"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SkillTierBadge } from "@/components/SkillTierBadge";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { SkillTraceDetail } from "./SkillTraceDetail";
import { PlayerProfileShape } from "./PlayerProfileShape";
import { PUBLIC_SKILL_CATEGORIES, formatSkillName } from "@/lib/skills";
import { formatPlayerSalary } from "./playerViewUtils";
import { getPlayerSkillTrace } from "@/lib/api";
import type { CompositeSkillResult, PlayerProfile, PlayerSkillTrace, SkillTier } from "@/lib/types";

const TIER_ORDER: Record<string, number> = {
  "All-Time Great": 0,
  Elite: 1,
  Proficient: 2,
  Capable: 3,
  None: 4,
};

function tierOrder(tier: string | null | undefined): number {
  return TIER_ORDER[tier ?? "None"] ?? 4;
}

/** Lazily-loaded, once-per-profile-view trace state shared by every SkillColumn. */
type TraceStatus = "idle" | "loading" | "unavailable" | "loaded";

interface SkillColumnProps {
  category: string;
  skillNames: string[];
  skills: Record<string, CompositeSkillResult> | null;
  selectedSkill: string | null;
  onSelectSkill: (skillName: string) => void;
}

/** A skill's row within its category column. Selecting a row doesn't expand
 * anything in place — it drives the single shared detail panel rendered
 * below the whole grid (see PlayerProfileView). A per-row floating popover
 * used to do this but got clipped by any scrolling ancestor (the profile
 * modal's own overflow) and had to guess which edge to open from; an
 * in-flow panel at the bottom has neither problem and works identically
 * in the full page and the modal. */
