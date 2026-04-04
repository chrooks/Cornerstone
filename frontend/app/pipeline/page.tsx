"use client";

import { useState, useEffect, useCallback } from "react";
import { Toaster, toast } from "sonner";
import { cn } from "@/lib/utils";
import { getPipelineStatus, runStatsFetch, runSkillsBatch, runCompositeBatch } from "@/lib/api";
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
}: {
  step: number;
  title: string;
  description: string;
  running: boolean;
  lastResult: React.ReactNode | null;
  onRun: () => void;
  disabled?: boolean;
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

      {/* Result / spinner */}
      <div className="px-5 py-4 min-h-[3rem]">
        {running ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            {/* Simple CSS spinner */}
            <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            Processing — this may take several minutes for all players…
          </div>
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

  // Step 0: Fetch Player Stats
  const [step0Running, setStep0Running] = useState(false);
  const [step0Result, setStep0Result]   = useState<React.ReactNode | null>(null);

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

  // Run Step 0: fetch NBA stats from the API for all qualifying players
  const handleRunStep0 = useCallback(async () => {
    setStep0Running(true);
    setStep0Result(null);
    try {
      const res = await runStatsFetch(CURRENT_SEASON);
      if (res.success && res.data) {
        const d = res.data;
        setStep0Result(
          <div className="space-y-1">
            <p className="text-green-700 font-medium">Stats fetch complete</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs text-muted-foreground mt-1">
              <span>Total: <strong className="text-foreground">{d.total}</strong></span>
              <span>Fetched: <strong className="text-foreground">{d.fetched}</strong></span>
              <span>Errors: <strong className="text-foreground">{d.errors}</strong></span>
            </div>
          </div>
        );
        toast.success(`Stats fetch complete — ${d.fetched}/${d.total} players`);
      } else {
        setStep0Result(
          <p className="text-destructive text-sm">{res.error ?? "Unknown error"}</p>
        );
        toast.error(res.error ?? "Stats fetch failed");
      }
    } catch {
      setStep0Result(<p className="text-destructive text-sm">Request failed — check backend logs</p>);
      toast.error("Request failed");
    } finally {
      setStep0Running(false);
      await refreshStatus();
    }
  }, [refreshStatus]);

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
    <main className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <Toaster position="top-right" richColors />

      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-foreground">Pipeline</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Run the two-step stat → composite pipeline for all qualifying players
          ({CURRENT_SEASON}).
        </p>
      </div>

      {/* Status dashboard */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground">Current Status</h2>
          <button
            type="button"
            onClick={refreshStatus}
            disabled={statusLoading}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {statusLoading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border bg-card px-4 py-3 flex items-center gap-3">
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
            <div className="rounded-lg border border-border bg-card px-4 py-3 flex items-center gap-3">
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
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Run Pipeline</h2>
        <p className="text-xs text-muted-foreground -mt-2">
          Run all three steps in order. Step 0 fetches raw NBA stats and can take
          30–60 min for a full league sweep. Steps 1 and 2 are much faster.
        </p>

        <StepCard
          step={0}
          title="Fetch Player Stats"
          description="Pull raw stats from nba_api for every qualifying player and cache them in player_stats. Required before Step 1. Long-running — expect 30–60 min for ~300 players."
          running={step0Running}
          lastResult={step0Result}
          onRun={handleRunStep0}
          disabled={step1Running || step2Running}
        />

        <StepCard
          step={1}
          title="Stat Skill Mapping"
          description="Evaluate all 19 skills for every qualifying player using the threshold rule engine. Persists source='stats' skill profiles. Requires Step 0 to have been run."
          running={step1Running}
          lastResult={step1Result}
          onRun={handleRunStep1}
          disabled={step0Running || step2Running}
        />

        <StepCard
          step={2}
          title="Claude Assessment & Composite"
          description="Run Claude's skill assessment for 14 skills per player, composite with stat ratings, and create flags for disagreements. Requires Step 1 to have been run first."
          running={step2Running}
          lastResult={step2Result}
          onRun={handleRunStep2}
          disabled={step0Running || step1Running}
        />
      </section>
    </main>
  );
}
