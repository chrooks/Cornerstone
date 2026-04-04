"use client";

/**
 * PlayerCard.tsx — Card view for a single player in the /players explorer.
 *
 * Shows: silhouette placeholder, name/team/position, bio stats, flag badge,
 * and the top 6 non-None skills (prioritized by skill type then tier).
 * An "expand" button reveals all remaining non-None skills.
 *
 * Click the card to navigate to /players/[id].
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SkillTierBadge } from "@/components/SkillTierBadge";
import { formatSalary, formatHeight, tierToNum, SKILL_LABELS } from "./playerFilters";
import type { PlayerWithSkills } from "@/lib/types";
import type { SkillTier } from "@/lib/types";

// ---------------------------------------------------------------------------
// Developer-configurable skill type priority map.
// Skills shown first on cards when a player has more than TOP_SKILL_COUNT
// non-None skills. Lower number = higher priority.
// ---------------------------------------------------------------------------

const SKILL_TYPE_PRIORITY: Record<string, number> = {
  // ── Additive (0) — always valuable to have multiples on a team ──────────
  spot_up_shooter:         0,
  movement_shooter:        0,
  rebounder:               0,
  offensive_rebounder:     0,
  rim_protector:           0,
  vertical_spacer:         0,
  screen_setter:           0,
  switchable_defender:     0,
  cutter:                  0,
  // ── Threshold (1) — valuable when at least one player excels ───────────
  off_dribble_shooter:     1,
  crafty_finisher:         1,
  pnr_finisher:            1,
  passer:                  1,
  mid_post_player:         1,
  low_post_player:         1,
  high_flyer:              1,
  point_of_attack_defender:1,
  // ── Zero-sum (2) — team typically needs just one at a high level ────────
  isolation_scorer:        2,
  pnr_ball_handler:        2,
  transition_threat:       2,
};

/** Default number of skills to show before the "expand" button appears. */
const TOP_SKILL_COUNT = 6;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SkillEntry { name: string; tier: string; }

/**
 * Return the top non-None skills for card display, sorted by:
 *  1. Skill type priority (additive < threshold < zero-sum)
 *  2. Tier level (All-Time Great > Elite > Capable)
 */
function getTopSkills(skills: Record<string, string>): SkillEntry[] {
  return Object.entries(skills)
    .filter(([, tier]) => tier !== "None")
    .sort(([nameA, tierA], [nameB, tierB]) => {
      const priDiff = (SKILL_TYPE_PRIORITY[nameA] ?? 1) - (SKILL_TYPE_PRIORITY[nameB] ?? 1);
      if (priDiff !== 0) return priDiff;
      return tierToNum(tierB) - tierToNum(tierA); // higher tier first within same priority
    })
    .map(([name, tier]) => ({ name, tier }));
}

// ---------------------------------------------------------------------------
// Silhouette icon — inline SVG so no external asset required
// ---------------------------------------------------------------------------

function Silhouette() {
  return (
    <svg
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-full"
      aria-hidden="true"
    >
      {/* Background */}
      <rect width="80" height="80" rx="8" fill="currentColor" className="text-muted/60" />
      {/* Head */}
      <circle cx="40" cy="28" r="12" fill="currentColor" className="text-muted-foreground/30" />
      {/* Body */}
      <path
        d="M16 72c0-13.255 10.745-24 24-24s24 10.745 24 24"
        fill="currentColor"
        className="text-muted-foreground/30"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// PlayerCard component
// ---------------------------------------------------------------------------

interface PlayerCardProps {
  player: PlayerWithSkills;
}

export function PlayerCard({ player }: PlayerCardProps) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  const allTopSkills = player.skills ? getTopSkills(player.skills) : [];
  const visibleSkills = expanded ? allTopSkills : allTopSkills.slice(0, TOP_SKILL_COUNT);
  const hasMore = allTopSkills.length > TOP_SKILL_COUNT;

  // Build compact bio line — only include non-null values
  const bioLine = [
    player.age != null ? `Age ${player.age}` : null,
    formatHeight(player.height) || null,
    player.weight != null ? `${player.weight} lbs` : null,
    player.salary != null ? formatSalary(player.salary) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      onClick={() => router.push(`/players/${player.id}`)}
      className="group cursor-pointer rounded-lg border border-border bg-card hover:border-foreground/20 hover:shadow-sm transition-all p-4 flex flex-col gap-3"
    >
      {/* ── Header: silhouette + identity ── */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 flex-shrink-0 rounded-md overflow-hidden">
          <Silhouette />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm text-foreground truncate group-hover:underline">
            {player.name}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {[player.team, player.position].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>

        {/* Unresolved flags badge */}
        {player.flag_summary.unresolved > 0 && (
          <span className="flex-shrink-0 inline-flex items-center rounded-full bg-amber-100 border border-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
            {player.flag_summary.unresolved} flag{player.flag_summary.unresolved !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* ── Bio stats ── */}
      {bioLine && (
        <p className="text-[11px] text-muted-foreground">{bioLine}</p>
      )}

      {/* ── Skills section ── */}
      {player.skills == null ? (
        <p className="text-[11px] text-muted-foreground italic">No skill profile yet</p>
      ) : allTopSkills.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic">No rated skills</p>
      ) : (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1">
            {visibleSkills.map(({ name, tier }) => (
              <div key={name} className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground">
                  {SKILL_LABELS[name] ?? name}
                </span>
                <SkillTierBadge tier={tier as SkillTier} size="sm" />
              </div>
            ))}
          </div>

          {/* Expand / collapse toggle */}
          {hasMore && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation(); // don't navigate on expand click
                setExpanded((v) => !v);
              }}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {expanded
                ? "▲ Show less"
                : `▾ ${allTopSkills.length - TOP_SKILL_COUNT} more skill${allTopSkills.length - TOP_SKILL_COUNT !== 1 ? "s" : ""}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