function SkillColumn({ category, skillNames, skills, selectedSkill, onSelectSkill }: SkillColumnProps) {
  const sorted = [...skillNames].sort((a, b) => {
    const tierA = skills?.[a]?.final_tier;
    const tierB = skills?.[b]?.final_tier;
    return tierOrder(tierA) - tierOrder(tierB);
  });

  return (
    <div id={`player-profile-skill-column-${category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} className="flex flex-col gap-1 min-w-0">
      <p className="text-[10px] font-semibold text-[#0e0907]/45 uppercase tracking-wide mb-1 leading-tight">
        {category}
      </p>
      {sorted.map((skillName) => {
        const tier = (skills?.[skillName]?.final_tier ?? "None") as SkillTier;
        const isSelected = selectedSkill === skillName;

        return (
          <button
            key={skillName}
            type="button"
            id={`player-profile-skill-toggle-${skillName}`}
            onClick={() => onSelectSkill(skillName)}
            aria-expanded={isSelected}
            className={cn(
              "flex items-center justify-between gap-1.5 py-0.5 px-1 -mx-1 text-left rounded-sm transition-colors",
              isSelected ? "bg-[#ffa05c]/15" : "hover:bg-[#0e0907]/[0.03]"
            )}
          >
            <span className={cn("text-xs leading-tight truncate", tier === "None" ? "text-[#0e0907]/35" : "text-[#0e0907]")}>
              {formatSkillName(skillName)}
            </span>
            <span className="flex items-center gap-1 shrink-0">
              <SkillTierBadge tier={tier} size="sm" />
              {isSelected ? (
                <ChevronUp className="h-3 w-3 text-[#0e0907]/45" />
              ) : (
                <ChevronDown className="h-3 w-3 text-[#0e0907]/35" />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface SkillDetailPanelProps {
  skillName: string;
  tier: SkillTier;
  traceStatus: TraceStatus;
  trace: PlayerSkillTrace | null;
  onClose: () => void;
}

/** The single shared "why" panel for whichever skill is selected — lives in
 * normal document flow below the grid, full width, so it never needs to
 * fight a scroll container or guess which edge to open from. */
function SkillDetailPanel({ skillName, tier, traceStatus, trace, onClose }: SkillDetailPanelProps) {
  const entry = trace?.skills?.[skillName];
  const unavailable = traceStatus === "unavailable" || (traceStatus === "loaded" && !trace?.computed);

  return (
    <div
      id="player-profile-skill-detail-panel"
      className="rounded-md border border-[#d9d0c9] bg-[#f7f7f7] p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-[#d9d0c9] pb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[#0e0907]">{formatSkillName(skillName)}</span>
          <SkillTierBadge tier={tier} size="sm" />
        </div>
        <button
          type="button"
          id="player-profile-skill-detail-close"
          onClick={onClose}
          aria-label="Close breakdown"
          className="rounded-sm p-0.5 text-[#0e0907]/40 hover:bg-[#0e0907]/[0.05] hover:text-[#0e0907] transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {traceStatus === "loading" && (
        <p className="text-[12px] text-[#0e0907]/45">Loading breakdown…</p>
      )}
      {unavailable && (
        <p className="text-[12px] text-[#0e0907]/45">Trace temporarily unavailable for this player.</p>
      )}
      {traceStatus === "loaded" && trace?.computed && entry && (
        <SkillTraceDetail conditions={entry.condition_results} override={entry.override} finalTier={tier} />
      )}
    </div>
  );
}

interface PlayerProfileViewProps {
  profile: PlayerProfile;
  boxStats?: Record<string, number | null> | null;
  fromBuilder?: boolean;
  isModal?: boolean;
}

export function PlayerProfileView({
  profile,
  boxStats,
  fromBuilder = false,
  isModal = false,
}: PlayerProfileViewProps) {
  const { player } = profile;
  const backLabel = fromBuilder ? "Builder" : "Players";

  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [traceStatus, setTraceStatus] = useState<TraceStatus>("idle");
  const [trace, setTrace] = useState<PlayerSkillTrace | null>(null);

  useEffect(() => {
    if (!selectedSkill) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedSkill(null);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedSkill]);

  async function handleSelectSkill(skillName: string) {
    if (selectedSkill === skillName) {
      setSelectedSkill(null);
      return;
    }
    setSelectedSkill(skillName);

    if (traceStatus !== "idle") return; // already fetched (or failed) for this profile view

    setTraceStatus("loading");
    try {
      const res = await getPlayerSkillTrace(player.id, player.season);
      if (res.success && res.data) {
        setTrace(res.data);
        setTraceStatus("loaded");
      } else {
        setTraceStatus("unavailable");
      }
    } catch {
      setTraceStatus("unavailable");
    }
  }

  return (
    <section id={isModal ? "player-profile-modal-view" : "public-player-profile-view"} className="space-y-8">
      {!isModal && (
        <div id="player-profile-view-nav" className="flex items-center justify-between gap-3">
          <Link
            id="public-player-back-link"
            href={fromBuilder ? "/builder" : "/players"}
            className="text-sm text-[#0e0907]/50 hover:text-[#0e0907] transition-colors"
          >
            Back to {backLabel}
          </Link>
        </div>
      )}

      <header id="player-profile-view-header" className="flex items-start gap-5">
        <PlayerHeadshot nba_api_id={player.nba_api_id} size={96} name={player.name} />
        <div className="space-y-1 min-w-0 flex-1">
          <h1 id="player-profile-view-name" className="text-2xl font-bold text-[#0e0907] leading-tight">
            {player.name}
          </h1>
          <p id="player-profile-view-bio" className="text-sm text-[#0e0907]/55">
            {player.team && (
              <>
                {isModal ? (
                  <span>{player.team}</span>
                ) : (
                  <Link href={`/players?team=${encodeURIComponent(player.team)}`} className="hover:underline hover:text-[#0e0907] transition-colors">
                    {player.team}
                  </Link>
                )}
                {" · "}
              </>
            )}
            {[
              player.position,
              player.age ? `Age ${player.age}` : null,
              player.height ?? null,
              player.weight ? `${player.weight} lbs` : null,
            ].filter(Boolean).join(" · ")}
            {player.games_played != null && (
              <span> · {player.games_played} GP · {player.minutes_per_game?.toFixed(1)} MPG</span>
            )}
            {player.salary != null && <span> · {formatPlayerSalary(player.salary)}</span>}
            {player.games_played == null && player.season && <span> · {player.season}</span>}
          </p>

          {boxStats && (
            <p id="player-profile-view-box-stats" className="text-xs text-[#0e0907]/55 font-mono tabular-nums">
              {[
                boxStats.pts != null ? `${boxStats.pts.toFixed(1)} Pts` : null,
                boxStats.reb != null ? `${boxStats.reb.toFixed(1)} Reb` : null,
                boxStats.ast != null ? `${boxStats.ast.toFixed(1)} Ast` : null,
                boxStats.stl != null ? `${boxStats.stl.toFixed(1)} Stl` : null,
                boxStats.blk != null ? `${boxStats.blk.toFixed(1)} Blk` : null,
                boxStats.fg_pct != null ? `${(boxStats.fg_pct * 100).toFixed(1)}% FG` : null,
                boxStats.fg3_pct != null ? `${(boxStats.fg3_pct * 100).toFixed(1)}% 3P` : null,
              ].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      </header>

      {profile.skills ? (
        <div className="flex flex-col gap-4">
          <PlayerProfileShape playerName={player.name} skills={profile.skills} />
          <div
            id="player-profile-view-skills"
            className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 lg:gap-6"
          >
            {Object.entries(PUBLIC_SKILL_CATEGORIES).map(([category, skillNames]) => (
              <SkillColumn
                key={category}
                category={category}
                skillNames={skillNames}
                skills={profile.skills}
                selectedSkill={selectedSkill}
                onSelectSkill={handleSelectSkill}
              />
            ))}
          </div>

          {selectedSkill && (
            <SkillDetailPanel
              skillName={selectedSkill}
              tier={(profile.skills[selectedSkill]?.final_tier ?? "None") as SkillTier}
              traceStatus={traceStatus}
              trace={trace}
              onClose={() => setSelectedSkill(null)}
            />
          )}
        </div>
      ) : (
        <div id="player-profile-view-no-skills" className="rounded-md border border-[#d9d0c9] bg-[#f7f7f7] p-6 text-center">
          <p className="text-sm text-[#0e0907]/50">No skill profile available yet for this player.</p>
        </div>
      )}
    </section>
  );
}
