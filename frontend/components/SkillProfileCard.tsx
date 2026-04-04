"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { getPlayerSkills } from "@/lib/api";
import { SkillTierBadge } from "./SkillTierBadge";
import { StatConfidenceIndicator } from "./StatConfidenceIndicator";
import type { PlayerSkills, SkillResult } from "@/lib/types";

interface SkillProfileCardProps {
  playerId: string;
  season?: string;
  onSkillClick?: (skillName: string) => void;
  highlightSkill?: string;
  /** If provided, replaces fetched skills (used after re-evaluate) */
  externalSkills?: PlayerSkills;
  /** Skills from a previous evaluation — used to highlight changed tiers */
  previousSkills?: PlayerSkills;
  className?: string;
}

/** Skill categories matching the 19-skill schema */
// Canonical skill keys — must stay in sync with backend/services/claude_assessment.py
const SKILL_CATEGORIES: Record<string, string[]> = {
  "High Confidence": [
    "spot_up_shooter",
    "off_dribble_shooter",
    "offensive_rebounder",
    "rebounder",
    "rim_protector",
    "isolation_scorer",
  ],
  Moderate: [
    "movement_shooter",
    "cutter",
    "transition_threat",
    "pnr_ball_handler",
    "pnr_finisher",
    "crafty_finisher",
    "vertical_spacer",
    "screen_setter",
    "passer",
    "mid_post_player",
    "low_post_player",
  ],
  "Low Confidence": [
    "switchable_defender",
    "point_of_attack_defender",
    "high_flyer",
  ],
};

function formatSkillName(name: string): string {
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function SkillRow({
  result,
  onClick,
  isHighlighted,
  tierChanged,
}: {
  result: SkillResult;
  onClick?: () => void;
  isHighlighted: boolean;
  tierChanged: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-left text-xs",
        "transition-all",
        onClick && "hover:bg-muted/60 cursor-pointer",
        isHighlighted && "bg-accent ring-1 ring-ring",
        tierChanged && "ring-1 ring-amber-400 bg-amber-50"
      )}
    >
      <span className="font-medium text-foreground truncate flex-1">
        {formatSkillName(result.skill_name)}
      </span>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <StatConfidenceIndicator confidence={result.stat_confidence} />
        {result.review_recommended && (
          <span
            className="text-amber-500"
            title="Review recommended"
          >
            ⚑
          </span>
        )}
        <SkillTierBadge tier={result.tier} size="sm" />
        {tierChanged && (
          <span className="text-amber-500 text-xs font-bold" title="Tier changed after re-evaluation">
            ↕
          </span>
        )}
      </div>
    </button>
  );
}

/**
 * Displays all 19 skills for a player organized by category, with tier badges,
 * confidence indicators, and review flags.
 *
 * Clicking a skill row fires the onSkillClick callback — used to link the
 * skill profile card (left panel) to the threshold editor (center panel).
 *
 * Reused in: calibration, review panel, player profile page.
 */
export function SkillProfileCard({
  playerId,
  season,
  onSkillClick,
  highlightSkill,
  externalSkills,
  previousSkills,
  className,
}: SkillProfileCardProps) {
  const [skills, setSkills] = useState<PlayerSkills | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (externalSkills) {
      setSkills(externalSkills);
      setLoading(false);
      return;
    }
    if (!playerId) return;
    setLoading(true);
    setError(null);
    getPlayerSkills(playerId)
      .then((res) => {
        if (res.success && res.data) {
          setSkills(res.data);
        } else {
          setError(res.error ?? "Failed to load skills");
        }
      })
      .catch(() => setError("Failed to load skills"))
      .finally(() => setLoading(false));
  }, [playerId, season, externalSkills]);

  if (loading) {
    return (
      <div className={cn("space-y-2 animate-pulse", className)}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 bg-muted rounded-md" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive", className)}>
        {error}
      </div>
    );
  }

  if (!skills) return null;

  return (
    <div className={cn("space-y-3", className)}>
      {Object.entries(SKILL_CATEGORIES).map(([category, skillNames]) => {
        // Only render skills that are present in the evaluation results
        const categorySkills = skillNames
          .map((name) => skills[name])
          .filter(Boolean) as SkillResult[];

        if (categorySkills.length === 0) return null;

        return (
          <div key={category} className="rounded-md border border-border overflow-hidden">
            <div className="px-2 py-1.5 bg-muted/40 border-b border-border">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {category}
              </span>
            </div>
            <div className="px-1 py-1 space-y-0.5">
              {categorySkills.map((result) => (
                <SkillRow
                  key={result.skill_name}
                  result={result}
                  onClick={onSkillClick ? () => onSkillClick(result.skill_name) : undefined}
                  isHighlighted={highlightSkill === result.skill_name}
                  tierChanged={
                    previousSkills !== undefined &&
                    previousSkills[result.skill_name]?.tier !== result.tier
                  }
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
