"use client";

/**
 * EvaluatePage.tsx — Final roster evaluation page.
 *
 * Reads the same URL params as the builder (?cornerstone=, ?s1-s8=),
 * reconstructs the roster, and calls POST /api/builder/evaluate in final mode.
 *
 * Layout: header → roster summary → ScoreDisplay → NotesList → (admin) DebugPanel
 *
 * Player payload: cornerstone → slot=0, is_cornerstone=true
 *                 supporting  → slot=index+1 (allSlots[0] = slot 1), is_cornerstone=false
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { listPlayersWithSkills, getLegend, evaluateRoster } from "@/lib/api";
import { useAdminStatus } from "@/lib/hooks/useAdminStatus";
import { MAX_ROSTER_SLOTS } from "@/lib/builder-config";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { ScoreDisplay } from "./ScoreDisplay";
import { NotesList } from "./NotesList";
import { DebugPanel } from "./DebugPanel";
import type { LegendDetail, PlayerWithSkills, RosterEvaluation } from "@/lib/types";

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

/**
 * Build the player payload for POST /api/builder/evaluate.
 *
 * The cornerstone legend (from legendDetail) gets slot=0, is_cornerstone=true.
 * allSlots is 0-indexed; allSlots[0] corresponds to slot 1, allSlots[1] to slot 2, etc.
 * The legend itself occupies slot 0 in the URL params but may appear in allSlots[0] as a
 * PlayerWithSkills entry with is_legend=true.
 */
function buildPlayerPayload(
  allSlots: (PlayerWithSkills | null)[],
  legendDetail: LegendDetail,
) {
  const result: Array<{
    name: string;
    slot: number;
    is_cornerstone: boolean;
    height: string | null;
    skills: Record<string, string>;
  }> = [];

  // The cornerstone legend always goes as slot=0, is_cornerstone=true
  result.push({
    name: legendDetail.name,
    slot: 0,
    is_cornerstone: true,
    height: legendDetail.height,
    skills: Object.fromEntries(
      Object.entries(legendDetail.profile).map(([k, v]) => [k, v ?? "None"]),
    ),
  });

  // Supporting players from allSlots (0-indexed in the array → slot = index + 1)
  allSlots.forEach((p, index) => {
    if (p === null || p.is_legend) return; // skip nulls and legend entries
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
// Sub-components
// ---------------------------------------------------------------------------

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

  // Note buckets — split into issues, tips, strengths
  const issues    = useMemo(() => evaluation?.notes.filter((n) => n.severity === "critical" || n.severity === "warning") ?? [], [evaluation]);
  const tips      = useMemo(() => evaluation?.notes.filter((n) => n.severity === "tip") ?? [], [evaluation]);
  const strengths = useMemo(() => evaluation?.notes.filter((n) => n.severity === "strength") ?? [], [evaluation]);

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
          <div className="h-32 bg-muted rounded-xl" />
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 bg-muted rounded-lg" />
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

          {/* Score display — all 9 dimensions */}
          <ScoreDisplay scores={evaluation.scores} />

          {/* Notes — issues, tips, strengths in collapsible sections */}
          <NotesList issues={issues} tips={tips} strengths={strengths} />

          {/* Admin debug panel — traces + height coverage chart */}
          {isAdmin && (evaluation.player_traces || evaluation.aggregate_traces || evaluation.height_coverage) && (
            <DebugPanel
              playerTraces={evaluation.player_traces}
              aggregateTraces={evaluation.aggregate_traces}
              heightCoverage={evaluation.height_coverage}
            />
          )}
        </div>
      )}
    </main>
  );
}
