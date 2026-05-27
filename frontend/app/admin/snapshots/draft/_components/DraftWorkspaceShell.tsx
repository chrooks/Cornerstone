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

  // Derive gate context from current draft state
  const gateContext: TabGateContext = {
    hasDraft: !!draft,
    draftStatus: draft?.status ?? null,
  };

  // Resolve active tab from URL, falling back to overview if gated
  const tabParam = searchParams.get("tab");
  const focusRunId = searchParams.get("run");
  const activeTab = resolveActiveTab(tabParam, gateContext);

  // If the URL has a gated/invalid tab, rewrite it immediately
  useEffect(() => {
    if (tabParam && tabParam !== activeTab) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", activeTab);
      router.replace(`?${params.toString()}`);
    }
  }, [tabParam, activeTab, router, searchParams]);

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
    async (label: string, allowMissing: boolean) => {
      if (!draft) return;
      setIsPublishing(true);
      try {
        const res = await publishDraft(draft.id, label, allowMissing);
        if (res.success && res.data) {
          toast.success(`Published as "${res.data.label}"`);
          setPublishModalOpen(false);
          router.replace(`/admin/snapshots/${res.data.id}`);
        } else {
          toast.error(res.error ?? "Failed to publish");
        }
      } catch {
        toast.error("Failed to publish");
      } finally {
        setIsPublishing(false);
      }
    },
    [draft, router]
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
    <main id="snapshot-draft-page" className="max-w-[1180px] mx-auto px-4 py-8 pb-28">
      <Toaster position="top-right" richColors />

      {/* Header strip */}
      <header id="snapshot-draft-header" className="flex items-start justify-between gap-4 mb-6">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-neutral-400 mb-1">
            Admin · Snapshots · Draft
          </p>
          {draft ? (
            <div id="snapshot-draft-header-inner" className="flex items-center gap-3">
              <h1 id="snapshot-draft-title" className="text-2xl font-bold text-[#0e0907]">
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
            <h1 id="snapshot-draft-title-empty" className="text-2xl font-bold text-[#0e0907]">
              Draft Workspace
            </h1>
          )}
          {draft && (
            <p id="snapshot-draft-date" className="text-xs text-neutral-500 mt-1">
              Created {new Date(draft.created_at).toLocaleDateString()}
            </p>
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
              onOpenPublishModal={() => setPublishModalOpen(true)}
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
                onClick={() => setPublishModalOpen(true)}
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
          isPublishing={isPublishing}
        />
      )}
    </main>
  );
}
