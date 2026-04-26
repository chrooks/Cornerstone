"use client";

/**
 * AssistantGmNotes.tsx — Live GM feedback panel for the roster builder.
 *
 * Fires POST /api/builder/evaluate whenever the set of players in the roster
 * changes (add/remove). Reordering slots does NOT trigger a re-eval.
 * Debounced 500ms to avoid hammering the backend on rapid changes.
 *
 * States: idle → analyzing (skeleton) → ready (session history stack) | error
 *
 * Session history model (email-style):
 *   Each successful eval is appended to sessionHistory. The most recent entry is
 *   expanded by default with the full S/W/S layout. Older entries render as
 *   compact rows with a subject line + timestamp + note count — click a row
 *   to expand it and collapse whichever entry was previously expanded.
 *
 * Player payload: cornerstone → slot=0, is_cornerstone=true
 *                 supporting  → slot=index+1 (allSlots array is 0-indexed)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { evaluateRoster } from "@/lib/api";
import { NotesList } from "./NotesList";
import type { SuggestionFilter } from "@/lib/noteFilters";
import type { CohesionRosterEvaluation, LegendDetail, Note, PlayerWithSkills, RosterEvaluation } from "@/lib/types";
import { isCohesionEvaluation, normalizeCohesionNotes } from "@/lib/cohesionHelpers";

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
  onEvaluation?: (evaluation: RosterEvaluation | CohesionRosterEvaluation) => void;
  /** Called when the user clicks a suggestion note — parent injects a filter into the player picker. */
  onSuggestionFilter?: (filter: SuggestionFilter, note: Note) => void;
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
 * Derive a short subject line describing how the roster changed between two
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

/** Format a Unix timestamp (ms) as a short time string like "3:47 PM". */
function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** Format a timestamp like an internal memo dateline. */
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

// ---------------------------------------------------------------------------
// What-changed panel — shows specific notes that appeared/disappeared
// ---------------------------------------------------------------------------

