"use client";

/**
 * AssistantGmNotes.tsx — Live Feedback panel for Build.
 *
 * Fires POST /api/builder/evaluate whenever the set of Players in the Rotation
 * changes (add/remove). Reordering slots does NOT trigger a re-eval.
 * Debounced 500ms to avoid hammering the backend on rapid changes.
 *
 * States: idle → analyzing (skeleton) → ready (evaluation history stack) | error
 *
 * Evaluation history model:
 *   Each successful eval is appended to sessionHistory. The most recent entry is
 *   expanded by default with the full S/W/S layout. Older entries render as
 *   compact rows with a change line + timestamp + note count. Click a row
 *   to expand it and collapse whichever entry was previously expanded.
 *
 * Player payload: cornerstone → slot=0, is_cornerstone=true
 *                 supporting  → slot=index+1 (allSlots array is 0-indexed)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { evaluateRoster } from "@/lib/api";
import { FeedbackTooltip } from "./FeedbackTooltip";
import { NotesList } from "./NotesList";
import { filterNotesByPlayer, type SuggestionFilter } from "@/lib/noteFilters";
import type { LegendDetail, Note, PlayerWithSkills, RosterEvaluation } from "@/lib/types";
import { normalizeCohesionNotes } from "@/lib/cohesionHelpers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GmNotesState = "idle" | "analyzing" | "ready" | "error";

/** A single snapshot in the session history — one entry per successful eval. */
interface HistoryEntry {
  id: string;
  timestamp: number;
  /** Subject-line summary of what changed since the previous eval (e.g. "Added Cooper Flagg to slot 4"). */
  changeDescription: string;
  /** Full engine response for the same snapshot. Used for the current explanation header. */
  evaluation: RosterEvaluation | null;
  notes: Note[];
  issues: Note[];
  suggestions: Note[];
  strengths: Note[];
}

