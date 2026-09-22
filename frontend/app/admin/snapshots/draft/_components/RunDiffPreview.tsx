"use client";

/**
 * RunDiffPreview — orchestrates the diff view for a reviewable or terminal staged run.
 *
 * States (priority order):
 * 1. running — the staging run's background worker hasn't finished yet; no
 *    diff fetch, no commit/discard actions.
 * 2. loading — spinner "Loading changes..."
 * 3. error — warm red card + retry
 * 4. terminal guard — read-only notice, diff still shown
 * 5. empty (total_changed===0) — empty state with Discard still available
 * 6. diff — summary or drilldown view + action bar
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getRunDiff, discardPipelineRun } from "@/lib/api";
import { usePipelineRunsPolling } from "../../_components/usePipelineRunsPolling";
import { isReviewableRun, isTerminalRun } from "../_lib/runReview";
import { DiffSummaryView } from "./diff/DiffSummaryView";
import { DiffDrilldownTable } from "./diff/DiffDrilldownTable";
import { RunDiffActionBar } from "./diff/RunDiffActionBar";
import type { PipelineRun, RunDiff } from "@/lib/types";

interface RunDiffPreviewProps {
  runId: string;
  run: PipelineRun | null;
  onBack: () => void;
  onCommitted: () => void;
  onDiscarded: () => void;
}

type ViewMode = "summary" | "drilldown";

/**
 * How long a run has been going, in words. The Discard dialog asks Chris to
 * tell a stuck run from a healthy one, and without this the two look identical.
 */
function runAge(startedAt: string | null | undefined): string | null {
  if (!startedAt) return null;
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return null;
  const minutes = Math.floor((Date.now() - started) / 60_000);
  if (minutes < 1) return "started just now";
  if (minutes < 60) return `started ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `started ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `started ${days} day${days === 1 ? "" : "s"} ago`;
}

function ViewToggleButton({
  active,
  id,
  onClick,
  children,
}: {
  active: boolean;
  id: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      id={id}
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-[#0e0907] text-white"
          : "bg-white text-neutral-600 hover:bg-neutral-50"
      )}
    >
      {children}
    </button>
  );
}

