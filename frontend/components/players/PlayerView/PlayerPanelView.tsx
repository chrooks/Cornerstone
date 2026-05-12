"use client";

import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { SkillTierBadge } from "@/components/SkillTierBadge";
import { formatSkillName, PUBLIC_SKILL_CATEGORIES } from "@/lib/skills";
import { formatHeight } from "@/components/players/playerFilters";
import { formatPlayerSalary } from "./playerViewUtils";
import type { LegendTier, PlayerWithSkills, SkillTier } from "@/lib/types";

type PanelSkillProfile = Record<string, string | null | undefined>;

interface PlayerPanelViewProps {
  player: PlayerWithSkills;
  skills?: PanelSkillProfile | null;
  disabled?: boolean;
  highlighted?: boolean;
  primaryActionLabel?: string;
  onPrimaryAction?: (player: PlayerWithSkills) => void;
  onOpenProfile?: (player: PlayerWithSkills) => void;
  onHover?: (player: PlayerWithSkills) => void;
  onHoverEnd?: () => void;
  onDragStart?: (event: React.DragEvent, player: PlayerWithSkills) => void;
  onContextMenu?: (event: React.MouseEvent, player: PlayerWithSkills) => void;
  fitContent?: ReactNode;
}

function TierBadge({ tier }: { tier: string | null | undefined }) {
  if (!tier) return <span className="text-[0.6875rem] text-[#0e0907]/20 italic">--</span>;
  return <SkillTierBadge tier={tier as SkillTier} size="sm" />;
}

