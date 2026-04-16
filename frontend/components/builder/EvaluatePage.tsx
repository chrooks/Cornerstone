"use client";

/**
 * EvaluatePage.tsx — Final roster evaluation page.
 *
 * Reads the same URL params as the builder (?cornerstone=, ?s1-s8=),
 * reconstructs the roster, and calls POST /api/builder/evaluate in final mode.
 *
 * Layout: header → roster summary → two-column (strengths | issues) → tips → debug
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { listPlayersWithSkills, getLegend, evaluateRoster } from "@/lib/api";
import { useAdminStatus } from "@/lib/hooks/useAdminStatus";
import { MAX_ROSTER_SLOTS } from "@/lib/builder-config";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import type { LegendDetail, Note, PlayerWithSkills, RosterEvaluation } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readSlotsFromParams(
  params: URLSearchParams,
  cornerstoneId: string | null,
  playerMap: Map<string, PlayerWithSkills>,
): (PlayerWithSkills | null)[] {
  const slots: (PlayerWithSkills | null)[] = Array(MAX_ROSTER_SLOTS).fill(null);
  if (params.has("s1")) {
    for (let i = 1; i <= MAX_ROSTER_SLOTS; i++) {
      const id = params.get(`s${i}`);
      if (id) slots[i - 1] = playerMap.get(id) ?? null;
    }
  } else {
    if (cornerstoneId) slots[0] = playerMap.get(cornerstoneId) ?? null;
    for (let i = 2; i <= MAX_ROSTER_SLOTS; i++) {
      const id = params.get(`s${i}`);
      if (id) slots[i - 1] = playerMap.get(id) ?? null;
    }
  }
  return slots;
}

function buildPlayerPayload(
  allSlots: (PlayerWithSkills | null)[],
  legendDetail: LegendDetail,
) {
  return allSlots
    .filter((p): p is PlayerWithSkills => p !== null)
    .map((p) => {
      if (p.is_legend) {
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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function NoteCard({ note }: { note: Note }) {
  return (
    <div className="flex gap-2 items-start p-3 rounded-lg bg-muted/40">
      <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide flex-shrink-0 mt-0.5", badgeClass(note.severity))}>
        {note.severity}
      </span>
      <p className="text-xs text-muted-foreground leading-relaxed">{note.text}</p>
    </div>
  );
}

function RosterSummary({ allSlots, cornerstoneId }: { allSlots: (PlayerWithSkills | null)[]; cornerstoneId: string | null }) {
  return (
    <div id="eval-roster-summary" className="flex gap-3 overflow-x-auto pb-1 justify-center">
      {allSlots.filter(Boolean).map((p, i) => {
        const isCornerstone = p!.id === cornerstoneId;
        return (
          <div key={p!.id} id={`eval-slot-${i + 1}`} className="flex-shrink-0 flex flex-col items-center gap-1">
            <div className="relative w-14 h-14 rounded-lg overflow-hidden border-2 border-border">
              <PlayerHeadshot nba_api_id={p!.nba_api_id} size={56} name={p!.name} />
              {isCornerstone && (
                <span
                  id={`eval-slot-${i + 1}-legend-badge`}
                  className="absolute top-0 left-0 bg-amber-400/90 text-white text-[8px] font-bold px-1 py-0.5 rounded-br"
                >
                  ★
                </span>
              )}
            </div>
            <p
              id={`eval-slot-${i + 1}-name`}
              className="text-[9px] text-muted-foreground text-center leading-tight truncate w-14"
              title={p!.name}
            >
              {p!.name.split(" ").pop()}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EvaluatePage
// ---------------------------------------------------------------------------

type EvalState = "loading" | "evaluating" | "ready" | "error";

interface DataReady {
  slots: (PlayerWithSkills | null)[];
  legend: LegendDetail;
}

export function EvaluatePage() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const { isAdmin, loading: adminLoading, email } = useAdminStatus();
  const isLoggedIn = email !== null;

  const cornerstoneId = searchParams.get("cornerstone");
  const backHref = `/builder?${searchParams.toString()}`;

  const [evalState, setEvalState] = useState<EvalState>("loading");
  const [errorMsg, setErrorMsg]   = useState<string | null>(null);
  const [dataReady, setDataReady] = useState<DataReady | null>(null);
  const [evaluation, setEvaluation] = useState<RosterEvaluation | null>(null);
  const [debugOpen, setDebugOpen]   = useState(false);
  const [debugCopied, setDebugCopied] = useState(false);

  // Capture searchParams at mount — stable ref avoids closure staleness
  const paramsRef = useRef(searchParams.toString());

  // Phase 1: load players + legend
  useEffect(() => {
    if (!cornerstoneId) { router.replace("/builder"); return; }

    Promise.all([listPlayersWithSkills(), getLegend(cornerstoneId)])
      .then(([playersRes, legendRes]) => {
        if (!playersRes.success || !playersRes.data) throw new Error(playersRes.error ?? "Failed to load players");
        if (!legendRes.success || !legendRes.data) throw new Error(legendRes.error ?? "Failed to load legend");

        const playerMap = new Map(playersRes.data.map((p) => [p.id, p]));
        const slots = readSlotsFromParams(new URLSearchParams(paramsRef.current), cornerstoneId, playerMap);
        setDataReady({ slots, legend: legendRes.data });
        setEvalState("evaluating");
      })
      .catch((err: unknown) => {
        setErrorMsg(err instanceof Error ? err.message : "Failed to load data");
        setEvalState("error");
      });
  // Mount only — paramsRef captures the snapshot
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 2: evaluate once data AND admin status are both resolved
  useEffect(() => {
    if (!dataReady || adminLoading) return;

    const players = buildPlayerPayload(dataReady.slots, dataReady.legend);
    setEvalState("evaluating");

    evaluateRoster({ players, mode: "final", debug: isAdmin })
      .then((res) => {
        if (res.success && res.data) {
          setEvaluation(res.data);
          setEvalState("ready");
        } else {
          setErrorMsg(res.error ?? "Evaluation failed");
          setEvalState("error");
        }
      })
      .catch(() => {
        setErrorMsg("Failed to reach the server");
        setEvalState("error");
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataReady, adminLoading]);

  // Note buckets
  const strengths = useMemo(() => evaluation?.notes.filter((n) => n.severity === "strength") ?? [], [evaluation]);
  const issues    = useMemo(() => evaluation?.notes.filter((n) => n.severity === "critical" || n.severity === "warning") ?? [], [evaluation]);
  const tips      = useMemo(() => evaluation?.notes.filter((n) => n.severity === "tip") ?? [], [evaluation]);

  const debugTraces = evaluation
    ? { player: evaluation.player_traces, aggregate: evaluation.aggregate_traces }
    : null;

  const handleCopyDebug = useCallback(async () => {
    if (!debugTraces) return;
    await navigator.clipboard.writeText(JSON.stringify(debugTraces, null, 2));
    setDebugCopied(true);
    setTimeout(() => setDebugCopied(false), 2000);
  }, [debugTraces]);

  const isLoading = evalState === "loading" || evalState === "evaluating";

  return (
    <main id="eval-page" className="max-w-4xl mx-auto px-4 py-6 space-y-6">

      {/* Header */}
      <div id="eval-header" className="relative flex items-center">
        <button
          id="eval-back-btn"
          type="button"
          onClick={() => router.push(backHref)}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0"
        >
          ← Back to builder
        </button>
        <h1 id="eval-title" className="absolute left-1/2 -translate-x-1/2 text-lg font-bold text-foreground pointer-events-none whitespace-nowrap">
          Final Evaluation
        </h1>
        {isLoggedIn && (
          <button
            id="eval-save-btn"
            type="button"
            disabled
            title="Coming soon"
            className="ml-auto text-sm font-medium rounded-md border border-border px-3 py-1.5 opacity-40 cursor-not-allowed shrink-0"
          >
            Save Roster
          </button>
        )}
      </div>

      {/* Roster summary */}
      {dataReady && (
        <RosterSummary allSlots={dataReady.slots} cornerstoneId={cornerstoneId} />
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div id="eval-skeleton" className="space-y-4 animate-pulse">
          <div className="grid grid-cols-2 gap-4">
            {[0, 1].map((col) => (
              <div key={col} className="space-y-3">
                <div className="h-5 w-24 bg-muted rounded" />
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-14 bg-muted rounded-lg" />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {evalState === "error" && (
        <p id="eval-error" className="text-sm text-destructive">{errorMsg ?? "Something went wrong."}</p>
      )}

      {/* Results */}
      {evalState === "ready" && evaluation && (
        <div id="eval-results" className="space-y-6">

          {/* Two columns */}
          <div id="eval-columns" className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div id="eval-strengths">
              <h2 id="eval-strengths-title" className="text-sm font-semibold text-green-400 mb-3">Strengths</h2>
              {strengths.length === 0
                ? <p className="text-xs text-muted-foreground">No standout strengths identified.</p>
                : <div className="space-y-2">{strengths.map((n, i) => <NoteCard key={i} note={n} />)}</div>
              }
            </div>
            <div id="eval-issues">
              <h2 id="eval-issues-title" className="text-sm font-semibold text-amber-400 mb-3">Areas to Address</h2>
              {issues.length === 0
                ? <p className="text-xs text-muted-foreground">No critical issues found.</p>
                : <div className="space-y-2">{issues.map((n, i) => <NoteCard key={i} note={n} />)}</div>
              }
            </div>
          </div>

          {/* Tips */}
          {tips.length > 0 && (
            <div id="eval-tips">
              <h2 id="eval-tips-title" className="text-sm font-semibold text-blue-400 mb-3">Tips</h2>
              <div className="space-y-2">{tips.map((n, i) => <NoteCard key={i} note={n} />)}</div>
            </div>
          )}

          {/* Admin debug */}
          {isAdmin && debugTraces && (
            <div id="eval-debug" className="border border-border rounded">
              <div className="flex items-center justify-between px-3 py-2">
                <button id="eval-debug-toggle" type="button" onClick={() => setDebugOpen((v) => !v)}
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors font-mono cursor-pointer">
                  {debugOpen ? "▾" : "▸"} Debug Traces
                </button>
                <button id="eval-debug-copy" type="button" onClick={handleCopyDebug}
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors font-mono cursor-pointer">
                  {debugCopied ? "✓ Copied" : "Copy"}
                </button>
              </div>
              {debugOpen && (
                <pre id="eval-debug-content" className="px-3 pb-3 text-[10px] text-muted-foreground overflow-auto max-h-96 font-mono">
                  {JSON.stringify(debugTraces, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