function WhatChangedPanel({ added, removed }: { added: Note[]; removed: Note[] }) {
  const [isOpen, setIsOpen] = useState(true);
  const totalCount = added.length + removed.length;

  // Auto-collapse after 5 seconds so stale changes don't clutter the view
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setIsOpen(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setIsOpen(false), 5000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [added, removed]);

  return (
    <div
      id="gm-notes-what-changed"
      className="overflow-hidden rounded-2xl border border-border/70 bg-background/80 shadow-[0_8px_24px_rgba(15,23,42,0.05)]"
    >
      <button
        id="gm-notes-what-changed-toggle"
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2 text-left transition-colors hover:bg-muted/30 cursor-pointer"
        aria-expanded={isOpen}
      >
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/80">Redlines</p>
          <span className="text-[12px] font-semibold text-foreground">
            What changed
            <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">({totalCount})</span>
          </span>
        </div>
        <span className="text-muted-foreground text-[9px] font-mono" aria-hidden>
          {isOpen ? "▾" : "▸"}
        </span>
      </button>
      {isOpen && (
        <div id="gm-notes-what-changed-content" className="space-y-2 px-4 pb-4">
          {/* New notes — green accent */}
          {added.map((note) => (
            <div
              key={`added-${note.trace_key}`}
              id={`changed-added-${note.trace_key}`}
              className="flex items-start gap-2 rounded-xl border border-green-500/20 bg-green-500/5 px-3 py-2 text-[11px]"
            >
              <span className="text-green-500 font-mono flex-shrink-0">+</span>
              <p className="text-muted-foreground leading-snug">{note.text}</p>
            </div>
          ))}
          {/* Resolved notes — red accent with strikethrough */}
          {removed.map((note) => (
            <div
              key={`removed-${note.trace_key}`}
              id={`changed-removed-${note.trace_key}`}
              className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-[11px] opacity-70"
            >
              <span className="text-red-500 font-mono flex-shrink-0">−</span>
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
}: {
  entry: HistoryEntry;
  isCurrent: boolean;
  /** What-changed diff against the previous eval — only shown for the current entry. */
  changedNotes: { added: Note[]; removed: Note[] } | null;
  /** Only shown on non-current entries; clicking dismisses this one back to the latest. */
  onCollapse?: () => void;
  onSuggestionFilter?: (filter: SuggestionFilter, note: Note) => void;
}) {
  return (
    <div
      id={`history-entry-expanded-${entry.id}`}
      className={cn(
        "w-full min-w-0 space-y-4 rounded-[22px] border p-4 shadow-[0_18px_40px_rgba(15,23,42,0.06)]",
        isCurrent
          ? "border-amber-500/30 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(255,247,237,0.92))] dark:bg-[linear-gradient(180deg,rgba(24,24,23,0.96),rgba(41,23,14,0.9))]"
          : "border-border/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.88))] dark:bg-[linear-gradient(180deg,rgba(24,24,23,0.92),rgba(20,20,20,0.88))]",
      )}
    >
      {/* Header row — memo metadata + subject line */}
      <div className="flex items-start justify-between gap-3">
        <div id={`history-entry-metadata-${entry.id}`} className="min-w-0 flex-1 space-y-3">

          <div className="flex items-start justify-between gap-4">
            <p id={`history-entry-subject-${entry.id}`} className="min-w-0 flex-1">
              <span className="font-semibold text-foreground/85">Subject:</span> {entry.changeDescription}
            </p>
            <p className="flex-shrink-0 text-[11px] text-muted-foreground">
              {formatTime(entry.timestamp)}
              {isCurrent && <span className="ml-1.5 text-amber-600 dark:text-amber-400">• latest</span>}
            </p>
          </div>

          <div className="grid gap-1 text-[11px] text-muted-foreground">
            <p id={`history-entry-from-${entry.id}`}><span className="font-semibold text-foreground/85">From:</span> Assistant GM, Pro Scouting</p>
            <p id={`history-entry-to-${entry.id}`}><span className="font-semibold text-foreground/85">To:</span> General Manager</p>
          </div>


        </div>
        {!isCurrent && onCollapse && (
          <button
            id={`history-entry-dismiss-${entry.id}`}
            type="button"
            onClick={onCollapse}
            className="flex-shrink-0 rounded-full border border-border/70 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:border-amber-500/40 hover:text-foreground"
          >
            Latest memo
          </button>
        )}
      </div>

      {/* Only the currently-live eval carries the what-changed diff panel. */}
      {isCurrent && changedNotes && (
        <WhatChangedPanel added={changedNotes.added} removed={changedNotes.removed} />
      )}

      {/* Three-column strengths/weaknesses/suggestions */}
      {entry.notes.length === 0 ? (
        <p className="text-xs text-muted-foreground">No issues found — roster looks solid.</p>
      ) : (
        <NotesList
          issues={entry.issues}
          suggestions={entry.suggestions}
          strengths={entry.strengths}
          variant="email"
          onSuggestionFilter={onSuggestionFilter}
        />
      )}
    </div>
  );
}

/**
 * Collapsed row — single-line email-style summary. Clicking expands this entry
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
        "flex w-full items-center gap-3 rounded-2xl border border-border/70 bg-background/80 px-4 py-3 text-left transition-colors",
        "hover:border-amber-500/30 hover:bg-muted/30 focus:outline-none focus:ring-1 focus:ring-amber-500/50",
      )}
    >
      <div className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-amber-500/70" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">Scout note</p>
        <p className="truncate font-medium text-foreground">{entry.changeDescription}</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">{formatMemoDate(entry.timestamp)}</p>
      </div>
      {/* Pill: tiny counts of +/-/★ keep the row scannable like a mail subject line */}
      <div className="flex flex-shrink-0 items-center gap-2 rounded-full border border-border/70 bg-muted/30 px-2.5 py-1 text-[10px] font-mono">
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
  // Tracks previous slot layout to derive the change subject line on the next eval
  const prevSlotsRef = useRef<(PlayerWithSkills | null)[] | null>(null);

  // Stable key: changes on player add/remove OR slot reorder, so swapping slots triggers re-eval
  // (slot position affects slot weight, which directly affects scores)
  // Legend ID is prefixed so switching cornerstones triggers re-eval even with 0 supporting players.
  const rosterKey = useMemo(() => {
    const legendPart = legendDetail ? `legend:${legendDetail.id}` : "legend:none";
    const slotPart = allSlots
      .map((p, i) => (p ? `${i}:${p.id}` : null))
      .filter(Boolean)
      .join(",");
    return `${legendPart}|${slotPart}`;
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
        const newNotes: Note[] = isCohesionEvaluation(res.data)
          ? normalizeCohesionNotes(res.data.notes)
          : res.data.notes;

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

        // Derive the email-style subject line from the roster delta
        const changeDescription = describeRosterChange(prevSlotsRef.current, allSlots);

        // Build the new history entry — pre-bucketed into S/W/S for cheap re-renders
        const entry: HistoryEntry = {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          changeDescription,
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
    // rosterKey encodes legend + all slots; runEval is stable-ish via useCallback
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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      id="builder-gm-notes"
      className="flex min-w-0 flex-col gap-4 rounded-[24px] border border-border/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.86),rgba(255,248,240,0.88))] p-4 shadow-[0_24px_70px_rgba(15,23,42,0.08)] dark:bg-[linear-gradient(180deg,rgba(18,18,18,0.96),rgba(34,20,12,0.92))]"
    >
      {state === "idle" && (
        <p id="builder-gm-notes-idle" className="rounded-2xl border border-dashed border-border/80 bg-background/60 px-4 py-6 text-sm text-muted-foreground">
          Add players to your roster to get GM feedback.
        </p>
      )}

      {state === "analyzing" && sessionHistory.length === 0 && (
        <ul
          id="builder-gm-notes-skeleton"
          className="space-y-3 rounded-[20px] border border-border/70 bg-background/70 p-4 animate-pulse"
          aria-label="Loading notes"
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="flex items-start gap-3 rounded-xl border border-border/50 bg-muted/20 px-3 py-3">
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
      {currentEntry && (
        <div id="builder-gm-notes-history" className="flex min-w-0 flex-col gap-3">
          {sessionHistory.map((entry, idx) => {
            const isExpanded = entry.id === currentEntry.id;
            // Only the latest entry renders the live what-changed diff; older
            // snapshots show their S/W/S content but skip the diff panel so
            // they represent a point-in-time state, not a delta.
            if (isExpanded) {
              const isLatest = idx === 0;
              return (
                <ExpandedHistoryEntry
                  key={entry.id}
                  entry={entry}
                  isCurrent={isLatest}
                  changedNotes={isLatest ? changedNotes : null}
                  onCollapse={!isLatest ? () => setExpandedEntryId(null) : undefined}
                  onSuggestionFilter={onSuggestionFilter}
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
            <p className="rounded-xl border border-border/70 bg-background/70 px-3 py-2 text-[10px] italic text-muted-foreground">
              Viewing an older evaluation. Click a newer row above or the return link to come back.
            </p>
          )}
        </div>
      )}

      {state === "error" && (
        <p id="builder-gm-notes-error" className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {errorMsg ?? "Something went wrong."}
        </p>
      )}
    </div>
  );
}
