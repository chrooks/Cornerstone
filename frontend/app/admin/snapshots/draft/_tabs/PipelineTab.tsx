"use client";

/**
 * PipelineTab — run history list for the draft workspace.
 *
 * - Shows pipeline runs scoped to the current draft.
 * - Highlights a specific run when `focusRunId` is set (from `?run=<id>` URL param).
 * - The PipelineCards (trigger controls) live in OverviewTab; this tab is read-only history.
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getDraftPipelineRuns } from "@/lib/api";
import type { SnapshotDraftSummary, SnapshotCountSummary, SnapshotPublishValidation, PipelineRun } from "@/lib/types";
import type { TabSlug } from "../_lib/tabRouting";

export interface PipelineTabProps {
  draft: SnapshotDraftSummary;
  summary: SnapshotCountSummary | null;
  validation: SnapshotPublishValidation | null;
  reload: () => Promise<void>;
  onTabChange: (slug: TabSlug) => void;
  /** run_id to auto-scroll/highlight — from `?run=<id>` search param. */
  focusRunId?: string | null;
}

const PIPELINE_LABELS: Record<string, string> = {
  stat_fetch: "Stat Fetch",
  salary_scrape: "Salary Scrape",
  bio_team_sync: "Bio / Team Sync",
  threshold_edit: "Threshold Edit",
};

function RunStatusBadge({ status }: { status: PipelineRun["status"] }) {
  const classMap: Record<PipelineRun["status"], string> = {
    running: "bg-[#ffa05c]/20 text-[#fe6d34] border border-[#ffa05c]/40",
    success: "bg-green-50 text-green-700 border border-green-200",
    error: "bg-red-50 text-red-700 border border-red-200",
  };
  const labels: Record<PipelineRun["status"], string> = {
    running: "Running",
    success: "Success",
    error: "Error",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded",
        classMap[status]
      )}
    >
      {status === "running" && (
        <span className="mr-1 inline-block w-2 h-2 border border-current border-t-transparent rounded-full animate-spin" />
      )}
      {labels[status]}
    </span>
  );
}

export function PipelineTab({ draft, focusRunId }: PipelineTabProps) {
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getDraftPipelineRuns(draft.id);
      if (res.success && res.data) {
        setRuns(res.data);
      } else {
        // Route not yet deployed — treat as empty list, not an error
        setRuns([]);
      }
    } catch {
      setError("Could not load pipeline runs.");
    } finally {
      setLoading(false);
    }
  }, [draft.id]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  return (
    <div id="pipeline-tab-content">
      <div id="pipeline-tab-header" className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-base font-semibold text-[#0e0907]">Pipeline Runs</h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            All runs scoped to this draft.
          </p>
        </div>
        <button
          id="pipeline-tab-refresh-btn"
          type="button"
          onClick={loadRuns}
          disabled={loading}
          className="text-xs text-neutral-500 hover:text-[#0e0907] underline disabled:opacity-50 transition-colors"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {!loading && error && (
        <div
          id="pipeline-tab-error"
          className="rounded-[6px] border border-red-200 bg-red-50 px-6 py-8 text-center"
        >
          <p className="text-sm font-medium text-red-700">{error}</p>
          <button
            type="button"
            onClick={loadRuns}
            className="text-xs text-red-600 underline mt-2 hover:text-red-700"
          >
            Try again
          </button>
        </div>
      )}

      {!loading && !error && runs.length === 0 && (
        <div
          id="pipeline-tab-empty"
          className="rounded-[6px] border border-[#d9d0c9] px-6 py-8 text-center"
          style={{ backgroundColor: "#fef9f5" }}
        >
          <p className="text-sm text-neutral-500">No pipeline runs yet for this draft.</p>
          <p className="text-xs text-neutral-400 mt-1">
            Trigger a run from the Overview tab (Stat Fetch, Salary Scrape, or
            Bio / Team Sync) to see activity here.
          </p>
        </div>
      )}

      {!error && runs.length > 0 && (
        <div id="pipeline-tab-run-list" className="space-y-3">
          {runs.map((run) => {
            const isFocused = focusRunId === run.id;
            return (
              <article
                key={run.id}
                id={`pipeline-run-${run.id}`}
                className={cn(
                  "rounded-[6px] border px-5 py-4",
                  isFocused
                    ? "border-[#ffa05c] bg-[#fff8f4]"
                    : "border-[#d9d0c9] bg-white"
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-[#0e0907]">
                      {PIPELINE_LABELS[run.pipeline_name] ?? run.pipeline_name}
                      {run.scope === "player" && (
                        <span className="ml-2 text-[11px] font-normal text-neutral-400">
                          (single player)
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-neutral-400 mt-0.5 font-mono">
                      {run.id}
                    </p>
                  </div>
                  <RunStatusBadge status={run.status} />
                </div>

                <div className="flex items-center gap-4 mt-3 text-xs text-neutral-500">
                  <span>
                    Started: {new Date(run.started_at).toLocaleString()}
                  </span>
                  {run.finished_at && (
                    <span>
                      Finished: {new Date(run.finished_at).toLocaleString()}
                    </span>
                  )}
                  {run.rows_processed > 0 && (
                    <span>{run.rows_processed} rows</span>
                  )}
                </div>

                {run.status === "error" && run.error_tail && (
                  <details className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-xs">
                    <summary className="font-medium text-red-700 cursor-pointer select-none mb-1">
                      Error detail
                    </summary>
                    <pre className="whitespace-pre-wrap font-mono text-red-600 text-[11px] leading-relaxed">
                      {run.error_tail}
                    </pre>
                  </details>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
