"use client";

/**
 * AssistantGmNotes.tsx — Live GM feedback panel for the roster builder.
 *
 * Fires POST /api/builder/evaluate whenever the set of players in the roster
 * changes (add/remove). Reordering slots does NOT trigger a re-eval.
 * Debounced 500ms to avoid hammering the backend on rapid changes.
 *
 * States: idle → analyzing (skeleton) → ready (mini score bar + notes) | error
 *
 * Player payload: cornerstone → slot=0, is_cornerstone=true
 *                 supporting  → slot=index+1 (allSlots array is 0-indexed)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { evaluateRoster } from "@/lib/api";
import { NotesList } from "./NotesList";
import { DebugPanel } from "./DebugPanel";
import type { LegendDetail, Note, PlayerWithSkills, RosterEvaluation, Scores } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GmNotesState = "idle" | "analyzing" | "ready" | "error";

interface AssistantGmNotesProps {
  allSlots: (PlayerWithSkills | null)[];
  legendDetail: LegendDetail | null;
  isAdmin: boolean;
  /** Called after every successful evaluation — used by parent to lift eval data for the Debug tab. */
  onEvaluation?: (evaluation: RosterEvaluation) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the player payload with required slot and is_cornerstone fields.
 * The legend occupies slot 0 (cornerstone); supporting players start at slot 1.
 */
function buildPlayerPayload(
  allSlots: (PlayerWithSkills | null)[],
  legendDetail: LegendDetail | null,
) {
  const result: Array<{
    name: string;
    slot: number;
    is_cornerstone: boolean;
    height: string | null;
    skills: Record<string, string>;
  }> = [];

  // Cornerstone legend — always slot=0
  if (legendDetail) {
    result.push({
      name: legendDetail.name,
      slot: 0,
      is_cornerstone: true,
      height: legendDetail.height,
      skills: Object.fromEntries(
        Object.entries(legendDetail.profile).map(([k, v]) => [k, v ?? "None"]),
      ),
    });
  }

  // Supporting players from allSlots (0-indexed → slot = index + 1)
  allSlots.forEach((p, index) => {
    if (p === null || p.is_legend) return; // skip nulls and legend placeholder entries
    result.push({
      name: p.name,
      slot: index + 1,
      is_cornerstone: false,
      height: p.height,
      skills: (p.skills ?? {}) as Record<string, string>,
    });
  });

  return result;
}

// ---------------------------------------------------------------------------
// Mini score bar — compact 2×2 grid for live panel
// ---------------------------------------------------------------------------

function scoreColor(score: number): string {
  if (score >= 70) return "text-green-400";
  if (score >= 40) return "text-amber-400";
  return "text-red-400";
}

function barColor(score: number): string {
  if (score >= 70) return "bg-green-500";
  if (score >= 40) return "bg-amber-500";
  return "bg-red-500";
}

function ScoreRow({
  id,
  label,
  value,
  indent = false,
}: {
  id: string;
  label: string;
  value: number;
  indent?: boolean;
}) {
  const val = Math.round(value);
  return (
    <div id={id} className={cn("flex flex-col gap-0.5", indent && "pl-3")}>
      <div className="flex items-center justify-between gap-2">
        <span className={cn("text-[10px]", indent ? "text-muted-foreground/60" : "text-muted-foreground")}>
          {label}
        </span>
        <span className={cn("text-[10px] font-mono font-bold tabular-nums", scoreColor(val))}>
          {val}
        </span>
      </div>
      {/* Bar */}
      <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", barColor(val))}
          style={{ width: `${val}%` }}
          role="progressbar"
          aria-valuenow={val}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
        />
      </div>
    </div>
  );
}

