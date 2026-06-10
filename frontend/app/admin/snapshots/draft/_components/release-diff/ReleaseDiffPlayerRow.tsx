"use client";

/**
 * ReleaseDiffPlayerRow — one changed Player in the release diff (#8).
 *
 * Collapsed: name + legend marker + compact delta counts.
 * Expanded: per-skill tier chips (old → new) and contract/bio deltas.
 *
 * Tier chips reuse TIER_BADGE_CLASSES; a null tier (skill key absent on that
 * side) renders as a muted "none" chip, mirroring the run-diff convention.
 */

import { cn } from "@/lib/utils";
import { TIER_BADGE_CLASSES } from "@/lib/tiers";
import { formatSkillName } from "@/lib/skills";
import type { ReleaseDiffChangedPlayer, SkillTier } from "@/lib/types";
import { formatContractChange, nameSlug } from "./releaseDiffFormat";

function TierChip({ tier }: { tier: string | null }) {
  if (tier === null) {
    return (
      <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-slate-400 italic">
        none
      </span>
    );
  }
  const badgeClass =
    TIER_BADGE_CLASSES[tier as SkillTier] ??
    "bg-slate-100 text-slate-500 border border-slate-200";
  return (
    <span
      className={cn(
        "inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded",
        badgeClass
      )}
    >
      {tier}
    </span>
  );
}

export function LegendMarker() {
  return (
    <span className="inline-flex items-center text-[10px] font-semibold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded border border-violet-300 bg-violet-100 text-violet-800">
      Legend
    </span>
  );
}

export interface ReleaseDiffPlayerRowProps {
  player: ReleaseDiffChangedPlayer;
  isExpanded: boolean;
  onToggle: () => void;
}

export function ReleaseDiffPlayerRow({
  player,
  isExpanded,
  onToggle,
}: ReleaseDiffPlayerRowProps) {
  const slug = nameSlug(player.name);
  const skillCount = player.skill_changes.length;
  const contractCount = player.contract_changes.length;

  const countParts: string[] = [];
  if (skillCount > 0)
    countParts.push(`${skillCount} skill${skillCount !== 1 ? "s" : ""}`);
  if (contractCount > 0)
    countParts.push(`${contractCount} contract`);

  const meta = [player.team, player.position].filter(Boolean).join(" · ");

  return (
    <div
      id={`diff-player-row-${slug}`}
      className="rounded-[6px] border border-[#d9d0c9] bg-white"
    >
      <button
        id={`diff-player-row-${slug}-toggle`}
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-[#fef9f5] transition-colors rounded-[6px]"
      >
        <span
          className="text-neutral-400 text-[10px] select-none w-3"
          aria-hidden="true"
        >
          {isExpanded ? "▾" : "▸"}
        </span>
        <span className="text-sm font-semibold text-[#0e0907]">
          {player.name}
        </span>
        {player.is_legend && <LegendMarker />}
        {meta && <span className="text-xs text-neutral-400">{meta}</span>}
        <span className="ml-auto text-xs text-neutral-500">
          {countParts.join(" · ")}
        </span>
      </button>

      {isExpanded && (
        <div
          id={`diff-player-row-${slug}-detail`}
          className="border-t border-[#d9d0c9] px-4 py-3 space-y-3"
        >
          {skillCount > 0 && (
            <div id={`diff-player-row-${slug}-skills`}>
              <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-neutral-400 mb-1.5">
                Skill changes
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                {player.skill_changes.map((change) => (
                  <div
                    key={change.skill}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="text-xs text-[#0e0907]">
                      {formatSkillName(change.skill)}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <TierChip tier={change.old_tier} />
                      <span
                        className="text-neutral-400 text-[10px] select-none"
                        aria-hidden="true"
                      >
                        &rarr;
                      </span>
                      <TierChip tier={change.new_tier} />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {contractCount > 0 && (
            <div id={`diff-player-row-${slug}-contract`}>
              <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-neutral-400 mb-1.5">
                Contract &amp; bio changes
              </p>
              <div className="space-y-1">
                {player.contract_changes.map((change) => {
                  const { label, oldValue, newValue } =
                    formatContractChange(change);
                  return (
                    <div
                      key={change.field}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span className="text-neutral-500 w-16">{label}</span>
                      <span className="text-neutral-400 line-through">
                        {oldValue}
                      </span>
                      <span
                        className="text-neutral-400 text-[10px] select-none"
                        aria-hidden="true"
                      >
                        &rarr;
                      </span>
                      <span className="font-medium text-[#0e0907]">
                        {newValue}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
