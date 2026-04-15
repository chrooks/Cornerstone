"use client";

/**
 * Public player profile — read-only, no admin controls.
 * Skills are displayed as 7 horizontal category columns (grid-cols-7 on lg),
 * each sorted highest tier first. Every skill is always shown, even "None".
 *
 * Admin version with tier overrides and delete is at /admin/players/[player_id].
 */

import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { getPlayerProfile, getPlayerStats } from "@/lib/api";
import { SkillTierBadge } from "@/components/SkillTierBadge";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import type { PlayerProfile, CompositeSkillResult, SkillTier } from "@/lib/types";
import { PUBLIC_SKILL_CATEGORIES, formatSkillName } from "@/lib/skills";

const CURRENT_SEASON = "2025-26";

/** Numeric weight for tier sorting — higher tier = lower sort index. */
const TIER_ORDER: Record<string, number> = {
  "All-Time Great": 0,
  "Elite":          1,
  "Proficient":     2,
  "Capable":        3,
  "None":           4,
};

function tierOrder(tier: string | null | undefined): number {
  return TIER_ORDER[tier ?? "None"] ?? 4;
}

/** Format salary as "$X.Xm" or "$Xk". */
function formatSalary(salary: number | null): string {
  if (salary == null) return "—";
  if (salary >= 1_000_000) return `$${(salary / 1_000_000).toFixed(1)}m`;
  return `$${Math.round(salary / 1000)}k`;
}

// ---------------------------------------------------------------------------
// Skill column — one per category in the 7-column grid
// ---------------------------------------------------------------------------

interface SkillColumnProps {
  category: string;
  skillNames: string[];
  skills: Record<string, CompositeSkillResult> | null;
}

function SkillColumn({ category, skillNames, skills }: SkillColumnProps) {
  // Sort skills: highest tier first; within the same tier, preserve definition order
  const sorted = [...skillNames].sort((a, b) => {
    const ta = skills?.[a]?.final_tier;
    const tb = skills?.[b]?.final_tier;
    return tierOrder(ta) - tierOrder(tb);
  });

  return (
    <div className="flex flex-col gap-1 min-w-0">
      {/* Column header */}
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 leading-tight">
        {category}
      </p>

      {/* Skill rows — every skill rendered, even unrated ones */}
      {sorted.map((skillName) => {
        const tier = (skills?.[skillName]?.final_tier ?? "None") as SkillTier;
        return (
          <div
            key={skillName}
            className="flex items-center justify-between gap-1.5 py-0.5"
          >
            <span className={cn(
              "text-xs leading-tight truncate",
              tier === "None" ? "text-muted-foreground/50" : "text-foreground"
            )}>
              {formatSkillName(skillName)}
            </span>
            <SkillTierBadge tier={tier} size="sm" />
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function PublicPlayerProfilePage() {
  const { player_id } = useParams<{ player_id: string }>();
  const searchParams = useSearchParams();
  // When navigated from the builder (right-click → open profile), link back there
  const fromBuilder = searchParams.get("from") === "builder";

  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [boxStats, setBoxStats] = useState<Record<string, number | null> | null>(null);

  useEffect(() => {
    if (!player_id) return;
    setLoading(true);
    setError(null);
    // Fetch profile and box stats in parallel
    Promise.all([
      getPlayerProfile(player_id, CURRENT_SEASON),
      getPlayerStats(player_id, CURRENT_SEASON),
    ])
      .then(([profileRes, statsRes]) => {
        if (profileRes.success && profileRes.data) {
          setProfile(profileRes.data);
        } else {
          setError(profileRes.error ?? "Failed to load player profile");
        }
        if (statsRes.success && statsRes.data?.box_score) {
          setBoxStats(statsRes.data.box_score);
        }
      })
      .catch(() => setError("Failed to load player profile"))
      .finally(() => setLoading(false));
  }, [player_id]);

  if (loading) {
    return (
      <main className="max-w-screen-xl mx-auto px-4 py-8">
        <div className="space-y-4 animate-pulse">
          <div className="h-8 w-56 bg-muted rounded" />
          <div className="h-4 w-40 bg-muted rounded" />
          <div className="h-48 bg-muted rounded-lg" />
        </div>
      </main>
    );
  }

  if (error || !profile) {
    return (
      <main className="max-w-screen-xl mx-auto px-4 py-8">
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive">
          {error ?? "Player not found"}
        </div>
        <Link href="/players" className="mt-3 inline-block text-sm text-muted-foreground hover:text-foreground">
          ← Back to Players
        </Link>
      </main>
    );
  }

  const { player } = profile;

  return (
    <main id="public-player-profile-page" className="max-w-screen-xl mx-auto px-4 py-8 space-y-8">
      {/* Back link — returns to builder if opened from there, otherwise players list */}
      <Link
        id="public-player-back-link"
        href={fromBuilder ? "/builder" : "/players"}
        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        {fromBuilder ? "← Builder" : "← Players"}
      </Link>

      {/* Player header — headshot + name + bio + box stats */}
      <div id="public-player-header" className="flex items-start gap-5">
        <PlayerHeadshot nba_api_id={player.nba_api_id} size={96} name={player.name} />

        <div className="space-y-1 min-w-0 flex-1">
          <h1 id="public-player-name" className="text-2xl font-bold text-foreground leading-tight">
            {player.name}
          </h1>

          {/* Bio line */}
          <p id="public-player-bio" className="text-sm text-muted-foreground">
            {player.team && (
              <>
                <Link
                  href={`/players?team=${encodeURIComponent(player.team)}`}
                  className="hover:underline hover:text-foreground transition-colors"
                >
                  {player.team}
                </Link>
                {" · "}
              </>
            )}
            {[
              player.position,
              player.age ? `Age ${player.age}` : null,
              player.height ?? null,
              player.weight ? `${player.weight} lbs` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            {player.games_played != null && (
              <span> · {player.games_played} GP · {player.minutes_per_game?.toFixed(1)} MPG</span>
            )}
            {player.salary != null && (
              <span> · {formatSalary(player.salary)}</span>
            )}
          </p>

          {/* Box score line */}
          {boxStats && (
            <p id="public-player-box-stats" className="text-xs text-muted-foreground font-mono tabular-nums">
              {[
                boxStats.pts    != null ? `${boxStats.pts.toFixed(1)} Pts`    : null,
                boxStats.reb    != null ? `${boxStats.reb.toFixed(1)} Reb`    : null,
                boxStats.ast    != null ? `${boxStats.ast.toFixed(1)} Ast`    : null,
                boxStats.stl    != null ? `${boxStats.stl.toFixed(1)} Stl`    : null,
                boxStats.blk    != null ? `${boxStats.blk.toFixed(1)} Blk`    : null,
                boxStats.fg_pct  != null ? `${(boxStats.fg_pct * 100).toFixed(1)}% FG`  : null,
                boxStats.fg3_pct != null ? `${(boxStats.fg3_pct * 100).toFixed(1)}% 3P` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>
      </div>

      {/* 7-column skill grid */}
      {profile.skills ? (
        <div
          id="public-player-skills"
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
        <div className="rounded-lg border border-border bg-muted/20 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No skill profile available yet for this player.
          </p>
        </div>
      )}
    </main>
  );
}
