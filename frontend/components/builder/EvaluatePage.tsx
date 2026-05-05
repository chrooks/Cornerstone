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
import { normalizeCohesionNotes } from "@/lib/cohesionHelpers";
import { useAdminStatus } from "@/lib/hooks/useAdminStatus";
import { readSlotsFromParams, buildPlayerPayload } from "@/lib/roster-utils";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { CohesionScoreDisplay } from "./CohesionScoreDisplay";
import { NotesList } from "./NotesList";
import { CohesionDebugPanel } from "./CohesionDebugPanel";
import type { LegendDetail, PlayerWithSkills, RosterEvaluation } from "@/lib/types";

// ---------------------------------------------------------------------------
// TeamDescriptionCard — LLM-generated GM-memo narrative (final mode only)
// ---------------------------------------------------------------------------

interface TeamDescriptionCardProps {
  /** The narrative text, or null/undefined if not yet available or not applicable */
  description: string | null | undefined;
  /** True while the final evaluation API call is in flight */
  isLoading: boolean;
}

/**
 * Collapsible card displaying the LLM-generated team identity narrative.
 *
 * Renders a spinner placeholder while the evaluation is loading (final mode only).
 * Renders nothing when not loading and no description is available.
 * Expanded by default when a description is present.
 */
function TeamDescriptionCard({ description, isLoading }: TeamDescriptionCardProps) {
  // Track open/collapsed state — default open so the narrative is immediately visible
  const [isOpen, setIsOpen] = useState(true);

  // Don't render anything if we're not loading and there's no content
  if (!isLoading && !description) return null;

  return (
    <div id="eval-team-description" className="border border-border rounded-lg overflow-hidden">
      {/* Header — always visible, toggles collapse */}
      <button
        id="eval-team-description-toggle"
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-muted/30 transition-colors cursor-pointer"
        aria-expanded={isOpen}
      >
        <span className="text-sm font-semibold text-purple-400">
          Team Identity
        </span>
        <span className="text-muted-foreground text-xs font-mono" aria-hidden>
          {isOpen ? "▾" : "▸"}
        </span>
      </button>

      {/* Content — only rendered when open */}
      {isOpen && (
        <div id="eval-team-description-content" className="px-4 pb-4 pt-1">
          {isLoading ? (
            // Spinner placeholder while the API call is in flight
            <div id="eval-team-description-loading" className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <svg
                className="animate-spin h-3.5 w-3.5 text-muted-foreground"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              Generating team identity…
            </div>
          ) : (
            // Render each paragraph from the narrative as its own <p> element
            <div id="eval-team-description-text" className="space-y-3">
              {description!.split("\n\n").map((para, i) => (
                <p key={i} className="text-xs text-muted-foreground leading-relaxed">
                  {para.trim()}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// readSlotsFromParams and buildPlayerPayload imported from @/lib/roster-utils

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

const TEAM_DESCRIPTION_CACHE_VERSION = "team-description-v1";

function sortedSkillEntries(skills: Record<string, string | null | undefined>): [string, string][] {
  return Object.entries(skills)
    .map(([skill, tier]) => [skill, tier ?? "None"] as [string, string])
    .sort(([a], [b]) => a.localeCompare(b));
}

function hashString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function teamDescriptionCacheKey(slots: (PlayerWithSkills | null)[], legend: LegendDetail): string {
  const fingerprint = {
    version: TEAM_DESCRIPTION_CACHE_VERSION,
    cornerstone: {
      id: legend.id,
      height: legend.height,
      skills: sortedSkillEntries(legend.profile),
    },
    slots: slots.map((player, index) => (
      player
        ? {
            slot: index + 1,
            id: player.id,
            height: player.height,
            skills: sortedSkillEntries((player.skills ?? {}) as Record<string, string>),
          }
        : { slot: index + 1, id: null }
    )),
  };

  return `builder-final-team-description:${TEAM_DESCRIPTION_CACHE_VERSION}:${hashString(JSON.stringify(fingerprint))}`;
}

function readCachedTeamDescription(cacheKey: string): string | null {
  if (typeof window === "undefined") return null;
  const cached = window.localStorage.getItem(cacheKey);
  return cached && cached.trim().length > 0 ? cached : null;
}

function writeCachedTeamDescription(cacheKey: string, description: string | null | undefined): void {
  if (typeof window === "undefined" || !description) return;
  window.localStorage.setItem(cacheKey, description);
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
    const descriptionCacheKey = teamDescriptionCacheKey(dataReady.slots, dataReady.legend);
    const cachedDescription = readCachedTeamDescription(descriptionCacheKey);
    setEvalState("evaluating");

    // Numeric evaluation should always run fresh, but the final narrative can
    // be reused for the exact same roster fingerprint to avoid duplicate LLM calls.
    evaluateRoster({ players, mode: cachedDescription ? "live" : "final", debug: isAdmin })
      .then((res) => {
        if (res.success && res.data) {
          const evaluationWithCachedDescription = cachedDescription
            ? { ...res.data, team_description: cachedDescription }
            : res.data;
          writeCachedTeamDescription(descriptionCacheKey, evaluationWithCachedDescription.team_description);
          setEvaluation(evaluationWithCachedDescription);
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

  // Normalize cohesion notes into legacy Note shape so bucketing works
  const normalizedNotes = useMemo(() => {
    if (!evaluation) return [];
    return normalizeCohesionNotes(evaluation.notes);
  }, [evaluation]);

  // Note buckets — split into issues, suggestions, strengths
  const issues      = useMemo(() => normalizedNotes.filter((n) => n.severity === "critical" || n.severity === "warning"), [normalizedNotes]);
  const suggestions = useMemo(() => normalizedNotes.filter((n) => n.severity === "suggestion"), [normalizedNotes]);
  const strengths   = useMemo(() => normalizedNotes.filter((n) => n.severity === "strength"), [normalizedNotes]);

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

      {/* Loading skeleton — shown while player data loads (phase 1) or evaluation runs (phase 2) */}
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

      {/* Team Identity spinner — visible during the evaluation API call (final mode only).
          Since this page always calls in final mode, we always show the spinner while evaluating
          so the user can see where the narrative will appear before results arrive. */}
      {evalState === "evaluating" && (
        <TeamDescriptionCard description={null} isLoading={true} />
      )}

      {/* Error */}
      {evalState === "error" && (
        <p id="eval-error" className="text-sm text-destructive">{errorMsg ?? "Something went wrong."}</p>
      )}

      {/* Results */}
      {evalState === "ready" && evaluation && (
        <div id="eval-results" className="space-y-6">

          {/* Score display */}
          <CohesionScoreDisplay evaluation={evaluation} />

          {/* Team Identity — LLM GM-memo narrative (final mode only) */}
          <TeamDescriptionCard
            description={evaluation.team_description}
            isLoading={false}
          />

          {/* Notes — issues, suggestions, strengths in collapsible sections */}
          <NotesList issues={issues} suggestions={suggestions} strengths={strengths} />

          {/* Admin debug panel */}
          {isAdmin && (
            <CohesionDebugPanel evaluation={evaluation} />
          )}
          {/* Raw notes JSON dump */}
          {isAdmin && (
            <details id="eval-debug-notes-json" className="mt-4">
              <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
                Raw Notes JSON
              </summary>
              <pre id="eval-debug-notes-json-content" className="mt-2 max-h-[400px] overflow-auto rounded border border-border/60 bg-muted/30 p-2 text-[9px] font-mono text-muted-foreground whitespace-pre-wrap">
                {JSON.stringify(evaluation.notes, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </main>
  );
}
