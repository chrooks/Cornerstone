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
import { cn } from "@/lib/utils";
import { SkillTierBadge } from "@/components/SkillTierBadge";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { formatSalary, formatHeight, tierToNum, SKILL_LABELS } from "./playerFilters";
import type { PlayerWithSkills } from "@/lib/types";
import type { SkillTier } from "@/lib/types";
import { SKILL_TYPE_PRIORITY } from "@/lib/skills";

/** Default number of skills to show before the "expand" button appears. */
const TOP_SKILL_COUNT = 6;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SkillEntry { name: string; tier: string; }

/**
 * Return the top non-None skills for card display, sorted by:
 *  1. Tier level (All-Time Great > Elite > Capable)
 *  2. Skill type priority (additive < threshold < zero-sum) as tiebreaker
 */
function getTopSkills(skills: Record<string, string>): SkillEntry[] {
  return Object.entries(skills)
    .filter(([, tier]) => tier !== "None")
    .sort(([nameA, tierA], [nameB, tierB]) => {
      const tierDiff = tierToNum(tierB) - tierToNum(tierA); // higher tier first
      if (tierDiff !== 0) return tierDiff;
      return (SKILL_TYPE_PRIORITY[nameA] ?? 1) - (SKILL_TYPE_PRIORITY[nameB] ?? 1);
    })
    .map(([name, tier]) => ({ name, tier }));
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

  const isLegend = player.is_legend === true;

  return (
    <div
      onClick={isLegend ? undefined : (e) => {
        if (e.metaKey || e.ctrlKey) {
          window.open(`/players/${player.id}`, "_blank");
          return;
        }
        router.push(`/players/${player.id}`);
      }}
      className={cn(
        "group rounded-lg border border-border bg-card transition-all p-4 flex flex-col gap-3",
        isLegend
          ? "cursor-default border-amber-200/60 bg-amber-50/30 dark:bg-amber-950/10"
          : "cursor-pointer hover:border-foreground/20 hover:shadow-sm",
      )}
    >
      {/* ── Header: silhouette + identity ── */}
      <div className="flex items-center gap-3">
        <PlayerHeadshot nba_api_id={player.nba_api_id} size={48} name={player.name} />
        <div className="min-w-0 flex-1">
          <p className={cn("font-semibold text-sm text-foreground truncate", !isLegend && "group-hover:underline")}>
            {isLegend && <span className="text-amber-500 mr-1" aria-label="Legend">★</span>}
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
