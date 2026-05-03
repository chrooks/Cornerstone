"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Toaster, toast } from "sonner";
import { cn } from "@/lib/utils";
import { getPipelineStatus, runStatsFetch, getJobStatus, runSkillsBatch, runCompositeBatch } from "@/lib/api";
import type { PipelineStatus } from "@/lib/types";

// Current season — keep in sync with CURRENT_SEASON in players_service.py
const CURRENT_SEASON = "2025-26";

/** A single stat tile in the status dashboard. */
function StatTile({
  label,
  value,
  total,
  className,
}: {
  label: string;
  value: number | null;
  total?: number;
  className?: string;
}) {
  const pct =
    value != null && total != null && total > 0
      ? Math.round((value / total) * 100)
      : null;

  return (
    <div className={cn("rounded-lg border border-border bg-card p-4", className)}>
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
        {label}
      </p>
      <p className="text-2xl font-bold tabular-nums text-foreground">
        {value ?? "—"}
      </p>
      {pct != null && (
        <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** A pipeline run step card with a "Run" button and result display. */
function StepCard({
  step,
  title,
  description,
  running,
  lastResult,
  onRun,
  disabled,
  headerExtra,
  progressNode,
}: {
  step: number;
  title: string;
  description: string;
  running: boolean;
  lastResult: React.ReactNode | null;
  onRun: () => void;
  disabled?: boolean;
  /** Optional controls rendered to the left of the Run button (e.g. checkboxes). */
  headerExtra?: React.ReactNode;
  /** Optional live progress display shown while running (replaces generic spinner). */
  progressNode?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-muted/30">
        <span className="flex-shrink-0 w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
          {step}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
        {headerExtra}
        <button
          type="button"
          onClick={onRun}
          disabled={running || disabled}
          className={cn(
            "flex-shrink-0 text-sm font-medium px-4 py-2 rounded-md transition-colors",
            "bg-primary text-primary-foreground hover:bg-primary/90",
            (running || disabled) && "opacity-50 cursor-not-allowed"
          )}
        >
          {running ? "Running…" : "Run"}
        </button>
      </div>

      {/* Result / spinner / progress */}
      <div className="px-5 py-4 min-h-[3rem]">
        {running ? (
          progressNode ?? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              {/* Simple CSS spinner */}
              <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              Processing — this may take several minutes for all players…
            </div>
          )
        ) : lastResult ? (
          <div className="text-sm">{lastResult}</div>
        ) : (
          <p className="text-xs text-muted-foreground italic">Not yet run this session.</p>
        )}
      </div>
    </div>
  );
}

export default function PipelinePage() {
  const [status, setStatus]             = useState<PipelineStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  // Step 0: Fetch Player Stats (background job with polling)
  const [step0Running, setStep0Running]         = useState(false);
  const [step0Result, setStep0Result]           = useState<React.ReactNode | null>(null);
  const [step0Progress, setStep0Progress]       = useState<{ progress: number; total: number; fetched: number; errors: number } | null>(null);
  // When true, bypass the 24-hour cache and re-fetch all stats from nba_api.
  const [step0ForceRefresh, setStep0ForceRefresh] = useState(false);
  // Ref to hold the polling interval so we can clear it on unmount
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Step 1: Skill Mapping
  const [step1Running, setStep1Running] = useState(false);
  const [step1Result, setStep1Result]   = useState<React.ReactNode | null>(null);

  // Step 2: Composite Pipeline
  const [step2Running, setStep2Running] = useState(false);
  const [step2Result, setStep2Result]   = useState<React.ReactNode | null>(null);

  // Refresh the status dashboard
  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    const res = await getPipelineStatus(CURRENT_SEASON);
    if (res.success && res.data) {
      setStatus(res.data);
    }
    setStatusLoading(false);
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // Clean up polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Run Step 0: kick off background stats fetch and poll for progress
  const handleRunStep0 = useCallback(async () => {
    setStep0Running(true);
    setStep0Result(null);
    setStep0Progress(null);

    try {
      const res = await runStatsFetch(CURRENT_SEASON, step0ForceRefresh);
      if (!res.success || !res.data) {
        setStep0Result(
          <p className="text-destructive text-sm">{res.error ?? "Unknown error"}</p>
        );
        toast.error(res.error ?? "Stats fetch failed");
        setStep0Running(false);
        return;
      }

      const jobId = res.data.job_id;

      // Poll every 3 seconds for job progress
      pollRef.current = setInterval(async () => {
        try {
          const poll = await getJobStatus(jobId);
          if (!poll.success || !poll.data) return;

          const j = poll.data;

          // Update live progress counters
          setStep0Progress({
            progress: j.progress,
            total:    j.total,
            fetched:  j.fetched,
            errors:   j.errors,
          });

          // Job finished — stop polling and show final result
          if (j.status === "complete" || j.status === "error") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setStep0Running(false);
            setStep0Progress(null);

            if (j.status === "complete" && j.result) {
              const d = j.result;
              setStep0Result(
                <div className="space-y-2">
                  <p className="text-green-700 font-medium">Stats &amp; salary fetch complete</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs text-muted-foreground">
                    <span>Total players: <strong className="text-foreground">{d.total}</strong></span>
                    <span>Stats fetched: <strong className="text-foreground">{d.fetched}</strong></span>
                    <span>Errors: <strong className="text-foreground">{d.errors}</strong></span>
                  </div>
                  {(d.salary_matched != null || d.salary_unmatched != null) && (
                    <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs text-muted-foreground border-t border-border pt-1.5">
                      <span>Salaries matched: <strong className="text-foreground">{d.salary_matched ?? "—"}</strong></span>
                      <span>Unmatched: <strong className="text-foreground">{d.salary_unmatched ?? "—"}</strong></span>
                    </div>
                  )}
                </div>
              );
              toast.success(`Stats fetch complete — ${d.fetched}/${d.total} players, ${d.salary_matched ?? 0} salaries updated`);
            } else {
              setStep0Result(
                <p className="text-destructive text-sm">{j.error ?? "Job failed — check backend logs"}</p>
              );
              toast.error(j.error ?? "Stats fetch failed");
            }

            await refreshStatus();
          }
        } catch {
          // Polling error — keep trying, transient network blip
        }
      }, 3000);
    } catch {
      setStep0Result(<p className="text-destructive text-sm">Request failed — check backend logs</p>);
      toast.error("Request failed");
      setStep0Running(false);
    }
  }, [refreshStatus, step0ForceRefresh]);

  // Run Step 1: stat skill mapping batch
  const handleRunStep1 = useCallback(async () => {
    setStep1Running(true);
    setStep1Result(null);
    try {
      const res = await runSkillsBatch(CURRENT_SEASON);
      if (res.success && res.data) {
        const d = res.data;
        setStep1Result(
          <div className="space-y-1">
            <p className="text-green-700 font-medium">Skill mapping complete</p>
            <p className="text-xs text-muted-foreground">
              Processed <strong>{d.processed}</strong> / {d.total} players
            </p>
          </div>
        );
        toast.success(`Skill mapping complete — ${d.processed} players processed`);
      } else {
        setStep1Result(
          <p className="text-destructive text-sm">{res.error ?? "Unknown error"}</p>
        );
        toast.error(res.error ?? "Skill mapping failed");
      }
    } catch {
      setStep1Result(<p className="text-destructive text-sm">Request failed — check backend logs</p>);
      toast.error("Request failed");
    } finally {
      setStep1Running(false);
      // Refresh the status tiles after the run
      await refreshStatus();
    }
  }, [refreshStatus]);

  // Run Step 2: composite pipeline batch (Claude assessment + compositing)
  const handleRunStep2 = useCallback(async () => {
    setStep2Running(true);
    setStep2Result(null);
    try {
      const res = await runCompositeBatch(CURRENT_SEASON);
      if (res.success && res.data) {
        const d = res.data;
        setStep2Result(
          <div className="space-y-1">
            <p className="text-green-700 font-medium">Composite pipeline complete</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs text-muted-foreground mt-1">
              <span>Processed: <strong className="text-foreground">{d.processed}</strong></span>
              <span>Claude calls: <strong className="text-foreground">{d.claude_calls_made}</strong></span>
              <span>Auto-accepted: <strong className="text-foreground">{d.auto_accepted}</strong></span>
              <span>Flagged for review: <strong className="text-foreground">{d.flagged_for_review}</strong></span>
              <span>Errors: <strong className="text-foreground">{d.errors}</strong></span>
              <span>Est. cost: <strong className="text-foreground">${d.estimated_cost_usd.toFixed(4)}</strong></span>
            </div>
          </div>
        );
        toast.success(`Composite complete — ${d.flagged_for_review} flags created`);
      } else {
        setStep2Result(
          <p className="text-destructive text-sm">{res.error ?? "Unknown error"}</p>
        );
        toast.error(res.error ?? "Composite pipeline failed");
      }
    } catch {
      setStep2Result(<p className="text-destructive text-sm">Request failed — check backend logs</p>);
      toast.error("Request failed");
    } finally {
      setStep2Running(false);
      await refreshStatus();
    }
  }, [refreshStatus]);

  const totalPlayers = status?.total_qualifying_players ?? null;

  return (
    <main id="pipeline-page" className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <Toaster position="top-right" richColors />

      {/* Page header */}
      <div id="pipeline-header">
        <h1 id="pipeline-title" className="text-xl font-bold text-foreground">Pipeline</h1>
        <p id="pipeline-subtitle" className="text-sm text-muted-foreground mt-1">
          Run the two-step stat → composite pipeline for all qualifying players
          ({CURRENT_SEASON}).
        </p>
      </div>

      {/* Status dashboard */}
      <section id="pipeline-status-section">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground">Current Status</h2>
          <button
            id="pipeline-refresh-btn"
            type="button"
            onClick={refreshStatus}
            disabled={statusLoading}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {statusLoading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <div id="pipeline-status-grid" className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatTile
            label="Qualifying Players"
            value={status?.total_qualifying_players ?? null}
          />
          <StatTile
            label="With Stats"
            value={status?.players_with_stats ?? null}
            total={totalPlayers ?? undefined}
          />
          <StatTile
            label="Skill Profiles"
            value={status?.players_with_skills ?? null}
            total={totalPlayers ?? undefined}
          />
          <StatTile
            label="Composite Profiles"
            value={status?.players_with_composite ?? null}
            total={totalPlayers ?? undefined}
          />
        </div>

        {/* Flag summary row */}
        {status && (
          <div id="pipeline-flags-row" className="mt-3 grid grid-cols-2 gap-3">
            <div id="pipeline-unresolved-card" className="rounded-lg border border-border bg-card px-4 py-3 flex items-center gap-3">
              <div
                className={cn(
                  "w-2 h-2 rounded-full flex-shrink-0",
                  status.unresolved_flags > 0 ? "bg-amber-500" : "bg-emerald-500"
                )}
              />
              <div>
                <p className="text-xs text-muted-foreground font-medium">Unresolved Flags</p>
                <p className="text-lg font-bold tabular-nums">
                  {status.unresolved_flags}
                  {status.total_flags > 0 && (
                    <span className="text-xs font-normal text-muted-foreground ml-1">
                      / {status.total_flags} total
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div id="pipeline-flagged-players-card" className="rounded-lg border border-border bg-card px-4 py-3 flex items-center gap-3">
              <div
                className={cn(
                  "w-2 h-2 rounded-full flex-shrink-0",
                  status.flagged_players > 0 ? "bg-amber-500" : "bg-emerald-500"
                )}
              />
              <div>
                <p className="text-xs text-muted-foreground font-medium">Players Needing Review</p>
                <p className="text-lg font-bold tabular-nums">{status.flagged_players}</p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Pipeline steps */}
      <section id="pipeline-run-section" className="space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Run Pipeline</h2>
        <p className="text-xs text-muted-foreground -mt-2">
          Run all three steps in order. Step 0 fetches raw NBA stats and can take
          30–60 min for a full league sweep. Steps 1 and 2 are much faster.
        </p>

        <div id="pipeline-step-0">
        <StepCard
          step={0}
          title="Fetch Player Stats"
          description="Pull raw stats from nba_api and scrape ESPN salaries for every qualifying player. Stats are cached in player_stats; salaries are upserted into the players table. Required before Step 1. Runs in background — you can navigate away."
          running={step0Running}
          lastResult={step0Result}
          onRun={handleRunStep0}
          disabled={step1Running || step2Running}
          headerExtra={
            /* Force refresh bypasses the 24-hour cache — use after fixing the assembler */
            <label id="pipeline-step-0-force-refresh-label" className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none flex-shrink-0">
              <input
                id="pipeline-step-0-force-refresh"
                type="checkbox"
                checked={step0ForceRefresh}
                onChange={(e) => setStep0ForceRefresh(e.target.checked)}
                className="rounded"
                disabled={step0Running}
              />
              Force refresh
            </label>
          }
          progressNode={
            step0Progress ? (
              <div id="pipeline-step-0-progress" className="space-y-2">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  <span>
                    Fetching player stats… {step0Progress.progress}/{step0Progress.total}
                  </span>
                </div>
                {step0Progress.total > 0 && (
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{ width: `${Math.round((step0Progress.progress / step0Progress.total) * 100)}%` }}
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-x-6 text-xs text-muted-foreground">
                  <span>Fetched: <strong className="text-foreground">{step0Progress.fetched}</strong></span>
                  <span>Errors: <strong className="text-foreground">{step0Progress.errors}</strong></span>
                </div>
              </div>
            ) : undefined
          }
        />
        </div>

        <div id="pipeline-step-1">
        <StepCard
          step={1}
          title="Stat Skill Mapping"
          description="Evaluate all 19 skills for every qualifying player using the threshold rule engine. Persists source='stats' skill profiles. Requires Step 0 to have been run."
          running={step1Running}
          lastResult={step1Result}
          onRun={handleRunStep1}
          disabled={step0Running || step2Running}
        />
        </div>

        <div id="pipeline-step-2">
        <StepCard
          step={2}
          title="Claude Assessment & Composite"
          description="Run Claude's skill assessment for 14 skills per player, composite with stat ratings, and create flags for disagreements. Requires Step 1 to have been run first."
          running={step2Running}
          lastResult={step2Result}
          onRun={handleRunStep2}
          disabled={step0Running || step1Running}
        />
        </div>
      </section>
    </main>
  );
}