function MiniScoreBar({ scores }: { scores: Scores }) {
  return (
    <div id="gm-notes-mini-scores" className="flex flex-col gap-0.5 p-2 rounded-lg bg-muted/30 border border-border/50">
      <ScoreRow id="gm-notes-score-overall"     label="Overall"     value={scores.overall} />
      <div className="my-0.5 border-t border-border/30" />
      <ScoreRow id="gm-notes-score-offense"     label="Offense"     value={scores.offense} />
      <ScoreRow id="gm-notes-score-spacing"     label="Spacing"     value={scores.spacing}    indent />
      <ScoreRow id="gm-notes-score-creation"    label="Creation"    value={scores.creation}   indent />
      <ScoreRow id="gm-notes-score-paint"       label="Paint"       value={scores.paint}      indent />
      <ScoreRow id="gm-notes-score-transition"  label="Transition"  value={scores.transition} indent />
      <div className="my-0.5 border-t border-border/30" />
      <ScoreRow id="gm-notes-score-defense"     label="Defense"     value={scores.defense} />
      <ScoreRow id="gm-notes-score-optionality" label="Optionality" value={scores.optionality} />
      <ScoreRow id="gm-notes-score-robustness"  label="Robustness"  value={scores.robustness} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AssistantGmNotes({ allSlots, legendDetail, isAdmin, onEvaluation }: AssistantGmNotesProps) {
  const [state, setState]         = useState<GmNotesState>("idle");
  const [notes, setNotes]         = useState<Note[]>([]);
  const [scores, setScores]       = useState<Scores | null>(null);
  const [errorMsg, setErrorMsg]   = useState<string | null>(null);
  const [changedSignal, setChangedSignal] = useState<{ added: number; removed: number } | null>(null);
  const [debugTraces, setDebugTraces] = useState<{
    player: Record<string, unknown> | null;
    aggregate: Record<string, unknown> | null;
    heightCoverage: import("@/lib/types").HeightCoverageData | null;
  } | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks previous trace_key set to compute what-changed diff after each eval
  const prevTraceKeysRef = useRef<Set<string> | null>(null);

  // Stable key: changes on player add/remove OR slot reorder, so swapping slots triggers re-eval
  // (slot position affects slot weight, which directly affects scores)
  // Stable key: changes on legend selection, player add/remove, or slot reorder.
  // Legend ID is prefixed so switching cornerstones triggers re-eval even with 0 supporting players.
  const rosterKey = useMemo(() => {
    const legendPart = legendDetail ? `legend:${legendDetail.id}` : "legend:none";
    const slotPart = allSlots
      .map((p, i) => (p ? `${i}:${p.id}` : null))
      .filter(Boolean)
      .join(",");
    return `${legendPart}|${slotPart}`;
  }, [allSlots, legendDetail]);

  // Whether there are any supporting players (non-legend) to evaluate
  const supportingCount = allSlots.filter((p) => p !== null && !p.is_legend).length;

  const runEval = useCallback(async () => {
    // Requires a legend (cornerstone) — supporting players can be zero for complement suggestions
    if (!legendDetail) {
      setState("idle");
      return;
    }
    const players = buildPlayerPayload(allSlots, legendDetail);

    setState("analyzing");
    setErrorMsg(null);

    try {
      const res = await evaluateRoster({ players, mode: "live", debug: isAdmin });
      if (res.success && res.data) {
        setNotes(res.data.notes);
        setScores(res.data.scores);

        // Compute what-changed diff between this eval and the previous one
        const currentKeys = new Set(res.data.notes.map((n) => n.trace_key));
        const prev = prevTraceKeysRef.current;
        if (prev) {
          const added   = [...currentKeys].filter((k) => !prev.has(k)).length;
          const removed = [...prev].filter((k) => !currentKeys.has(k)).length;
          setChangedSignal(added > 0 || removed > 0 ? { added, removed } : null);
        }
        prevTraceKeysRef.current = currentKeys;
        if (isAdmin) {
          setDebugTraces({
            player:        res.data.player_traces,
            aggregate:     res.data.aggregate_traces,
            heightCoverage: res.data.height_coverage,
          });
        }
        // Lift full evaluation to parent so the Debug tab can display scoring breakdown
        onEvaluation?.(res.data);
        setState("ready");
      } else {
        setErrorMsg(res.error ?? "Evaluation failed");
        setState("error");
      }
    } catch {
      setErrorMsg("Failed to reach the server");
      setState("error");
    }
  // allSlots and legendDetail are captured at call time via the debounce
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSlots, legendDetail, isAdmin]);

  useEffect(() => {
    // No legend selected — nothing to evaluate or suggest
    if (!legendDetail) {
      setState("idle");
      setNotes([]);
      setScores(null);
      setChangedSignal(null);
      prevTraceKeysRef.current = null;
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void runEval(); }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  // rosterKey encodes legend + all slots; runEval is stable-ish via useCallback
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterKey]);

  // Split notes into buckets for NotesList
  const issues      = useMemo(() => notes.filter((n) => n.severity === "critical" || n.severity === "warning"), [notes]);
  const suggestions = useMemo(() => notes.filter((n) => n.severity === "suggestion"), [notes]);
  const strengths   = useMemo(() => notes.filter((n) => n.severity === "strength"), [notes]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div id="builder-gm-notes" className="flex flex-col gap-3 h-full">
      <h3 id="builder-gm-notes-title" className="text-sm font-semibold text-foreground">
        Assistant GM Notes
      </h3>

      {state === "idle" && (
        <p id="builder-gm-notes-idle" className="text-xs text-muted-foreground">
          Add players to your roster to get GM feedback.
        </p>
      )}

      {state === "analyzing" && (
        <ul id="builder-gm-notes-skeleton" className="space-y-3 animate-pulse" aria-label="Loading notes">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="flex gap-2 items-start">
              <div className="h-4 w-14 bg-muted rounded flex-shrink-0" />
              <div className={cn("h-4 bg-muted rounded", i % 2 === 0 ? "w-full" : "w-4/5")} />
            </li>
          ))}
        </ul>
      )}

      {state === "ready" && (
        <>
          {/* Mini score bar — 4 key metrics at a glance */}
          {scores && <MiniScoreBar scores={scores} />}

              {/* What-changed pill — shows diff from previous eval */}
          {changedSignal && (
            <p id="gm-notes-changed-pill" className="text-[10px] text-muted-foreground font-mono bg-muted/40 rounded px-2 py-1">
              {changedSignal.added > 0 && `+ ${changedSignal.added} new`}
              {changedSignal.added > 0 && changedSignal.removed > 0 && " · "}
              {changedSignal.removed > 0 && `− ${changedSignal.removed} resolved`}
            </p>
          )}

          {/* Notes list — issues, suggestions, strengths */}
          {notes.length === 0 ? (
            <p id="builder-gm-notes-empty" className="text-xs text-muted-foreground">
              No issues found — roster looks solid.
            </p>
          ) : (
            <NotesList issues={issues} suggestions={suggestions} strengths={strengths} />
          )}
        </>
      )}

      {state === "error" && (
        <p id="builder-gm-notes-error" className="text-xs text-destructive">
          {errorMsg ?? "Something went wrong."}
        </p>
      )}

      {/* Admin debug panel — traces + height coverage chart */}
      {isAdmin && debugTraces && state === "ready" && (
        <DebugPanel
          playerTraces={debugTraces.player}
          aggregateTraces={debugTraces.aggregate}
          heightCoverage={debugTraces.heightCoverage}
        />
      )}
    </div>
  );
}
