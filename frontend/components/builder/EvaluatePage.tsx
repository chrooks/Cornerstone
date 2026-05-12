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
import Link from "next/link";
import { useRouter, useSearchParams, useParams, usePathname } from "next/navigation";
import { listPlayersWithSkills, getLegend, evaluateRoster, saveTeam, listRuleSets } from "@/lib/api";
import { normalizeCohesionNotes } from "@/lib/cohesionHelpers";
import { useAdminStatus } from "@/lib/hooks/useAdminStatus";
import { readSlotsFromParams, buildPlayerPayload } from "@/lib/roster-utils";
import { LEGEND_SALARY, MAX_ROSTER_SLOTS } from "@/lib/builder-config";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { CohesionScoreDisplay } from "./CohesionScoreDisplay";
import { NotesList } from "./NotesList";
import { CohesionDebugPanel } from "./CohesionDebugPanel";
import type { LegendDetail, PlayerWithSkills, RosterEvaluation, RuleSetSummary, SaveTeamPayload, SavedTeamSummary } from "@/lib/types";

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
    <section id="eval-team-description" className="border border-[#d9d0c9] bg-[#f7f7f7]">
      {/* Header — always visible, toggles collapse */}
      <button
        id="eval-team-description-toggle"
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[#f0f0f0]/70 transition-colors cursor-pointer"
        aria-expanded={isOpen}
      >
        <span>
          <span className="block text-xs font-semibold text-[#0e0907]/50">
            Team Identity
          </span>
          <span className="mt-0.5 block text-sm font-semibold text-[#0e0907]">
            Final Scouting Note
          </span>
        </span>
        <span className="text-muted-foreground text-xs font-mono" aria-hidden>
          {isOpen ? "▾" : "▸"}
        </span>
      </button>

      {/* Content — only rendered when open */}
      {isOpen && (
        <div id="eval-team-description-content" className="border-t border-[#d9d0c9]/70 px-4 pb-4 pt-3">
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
              Generating Team identity...
            </div>
          ) : (
            // Render each paragraph from the narrative as its own <p> element
            <div id="eval-team-description-text" className="space-y-3">
              {description!.split("\n\n").map((para, i) => (
                <p key={i} className="w-full text-sm text-[#0e0907]/68 leading-6">
                  {para.trim()}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// readSlotsFromParams and buildPlayerPayload imported from @/lib/roster-utils

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RotationSummary({ allSlots, cornerstoneId }: { allSlots: (PlayerWithSkills | null)[]; cornerstoneId: string | null }) {
  const players = allSlots.filter(Boolean) as PlayerWithSkills[];
  const starterPlayers = players.slice(0, 5);
  const benchPlayers = players.slice(5);

  function renderPlayer(p: PlayerWithSkills, index: number) {
    const isCornerstone = p.id === cornerstoneId;
    return (
      <div key={p.id} id={`eval-slot-${index + 1}`} className="flex-shrink-0 flex flex-col items-center gap-1">
        <div className="relative h-16 w-16 overflow-hidden border-2 border-border">
          <PlayerHeadshot nba_api_id={p.nba_api_id} size={64} name={p.name} />
          {isCornerstone && (
            <span
              id={`eval-slot-${index + 1}-legend-badge`}
              className="absolute top-0 left-0 bg-amber-400/90 text-white text-[8px] font-bold px-1 py-0.5"
            >
              ★
            </span>
          )}
        </div>
        <p
          id={`eval-slot-${index + 1}-name`}
          className="w-[4.5rem] truncate text-center text-[10px] leading-tight text-muted-foreground"
          title={p.name}
        >
          {p.name.split(" ").pop()}
        </p>
      </div>
    );
  }

  return (
    <div id="eval-rotation-summary" className="overflow-x-auto border border-[#d9d0c9] bg-[#f7f7f7] px-6 py-3">
      <div id="eval-rotation-summary-list" className="mx-auto flex w-max items-start justify-center">
        <div id="eval-rotation-starters" className="flex items-start gap-3">
          {starterPlayers.map((player, index) => renderPlayer(player, index))}
        </div>

        {benchPlayers.length > 0 && (
          <>
            <div id="eval-rotation-boundary" className="mx-4 flex self-stretch flex-col items-center">
              <div className="w-px flex-1 bg-[#d9d0c9]" />
              <span className="py-1 text-[0.5rem] font-semibold uppercase tracking-[1px] text-[#9a938a]">
                Bench
              </span>
              <div className="w-px flex-1 bg-[#d9d0c9]" />
            </div>
            <div id="eval-rotation-bench" className="flex items-start gap-3">
              {benchPlayers.map((player, index) => renderPlayer(player, index + 5))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EvaluatePage
// ---------------------------------------------------------------------------

type EvalState = "loading" | "evaluating" | "ready" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";

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
  const params       = useParams();
  const pathname     = usePathname();
  const { isAdmin, loading: adminLoading, email } = useAdminStatus();
  const isLoggedIn = email !== null;

  // Ruleset from route params when under /lab/[ruleset]/eval; absent on legacy /builder/evaluate
  const ruleset = (params.ruleset as string) ?? null;
  const cornerstoneId = searchParams.get("cornerstone");
  // Back link routes into Lab flow when ruleset is known, otherwise falls back to legacy /builder
  const buildPath = ruleset ? `/lab/${ruleset}/build` : "/builder";
  const backHref = `${buildPath}?${searchParams.toString()}`;

  const [evalState, setEvalState] = useState<EvalState>("loading");
  const [errorMsg, setErrorMsg]   = useState<string | null>(null);
  const [dataReady, setDataReady] = useState<DataReady | null>(null);
  const [evaluation, setEvaluation] = useState<RosterEvaluation | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedTeam, setSavedTeam] = useState<SavedTeamSummary | null>(null);
  const [resolvedRuleSet, setResolvedRuleSet] = useState<RuleSetSummary | null>(null);

  // Capture searchParams at mount — stable ref avoids closure staleness
  const paramsRef = useRef(searchParams.toString());

  // Phase 1: load players + legend
  useEffect(() => {
    if (!cornerstoneId) { router.replace(buildPath); return; }

    Promise.all([listPlayersWithSkills(), getLegend(cornerstoneId), listRuleSets()])
      .then(([playersRes, legendRes, rulesetsRes]) => {
        if (!playersRes.success || !playersRes.data) throw new Error(playersRes.error ?? "Failed to load players");
        if (!legendRes.success || !legendRes.data) throw new Error(legendRes.error ?? "Failed to load legend");

        // Resolve RuleSet Version for the current Lab RuleSet slug
        const rulesetSlug = ruleset ?? "standard";
        const matched = (rulesetsRes.data ?? []).find((rs) => rs.slug === rulesetSlug);
        if (matched) setResolvedRuleSet(matched);

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

  function buildSavePayload(): SaveTeamPayload | null {
    if (!dataReady || !evaluation) return null;
    if (!resolvedRuleSet?.current_version) return null;

    const filledSlots = dataReady.slots.slice(0, MAX_ROSTER_SLOTS);
    if (filledSlots.some((player) => player === null)) return null;

    return {
      ruleset_slug: ruleset ?? "standard",
      ruleset_version_id: resolvedRuleSet.current_version.id,
      rules_hash: resolvedRuleSet.current_version.rules_hash,
      cornerstone_legend_id: dataReady.legend.id,
      players: filledSlots.map((player, index) => {
        const slot = index + 1;
        const isCornerstone = player!.id === dataReady.legend.id || player!.is_legend === true;
        if (isCornerstone) {
          return {
            slot,
            is_cornerstone: true,
            player_id: null,
            legend_id: dataReady.legend.id,
            salary_snapshot: LEGEND_SALARY,
            player_name_snapshot: dataReady.legend.name,
            team_snapshot: dataReady.legend.team,
            position_snapshot: dataReady.legend.position,
            skill_profile_snapshot: Object.fromEntries(
              Object.entries(dataReady.legend.profile).map(([skill, tier]) => [skill, tier ?? "None"]),
            ),
          };
        }

        return {
          slot,
          is_cornerstone: false,
          player_id: player!.id,
          legend_id: null,
          salary_snapshot: player!.salary ?? 0,
          player_name_snapshot: player!.name,
          team_snapshot: player!.team,
          position_snapshot: player!.position,
          skill_profile_snapshot: (player!.skills ?? {}) as Record<string, string>,
          is_rookie_deal: player!.is_rookie_deal ?? false,
        };
      }),
      evaluation: {
        ...evaluation,
        starting_lineup_score: evaluation.starting_lineup.cohesion_score,
      },
    };
  }

  function redirectToLoginForSave() {
    const current = `${pathname}?${searchParams.toString()}`;
    router.push(`/login?redirectTo=${encodeURIComponent(current)}`);
  }

  async function handleSaveTeam() {
    setSaveError(null);

    if (adminLoading) return;
    if (!isLoggedIn) {
      redirectToLoginForSave();
      return;
    }

    const payload = buildSavePayload();
    if (!payload) {
      setSaveState("error");
      setSaveError("Complete this Rotation before saving.");
      return;
    }

    setSaveState("saving");
    const res = await saveTeam(payload);
    if (res.success && res.data) {
      setSavedTeam(res.data);
      setSaveState("saved");
      return;
    }

    setSaveState("error");
    setSaveError(res.error ?? "Team could not be saved.");
  }

  const saveButtonLabel = saveState === "saving"
    ? "Saving..."
    : isLoggedIn
      ? savedTeam
        ? "Saved"
        : "Save Team"
      : "Sign In To Save";
  const saveDisabled = adminLoading || evalState !== "ready" || saveState === "saving" || saveState === "saved";

  return (
    <main id="eval-page" className="max-w-5xl mx-auto px-4 py-6 space-y-6">

      {/* Header */}
      <div id="eval-header" className="relative flex items-center">
        <button
          id="eval-back-btn"
          type="button"
          onClick={() => router.push(backHref)}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0"
        >
          ← Back to Build
        </button>
        <h1 id="eval-title" className="absolute left-1/2 -translate-x-1/2 text-lg font-bold text-foreground pointer-events-none whitespace-nowrap">
          Final Eval
        </h1>
        <button
          id="eval-save-btn"
          type="button"
          disabled={saveDisabled}
          onClick={handleSaveTeam}
          className="ml-auto shrink-0 rounded-[4px] border border-[#0e0907] bg-[#ffa05c] px-3 py-1.5 text-sm font-medium text-[#0e0907] transition-colors hover:bg-[#fe6d34] disabled:cursor-not-allowed disabled:border-[#d9d0c9] disabled:bg-[#f0f0f0] disabled:text-[#0e0907]/40"
        >
          {saveButtonLabel}
        </button>
      </div>

      {(saveState === "saving" || saveState === "saved" || saveState === "error") && (
        <div
          id="eval-save-feedback"
          role="status"
          aria-live="polite"
          className="border border-[#d9d0c9] bg-[#f7f7f7] px-4 py-3 text-sm text-[#0e0907]/70"
        >
          {saveState === "saving" && (
            <p id="eval-save-saving">Saving this Team to your Lab...</p>
          )}
          {saveState === "saved" && savedTeam && (
            <div id="eval-save-success" className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p>
                Saved{" "}
                <Link
                  id="eval-save-success-saved-team-link"
                  href={`/profile/saved-teams/${savedTeam.id}`}
                  className="font-semibold text-[#0e0907] underline decoration-[#ffa05c] underline-offset-4 transition-colors hover:text-[#a34400] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ffa05c]"
                >
                  {savedTeam.name}
                </Link>
                .
              </p>
              <button
                id="eval-save-keep-tuning-btn"
                type="button"
                onClick={() => router.push(backHref)}
                className="w-fit rounded-[4px] border border-[#d9d0c9] px-2.5 py-1 text-xs font-medium text-[#0e0907] transition-colors hover:bg-[#f0f0f0]"
              >
                Keep Tuning
              </button>
            </div>
          )}
          {saveState === "error" && (
            <p id="eval-save-error" className="text-[#e53e3e]">
              {saveError ?? "Team could not be saved."}
            </p>
          )}
        </div>
      )}

      {/* Rotation summary */}
      {dataReady && (
        <RotationSummary allSlots={dataReady.slots} cornerstoneId={cornerstoneId} />
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

          {/* Notes */}
          <section id="eval-notes-section" className="space-y-3">
            <div id="eval-notes-header">
              <p className="text-xs font-semibold text-[#0e0907]/50">
                Pressure Points
              </p>
              <h2 className="mt-1 text-base font-semibold text-[#0e0907]">
                What The Engine Would Argue About
              </h2>
            </div>
            <NotesList
              issues={issues}
              suggestions={suggestions}
              strengths={strengths}
              emptyTextOverrides={{
                strengths: "No standout strengths identified in this final read.",
                issues: "No major weaknesses identified.",
                suggestions: "No immediate adjustment suggested.",
              }}
            />
          </section>

          {/* Admin debug panel */}
          {isAdmin && (
            <CohesionDebugPanel evaluation={evaluation} />
          )}
          {/* Raw notes JSON dump */}
          {isAdmin && (
            <details id="eval-debug-notes-json" className="mt-4">
              <summary className="cursor-pointer text-[10px] font-semibold text-muted-foreground hover:text-foreground">
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
