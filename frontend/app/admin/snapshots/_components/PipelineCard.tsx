"use client";

/**
 * PipelineCard — one ingestion pipeline card.
 *
 * States:
 *  idle    — bulk button + player search enabled
 *  running — bulk replaced with progress strip, search disabled
 *  error   — error tail open by default, bulk re-enabled
 *  frozen  — all controls disabled at 60% opacity (review state)
 *
 * Tokens: Card White surface, Warm Border, Hardwood Amber CTA.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PlayerSearchCombobox } from "@/components/PlayerSearchCombobox";
import { StateChip } from "./StateChip";
import { getPipelineRun } from "@/lib/api";
import type { Player, PipelineRun } from "@/lib/types";

type PipelineCardState = "idle" | "running" | "error" | "frozen";

/** Format elapsed milliseconds as m:ss. */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

interface PipelineCardProps {
  id: string;
  title: string;
  description: string;
  /** If true, all controls are disabled (review/frozen state). */
  frozen?: boolean;
  /** Trigger function for bulk run. Returns the run_id. */
  onBulkRun: () => Promise<string>;
  /** Trigger function for per-player run. Returns the run_id. */
  onPlayerRun: (playerId: string) => Promise<string>;
  /** Last known run for display. */
  lastRun?: PipelineRun | null;
}

