"use client";

/**
 * /admin/snapshots/draft — Draft dashboard Surface.
 *
 * Layout (1180px max-width):
 *  Header strip: auto-label + StateChip + lifecycle action
 *  3-up grid: Stat fetch | Salary scrape | Bio/Team sync (PipelineCard)
 *  2-up grid: Skill mapping → /admin/calibration | Compositing → /admin/review (StatusCard)
 *  CountSummary panel (review state only)
 *  Sticky bottom-right action bar: primary lifecycle action + DiscardActions
 *
 * Redirects to /admin/snapshots when no draft exists.
 *
 * One primary action:
 *  draft → "Move to review"
 *  review → "Publish"
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast, Toaster } from "sonner";
import { cn } from "@/lib/utils";
import {
  getDraftSnapshot,
  getDraftSummary,
  getDraftValidation,
  moveDraftToReview,
  moveReviewToDraft,
  publishDraft,
  triggerStatFetch,
  triggerSalaryScrape,
  triggerBioTeamSync,
} from "@/lib/api";
import type { SnapshotDraftSummary, SnapshotCountSummary, SnapshotPublishValidation } from "@/lib/types";
import { StateChip } from "../_components/StateChip";
import { PipelineCard } from "../_components/PipelineCard";
import { StatusCard } from "../_components/StatusCard";
import { CountSummary } from "../_components/CountSummary";
import { PublishModal } from "../_components/PublishModal";
import { DiscardActions } from "../_components/DiscardActions";

type PageState = "loading" | "no-draft" | "ready" | "error";

export default function SnapshotDraftPage() {
  const router = useRouter();
  const [pageState, setPageState] = useState<PageState>("loading");
  const [draft, setDraft] = useState<SnapshotDraftSummary | null>(null);
  const [summary, setSummary] = useState<SnapshotCountSummary | null>(null);
  const [validation, setValidation] = useState<SnapshotPublishValidation | null>(null);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);

  const loadDraft = useCallback(async () => {
    const res = await getDraftSnapshot();
    if (!res.success || !res.data) {
      setPageState("no-draft");
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

  useEffect(() => {
    loadDraft().then((d) => {
      if (d) loadSummaryAndValidation(d.id);
    });
  }, [loadDraft, loadSummaryAndValidation]);

  // Redirect to index when no draft
  useEffect(() => {
    if (pageState === "no-draft") {
      router.replace("/admin/snapshots");
    }
  }, [pageState, router]);

  const handleMoveToReview = useCallback(async () => {
    if (!draft) return;
    setIsTransitioning(true);
    try {
      const res = await moveDraftToReview(draft.id);
      if (res.success) {
        toast.success("Moved to review");
        const updated = await loadDraft();
        if (updated) await loadSummaryAndValidation(updated.id);
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
  }, [draft, loadDraft, loadSummaryAndValidation]);

  const handleMoveToDraft = useCallback(async () => {
    if (!draft) return;
    setIsTransitioning(true);
    try {
      const res = await moveReviewToDraft(draft.id);
      if (res.success) {
        toast.success("Back to draft");
        await loadDraft();
      } else {
        toast.error(res.error ?? "Failed to move back to draft");
      }
    } catch {
      toast.error("Failed to move back to draft");
    } finally {
      setIsTransitioning(false);
    }
  }, [draft, loadDraft]);

  const handlePublish = useCallback(async (label: string, allowMissing: boolean) => {
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
  }, [draft, router]);

  const handleDiscarded = useCallback(() => {
    router.replace("/admin/snapshots");
  }, [router]);

  if (pageState === "loading" || pageState === "no-draft") {
    return (
      <main id="snapshot-draft-page-loading" className="max-w-[1180px] mx-auto px-4 py-8">
        <div className="flex items-center gap-2 text-neutral-400 text-sm">
          <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          Loading draft…
        </div>
      </main>
    );
  }

  if (!draft) return null;

  const isReview = draft.status === "review";
  const isFrozen = isReview;

  return (
    <main id="snapshot-draft-page" className="max-w-[1180px] mx-auto px-4 py-8 pb-28">
      <Toaster position="top-right" richColors />

      {/* Header strip */}
      <header id="snapshot-draft-header" className="flex items-start justify-between gap-4 mb-10">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-neutral-400 mb-1">
            Admin · Snapshots · Draft
          </p>
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
          <p id="snapshot-draft-date" className="text-xs text-neutral-500 mt-1">
            Created {new Date(draft.created_at).toLocaleDateString()}
          </p>
        </div>
      </header>

      {/* 3-up pipeline cards */}
      <section id="snapshot-draft-pipeline-section" className="mb-10">
        <h2 className="text-[11px] uppercase tracking-wider font-semibold text-neutral-400 mb-4">
          Ingestion Pipelines
        </h2>
        <div
          id="snapshot-draft-pipeline-grid"
          className="grid grid-cols-1 md:grid-cols-3 gap-4"
        >
          <PipelineCard
            id="pipeline-card-stat-fetch"
            title="Stat Fetch"
            description="Pull current-season stats from NBA.com for all qualifying players."
            frozen={isFrozen}
            onBulkRun={async () => {
              const res = await triggerStatFetch();
              if (!res.success || !res.data) throw new Error(res.error ?? "Failed");
              return res.data.run_id;
            }}
            onPlayerRun={async (playerId) => {
              const res = await triggerStatFetch({ player_ids: [playerId] });
              if (!res.success || !res.data) throw new Error(res.error ?? "Failed");
              return res.data.run_id;
            }}
          />

          <PipelineCard
            id="pipeline-card-salary-scrape"
            title="Salary Scrape"
            description="Scrape current contract values from ESPN for all players."
            frozen={isFrozen}
            onBulkRun={async () => {
              const res = await triggerSalaryScrape();
              if (!res.success || !res.data) throw new Error(res.error ?? "Failed");
              return res.data.run_id;
            }}
            onPlayerRun={async (playerId) => {
              const res = await triggerSalaryScrape(playerId);
              if (!res.success || !res.data) throw new Error(res.error ?? "Failed");
              return res.data.run_id;
            }}
          />

          <PipelineCard
            id="pipeline-card-bio-team-sync"
            title="Bio / Team Sync"
            description="Refresh name, team, position, and physical attributes from NBA.com."
            frozen={isFrozen}
            onBulkRun={async () => {
              const res = await triggerBioTeamSync();
              if (!res.success || !res.data) throw new Error(res.error ?? "Failed");
              return res.data.run_id;
            }}
            onPlayerRun={async (playerId) => {
              const res = await triggerBioTeamSync(playerId);
              if (!res.success || !res.data) throw new Error(res.error ?? "Failed");
              return res.data.run_id;
            }}
          />
        </div>
      </section>

      {/* 2-up status cards */}
      <section id="snapshot-draft-status-section" className="mb-10">
        <h2 className="text-[11px] uppercase tracking-wider font-semibold text-neutral-400 mb-4">
          Evaluation Status
        </h2>
        <div
          id="snapshot-draft-status-grid"
          className="grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          <StatusCard
            id="status-card-skill-mapping"
            title="Skill Mapping"
            description="Run the stat-to-skill threshold engine and edit threshold rules."
            href="/admin/calibration"
          />
          <StatusCard
            id="status-card-compositing"
            title="Compositing"
            description="Resolve Claude vs. stats disagreements and manage composite profiles."
            href="/admin/review"
          />
        </div>
      </section>

      {/* Count summary (review only) */}
      {isReview && summary && (
        <section id="snapshot-draft-count-summary-section" className="mb-10">
          <h2 className="text-[11px] uppercase tracking-wider font-semibold text-neutral-400 mb-4">
            Publish Summary
          </h2>
          <CountSummary
            id="snapshot-draft-count-summary"
            summary={summary}
            missingCompositePlayers={validation?.missing_composite_players ?? []}
          />
        </section>
      )}

      {/* Sticky action bar */}
      <div
        id="snapshot-draft-action-bar"
        className="fixed bottom-6 right-6 flex items-center gap-3 z-20"
      >
        {/* Secondary: DiscardActions */}
        <DiscardActions
          id="snapshot-draft-discard-actions"
          draftId={draft.id}
          onDiscarded={handleDiscarded}
        />

        {/* Primary lifecycle action */}
        {isReview ? (
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
              (isTransitioning || draft.has_running_jobs) && "opacity-50 cursor-not-allowed",
            )}
          >
            {isTransitioning ? "Moving…" : "Move to review"}
          </button>
        )}
      </div>

      {/* Publish modal */}
      <PublishModal
        id="snapshot-publish-modal"
        open={publishModalOpen}
        onClose={() => setPublishModalOpen(false)}
        onPublish={handlePublish}
        playersMissingComposite={validation?.players_missing_composite ?? 0}
        isPublishing={isPublishing}
      />
    </main>
  );
}
