"use client";

/**
 * RunDiffPreview — orchestrates the diff view for a reviewable or terminal staged run.
 *
 * States (priority order):
 * 1. loading — spinner "Loading changes..."
 * 2. error — warm red card + retry
 * 3. terminal guard — read-only notice, diff still shown
 * 4. empty (total_changed===0) — empty state with Discard still available
 * 5. diff — summary or drilldown view + action bar
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getRunDiff } from "@/lib/api";
import { isTerminalRun } from "../_lib/runReview";
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
    loadDiff();
  }, [loadDiff]);

  const terminal = run ? isTerminalRun(run) : false;

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
              {run?.pipeline_name === "threshold_edit" ? "Threshold Edit" : "Skill Evaluation"} Diff
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
      {terminal && run && (
        <div
          id="diff-terminal-notice"
          className={cn(
            "mb-4 px-4 py-2.5 rounded-[6px] text-xs border",
            run.committed_at
              ? "bg-green-50 border-green-200 text-green-800"
              : "bg-slate-50 border-slate-200 text-slate-600"
          )}
        >
          {run.committed_at
            ? `Committed ${new Date(run.committed_at).toLocaleString()}. This run is read-only.`
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
          {!terminal && (
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

          {/* Action bar — only for non-terminal runs */}
          {!terminal && (
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