export function PipelineCard({
  id,
  title,
  description,
  frozen,
  onBulkRun,
  onPlayerRun,
  lastRun,
}: PipelineCardProps) {
  const [cardState, setCardState] = useState<PipelineCardState>(frozen ? "frozen" : "idle");
  const [currentRun, setCurrentRun] = useState<PipelineRun | null>(lastRun ?? null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Elapsed-time ticker — gives "it's alive" feedback even when the run has no
  // determinate total (salary/bio bulk jobs). Started locally at trigger time
  // so it counts from 0 without waiting for the first 2s poll.
  const runStartRef = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Cleanup on unmount only. Refs avoid re-render cascade that was killing the timer.
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  // Tick the elapsed clock once per second while a run is in flight.
  useEffect(() => {
    if (cardState !== "running") return;
    const tick = setInterval(() => {
      if (runStartRef.current != null) setElapsedMs(Date.now() - runStartRef.current);
    }, 1000);
    return () => clearInterval(tick);
  }, [cardState]);

  const startPolling = useCallback((runId: string) => {
    if (timerRef.current) clearInterval(timerRef.current);
    const timer = setInterval(async () => {
      try {
        const res = await getPipelineRun(runId);
        if (res.success && res.data) {
          setCurrentRun(res.data);
          if (res.data.status === "success") {
            clearInterval(timer);
            timerRef.current = null;
            setCardState("idle");
            toast.success(`${title} complete: ${res.data.rows_processed} rows`);
          } else if (res.data.status === "error") {
            clearInterval(timer);
            timerRef.current = null;
            setCardState("error");
            toast.error(`${title} failed`);
          }
        } else if (!res.success) {
          clearInterval(timer);
          timerRef.current = null;
          setCardState("error");
          toast.error(`${title} status check failed: ${res.error ?? "unknown"}`);
        }
      } catch {
        clearInterval(timer);
        timerRef.current = null;
        setCardState("error");
        toast.error(`${title} status check failed`);
      }
    }, 2000);
    timerRef.current = timer;
  }, [title]);

  const handleBulkRun = useCallback(async () => {
    if (cardState !== "idle") return;
    setCardState("running");
    runStartRef.current = Date.now();
    setElapsedMs(0);
    try {
      const runId = await onBulkRun();
      startPolling(runId);
      toast.info(`${title} started`);
    } catch {
      setCardState("error");
      toast.error(`Failed to start ${title}`);
    }
  }, [cardState, onBulkRun, startPolling, title]);

  const handlePlayerSelect = useCallback(async (player: Player) => {
    if (cardState !== "idle") return;
    setCardState("running");
    runStartRef.current = Date.now();
    setElapsedMs(0);
    try {
      const runId = await onPlayerRun(player.id);
      startPolling(runId);
      toast.info(`${title} started for ${player.name}`);
    } catch {
      setCardState("error");
      toast.error(`Failed to start ${title} for ${player.name}`);
    }
  }, [cardState, onPlayerRun, startPolling, title]);

  const isFrozen = frozen || cardState === "frozen";
  const isRunning = cardState === "running";
  const hasError = cardState === "error";

  return (
    <article
      id={id}
      className={cn(
        "rounded-[6px] border border-[#d9d0c9] p-6 flex flex-col h-full",
        isFrozen && "opacity-60 pointer-events-none",
      )}
      style={{ backgroundColor: "#f7f7f7" }}
    >
      {/* Header */}
      <div id={`${id}-header`} className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 id={`${id}-title`} className="font-semibold text-sm text-[#0e0907]">{title}</h3>
          <p id={`${id}-desc`} className="text-xs text-neutral-500 mt-0.5 leading-relaxed">
            {description}
          </p>
        </div>
        {currentRun && (
          <StateChip
            id={`${id}-state-chip`}
            variant={
              currentRun.status === "running" ? "running"
              : currentRun.status === "error" ? "error"
              : "success"
            }
          />
        )}
      </div>

      {/* Trigger group pinned to card bottom */}
      <div id={`${id}-triggers`} className="mt-auto">
      {/* Bulk action */}
      <div id={`${id}-bulk-area`} className="mb-4">
        {isRunning ? (
          (() => {
            const total = currentRun?.params?.total ?? null;
            const processed = currentRun?.rows_processed ?? 0;
            const hasTotal = total != null && total > 0;
            const pct = hasTotal ? Math.min(100, Math.round((processed / total) * 100)) : 0;
            return (
              <div id={`${id}-progress`} className="space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs text-neutral-500">
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 border-2 border-[#ffa05c] border-t-transparent rounded-full animate-spin" />
                    <span>
                      {hasTotal ? `${processed} / ${total} players` : "Running…"}
                    </span>
                  </span>
                  <span className="font-mono tabular-nums text-neutral-400">
                    {formatElapsed(elapsedMs)}
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-neutral-200 overflow-hidden">
                  {hasTotal ? (
                    <div
                      className="h-full bg-[#ffa05c] rounded-full transition-[width] duration-500 ease-out"
                      style={{ width: `${pct}%` }}
                    />
                  ) : (
                    <div className="h-full bg-[#ffa05c]/60 rounded-full animate-pulse w-full" />
                  )}
                </div>
              </div>
            );
          })()
        ) : (
          <button
            id={`${id}-bulk-btn`}
            type="button"
            onClick={handleBulkRun}
            disabled={isFrozen || isRunning}
            className={cn(
              "text-xs font-semibold px-4 py-2 rounded-[4px] transition-colors",
              "bg-[#ffa05c] text-[#0e0907] hover:bg-[#fe6d34]",
              "focus:outline-none focus:ring-2 focus:ring-[#ffa05c] focus:ring-offset-2",
              (isFrozen || isRunning) && "opacity-50 cursor-not-allowed",
            )}
          >
            Run for all qualifying
          </button>
        )}
      </div>

      {/* Per-player search */}
      <div id={`${id}-player-search`} className="mb-4">
        <p className="text-[11px] uppercase tracking-wider font-semibold text-neutral-400 mb-2">
          Run for one player
        </p>
        {isRunning ? (
          <p
            id={`${id}-player-search-disabled-tip`}
            className="text-xs text-neutral-400 italic"
            title="Wait for the current run to finish"
          >
            Search disabled while running
          </p>
        ) : (
          <PlayerSearchCombobox
            onSelect={handlePlayerSelect}
            placeholder="Search by name…"
            className="max-w-xs"
          />
        )}
      </div>

      {/* Error tail */}
      {hasError && currentRun?.error_tail && (
        <details
          id={`${id}-error-details`}
          open
          className="mt-2 rounded border border-red-200 bg-red-50 p-3 text-xs"
        >
          <summary className="font-medium text-red-700 cursor-pointer select-none mb-1">
            Error detail
          </summary>
          <pre
            id={`${id}-error-tail`}
            className="whitespace-pre-wrap font-mono text-red-600 text-[11px] leading-relaxed"
          >
            {currentRun.error_tail}
          </pre>
          <button
            id={`${id}-retry-btn`}
            type="button"
            onClick={() => { setCardState("idle"); setCurrentRun(null); }}
            className="mt-2 text-[11px] text-red-700 underline hover:no-underline"
          >
            Dismiss and retry
          </button>
        </details>
      )}

      {/* Last run footer */}
      {currentRun && currentRun.status !== "running" && (
        <p
          id={`${id}-last-run`}
          className="text-[11px] text-neutral-400 mt-3 border-t border-[#d9d0c9] pt-2"
        >
          Last run: {currentRun.started_at
            ? new Date(currentRun.started_at).toLocaleString()
            : "—"}
          {currentRun.rows_processed != null
            ? ` · ${currentRun.rows_processed} rows`
            : ""}
        </p>
      )}
      </div>
    </article>
  );
}
