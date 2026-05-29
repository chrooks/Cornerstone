"use client";

/**
 * DraftWorkspaceShell — the main client component for the draft workspace.
 *
 * Placed inside <Suspense> by page.tsx so useSearchParams is safe in Next 15.
 *
 * Responsibilities:
 *  - Draft/summary/validation fetch + reload
 *  - URL-pinned tab state via ?tab= (useSearchParams + router.replace)
 *  - TabStrip
 *  - Empty State Affordance when no draft exists
 *  - Active tab rendering (delegates to _tabs/)
 *  - Sticky lifecycle action bar
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast, Toaster } from "sonner";
import { cn } from "@/lib/utils";
import {
  getDraftSnapshot,
  getDraftSummary,
  getDraftValidation,
  moveDraftToReview,
  moveReviewToDraft,
  createDraftSnapshot,
} from "@/lib/api";
import type {
  SnapshotDraftSummary,
  SnapshotCountSummary,
  SnapshotPublishValidation,
} from "@/lib/types";
import { StateChip } from "../../_components/StateChip";
import { DiscardActions } from "../../_components/DiscardActions";
import { TabStrip } from "./TabStrip";
import { EmptyDraftCard } from "./EmptyDraftCard";
import { OverviewTab } from "../_tabs/OverviewTab";
import { PipelineTab } from "../_tabs/PipelineTab";
import { ThresholdsTab } from "../_tabs/ThresholdsTab";
import { ReviewTab } from "../_tabs/ReviewTab";
import { PublishTab } from "../_tabs/PublishTab";
import { PublishModal } from "../../_components/PublishModal";
import { publishDraft } from "@/lib/api";
import {
  resolveActiveTab,
  type TabSlug,
  type TabGateContext,
} from "../_lib/tabRouting";

type PageState = "loading" | "no-draft" | "ready" | "error";

export function DraftWorkspaceShell() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [pageState, setPageState] = useState<PageState>("loading");
  const [draft, setDraft] = useState<SnapshotDraftSummary | null>(null);
  const [summary, setSummary] = useState<SnapshotCountSummary | null>(null);
  const [validation, setValidation] = useState<SnapshotPublishValidation | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  // Issue #71: count-pin override Error State. publishCountChanged is true after a
  // publish was refused because open flags changed under the admin;
  // publishResetNonce disarms the override in the modal so they must re-confirm.
  const [publishCountChanged, setPublishCountChanged] = useState(false);
  const [publishResetNonce, setPublishResetNonce] = useState(0);

  // Derive gate context from current draft state
  const gateContext: TabGateContext = {
    hasDraft: !!draft,
    draftStatus: draft?.status ?? null,
  };

  // Resolve active tab from URL, falling back to overview if gated
  const tabParam = searchParams.get("tab");
  const focusRunId = searchParams.get("run");
  const activeTab = resolveActiveTab(tabParam, gateContext);

  // If the URL has a gated/invalid tab, rewrite it.
  // Skipped during initial draft load so that ?tab=thresholds on a real draft
  // isn't silently rewritten to overview before the fetch resolves.
  useEffect(() => {
    if (pageState === "loading") return;
    if (tabParam && tabParam !== activeTab) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", activeTab);
      router.replace(`?${params.toString()}`);
    }
  }, [pageState, tabParam, activeTab, router, searchParams]);

  // Safety: close PublishModal if status flips away from review while it's open
  // (e.g., another admin clicks "Back to draft" in a different window). Without
  // this, a submit from the open modal would publish a non-review draft.
  useEffect(() => {
    if (publishModalOpen && draft && draft.status !== "review") {
      setPublishModalOpen(false);
    }
  }, [draft, publishModalOpen]);

  const handleTabChange = useCallback(
    (slug: TabSlug) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", slug);
      // Clear run focus when switching tabs unless going to pipeline
      if (slug !== "pipeline") {
        params.delete("run");
      }
      router.replace(`?${params.toString()}`);
    },
    [router, searchParams]
  );

  const loadDraft = useCallback(async () => {
    const res = await getDraftSnapshot();
    if (!res.success || !res.data) {
      setPageState("no-draft");
      setDraft(null);
      return null;
    }
    setDraft(res.data);
    setPageState("ready");
    return res.data;
  }, []);

  const loadSummaryAndValidation = useCallback(async (draftId: string) => {
    const [sumRes, valRes] = await Promise.all([
      getDraftSummary(draftId),
      getDraftValidation(draftId),
    ]);
    if (sumRes.success && sumRes.data) setSummary(sumRes.data);
    if (valRes.success && valRes.data) setValidation(valRes.data);
  }, []);

  const reload = useCallback(async () => {
    const d = await loadDraft();
    if (d) await loadSummaryAndValidation(d.id);
  }, [loadDraft, loadSummaryAndValidation]);

  const openPublishModal = useCallback(() => {
    setPublishCountChanged(false);
    setPublishModalOpen(true);
    // Issue #71: refresh the open-flags count at open so the acknowledged number
    // is current — shrinks the stale-count window and keeps the Error State copy
    // honest if the count moved before the dialog opened.
    if (draft) void loadSummaryAndValidation(draft.id);
  }, [draft, loadSummaryAndValidation]);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleMoveToReview = useCallback(async () => {
    if (!draft) return;
    setIsTransitioning(true);
    try {
      const res = await moveDraftToReview(draft.id);
      if (res.success) {
        toast.success("Moved to review. Thresholds locked.");
        await reload();
        // Thresholds now disabled — if user is on that tab, resolveActiveTab will
        // redirect to overview on next render.
      } else {
        if (res.error === "pipeline_runs_in_flight") {
          toast.error("Wait for all pipeline runs to finish before moving to review.");
        } else {
          toast.error(res.error ?? "Failed to move to review");
        }
      }
    } catch {
      toast.error("Failed to move to review");
    } finally {
      setIsTransitioning(false);
    }
  }, [draft, reload]);

  const handleMoveToDraft = useCallback(async () => {
    if (!draft) return;
    setIsTransitioning(true);
    try {
      const res = await moveReviewToDraft(draft.id);
      if (res.success) {
        toast.success("Back to draft");
        await reload();
      } else {
        toast.error(res.error ?? "Failed to move back to draft");
      }
    } catch {
      toast.error("Failed to move back to draft");
    } finally {
      setIsTransitioning(false);
    }
  }, [draft, reload]);

  const handlePublish = useCallback(
    async (label: string, allowMissing: boolean, allowOpenFlags: boolean) => {
      if (!draft) return;
      setIsPublishing(true);
      try {
        // Issue #71: when overriding, send the open-flags count the admin saw so
        // the RPC can refuse if more flags appeared since.
        const acknowledgedOpenFlags = allowOpenFlags
          ? validation?.open_flags ?? 0
          : undefined;
        const res = await publishDraft(
          draft.id,
          label,
          allowMissing,
          allowOpenFlags,
          acknowledgedOpenFlags,
        );
        if (res.success && res.data) {
          // Issue #71: reflect the authoritative count actually bypassed, not the
          // acknowledged number, so the confirmation is honest.
          const bypassed = res.data.published_with_open_flags ?? 0;
          toast.success(
            bypassed > 0
              ? `Published as "${res.data.label}" — bypassed ${bypassed} open flag${bypassed === 1 ? "" : "s"}`
              : `Published as "${res.data.label}"`,
          );
          setPublishCountChanged(false);
          setPublishModalOpen(false);
          router.replace(`/admin/snapshots/${res.data.id}`);
        } else if (res.error?.includes("open_flags_changed")) {
          // Issue #71: the count moved under the admin. Refresh the validation
          // count, disarm the override, and keep the modal open so they re-confirm
          // against the new number.
          await reload();
          setPublishCountChanged(true);
          setPublishResetNonce((n) => n + 1);
          toast.error(
            "Open flags changed since you opened this dialog. Review the new count and confirm again.",
          );
        } else if (res.error?.includes("open_flags_not_acknowledged")) {
          toast.error("Open flags are unresolved. Check the override to publish anyway.");
        } else {
          toast.error(res.error ?? "Failed to publish");
        }
      } catch {
        toast.error("Failed to publish");
      } finally {
        setIsPublishing(false);
      }
    },
    [draft, router, reload, validation]
  );

  const handleDiscarded = useCallback(() => {
    router.replace("/admin/snapshots");
  }, [router]);

  const handleCreateDraft = useCallback(async () => {
    setIsCreating(true);
    try {
      const res = await createDraftSnapshot();
      if (res.success) {
        toast.success("Draft created");
        await reload();
      } else {
        toast.error(res.error ?? "Failed to create draft");
      }
    } catch {
      toast.error("Failed to create draft");
    } finally {
      setIsCreating(false);
    }
  }, [reload]);

  // ── Render ──────────────────────────────────────────────────────────────────

  const tabProps = draft
    ? {
        draft,
        summary,
        validation,
        reload,
        onTabChange: handleTabChange,
      }
    : null;

  if (pageState === "loading") {
    return (
      <main id="snapshot-draft-page-loading" className="max-w-[1180px] mx-auto px-4 py-8">
        <div className="flex items-center gap-2 text-neutral-400 text-sm">
          <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          Loading workspace…
        </div>
      </main>
    );
  }

  return (
    <main id="snapshot-draft-page" className="max-w-[1180px] mx-auto px-4 pt-4 pb-4">
      <Toaster position="top-right" richColors />

      {/* Header strip — compact: eyebrow (with created date) + title row on two lines */}
      <header id="snapshot-draft-header" className="flex items-start justify-between gap-4 mb-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-neutral-400 mb-0.5">
            Admin · Snapshots · Draft
            {draft && (
              <span className="normal-case tracking-normal text-neutral-400/80">
                {" · "}Created {new Date(draft.created_at).toLocaleDateString()}
              </span>
            )}
          </p>
          {draft ? (
            <div id="snapshot-draft-header-inner" className="flex items-center gap-3">
              <h1 id="snapshot-draft-title" className="text-lg font-bold text-[#0e0907]">
                {draft.label}
              </h1>
              <StateChip
                id="snapshot-draft-status-chip"
                variant={draft.status as "draft" | "review"}
              />
              {draft.has_running_jobs && (
                <span
                  id="snapshot-draft-running-indicator"
                  className="flex items-center gap-1 text-xs text-[#fe6d34]"
                >
                  <span className="inline-block w-2.5 h-2.5 border-2 border-[#fe6d34] border-t-transparent rounded-full animate-spin" />
                  Pipeline running
                </span>
              )}
            </div>
          ) : (
            <h1 id="snapshot-draft-title-empty" className="text-lg font-bold text-[#0e0907]">
              Draft Workspace
            </h1>
          )}
        </div>
      </header>

      {/* Tab strip — always rendered (tabs are disabled when no draft) */}
      <TabStrip
        id="snapshot-draft-tab-strip"
        activeTab={activeTab}
        gateContext={gateContext}
        onTabChange={handleTabChange}
      />

      {/* No-draft Empty State Affordance */}
      {pageState === "no-draft" && (
        <EmptyDraftCard
          id="snapshot-draft-empty-card"
          onCreateDraft={handleCreateDraft}
          isCreating={isCreating}
        />
      )}

      {/* Active tab content */}
      {pageState === "ready" && tabProps && (
        <div id="snapshot-draft-tab-content">
          {activeTab === "overview" && <OverviewTab {...tabProps} />}
          {activeTab === "pipeline" && (
            <PipelineTab {...tabProps} focusRunId={focusRunId} />
          )}
          {activeTab === "thresholds" && <ThresholdsTab {...tabProps} />}
          {activeTab === "review" && <ReviewTab {...tabProps} />}
          {activeTab === "publish" && (
            <PublishTab
              {...tabProps}
              onOpenPublishModal={openPublishModal}
              isPublishing={isPublishing}
            />
          )}
        </div>
      )}

      {/* Sticky action bar */}
      {draft && (
        <div
          id="snapshot-draft-action-bar"
          className="fixed bottom-6 right-6 flex items-center gap-3 z-20"
        >
          <DiscardActions
            id="snapshot-draft-discard-actions"
            draftId={draft.id}
            onDiscarded={handleDiscarded}
          />

          {draft.status === "review" ? (
            <>
              <button
                id="snapshot-draft-move-to-draft-btn"
                type="button"
                onClick={handleMoveToDraft}
                disabled={isTransitioning}
                className="text-xs font-medium text-neutral-600 hover:text-[#0e0907] transition-colors
                  border border-[#d9d0c9] rounded-[4px] px-3 py-1.5 bg-white
                  disabled:opacity-50"
              >
                Back to draft
              </button>
              <button
                id="snapshot-draft-publish-btn"
                type="button"
                onClick={openPublishModal}
                disabled={isTransitioning || isPublishing}
                className="text-xs font-semibold px-5 py-2 rounded-[4px] transition-colors
                  bg-[#ffa05c] text-[#0e0907] hover:bg-[#fe6d34]
                  focus:outline-none focus:ring-2 focus:ring-[#ffa05c] focus:ring-offset-2
                  disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Publish
              </button>
            </>
          ) : (
            <button
              id="snapshot-draft-move-to-review-btn"
              type="button"
              onClick={handleMoveToReview}
              disabled={isTransitioning || draft.has_running_jobs}
              title={
                draft.has_running_jobs
                  ? "Wait for pipeline runs to finish before moving to review"
                  : undefined
              }
              className={cn(
                "text-xs font-semibold px-5 py-2 rounded-[4px] transition-colors",
                "bg-[#ffa05c] text-[#0e0907] hover:bg-[#fe6d34]",
                "focus:outline-none focus:ring-2 focus:ring-[#ffa05c] focus:ring-offset-2",
                (isTransitioning || draft.has_running_jobs) && "opacity-50 cursor-not-allowed"
              )}
            >
              {isTransitioning ? "Moving…" : "Move to review"}
            </button>
          )}
        </div>
      )}

      {draft && (
        <PublishModal
          id="snapshot-publish-modal"
          open={publishModalOpen}
          onClose={() => setPublishModalOpen(false)}
          onPublish={handlePublish}
          playersMissingComposite={validation?.players_missing_composite ?? 0}
          openFlags={validation?.open_flags ?? 0}
          isPublishing={isPublishing}
          resetSignal={publishResetNonce}
          countChanged={publishCountChanged}
        />
      )}
    </main>
  );
}