export function PlayerPanelView({
  player,
  skills,
  disabled = false,
  highlighted = false,
  primaryActionLabel,
  onPrimaryAction,
  onOpenProfile,
  onHover,
  onHoverEnd,
  onDragStart,
  onContextMenu,
  fitContent,
}: PlayerPanelViewProps) {
  const [activeTab, setActiveTab] = useState<"player" | "build-fit">("player");
  const profile = skills ?? player.skills;
  const isLegend = player.is_legend === true;
  const canAct = !!onPrimaryAction && !disabled;
  const canOpenProfile = !!onOpenProfile;
  const canClickPanel = canAct || (!primaryActionLabel && canOpenProfile && !disabled);
  const tierCounts = useMemo(() => {
    if (!profile) return null;
    const counts: Record<string, number> = {};
    Object.values(profile).forEach((tier) => {
      if (tier && tier !== "None") counts[tier] = (counts[tier] || 0) + 1;
    });
    return counts;
  }, [profile]);

  const facts = [
    player.peak_year != null ? ["Era", String(player.peak_year)] : null,
    player.age != null ? [isLegend ? "Peak Age" : "Age", String(player.age)] : null,
    player.height ? ["Height", formatHeight(player.height)] : null,
    player.weight != null ? ["Weight", `${player.weight} lbs`] : null,
    player.salary != null ? ["Salary", `${formatPlayerSalary(player.salary)}${player.is_rookie_deal ? " RD" : ""}`] : null,
  ].filter(Boolean) as [string, string][];

  return (
    <article
      id={`player-panel-view-${player.id}`}
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
      onClick={canClickPanel ? () => {
        if (canAct) {
          onPrimaryAction?.(player);
          return;
        }
        onOpenProfile?.(player);
      } : undefined}
      className={cn(
        "rounded-md border border-[#d9d0c9] bg-[#f7f7f7] transition-colors",
        canClickPanel && "cursor-pointer hover:border-[#0e0907]/30",
        disabled && "opacity-40 cursor-not-allowed",
        highlighted && "!opacity-100 ring-2 ring-[#ffa05c]/60",
      )}
    >
      <div className="flex flex-col lg:flex-row">
        <div id={`player-panel-view-summary-${player.id}`} className="lg:w-[280px] xl:w-[320px] shrink-0 px-6 py-6 lg:border-r border-b lg:border-b-0 border-[#d9d0c9]/60 flex flex-col">
          <PlayerHeadshot
            nba_api_id={player.nba_api_id}
            size={80}
            name={player.name}
            className="mb-4 border border-[#d9d0c9]/60"
          />
          <h3 id={`player-panel-view-name-${player.id}`} className="text-[1.25rem] font-semibold leading-[1.2] text-[#0e0907]">
            {isLegend && player.peak_year != null ? `${player.peak_year} ` : ""}{player.name}
          </h3>
          <div id={`player-panel-view-meta-${player.id}`} className="flex items-center gap-2 mt-1.5 flex-wrap">
            {player.position && <span className="text-[0.8125rem] font-medium text-[#0e0907]/55">{player.position}</span>}
            {player.team && (
              <>
                <span className="text-[#0e0907]/20" aria-hidden="true">·</span>
                <span className="text-[0.8125rem] text-[#0e0907]/55">{player.team}</span>
              </>
            )}
          </div>

          <div id={`player-panel-view-facts-${player.id}`} className="flex flex-col gap-1 mt-4">
            {facts.map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-3">
                <span className="text-[0.6875rem] font-medium tracking-[0.01em] text-[#0e0907]/40">{label}</span>
                <span className="font-mono text-[0.8125rem] tabular-nums text-[#0e0907]">{value}</span>
              </div>
            ))}
          </div>

          {tierCounts && (
            <div id={`player-panel-view-tier-counts-${player.id}`} className="flex items-center gap-2 flex-wrap mt-5">
              {(["All-Time Great", "Elite", "Proficient", "Capable"] as LegendTier[]).map((tier) =>
                tier && tierCounts[tier] ? (
                  <span key={tier} className="flex items-center gap-1">
                    <SkillTierBadge tier={tier as SkillTier} size="sm" />
                    <span className="font-mono text-[0.6875rem] tabular-nums text-[#0e0907]/40">{tierCounts[tier]}</span>
                  </span>
                ) : null
              )}
            </div>
          )}

          <div id={`player-panel-view-actions-${player.id}`} className="mt-6 lg:mt-auto lg:pt-6 flex flex-wrap gap-2">
            {primaryActionLabel && (
              <button
                id={`player-panel-view-primary-${player.id}`}
                type="button"
                disabled={!canAct}
                onClick={(event) => {
                  event.stopPropagation();
                  onPrimaryAction?.(player);
                }}
                className="inline-flex items-center px-5 py-2.5 rounded-sm bg-[#ffa05c] text-[#0e0907] text-[0.8125rem] font-medium tracking-[0.01em] transition-colors duration-150 hover:bg-[#fe6d34] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {primaryActionLabel}
              </button>
            )}
            {onOpenProfile && (
              <button
                id={`player-panel-view-profile-${player.id}`}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenProfile(player);
                }}
                className="inline-flex items-center px-4 py-2.5 rounded-sm border border-[#d9d0c9] text-[#0e0907]/65 text-[0.8125rem] font-medium tracking-[0.01em] transition-colors duration-150 hover:bg-[#f0f0f0] hover:text-[#0e0907]"
              >
                Inspect
              </button>
            )}
          </div>
        </div>

        <div
          id={`player-panel-view-detail-${player.id}`}
          className="flex-1 px-6 py-6 min-w-0"
          onClick={fitContent ? (event) => event.stopPropagation() : undefined}
        >
          {fitContent && (
            <div id={`player-panel-view-tabs-${player.id}`} className="mb-4 flex border border-[#d9d0c9]">
              {[
                { id: "player" as const, label: "Player" },
                { id: "build-fit" as const, label: "Build Fit" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  id={`player-panel-view-tab-${player.id}-${tab.id}`}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setActiveTab(tab.id);
                  }}
                  className={cn(
                    "flex-1 px-3 py-2 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] transition-colors",
                    activeTab === tab.id
                      ? "bg-[#0e0907] text-[#f8f3f1]"
                      : "text-[#0e0907]/45 hover:bg-[#0e0907]/[0.04] hover:text-[#0e0907]/70",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}

          {fitContent && activeTab === "build-fit" ? (
            <div id={`player-panel-view-build-fit-${player.id}`}>{fitContent}</div>
          ) : profile ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-5">
              {Object.entries(PUBLIC_SKILL_CATEGORIES).map(([category, skillNames]) => (
                <div key={category}>
                  <h4 className="text-[0.6875rem] font-medium tracking-[0.03em] uppercase text-[#0e0907]/35 mb-2">{category}</h4>
                  <div className="flex flex-col gap-1">
                    {skillNames.map((skillKey) => (
                      <div key={skillKey} className="flex items-center justify-between gap-2 py-0.5">
                        <span className="text-[0.8125rem] text-[#0e0907]/60 truncate">{formatSkillName(skillKey)}</span>
                        <TierBadge tier={profile[skillKey]} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[0.9375rem] text-[#0e0907]/40">No skill profile available yet.</p>
          )}
        </div>
      </div>
    </article>
  );
}
