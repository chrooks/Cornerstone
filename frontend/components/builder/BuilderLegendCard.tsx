"use client";

/**
 * BuilderLegendCard.tsx — Clickable legend card for the /builder picker.
 *
 * Renders identically to PlayerCard but triggers onSelect instead of navigating.
 * Accepts a PlayerWithSkills row with is_legend=true (from the bulk endpoint).
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { SkillTierBadge } from "@/components/SkillTierBadge";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { formatSalary, formatHeight, tierToNum, SKILL_LABELS } from "@/components/players/playerFilters";
import { SKILL_TYPE_PRIORITY } from "@/lib/skills";
import type { PlayerWithSkills, SkillTier } from "@/lib/types";

const TOP_SKILL_COUNT = 6;

interface SkillEntry { name: string; tier: string }

function getTopSkills(skills: Record<string, string>): SkillEntry[] {
  return Object.entries(skills)
    .filter(([, tier]) => tier !== "None")
    .sort(([nameA, tierA], [nameB, tierB]) => {
      const tierDiff = tierToNum(tierB) - tierToNum(tierA);
      if (tierDiff !== 0) return tierDiff;
      return (SKILL_TYPE_PRIORITY[nameA] ?? 1) - (SKILL_TYPE_PRIORITY[nameB] ?? 1);
    })
    .map(([name, tier]) => ({ name, tier }));
}

interface BuilderLegendCardProps {
  player: PlayerWithSkills;
  onSelect: (player: PlayerWithSkills) => void;
}

export function BuilderLegendCard({ player, onSelect }: BuilderLegendCardProps) {
  const [expanded, setExpanded] = useState(false);

  const allTopSkills = player.skills ? getTopSkills(player.skills) : [];
  const visibleSkills = expanded ? allTopSkills : allTopSkills.slice(0, TOP_SKILL_COUNT);
  const hasMore = allTopSkills.length > TOP_SKILL_COUNT;

  // Bio line matching PlayerCard: Age · Height · Weight · Salary
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
      id={`builder-legend-card-${player.id}`}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(player)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect(player);
      }}
      className={cn(
        "group cursor-pointer rounded-lg border border-amber-200/60 bg-amber-50/30",
        "dark:bg-amber-950/10 transition-all p-4 flex flex-col gap-3",
        "hover:border-amber-400/60 hover:shadow-md",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      {/* Header: headshot + identity */}
      <div className="flex items-center gap-3">
        <PlayerHeadshot nba_api_id={player.nba_api_id} size={48} name={player.name} />
        <div className="min-w-0 flex-1">
          <p
            id={`builder-legend-card-name-${player.id}`}
            className="font-semibold text-sm text-foreground truncate group-hover:underline"
          >
            <span className="text-amber-500 mr-1" aria-label="Legend">★</span>
            {player.peak_year != null ? `${player.peak_year} ` : ""}
            {player.name}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {[player.team, player.position].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>
      </div>

      {/* Bio stats */}
      {bioLine && (
        <p className="text-[11px] text-muted-foreground">{bioLine}</p>
      )}

      {/* Skills section */}
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

          {hasMore && (
            <button
              id={`builder-legend-card-expand-${player.id}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
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
