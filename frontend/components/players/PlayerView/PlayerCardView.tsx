"use client";

import { useState } from "react";
import { Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { SkillTierBadge } from "@/components/SkillTierBadge";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { formatHeight, SKILL_LABELS } from "@/components/players/playerFilters";
import { formatPlayerSalary, getTopSkills } from "./playerViewUtils";
import type { PlayerWithSkills, SkillTier } from "@/lib/types";

const TOP_SKILL_COUNT = 6;

interface PlayerCardViewProps {
  player: PlayerWithSkills;
  disabled?: boolean;
  highlighted?: boolean;
  primaryActionLabel?: string;
  onPrimaryAction?: (player: PlayerWithSkills) => void;
  onOpenProfile?: (player: PlayerWithSkills) => void;
  onHover?: (player: PlayerWithSkills) => void;
  onHoverEnd?: () => void;
  onDragStart?: (event: React.DragEvent, player: PlayerWithSkills) => void;
  onContextMenu?: (event: React.MouseEvent, player: PlayerWithSkills) => void;
}

export function PlayerCardView({
  player,
  disabled = false,
  highlighted = false,
  primaryActionLabel,
  onPrimaryAction,
  onOpenProfile,
  onHover,
  onHoverEnd,
  onDragStart,
  onContextMenu,
}: PlayerCardViewProps) {
  const [expanded, setExpanded] = useState(false);
  const allTopSkills = getTopSkills(player.skills);
  const visibleSkills = expanded ? allTopSkills : allTopSkills.slice(0, TOP_SKILL_COUNT);
  const hasMore = allTopSkills.length > TOP_SKILL_COUNT;
  const isLegend = player.is_legend === true;
  const canAct = !!onPrimaryAction && !disabled;
  const canOpenProfile = !!onOpenProfile;
  const canClickCard = canAct || (!primaryActionLabel && canOpenProfile && !disabled);
  const bioLine = [
    player.age != null ? `Age ${player.age}` : null,
    formatHeight(player.height) || null,
    player.weight != null ? `${player.weight} lbs` : null,
    player.salary != null ? formatPlayerSalary(player.salary) : null,
    player.peak_year != null ? `${player.peak_year}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <article
      id={`player-card-view-${player.id}`}
      draggable={!!onDragStart && !disabled}
      onDragStart={onDragStart && !disabled ? (event) => onDragStart(event, player) : undefined}
      onContextMenu={(event) => {
        if (onContextMenu) {
          onContextMenu(event, player);
          return;
        }
        if (canOpenProfile) {
          event.preventDefault();
          onOpenProfile?.(player);
        }
      }}
      onMouseEnter={onHover ? () => onHover(player) : undefined}
      onMouseLeave={onHoverEnd}
      className={cn(
        "group rounded-md border border-[#d9d0c9] bg-[#f7f7f7] p-4 flex flex-col gap-3 transition-colors",
        canClickCard && "cursor-pointer hover:border-[#0e0907]/30",
        disabled && "opacity-40 cursor-not-allowed",
        highlighted && "!opacity-100 ring-2 ring-[#ffa05c]/60",
        isLegend && "border-[#ffa05c]/50 bg-[#f7f7f7]",
      )}
      onClick={canClickCard ? () => {
        if (canAct) {
          onPrimaryAction?.(player);
          return;
        }
        onOpenProfile?.(player);
      } : undefined}
    >
      <div id={`player-card-view-header-${player.id}`} className="flex items-center gap-3">
        <PlayerHeadshot nba_api_id={player.nba_api_id} size={48} name={player.name} />
        <div className="min-w-0 flex-1">
          <h3 id={`player-card-view-name-${player.id}`} className={cn("font-semibold text-sm text-[#0e0907] truncate", canClickCard && "group-hover:underline")}>
            {isLegend && <span className="text-[#ffa05c] mr-1" aria-label="Legend">★</span>}
            {isLegend && player.peak_year != null ? `${player.peak_year} ` : ""}{player.name}
          </h3>
          <p id={`player-card-view-meta-${player.id}`} className="text-xs text-[#0e0907]/50 truncate">
            {[player.team, player.position].filter(Boolean).join(" · ") || "--"}
          </p>
        </div>
        {player.flag_summary.unresolved > 0 && (
          <span id={`player-card-view-flags-${player.id}`} className="shrink-0 inline-flex items-center rounded-sm bg-[#ffa05c]/20 border border-[#ffa05c]/40 px-1.5 py-0.5 text-[10px] font-medium text-[#7e2c0c]">
            {player.flag_summary.unresolved} flag{player.flag_summary.unresolved !== 1 ? "s" : ""}
          </span>
        )}
        {onOpenProfile && (
          <button
            id={`player-card-view-inspect-${player.id}`}
            type="button"
            title="Inspect Player"
            aria-label={`Inspect ${player.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onOpenProfile(player);
            }}
            className="shrink-0 border border-[#d9d0c9] bg-[#f0f0f0]/45 p-1.5 text-[#0e0907]/55 transition-colors hover:border-[#ffa05c]/70 hover:bg-[#ffa05c]/10 hover:text-[#0e0907]"
          >
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {bioLine && <p id={`player-card-view-bio-${player.id}`} className="text-[11px] text-[#0e0907]/45">{bioLine}</p>}

      {player.skills == null ? (
        <p id={`player-card-view-no-skills-${player.id}`} className="text-[11px] text-[#0e0907]/40 italic">No skill profile yet</p>
      ) : allTopSkills.length === 0 ? (
        <p id={`player-card-view-no-rated-skills-${player.id}`} className="text-[11px] text-[#0e0907]/40 italic">No rated skills</p>
      ) : (
        <div id={`player-card-view-skills-${player.id}`} className="space-y-1.5">
          <div className="flex flex-wrap gap-1">
            {visibleSkills.map(({ name, tier }) => (
              <div key={name} className="flex items-center gap-1">
                <span className="text-[10px] text-[#0e0907]/50">{SKILL_LABELS[name] ?? name}</span>
                <SkillTierBadge tier={tier as SkillTier} size="sm" />
              </div>
            ))}
          </div>
          {hasMore && (
            <button
              id={`player-card-view-expand-${player.id}`}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setExpanded((value) => !value);
              }}
              className="text-[10px] text-[#0e0907]/45 hover:text-[#0e0907] transition-colors"
            >
              {expanded ? "Show less" : `${allTopSkills.length - TOP_SKILL_COUNT} more skills`}
            </button>
          )}
        </div>
      )}

      {primaryActionLabel && (
        <div id={`player-card-view-actions-${player.id}`} className="mt-auto flex items-center pt-1">
          <button
            id={`player-card-view-primary-${player.id}`}
            type="button"
            disabled={!canAct}
            onClick={(event) => {
              event.stopPropagation();
              onPrimaryAction?.(player);
            }}
            className="rounded-sm bg-[#ffa05c] px-3 py-1.5 text-[0.8125rem] font-medium text-[#0e0907] transition-colors hover:bg-[#fe6d34] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {primaryActionLabel}
          </button>
        </div>
      )}
    </article>
  );
}