interface AssistantGmNotesProps {
  allSlots: (PlayerWithSkills | null)[];
  legendDetail: LegendDetail | null;
  isAdmin: boolean;
  /** Called after every successful evaluation — used by parent to lift eval data for the Debug tab. */
  onEvaluation?: (evaluation: RosterEvaluation) => void;
  /** Called when the user clicks a suggestion note — parent injects a filter into the player picker. */
  onSuggestionFilter?: (filter: SuggestionFilter, note: Note) => void;
  /** When set, only notes mentioning this player name are shown. Null = show all. */
  focusedPlayerName?: string | null;
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

/**
 * Derive a short line describing how the Rotation changed between two
 * snapshots. Pure function of the id+slot layout so it's robust to reorderings.
 */
function describeRosterChange(
  prev: (PlayerWithSkills | null)[] | null,
  curr: (PlayerWithSkills | null)[],
): string {
  if (!prev) return "Initial evaluation";

  // Build id→slot maps for both snapshots
  const prevMap = new Map<string, number>();
  const currMap = new Map<string, number>();
  prev.forEach((p, i) => { if (p) prevMap.set(p.id, i); });
  curr.forEach((p, i) => { if (p) currMap.set(p.id, i); });

  // Compute adds/removes by comparing id sets
  const added: Array<{ player: PlayerWithSkills; slot: number }> = [];
  curr.forEach((p, i) => { if (p && !prevMap.has(p.id)) added.push({ player: p, slot: i + 1 }); });
  const removed: PlayerWithSkills[] = [];
  prev.forEach((p) => { if (p && !currMap.has(p.id)) removed.push(p); });

  // Detect a pure slot reorder (identical id set, different positions)
  const reordered =
    added.length === 0 && removed.length === 0 &&
    curr.some((p, i) => p && prevMap.get(p.id) !== i);

  if (added.length === 1 && removed.length === 0) {
    return `Added ${added[0].player.name} to slot ${added[0].slot}`;
  }
  if (removed.length === 1 && added.length === 0) {
    return `Removed ${removed[0].name}`;
  }
  if (added.length === 1 && removed.length === 1) {
    return `Replaced ${removed[0].name} with ${added[0].player.name}`;
  }
  if (added.length > 0 && removed.length > 0) {
    return `Swapped ${removed.length} player${removed.length === 1 ? "" : "s"} for ${added.length} new`;
  }
  if (added.length > 0) {
    return `Added ${added.length} players`;
  }
  if (removed.length > 0) {
    return `Removed ${removed.length} players`;
  }
  if (reordered) {
    return "Reordered lineup";
  }
  return "Roster updated";
}

/** Format a timestamp for compact evaluation history. */
function formatMemoDate(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

// Maximum history entries to retain — older evals are dropped FIFO
const HISTORY_LIMIT = 20;

const BREAKDOWN_LABELS: Record<string, string> = {
  starting_5: "Starting Lineup",
  depth: "Depth",
  archetype_diversity: "Versatility",
  floor: "Floor",
};

function formatPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "0%";
  return `${Math.round(value * 100)}%`;
}

function formatScore(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "0.00";
  return value.toFixed(2);
}

function topBreakdownItems(evaluation: RosterEvaluation | null) {
  if (!evaluation) return [];
  return Object.entries(evaluation.star_rating_breakdown)
    .map(([key, value]) => ({
      key,
      label: BREAKDOWN_LABELS[key] ?? key.replaceAll("_", " "),
      value,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);
}

function weakestBreakdownItem(evaluation: RosterEvaluation | null) {
  if (!evaluation) return null;
  const [key, value] = Object.entries(evaluation.star_rating_breakdown)
    .sort((a, b) => a[1] - b[1])[0] ?? [null, null];
  if (!key || value == null) return null;
  return {
    key,
    label: BREAKDOWN_LABELS[key] ?? key.replaceAll("_", " "),
    value,
  };
}

function CurrentEngineRead({ entry }: { entry: HistoryEntry }) {
  const evaluation = entry.evaluation;
  const drivers = topBreakdownItems(evaluation);
  const weakest = weakestBreakdownItem(evaluation);
  const identity = evaluation?.lineup_summary.archetype_labels?.length
    ? evaluation.lineup_summary.archetype_labels.join(" / ")
    : "Still forming";
  const viable = evaluation?.lineup_summary.viable_lineups ?? 0;
  const total = evaluation?.lineup_summary.total_lineups ?? 0;

  return (
    <section id={`history-entry-current-read-${entry.id}`} className="min-w-0 flex-1 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[0.625rem] font-semibold uppercase tracking-[0.18em] text-[#0e0907]/40">
            Current Engine Read
          </p>
          <h3 className="mt-1 text-[1rem] font-semibold leading-tight text-[#0e0907]">
            {entry.changeDescription}
          </h3>
          <p className="mt-1 text-[0.8125rem] leading-snug text-[#0e0907]/55">
            Rotation identity: <span className="font-medium text-[#0e0907]/75">{identity}</span>
          </p>
        </div>
        <FeedbackTooltip
          id={`history-entry-score-tooltip-${entry.id}`}
          as="div"
          align="right"
          className="shrink-0"
          content={(
            <div className="space-y-2">
              <p className="font-semibold text-[#0e0907]">Score</p>
              <p>
                Current live evaluation: <span className="font-mono text-[#0e0907]">{formatScore(evaluation?.star_rating)}</span> / 5.
              </p>
              <p>Built from lineup fit, depth, versatility, and floor checks after this pick.</p>
            </div>
          )}
        >
          <div className="border border-[#d9d0c9] bg-[#f0f0f0]/60 px-3 py-2 text-right transition-colors hover:border-[#ffa05c]/45">
            <p className="text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-[#0e0907]/40">Score</p>
            <p className="font-mono text-[1rem] font-semibold tabular-nums text-[#0e0907]">
              {formatScore(evaluation?.star_rating)}
            </p>
          </div>
        </FeedbackTooltip>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {drivers.map((item) => (
          <FeedbackTooltip
            key={item.key}
            id={`history-entry-driver-tooltip-${entry.id}-${item.key}`}
            as="div"
            content={(
              <div className="space-y-2">
                <p className="font-semibold text-[#0e0907]">{item.label}</p>
                <p>
                  This factor is contributing <span className="font-mono text-[#0e0907]">{formatPct(item.value)}</span> toward the current score. It rises when the evaluated lineups repeatedly satisfy this part of the engine.
                </p>
              </div>
            )}
            className="w-full"
          >
            <div id={`history-entry-driver-${entry.id}-${item.key}`} className="w-full border border-[#d9d0c9]/70 bg-[#f8f3f1]/60 px-3 py-2 transition-colors hover:border-[#ffa05c]/45">
              <p className="text-[0.625rem] font-medium uppercase tracking-[0.14em] text-[#0e0907]/35">{item.label}</p>
              <p className="mt-1 font-mono text-[0.8125rem] tabular-nums text-[#0e0907]">{formatPct(item.value)}</p>
            </div>
          </FeedbackTooltip>
        ))}
      </div>

      <div className="grid gap-2 text-[0.8125rem] leading-snug text-[#0e0907]/60 sm:grid-cols-2">
        <FeedbackTooltip
          id={`history-entry-lineup-coverage-tooltip-${entry.id}`}
          as="div"
          content={(
            <div className="space-y-2">
              <p className="font-semibold text-[#0e0907]">Viable Lineup Combinations</p>
              <p>How many evaluated lineup combinations cleared the engine&apos;s viability floor. More viable combinations means the build has more substitution paths.</p>
            </div>
          )}
          className="w-full"
        >
          <p id={`history-entry-lineup-coverage-${entry.id}`} className="w-full border border-[#d9d0c9]/60 bg-[#f7f7f7] px-3 py-2 transition-colors hover:border-[#ffa05c]/45">
            Viable Lineup Combinations: <span className="font-mono text-[#0e0907]">{viable}</span>
            <span className="text-[#0e0907]/35"> / </span>
            <span className="font-mono text-[#0e0907]">{total}</span>
          </p>
        </FeedbackTooltip>
        {weakest && (
          <FeedbackTooltip
            id={`history-entry-primary-gap-tooltip-${entry.id}`}
            as="div"
            align="right"
            content={(
              <div className="space-y-2">
                <p className="font-semibold text-[#0e0907]">Main pressure point</p>
                <p>
                  Lowest current score factor: <span className="font-medium text-[#0e0907]">{weakest.label}</span>{" "}
                  at <span className="font-mono text-[#0e0907]">{formatPct(weakest.value)}</span>. This is the clearest path to improving the score.
                </p>
              </div>
            )}
            className="w-full"
          >
            <p id={`history-entry-primary-gap-${entry.id}`} className="w-full border border-[#d9d0c9]/60 bg-[#f7f7f7] px-3 py-2 transition-colors hover:border-[#ffa05c]/45">
              Main pressure point: <span className="font-medium text-[#0e0907]">{weakest.label}</span>
              <span className="ml-1 font-mono text-[#0e0907]/70">{formatPct(weakest.value)}</span>
            </p>
          </FeedbackTooltip>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// What-changed panel — shows specific notes that appeared/disappeared
// ---------------------------------------------------------------------------

function WhatChangedPanel({ added, removed }: { added: Note[]; removed: Note[] }) {
  const [isOpen, setIsOpen] = useState(true);
  const [isVisible, setIsVisible] = useState(true);
  const totalCount = added.length + removed.length;

  useEffect(() => {
    setIsVisible(true);
    setIsOpen(true);
    const timer = setTimeout(() => setIsVisible(false), 5000);
    return () => clearTimeout(timer);
  }, [added, removed]);

  if (!isVisible) return null;

  return (
    <div
      id="gm-notes-what-changed"
      className="overflow-hidden border border-[#d9d0c9]/70 bg-[#f0f0f0]/55"
    >
      <button
        id="gm-notes-what-changed-toggle"
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2 text-left transition-colors hover:bg-[#0e0907]/[0.03] cursor-pointer"
        aria-expanded={isOpen}
      >
        <div>
          <p className="text-[0.625rem] font-semibold uppercase tracking-[0.18em] text-[#0e0907]/40">Since Last Pick</p>
          <span className="text-[0.8125rem] font-semibold text-[#0e0907]">
            What changed
            <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">({totalCount})</span>
          </span>
        </div>
        <span className="text-muted-foreground text-[9px] font-mono" aria-hidden>
          {isOpen ? "▾" : "▸"}
        </span>
      </button>
      {isOpen && (
        <div id="gm-notes-what-changed-content" className="grid gap-2 px-4 pb-4 sm:grid-cols-2">
          {/* New notes — green accent */}
          {added.map((note) => (
            <div
              key={`added-${note.trace_key}`}
              id={`changed-added-${note.trace_key}`}
              className="flex items-start gap-2 border border-[#059669]/25 bg-[#059669]/5 px-3 py-2 text-[0.75rem]"
            >
              <span className="text-[#059669] font-mono flex-shrink-0">+</span>
              <p className="text-muted-foreground leading-snug">{note.text}</p>
            </div>
          ))}
          {/* Resolved notes — red accent with strikethrough */}
          {removed.map((note) => (
            <div
              key={`removed-${note.trace_key}`}
              id={`changed-removed-${note.trace_key}`}
              className="flex items-start gap-2 border border-[#e53e3e]/25 bg-[#e53e3e]/5 px-3 py-2 text-[0.75rem] opacity-80"
            >
              <span className="text-[#e53e3e] font-mono flex-shrink-0">−</span>
              <p className="text-muted-foreground leading-snug line-through">{note.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session history subcomponents
// ---------------------------------------------------------------------------

/**
 * Full-fidelity rendering of a single history entry: change summary header,
 * timestamp, optional what-changed diff, and the 3-column S/W/S layout.
 */
function ExpandedHistoryEntry({
  entry,
  isCurrent,
  changedNotes,
  onCollapse,
  onSuggestionFilter,
  showDebug = false,
}: {
  entry: HistoryEntry;
  isCurrent: boolean;
  /** What-changed diff against the previous eval — only shown for the current entry. */
  changedNotes: { added: Note[]; removed: Note[] } | null;
  /** Only shown on non-current entries; clicking dismisses this one back to the latest. */
  onCollapse?: () => void;
  onSuggestionFilter?: (filter: SuggestionFilter, note: Note) => void;
  /** Show engine debug info per note (admin only). */
  showDebug?: boolean;
}) {
  return (
    <div
      id={`history-entry-expanded-${entry.id}`}
      className={cn(
        "w-full min-w-0 space-y-4",
        isCurrent
          ? ""
          : "border border-[#d9d0c9]/70 bg-[#f7f7f7] p-3",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <CurrentEngineRead entry={entry} />
        {!isCurrent && onCollapse && (
          <button
            id={`history-entry-dismiss-${entry.id}`}
            type="button"
            onClick={onCollapse}
            className="flex-shrink-0 border border-[#d9d0c9]/70 px-3 py-1.5 text-[0.625rem] uppercase tracking-[0.18em] text-[#0e0907]/45 transition-colors hover:border-[#ffa05c]/40 hover:text-[#0e0907]"
          >
            Latest
          </button>
        )}
      </div>

      {/* Only the currently-live eval carries the what-changed diff panel. */}
      {isCurrent && changedNotes && (
        <WhatChangedPanel added={changedNotes.added} removed={changedNotes.removed} />
      )}

      {/* Strengths / weaknesses / suggestions */}
      {entry.notes.length === 0 ? (
        <p className="border border-dashed border-[#d9d0c9] bg-[#f0f0f0]/55 px-3 py-3 text-[0.8125rem] text-[#0e0907]/55">
          No pressure points yet. Add Players to make the Rotation readable.
        </p>
      ) : (
        <NotesList
          issues={entry.issues}
          suggestions={entry.suggestions}
          strengths={entry.strengths}
          onSuggestionFilter={onSuggestionFilter}
          showDebug={showDebug}
        />
      )}
    </div>
  );
}

/**
 * Collapsed row — single-line evaluation summary. Clicking expands this entry
 * (and collapses whichever one was previously expanded).
 */
function CollapsedHistoryRow({
  entry,
  onExpand,
}: {
  entry: HistoryEntry;
  onExpand: () => void;
}) {
  const issueCount = entry.issues.length;
  const suggestionCount = entry.suggestions.length;
  const strengthCount = entry.strengths.length;

  return (
    <button
      type="button"
      id={`history-entry-collapsed-${entry.id}`}
      onClick={onExpand}
      className={cn(
        "flex w-full items-center gap-3 border border-[#d9d0c9]/70 bg-[#f7f7f7] px-3 py-2.5 text-left transition-colors",
        "hover:border-[#ffa05c]/30 hover:bg-[#0e0907]/[0.02] focus:outline-none focus:ring-1 focus:ring-[#ffa05c]/50",
      )}
    >
      <div className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-[#ffa05c]/70" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-[0.18em] text-[#0e0907]/35">Previous eval</p>
        <p className="truncate font-medium text-foreground">{entry.changeDescription}</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">{formatMemoDate(entry.timestamp)}</p>
      </div>
      {/* Compact counts keep older evaluations scannable. */}
      <div className="flex flex-shrink-0 items-center gap-2 rounded-md border border-[#d9d0c9]/70 bg-[#0e0907]/[0.03] px-2.5 py-1 text-[0.625rem] font-mono">
        <span className="text-green-600 dark:text-green-400">+{strengthCount}</span>
        <span className="text-red-600 dark:text-red-400">−{issueCount}</span>
        <span className="text-amber-600 dark:text-amber-400">★{suggestionCount}</span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AssistantGmNotes({
  allSlots,
  legendDetail,
  isAdmin,
  onEvaluation,
  onSuggestionFilter,
  focusedPlayerName,
}: AssistantGmNotesProps) {
  const [state, setState] = useState<GmNotesState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Session history — accumulates one HistoryEntry per successful eval
  const [sessionHistory, setSessionHistory] = useState<HistoryEntry[]>([]);
  // Which entry is expanded. null → defer to "latest" (the top of the stack).
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);

  // What-changed: specific notes that were added or resolved between evaluations (current entry only)
  const [changedNotes, setChangedNotes] = useState<{ added: Note[]; removed: Note[] } | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks previous notes to compute what-changed diffs (added/removed notes)
  const prevNotesRef = useRef<Note[] | null>(null);
  // Tracks previous slot layout to derive the change line on the next eval
  const prevSlotsRef = useRef<(PlayerWithSkills | null)[] | null>(null);

  // Stable key: changes on player add/remove OR starter↔bench boundary crossing.
  // Swaps *within* starters (slots 1-5) or *within* bench (slots 6-9) do NOT
  // trigger re-eval — only moving a player across the starting-lineup boundary does.
  // Each group is sorted by player ID so intra-group reordering is invisible.
  // Legend ID is prefixed so switching cornerstones triggers re-eval even with 0 supporting players.
  const rosterKey = useMemo(() => {
    const legendPart = legendDetail ? `legend:${legendDetail.id}` : "legend:none";
    // allSlots indices 0-4 = starting lineup (cornerstone + co-star + starters)
    // allSlots indices 5-8 = bench
    const STARTER_BOUNDARY = 5;
    const starterIds = allSlots
      .slice(0, STARTER_BOUNDARY)
      .filter(Boolean)
      .map((p) => p!.id)
      .sort()
      .join(",");
    const benchIds = allSlots
      .slice(STARTER_BOUNDARY)
      .filter(Boolean)
      .map((p) => p!.id)
      .sort()
      .join(",");
    return `${legendPart}|s:${starterIds}|b:${benchIds}`;
  }, [allSlots, legendDetail]);

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
        // Normalize cohesion notes into legacy Note shape so bucketing and
        // diff logic work identically for both engine responses
        const newNotes: Note[] = normalizeCohesionNotes(res.data.notes);

        // Compute what-changed diff: which specific notes appeared or disappeared
        const prevN = prevNotesRef.current;
        if (prevN) {
          const currentKeys = new Set(newNotes.map((n) => n.trace_key));
          const prevKeys = new Set(prevN.map((n) => n.trace_key));
          const added = newNotes.filter((n) => !prevKeys.has(n.trace_key));
          const removed = prevN.filter((n) => !currentKeys.has(n.trace_key));
          setChangedNotes(added.length > 0 || removed.length > 0 ? { added, removed } : null);
        } else {
          setChangedNotes(null);
        }

        // Derive the change line from the Rotation delta
        const changeDescription = describeRosterChange(prevSlotsRef.current, allSlots);

        // Build the new history entry — pre-bucketed into S/W/S for cheap re-renders
        const entry: HistoryEntry = {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          changeDescription,
          evaluation: res.data,
          notes: newNotes,
          issues: newNotes.filter((n) => n.severity === "critical" || n.severity === "warning"),
          suggestions: newNotes.filter((n) => n.severity === "suggestion"),
          strengths: newNotes.filter((n) => n.severity === "strength"),
        };

        // Append entry (keep newest-first), cap to HISTORY_LIMIT, and jump the expanded view to latest
        setSessionHistory((prev) => [entry, ...prev].slice(0, HISTORY_LIMIT));
        setExpandedEntryId(null); // null → follow "latest"

        // Refresh refs used by the next diff
        prevNotesRef.current = newNotes;
        prevSlotsRef.current = allSlots.slice(); // immutable snapshot

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
      setSessionHistory([]);
      setExpandedEntryId(null);
      setChangedNotes(null);
      prevNotesRef.current = null;
      prevSlotsRef.current = null;
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void runEval(); }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // rosterKey encodes Legend + all slots; runEval is stable-ish via useCallback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterKey]);

  // Derived: which entry is visually "current" (expanded with full S/W/S + what-changed)
  // If expandedEntryId is null or stale, we fall back to the latest.
  const currentEntry: HistoryEntry | null = useMemo(() => {
    if (sessionHistory.length === 0) return null;
    if (expandedEntryId) {
      const found = sessionHistory.find((e) => e.id === expandedEntryId);
      if (found) return found;
    }
    return sessionHistory[0];
  }, [sessionHistory, expandedEntryId]);

  const isLatestExpanded = currentEntry?.id === sessionHistory[0]?.id;

  // Derive player-filtered view of the current entry when a slot is focused.
  // Filtering happens at display time — stored history stays unmodified.
  const filteredCurrentEntry: HistoryEntry | null = useMemo(() => {
    if (!currentEntry || !focusedPlayerName) return currentEntry;
    const filteredNotes = filterNotesByPlayer(currentEntry.notes, focusedPlayerName);
    return {
      ...currentEntry,
      notes: filteredNotes,
      issues: filterNotesByPlayer(currentEntry.issues, focusedPlayerName),
      suggestions: filterNotesByPlayer(currentEntry.suggestions, focusedPlayerName),
      strengths: filterNotesByPlayer(currentEntry.strengths, focusedPlayerName),
    };
  }, [currentEntry, focusedPlayerName]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      id="builder-gm-notes"
      className="flex min-w-0 flex-col gap-4"
    >
      {state === "idle" && (
        <p id="builder-gm-notes-idle" className="border border-dashed border-[#d9d0c9] bg-[#f0f0f0]/60 px-4 py-6 text-[0.9375rem] text-[#0e0907]/45">
          Add Players to the Rotation to get live Feedback.
        </p>
      )}

      {state === "analyzing" && sessionHistory.length === 0 && (
        <ul
          id="builder-gm-notes-skeleton"
          className="space-y-3 border border-[#d9d0c9]/70 bg-[#f0f0f0]/70 p-4 animate-pulse"
          aria-label="Loading notes"
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="flex items-start gap-3 rounded-md border border-[#d9d0c9]/50 bg-[#0e0907]/[0.02] px-3 py-3">
              <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30 flex-shrink-0 mt-1.5" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-24 rounded bg-muted" />
                <div className={cn("h-4 rounded bg-muted", i % 2 === 0 ? "w-full" : "w-4/5")} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Session history stack — expanded current + collapsed past entries */}
      {currentEntry && filteredCurrentEntry && (
        <div id="builder-gm-notes-history" className="flex min-w-0 flex-col gap-3">
          {sessionHistory.map((entry, idx) => {
            const isExpanded = entry.id === currentEntry.id;
            /* When expanded, use the player-filtered version of the entry */
            if (isExpanded) {
              const isLatest = idx === 0;
              return (
                <ExpandedHistoryEntry
                  key={entry.id}
                  entry={filteredCurrentEntry}
                  isCurrent={isLatest}
                  changedNotes={isLatest && !focusedPlayerName ? changedNotes : null}
                  onCollapse={!isLatest ? () => setExpandedEntryId(null) : undefined}
                  onSuggestionFilter={onSuggestionFilter}
                  showDebug={isAdmin}
                />
              );
            }
            return (
              <CollapsedHistoryRow
                key={entry.id}
                entry={entry}
                onExpand={() => setExpandedEntryId(entry.id)}
              />
            );
          })}

          {/* "Viewing an older evaluation" hint when user has scrolled back */}
          {!isLatestExpanded && (
            <p className="border border-[#d9d0c9]/70 bg-[#f0f0f0]/70 px-3 py-2 text-[0.625rem] italic text-[#0e0907]/40">
              Viewing older eval. Click a newer row above or Latest to return.
            </p>
          )}
        </div>
      )}

      {state === "error" && (
        <p id="builder-gm-notes-error" className="border border-[#e53e3e]/30 bg-[#e53e3e]/5 px-4 py-3 text-[0.9375rem] text-[#e53e3e]">
          {errorMsg ?? "Something went wrong."}
        </p>
      )}
    </div>
  );
}
