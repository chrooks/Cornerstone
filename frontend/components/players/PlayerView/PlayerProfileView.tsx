"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { SkillTierBadge } from "@/components/SkillTierBadge";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { PUBLIC_SKILL_CATEGORIES, formatSkillName } from "@/lib/skills";
import { formatPlayerSalary } from "./playerViewUtils";
import type { CompositeSkillResult, PlayerProfile, SkillTier } from "@/lib/types";

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

interface SkillColumnProps {
  category: string;
  skillNames: string[];
  skills: Record<string, CompositeSkillResult> | null;
}

function SkillColumn({ category, skillNames, skills }: SkillColumnProps) {
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
        return (
          <div key={skillName} className="flex items-center justify-between gap-1.5 py-0.5">
            <span className={cn("text-xs leading-tight truncate", tier === "None" ? "text-[#0e0907]/35" : "text-[#0e0907]")}>
              {formatSkillName(skillName)}
            </span>
            <SkillTierBadge tier={tier} size="sm" />
          </div>
        );
      })}
    </div>
  );
}

interface PlayerProfileViewProps {
  profile: PlayerProfile;
  boxStats?: Record<string, number | null> | null;
  fromBuilder?: boolean;
  isModal?: boolean;
  onDismiss?: () => void;
}

export function PlayerProfileView({
  profile,
  boxStats,
  fromBuilder = false,
  isModal = false,
  onDismiss,
}: PlayerProfileViewProps) {
  const { player } = profile;
  const backLabel = fromBuilder ? "Builder" : "Players";

  return (
    <section id={isModal ? "player-profile-modal-view" : "public-player-profile-view"} className="space-y-8">
      <div id="player-profile-view-nav" className="flex items-center justify-between gap-3">
        {isModal ? (
          <button
            id="player-profile-view-dismiss"
            type="button"
            onClick={onDismiss}
            className="text-sm text-[#0e0907]/50 hover:text-[#0e0907] transition-colors"
          >
            Close
          </button>
        ) : (
          <Link
            id="public-player-back-link"
            href={fromBuilder ? "/builder" : "/players"}
            className="text-sm text-[#0e0907]/50 hover:text-[#0e0907] transition-colors"
          >
            Back to {backLabel}
          </Link>
        )}
      </div>

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
        <div
          id="player-profile-view-skills"
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-4 lg:gap-6"
        >
          {Object.entries(PUBLIC_SKILL_CATEGORIES).map(([category, skillNames]) => (
            <SkillColumn
              key={category}
              category={category}
              skillNames={skillNames}
              skills={profile.skills}
            />
          ))}
        </div>
      ) : (
        <div id="player-profile-view-no-skills" className="rounded-md border border-[#d9d0c9] bg-[#f7f7f7] p-6 text-center">
          <p className="text-sm text-[#0e0907]/50">No skill profile available yet for this player.</p>
        </div>
      )}
    </section>
  );
}