export function RunDiffPreview({
  runId,
  run,
  onBack,
  onCommitted,
  onDiscarded,
}: RunDiffPreviewProps) {
  const [diff, setDiff] = useState<RunDiff | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "error" | "ready">("loading");
  const [viewMode, setViewMode] = useState<ViewMode>("summary");
  const [jumpSkill, setJumpSkill] = useState<string | null>(null);
  const [discardingStuck, setDiscardingStuck] = useState(false);
  const [stuckError, setStuckError] = useState<string | null>(null);

  // The run prop comes from the parent's run list, fetched once and not
  // live — the backend stages threshold_edit/skill_evaluation runs on a
  // background worker, so a freshly-created run is still "running" when we
  // land here. Poll for the live status instead of trusting the stale prop,
  // and don't fetch (or offer to commit) a diff that isn't done computing.
  const { run: polledRun } = usePipelineRunsPolling(runId);
  const effectiveRun = polledRun ?? run;
  const isRunning = effectiveRun == null || effectiveRun.status === "running";

  const loadDiff = useCallback(async () => {
    setLoadState("loading");
    try {
      const res = await getRunDiff(runId);
      if (res.success && res.data) {
        setDiff(res.data);
        setLoadState("ready");
      } else {
        setLoadState("error");
      }
    } catch {
      setLoadState("error");
    }
  }, [runId]);

  useEffect(() => {
    if (isRunning) return;
    loadDiff();
  }, [loadDiff, isRunning]);

  // A develop push restarts the server mid-run, and the run's row stays at
  // `running` forever with no worker behind it. The backend's discard accepts
  // a running run, so the control is always offered — the dialog carries the
  // cost rather than hiding the control behind a timer (M2.17a).
  const handleDiscardStuck = useCallback(async () => {
    if (discardingStuck) return;
    const confirmed = window.confirm(
      "Only discard a run that is stuck because a develop push restarted the server. " +
        "A healthy run keeps working, and discarding it throws its work away."
    );
    if (!confirmed) return;

    setDiscardingStuck(true);
    setStuckError(null);
    try {
      const res = await discardPipelineRun(runId);
      if (res.success) {
        onDiscarded();
      } else {
        setStuckError(res.error ?? "Failed to discard run.");
      }
    } catch {
      setStuckError("Could not reach the backend to discard this run.");
    } finally {
      setDiscardingStuck(false);
    }
  }, [discardingStuck, runId, onDiscarded]);

  const terminal = effectiveRun ? isTerminalRun(effectiveRun) : false;
  const canAct = effectiveRun ? isReviewableRun(effectiveRun) : false;

  // ── Running state ──────────────────────────────────────────────────────────
  if (isRunning) {
    return (
      <div id="run-diff-preview">
        <button
          id="diff-back-btn"
          type="button"
          onClick={onBack}
          className="text-xs text-neutral-500 hover:text-[#0e0907] underline mb-4 block"
        >
          Back to runs
        </button>
        <div
          id="run-diff-preview-running"
          className="flex items-center gap-2 text-neutral-400 text-sm pt-12 pb-6 justify-center"
        >
          <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          <span id="run-diff-preview-running-age">
            Run in progress — re-evaluating players, this can take a moment
            {runAge(effectiveRun?.started_at) ? ` (${runAge(effectiveRun?.started_at)})` : ""}.
          </span>
        </div>

        <div className="flex flex-col items-center gap-2 pb-12">
          <button
            id="run-diff-preview-discard-stuck-btn"
            type="button"
            onClick={handleDiscardStuck}
            disabled={discardingStuck}
            className={cn(
              "px-4 py-2 rounded-[4px] text-xs font-medium transition-colors",
              "border border-[#d9d0c9] bg-white text-neutral-600 hover:text-[#0e0907] hover:border-[#0e0907]",
              "focus:outline-none focus:ring-2 focus:ring-[#d9d0c9] focus:ring-offset-2",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {discardingStuck ? "Discarding…" : "Discard stuck run"}
          </button>
          <p className="text-[11px] text-neutral-500 max-w-sm text-center">
            A deploy that restarts the server leaves its run at &ldquo;running&rdquo; forever. Use this
            only then — it throws away the work of a run that is still going.
          </p>
          {stuckError && (
            <div
              id="run-diff-preview-discard-stuck-error"
              role="alert"
              className="rounded-[6px] border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
            >
              {stuckError}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loadState === "loading") {
    return (
      <div
        id="run-diff-preview"
        className="flex items-center gap-2 text-neutral-400 text-sm py-12 justify-center"
      >
        <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        Loading changes...
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (loadState === "error") {
    return (
      <div id="run-diff-preview">
        <button
          id="diff-back-btn"
          type="button"
          onClick={onBack}
          className="text-xs text-neutral-500 hover:text-[#0e0907] underline mb-4 block"
        >
          Back to runs
        </button>
        <div
          id="diff-error"
          className="rounded-[6px] border border-red-200 bg-red-50 px-6 py-8 text-center"
        >
          <p className="text-sm font-medium text-red-700">
            Could not load the diff for this run.
          </p>
          <button
            id="diff-retry-btn"
            type="button"
            onClick={loadDiff}
            className="text-xs text-red-600 underline mt-2 hover:text-red-700"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!diff) return null;

  const isEmpty = diff.summary.total_changed === 0;

  return (
    <div id="run-diff-preview">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <button
            id="diff-back-btn"
            type="button"
            onClick={onBack}
            className="text-xs text-neutral-500 hover:text-[#0e0907] underline mb-1 block"
          >
            Back to runs
          </button>
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-[#0e0907]">
              {effectiveRun?.pipeline_name === "threshold_edit" ? "Threshold Edit" : "Skill Evaluation"} Diff
            </h2>
            <span className="font-mono text-[11px] text-neutral-400">{runId}</span>
          </div>
        </div>

        {/* View toggle — only visible when diff is non-empty */}
        {!isEmpty && (
          <div
            id="diff-view-toggle"
            className="inline-flex rounded border border-[#d9d0c9] overflow-hidden"
          >
            <ViewToggleButton
              id="diff-view-summary-btn"
              active={viewMode === "summary"}
              onClick={() => setViewMode("summary")}
            >
              Summary
            </ViewToggleButton>
            <ViewToggleButton
              id="diff-view-drilldown-btn"
              active={viewMode === "drilldown"}
              onClick={() => {
                setViewMode("drilldown");
                setJumpSkill(null);
              }}
            >
              All changes
            </ViewToggleButton>
          </div>
        )}
      </div>

      {/* Terminal notice (replaces action bar, diff still shown read-only) */}
      {terminal && effectiveRun && (
        <div
          id="diff-terminal-notice"
          className={cn(
            "mb-4 px-4 py-2.5 rounded-[6px] text-xs border",
            effectiveRun.committed_at
              ? "bg-green-50 border-green-200 text-green-800"
              : "bg-slate-50 border-slate-200 text-slate-600"
          )}
        >
          {effectiveRun.committed_at
            ? `Committed ${new Date(effectiveRun.committed_at).toLocaleString()}. This run is read-only.`
            : "Discarded. This run is read-only."}
        </div>
      )}

      {/* Empty state */}
      {isEmpty ? (
        <div
          id="diff-empty"
          className="rounded-[6px] border border-[#d9d0c9] px-6 py-10 text-center"
          style={{ backgroundColor: "#fef9f5" }}
        >
          <p className="text-sm font-medium text-[#0e0907] mb-1">No tier changes in this run.</p>
          <p className="text-xs text-neutral-500 mb-4">Nothing to commit.</p>
          {canAct && (
            <RunDiffActionBar
              runId={runId}
              onCommitted={onCommitted}
              onDiscarded={onDiscarded}
            />
          )}
        </div>
      ) : (
        <>
          {/* Summary or drilldown view */}
          {viewMode === "summary" ? (
            <DiffSummaryView
              summary={diff.summary}
              onJumpToSkill={(skill) => {
                setJumpSkill(skill);
                setViewMode("drilldown");
              }}
            />
          ) : (
            <DiffDrilldownTable
              changes={diff.changes}
              summary={diff.summary}
              preselectedSkill={jumpSkill}
            />
          )}

          {/* Action bar — only for reviewable (success, uncommitted) runs */}
          {canAct && (
            <RunDiffActionBar
              runId={runId}
              onCommitted={onCommitted}
              onDiscarded={onDiscarded}
            />
          )}
        </>
      )}
    </div>
  );
}
