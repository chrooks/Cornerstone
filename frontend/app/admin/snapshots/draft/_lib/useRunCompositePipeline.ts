"use client";

/**
 * useRunCompositePipeline — shared "run the compositing pipeline for a selection"
 * behavior used by the Player Pool tab and the Publish tab's missing-composite
 * footer.
 *
 * The compositing pipeline changes Skill ratings. A snapshot in `review` is
 * meant to be frozen for final inspection, so running it there would strand the
 * new composites/flags behind the locked Review tab. To keep that invariant
 * honest, running in `review` first asks the admin to confirm, then — after
 * compositing — reverts the snapshot to `draft` and routes them to the Review
 * tab so the new flags are resolvable.
 *
 * In `draft` status it just runs (no confirm, no revert).
 */

import { useCallback, useState } from "react";
import { toast } from "sonner";

import {
  runCompositeBatchScoped,
  moveReviewToDraft,
  triggerStatFetch,
  getPipelineRun,
} from "@/lib/api";
import type { SnapshotDraftSummary } from "@/lib/types";
import type { TabSlug } from "./tabRouting";

/** Mode awaiting confirmation in `review` — both change ratings, so both revert. */
type PendingMode = "composite" | "combined";

/** Poll a background run until it leaves `running`. Returns the terminal status. */
async function waitForRun(
  runId: string,
  { intervalMs = 2500, maxMs = 300_000 }: { intervalMs?: number; maxMs?: number } = {},
): Promise<"success" | "error" | "discarded" | "timeout"> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxMs) {
    const res = await getPipelineRun(runId);
    const status = res.data?.status;
    if (status && status !== "running") return status;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return "timeout";
}

interface UseRunCompositePipelineArgs {
  draft: SnapshotDraftSummary;
  /** Re-fetch the shell's draft status + cross-tab summary/validation counts. */
  reload: () => Promise<void>;
  /** Navigate the workspace to another tab. */
  onTabChange: (slug: TabSlug) => void;
  /** Consumer-specific refresh after a successful run (e.g. reload a local list). */
  onComplete?: () => void | Promise<void>;
  /**
   * Issue #69: mark the upcoming review→draft revert as a locally-initiated
   * flip so the shell's silent-flip Feedback effect doesn't also toast for it
   * (this hook already toasts "Moved back to draft — resolve the new flags…").
   */
  markLocalTransition?: () => void;
}

export interface UseRunCompositePipeline {
  /** True while compositing (and any revert) is in flight. */
  isRunning: boolean;
  /** True while a Stat Fetch is running for the selection (incl. the combined path's fetch leg). */
  isFetchingStats: boolean;
  /** The player_ids awaiting confirmation, or null when the dialog is closed. */
  pendingIds: string[] | null;
  /** Which action is pending confirmation, or null. Drives the confirm dialog copy. */
  pendingMode: PendingMode | null;
  /** Composite-only for the selection. Opens the confirm dialog in `review`. */
  start: (playerIds: string[]) => void;
  /** Default action: Fetch stats, then composite. Opens the confirm dialog in `review`. */
  runStatsThenComposite: (playerIds: string[]) => void;
  /** Confirm the pending run (review-status path) — dispatches by pendingMode. */
  confirm: () => void;
  /** Dismiss the confirm dialog without running. */
  cancel: () => void;
  /** Stat Fetch only for the selection (no status flip, no confirm). */
  runStatFetch: (playerIds: string[]) => void;
}

