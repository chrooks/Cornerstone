"use client";

/**
 * AssistantGmNotes.tsx — Live GM feedback panel for the roster builder.
 *
 * Fires POST /api/builder/evaluate whenever the set of players in the roster
 * changes (add/remove). Reordering slots does NOT trigger a re-eval.
 * Debounced 500ms to avoid hammering the backend on rapid changes.
 *
 * States: idle → analyzing (skeleton) → ready (notes) | error
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { evaluateRoster } from "@/lib/api";
import type { LegendDetail, Note, PlayerWithSkills } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GmNotesState = "idle" | "analyzing" | "ready" | "error";

interface AssistantGmNotesProps {
  allSlots: (PlayerWithSkills | null)[];
  legendDetail: LegendDetail | null;
  isAdmin: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPlayerPayload(
  allSlots: (PlayerWithSkills | null)[],
  legendDetail: LegendDetail | null,
) {
  return allSlots
    .filter((p): p is PlayerWithSkills => p !== null)
    .map((p) => {
      if (p.is_legend && legendDetail) {
        return {
          name: legendDetail.name,
          height: legendDetail.height,
          skills: Object.fromEntries(
            Object.entries(legendDetail.profile).map(([k, v]) => [k, v ?? "None"]),
          ),
        };
      }
      return {
        name: p.name,
        height: p.height,
        skills: (p.skills ?? {}) as Record<string, string>,
      };
    });
}

function badgeClass(severity: Note["severity"]): string {
  switch (severity) {
    case "critical": return "bg-red-500/20 text-red-400 border border-red-500/30";
    case "warning":  return "bg-amber-500/20 text-amber-400 border border-amber-500/30";
    case "tip":      return "bg-blue-500/20 text-blue-400 border border-blue-500/30";
    case "strength": return "bg-green-500/20 text-green-400 border border-green-500/30";
  }
}

function SeverityBadge({ severity }: { severity: Note["severity"] }) {
  return (
    <span
      className={cn(
        "text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide flex-shrink-0 mt-0.5",
        badgeClass(severity),
      )}
    >
      {severity}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Debug panel
// ---------------------------------------------------------------------------

function DebugPanel({ traces }: { traces: { player: Record<string, unknown> | null; aggregate: Record<string, unknown> | null } }) {
  const [open, setOpen]     = useState(false);
  const [copied, setCopied] = useState(false);

  const json = JSON.stringify(traces, null, 2);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [json]);

  return (
    <div id="builder-gm-notes-debug" className="mt-2 border border-border rounded flex flex-col min-h-0 flex-1">
      <div className="flex items-center justify-between px-3 py-2 flex-shrink-0">
        <button
          id="builder-gm-notes-debug-toggle"
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors font-mono cursor-pointer"
        >
          {open ? "▾" : "▸"} Debug Traces
        </button>
        <button
          id="builder-gm-notes-debug-copy"
          type="button"
          onClick={handleCopy}
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors font-mono cursor-pointer"
        >
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      {open && (
        <pre
          id="builder-gm-notes-debug-content"
          className="px-3 pb-3 text-[10px] text-muted-foreground overflow-auto font-mono flex-1 min-h-0"
        >
          {json}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AssistantGmNotes({ allSlots, legendDetail, isAdmin }: AssistantGmNotesProps) {
  const [state, setState]           = useState<GmNotesState>("idle");
  const [notes, setNotes]           = useState<Note[]>([]);
  const [errorMsg, setErrorMsg]     = useState<string | null>(null);
  const [debugTraces, setDebugTraces] = useState<{
    player: Record<string, unknown> | null;
    aggregate: Record<string, unknown> | null;
  } | null>(null);
  const [debugOpen, setDebugOpen]   = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable key: changes on player add/remove, not on slot reorder
  const rosterKey = useMemo(() => {
    return allSlots
      .filter(Boolean)
      .map((p) => p!.id)
      .sort()
      .join(",");
  }, [allSlots]);

  const filledCount = allSlots.filter(Boolean).length;

  const runEval = useCallback(async () => {
    const players = buildPlayerPayload(allSlots, legendDetail);
    if (players.length === 0) {
      setState("idle");
      return;
    }

    setState("analyzing");
    setErrorMsg(null);

    try {
      const res = await evaluateRoster({ players, mode: "live", debug: isAdmin });
      if (res.success && res.data) {
        setNotes(res.data.notes);
        if (isAdmin) {
          setDebugTraces({
            player:    res.data.player_traces,
            aggregate: res.data.aggregate_traces,
          });
        }
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
    if (filledCount === 0) {
      setState("idle");
      setNotes([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void runEval(); }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  // rosterKey captures add/remove; runEval is stable-ish via useCallback
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterKey]);

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

      {state === "ready" && notes.length === 0 && (
        <p id="builder-gm-notes-empty" className="text-xs text-muted-foreground">
          No issues found — roster looks solid.
        </p>
      )}

      {state === "ready" && notes.length > 0 && (
        <ul id="builder-gm-notes-list" className="space-y-3">
          {notes.map((note, i) => (
            <li
              key={i}
              id={`builder-gm-note-${i + 1}`}
              className="flex gap-2 items-start text-xs text-muted-foreground leading-relaxed"
            >
              <SeverityBadge severity={note.severity} />
              <span>{note.text}</span>
            </li>
          ))}
        </ul>
      )}

      {state === "error" && (
        <p id="builder-gm-notes-error" className="text-xs text-destructive">
          {errorMsg ?? "Something went wrong."}
        </p>
      )}

      {/* Admin debug panel */}
      {isAdmin && debugTraces && state === "ready" && (
        <DebugPanel traces={debugTraces} />
      )}
    </div>
  );
}
