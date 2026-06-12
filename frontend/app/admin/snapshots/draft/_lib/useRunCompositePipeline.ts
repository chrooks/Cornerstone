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

import { runCompositeBatchScoped, moveReviewToDraft } from "@/lib/api";
import type { SnapshotDraftSummary } from "@/lib/types";
import type { TabSlug } from "./tabRouting";

interface UseRunCompositePipelineArgs {
  draft: SnapshotDraftSummary;
  /** Re-fetch the shell's draft status + cross-tab summary/validation counts. */
  reload: () => Promise<void>;
  /** Navigate the workspace to another tab. */
  onTabChange: (slug: TabSlug) => void;
  /** Consumer-specific refresh after a successful run (e.g. reload a local list). */
  onComplete?: () => void | Promise<void>;
}

export interface UseRunCompositePipeline {
  /** True while compositing (and any revert) is in flight. */
  isRunning: boolean;
  /** The player_ids awaiting confirmation, or null when the dialog is closed. */
  pendingIds: string[] | null;
  /** Begin a run for the given selection. Opens the confirm dialog in `review`. */
  start: (playerIds: string[]) => void;
  /** Confirm the pending run (review-status path). */
  confirm: () => void;
  /** Dismiss the confirm dialog without running. */
  cancel: () => void;
}

export function useRunCompositePipeline({
  draft,
  reload,
  onTabChange,
  onComplete,
}: UseRunCompositePipelineArgs): UseRunCompositePipeline {
  const [isRunning, setIsRunning] = useState(false);
  const [pendingIds, setPendingIds] = useState<string[] | null>(null);

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
        const { processed, flagged_for_review, errors, estimated_cost_usd } =
          res.data;
        toast.success(
          `Composited ${processed} player${processed !== 1 ? "s" : ""}` +
            `${flagged_for_review ? `, ${flagged_for_review} flagged for review` : ""}` +
            `${errors ? `, ${errors} error${errors !== 1 ? "s" : ""}` : ""}` +
            ` (~$${estimated_cost_usd.toFixed(2)})`,
        );

        // Review-status path: revert to draft so the new composites/flags are
        // editable and reviewable, then land the admin in the Review tab.
        let reverted = false;
        if (revertToDraft) {
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
        setPendingIds(null);
      }
    },
    [draft.id, draft.season, reload, onComplete, onTabChange],
  );

  const start = useCallback(
    (playerIds: string[]) => {
      if (playerIds.length === 0) return;
      if (draft.status === "review") {
        // Defer to the confirm dialog — running here will revert to draft.
        setPendingIds(playerIds);
        return;
      }
      void execute(playerIds, false);
    },
    [draft.status, execute],
  );

  const confirm = useCallback(() => {
    if (pendingIds) void execute(pendingIds, true);
  }, [pendingIds, execute]);

  const cancel = useCallback(() => setPendingIds(null), []);

  return { isRunning, pendingIds, start, confirm, cancel };
}