export function useRunCompositePipeline({
  draft,
  reload,
  onTabChange,
  onComplete,
  markLocalTransition,
}: UseRunCompositePipelineArgs): UseRunCompositePipeline {
  const [isRunning, setIsRunning] = useState(false);
  const [isFetchingStats, setIsFetchingStats] = useState(false);
  const [pending, setPending] = useState<{ ids: string[]; mode: PendingMode } | null>(null);

  const execute = useCallback(
    async (ids: string[], revertToDraft: boolean) => {
      if (ids.length === 0) return;
      setIsRunning(true);
      toast.info(
        `Running the compositing pipeline for ${ids.length} player${ids.length !== 1 ? "s" : ""}… this calls Claude and can take a moment.`,
      );
      try {
        const res = await runCompositeBatchScoped({
          player_ids: ids,
          season: draft.season,
        });
        if (!res.success || !res.data) {
          toast.error(res.error ?? "Failed to run the compositing pipeline");
          return;
        }
        const { processed, flagged_for_review, errors, skipped_no_stats, estimated_cost_usd } =
          res.data;

        // Nothing composited because the selection has no stats — composite reads
        // stats, it doesn't fetch them. Tell the admin what to do instead of a
        // silent "Composited 0".
        if (processed === 0 && skipped_no_stats > 0) {
          toast.warning(
            `Composited 0 — ${skipped_no_stats} player${skipped_no_stats !== 1 ? "s have" : " has"} no stats yet. ` +
              `Run Stat Fetch for them first, then composite.`,
          );
        } else {
          toast.success(
            `Composited ${processed} player${processed !== 1 ? "s" : ""}` +
              `${flagged_for_review ? `, ${flagged_for_review} flagged for review` : ""}` +
              `${skipped_no_stats ? `, ${skipped_no_stats} skipped (no stats)` : ""}` +
              `${errors ? `, ${errors} error${errors !== 1 ? "s" : ""}` : ""}` +
              ` (~$${estimated_cost_usd.toFixed(2)})`,
          );
        }

        // Only revert + navigate when something actually composited. If every
        // selected player was skipped (no stats), nothing changed — keep the
        // warning on screen and don't pointlessly flip review→draft.
        let reverted = false;
        if (revertToDraft && processed > 0) {
          // Issue #69: arm the shell's local-transition marker before the flip so
          // the silent-flip Feedback effect treats this as a known local change.
          markLocalTransition?.();
          const moveRes = await moveReviewToDraft(draft.id);
          if (moveRes.success) {
            reverted = true;
            toast.info("Moved back to draft — resolve the new flags in Review.");
          } else {
            toast.error(
              moveRes.error ?? "Composited, but failed to move back to draft.",
            );
          }
        }

        await reload();
        await onComplete?.();
        if (reverted) onTabChange("review");
      } catch {
        toast.error("Failed to run the compositing pipeline");
      } finally {
        setIsRunning(false);
      }
    },
    [draft.id, draft.season, reload, onComplete, onTabChange, markLocalTransition],
  );

  // Stat Fetch leg: kick off the background run and wait for it to finish.
  // Returns true when stats were fetched (terminal success), false otherwise.
  const fetchStatsAndWait = useCallback(
    async (playerIds: string[]): Promise<boolean> => {
      const res = await triggerStatFetch({ player_ids: playerIds, season: draft.season });
      if (!res.success || !res.data) {
        toast.error(res.error ?? "Failed to start Stat Fetch");
        return false;
      }
      const runId = res.data.run_id;
      toast.info(
        `Fetching stats for ${playerIds.length} player${playerIds.length !== 1 ? "s" : ""}… ` +
          `track it in the Pipeline tab.`,
      );
      const status = await waitForRun(runId);
      if (status === "success") return true;
      if (status === "timeout") {
        toast.warning("Stat Fetch is taking a while — check the Pipeline tab, then composite.");
      } else {
        toast.error("Stat Fetch failed — see the Pipeline tab.");
      }
      return false;
    },
    [draft.season],
  );

  // Combined default: Fetch stats, wait, then composite the same selection.
  const doCombined = useCallback(
    async (ids: string[], revertToDraft: boolean) => {
      if (ids.length === 0) return;
      setIsFetchingStats(true);
      let fetched = false;
      try {
        fetched = await fetchStatsAndWait(ids);
        await reload();
      } finally {
        setIsFetchingStats(false);
      }
      // Composite even if the fetch leg reported non-success: players that DID
      // get stats should still be rated, and execute()'s 0-processed warning
      // covers the ones that truly have no stats.
      void fetched;
      await execute(ids, revertToDraft);
    },
    [fetchStatsAndWait, reload, execute],
  );

  const start = useCallback(
    (playerIds: string[]) => {
      if (playerIds.length === 0) return;
      if (draft.status === "review") {
        setPending({ ids: playerIds, mode: "composite" });
        return;
      }
      void execute(playerIds, false);
    },
    [draft.status, execute],
  );

  const runStatsThenComposite = useCallback(
    (playerIds: string[]) => {
      if (playerIds.length === 0) return;
      if (draft.status === "review") {
        setPending({ ids: playerIds, mode: "combined" });
        return;
      }
      void doCombined(playerIds, false);
    },
    [draft.status, doCombined],
  );

  const confirm = useCallback(() => {
    if (!pending) return;
    const { ids, mode } = pending;
    setPending(null);
    if (mode === "combined") void doCombined(ids, true);
    else void execute(ids, true);
  }, [pending, doCombined, execute]);

  const cancel = useCallback(() => setPending(null), []);

  // Stat Fetch only. Stats are the raw layer (composite is what the freeze
  // protects), so this does NOT flip status or need a confirm — it just
  // populates player_stats so a later composite run can process these players.
  const runStatFetch = useCallback(
    async (playerIds: string[]) => {
      if (playerIds.length === 0) return;
      setIsFetchingStats(true);
      try {
        const ok = await fetchStatsAndWait(playerIds);
        if (ok) {
          toast.success(
            `Stats fetched for ${playerIds.length} player${playerIds.length !== 1 ? "s" : ""}. ` +
              `Now run compositing.`,
          );
        }
        await reload();
        await onComplete?.();
      } finally {
        setIsFetchingStats(false);
      }
    },
    [fetchStatsAndWait, reload, onComplete],
  );

  return {
    isRunning,
    isFetchingStats,
    pendingIds: pending?.ids ?? null,
    pendingMode: pending?.mode ?? null,
    start,
    runStatsThenComposite,
    confirm,
    cancel,
    runStatFetch,
  };
}
