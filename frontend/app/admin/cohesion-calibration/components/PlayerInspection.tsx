"use client";

/**
 * PlayerInspection — Left panel components for inspecting player composites.
 *
 * Contains: CompositeBars, SkillTierPill, CompositeRefPill, PlayerSkillsPanel,
 * PlayerEquationPanel (with PnrScreener, PaintTouch, OffBallImpact sub-equations).
 *
 * These are grouped because they share utility functions (skillTier, skillValue,
 * equationTermsFor) and constants (TIER_VALUES, FORMULA_LABELS, EQUATION_ORDER).
 */

import { cn } from "@/lib/utils";
import { COMPOSITE_COLUMNS } from "@/lib/cohesion-constants";
import { ALL_SKILL_NAMES, formatSkillName } from "@/lib/skills";
import { TIER_BADGE_CLASSES, tierToNum } from "@/lib/tiers";
import { pnrScreenerSecondaryScale } from "@/lib/cohesion-weights";
import type { CohesionExplanationWeights } from "@/lib/cohesion-weights";
import type { SkillTier } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants (page-specific, not shared across other pages)
// ---------------------------------------------------------------------------

const TIER_VALUES: Record<string, number> = {
  None: 0,
  Capable: 1.5,
  Proficient: 3,
  Elite: 6,
  "All-Time Great": 10,
};

export const FORMULA_LABELS: Record<string, string> = {
  spacing: "Spacing",
  finishing: "Finishing",
  paint_touch: "Rim Pressure",
  anchor: "Anchor",
  post_game: "Post Game",
  pnr_screener: "PnR Screener",
  off_ball_impact: "Off-Ball Impact",
  shot_creation: "Shot Creation",
  rebounding: "Rebounding",
  transition: "Transition",
  perimeter_defense: "Perimeter Defense",
  interior_defense: "Interior Defense",
};

const EQUATION_ORDER = [
  "spacing",
  "finishing",
  "paint_touch",
  "anchor",
  "post_game",
  "pnr_screener",
  "off_ball_impact",
  "shot_creation",
  "rebounding",
  "transition",
  "perimeter_defense",
  "interior_defense",
];

// Alias for CompositeBars (uses same data as COMPOSITE_COLUMNS)
const COMPOSITE_LABELS = COMPOSITE_COLUMNS;

// ---------------------------------------------------------------------------
// Utility functions (exported for use by equation components in page.tsx)
// ---------------------------------------------------------------------------

export function skillTier(skills: Record<string, string>, skill: string): SkillTier {
  const tier = skills[skill];
  if (
    tier === "All-Time Great" ||
    tier === "Elite" ||
    tier === "Proficient" ||
    tier === "Capable" ||
    tier === "None"
  ) {
    return tier;
  }
  return "None";
}

export function skillValue(skills: Record<string, string>, skill: string): number {
  return TIER_VALUES[skillTier(skills, skill)] ?? 0;
}

export function ratedSkills(skills: Record<string, string>): { skill: string; tier: SkillTier }[] {
  return ALL_SKILL_NAMES
    .map((skill) => ({ skill, tier: skillTier(skills, skill) }))
    .filter(({ tier }) => tier !== "None")
    .sort((a, b) => {
      const tierDiff = tierToNum(b.tier) - tierToNum(a.tier);
      return tierDiff !== 0 ? tierDiff : formatSkillName(a.skill).localeCompare(formatSkillName(b.skill));
    });
}

// ---------------------------------------------------------------------------
// Color utility (specific to composite bars — different from shared colors)
// ---------------------------------------------------------------------------

function compositeBarColor(score: number): string {
  if (score >= 8) return "bg-green-500";
  if (score >= 6) return "bg-green-600/60";
  if (score >= 4) return "bg-amber-500";
  if (score >= 2) return "bg-red-500/70";
  return "bg-red-600";
}

// ---------------------------------------------------------------------------
// Equation term definitions
// ---------------------------------------------------------------------------

interface EquationTerm {
  skill?: string;
  composite?: string;
  multiplier?: number;
}

function equationTermsFor(composite: string): EquationTerm[] {
  switch (composite) {
    case "spacing":
      return [
        { skill: "movement_shooter" },
        { skill: "spot_up_shooter" },
        { skill: "off_dribble_shooter", multiplier: 0.5 },
      ];
    case "finishing":
      return [{ skill: "high_flyer" }, { skill: "crafty_finisher" }];
    case "paint_touch":
      return [
        { skill: "driver" },
        { skill: "vertical_spacer", multiplier: 0.6 },
        { skill: "low_post_player" },
        { skill: "mid_post_player", multiplier: 0.7 },
        { composite: "finishing" },
      ];
    case "anchor":
      return [
        { skill: "rebounder" },
        { composite: "interior_defense" },
        { skill: "vertical_spacer" },
        { skill: "screen_setter", multiplier: 0.3 },
      ];
    case "post_game":
      return [{ skill: "low_post_player" }, { skill: "mid_post_player", multiplier: 0.7 }];
    case "pnr_screener":
      return [{ skill: "pnr_finisher" }, { skill: "screen_setter" }];
    case "off_ball_impact":
      return [{ composite: "spacing" }, { skill: "cutter" }, { composite: "finishing" }, { skill: "passer", multiplier: 0.5 }];
    case "shot_creation":
      return [
        { skill: "pnr_ball_handler" },
        { skill: "passer" },
        { skill: "off_dribble_shooter" },
        { skill: "isolation_scorer" },
        { composite: "spacing", multiplier: 0.3 },
        { composite: "paint_touch", multiplier: 0.5 },
      ];
    case "rebounding":
      return [{ skill: "rebounder" }, { skill: "offensive_rebounder" }];
    case "transition":
      return [
        { skill: "transition_threat" },
        { skill: "passer" },
        { skill: "high_flyer", multiplier: 0.7 },
        { skill: "driver", multiplier: 0.3 },
        { skill: "spot_up_shooter", multiplier: 0.2 },
      ];
    case "perimeter_defense":
      return [
        { skill: "perimeter_disruptor" },
        { skill: "versatile_defender", multiplier: 0.7 },
      ];
    case "interior_defense":
      return [
        { skill: "rim_protector" },
        { skill: "versatile_defender", multiplier: 0.5 },
        { skill: "rebounder", multiplier: 0.3 },
      ];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// CompositeBars
// ---------------------------------------------------------------------------

interface CompositeBarsProps {
  composites: Record<string, number>;
}

/** Horizontal bars for 12 composites (0-10 scale). */
export function CompositeBars({ composites }: CompositeBarsProps) {
  return (
    <div id="cohesion-cal-composites" className="space-y-1.5">
      {COMPOSITE_LABELS.map(({ key, label }) => {
        const score = composites[key] ?? 0;
        const rounded = Math.round(score * 10) / 10;
        const widthPct = Math.max(0, Math.min(100, (score / 10) * 100));
        return (
          <div key={key} id={`cohesion-cal-composite-${key}`} className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-20 truncate" title={label}>
              {label}
            </span>
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all duration-300", compositeBarColor(score))}
                style={{ width: `${widthPct}%` }}
              />
            </div>
            <span className="text-[10px] font-mono tabular-nums text-foreground w-7 text-right">
              {rounded.toFixed(1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pill components
// ---------------------------------------------------------------------------

interface SkillTierPillProps {
  id: string;
  skill: string;
  tier: SkillTier;
  compact?: boolean;
}

/** Small tier-colored chip used for player skill inspection and equations. */
export function SkillTierPill({ id, skill, tier, compact = false }: SkillTierPillProps) {
  return (
    <span
      id={id}
      className={cn(
        "inline-flex items-center gap-1 rounded border font-medium whitespace-nowrap",
        compact ? "px-1 py-0 text-[8px]" : "px-1.5 py-0.5 text-[9px]",
        TIER_BADGE_CLASSES[tier],
      )}
      title={`${formatSkillName(skill)}: ${tier} (${skillValue({ [skill]: tier }, skill)})`}
    >
      <span id={`${id}-name`}>{compact ? formatSkillName(skill).replaceAll(" ", "\u00a0") : formatSkillName(skill)}</span>
      <span id={`${id}-value`} className="font-mono tabular-nums opacity-80">
        {skillValue({ [skill]: tier }, skill).toFixed(tier === "None" ? 0 : 1)}
      </span>
    </span>
  );
}

interface CompositeRefPillProps {
  id: string;
  compositeKey: string;
  rawValue: number;
  compact?: boolean;
}

/** Pill showing a reference to another composite's raw value. */
export function CompositeRefPill({ id, compositeKey, rawValue, compact = false }: CompositeRefPillProps) {
  const label = FORMULA_LABELS[compositeKey] ?? compositeKey;
  return (
    <span
      id={id}
      className={cn(
        "inline-flex items-center gap-1 rounded border font-medium whitespace-nowrap",
        compact ? "px-1 py-0 text-[8px]" : "px-1.5 py-0.5 text-[9px]",
        "bg-purple-100 text-purple-800 border-purple-300",
      )}
      title={`${label} composite (raw: ${rawValue.toFixed(2)})`}
    >
      <span id={`${id}-name`}>{compact ? label.replaceAll(" ", "\u00a0") : label}</span>
      <span id={`${id}-value`} className="font-mono tabular-nums opacity-80">
        {rawValue.toFixed(1)}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// PlayerSkillsPanel
// ---------------------------------------------------------------------------

interface PlayerSkillsPanelProps {
  idPrefix: string;
  skills: Record<string, string>;
}

/** Compact display of a player's non-None skills under the composite bars. */
export function PlayerSkillsPanel({ idPrefix, skills }: PlayerSkillsPanelProps) {
  const visibleSkills = ratedSkills(skills);

  return (
    <div id={`${idPrefix}-skills-panel`} className="space-y-2">
      <p id={`${idPrefix}-skills-title`} className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Skills
      </p>
      {visibleSkills.length === 0 ? (
        <p id={`${idPrefix}-skills-empty`} className="text-xs text-muted-foreground/50">
          No rated skills
        </p>
      ) : (
        <div id={`${idPrefix}-skills-list`} className="flex flex-wrap gap-1.5">
          {visibleSkills.map(({ skill, tier }) => (
            <SkillTierPill
              key={skill}
              id={`${idPrefix}-skill-${skill}`}
              skill={skill}
              tier={tier}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PlayerEquationPanel (with sub-equation components)
// ---------------------------------------------------------------------------

interface PnrScreenerRawEquationProps {
  idPrefix: string;
  skills: Record<string, string>;
  rawValue: number;
  weights: CohesionExplanationWeights;
}

function PnrScreenerRawEquation({ idPrefix, skills, rawValue, weights }: PnrScreenerRawEquationProps) {
  const scale = pnrScreenerSecondaryScale(weights);
  const verticalValue = skillValue(skills, "vertical_spacer");
  const spotUpValue = skillValue(skills, "spot_up_shooter");
  const modifier = Math.max(1, 1 + scale * (verticalValue + spotUpValue));

  return (
    <div id={idPrefix} className="text-[9px] leading-relaxed">
      <span id={`${idPrefix}-label`} className="font-semibold text-foreground">PnR Screener</span>
      <span id={`${idPrefix}-equals`} className="mx-1 text-muted-foreground">=</span>
      <span id={`${idPrefix}-total`} className="font-mono font-semibold text-foreground tabular-nums">{rawValue.toFixed(2)}</span>
      <span id={`${idPrefix}-terms-equals`} className="mx-1 text-muted-foreground">=</span>
      <span id={`${idPrefix}-terms`} className="inline-flex flex-wrap items-center gap-1">
        <SkillTierPill id={`${idPrefix}-finisher`} skill="pnr_finisher" tier={skillTier(skills, "pnr_finisher")} compact />
        <span className="font-mono text-muted-foreground">x max(1, 1 + {scale.toFixed(2)} x (</span>
        <SkillTierPill id={`${idPrefix}-vertical`} skill="vertical_spacer" tier={skillTier(skills, "vertical_spacer")} compact />
        <span className="text-muted-foreground">+</span>
        <SkillTierPill id={`${idPrefix}-spot-up`} skill="spot_up_shooter" tier={skillTier(skills, "spot_up_shooter")} compact />
        <span className="font-mono text-muted-foreground">)) {modifier.toFixed(2)}</span>
        <span className="text-muted-foreground">+</span>
        <SkillTierPill id={`${idPrefix}-screen`} skill="screen_setter" tier={skillTier(skills, "screen_setter")} compact />
      </span>
    </div>
  );
}

interface PaintTouchRawEquationProps {
  idPrefix: string;
  skills: Record<string, string>;
  rawValue: number;
  rawComposites: Record<string, number>;
  weights: CohesionExplanationWeights;
}

function PaintTouchRawEquation({ idPrefix, skills, rawValue, rawComposites, weights }: PaintTouchRawEquationProps) {
  const finishingScale = weights.COMPOSITE_COEFFICIENTS.paint_touch_finishing_scale ?? 0.08;
  const rawFinishing = rawComposites["finishing"] ?? 0;
  const multiplier = Math.max(1, 1 + finishingScale * rawFinishing);

  return (
    <div id={idPrefix} className="text-[9px] leading-relaxed">
      <span id={`${idPrefix}-label`} className="font-semibold text-foreground">Rim Pressure</span>
      <span id={`${idPrefix}-equals`} className="mx-1 text-muted-foreground">=</span>
      <span id={`${idPrefix}-total`} className="font-mono font-semibold text-foreground tabular-nums">{rawValue.toFixed(2)}</span>
      <span id={`${idPrefix}-terms-equals`} className="mx-1 text-muted-foreground">=</span>
      <span id={`${idPrefix}-terms`} className="inline-flex flex-wrap items-center gap-1">
        <span className="font-mono text-muted-foreground">max(1, 1 + {finishingScale} x</span>
        <CompositeRefPill id={`${idPrefix}-finishing`} compositeKey="finishing" rawValue={rawFinishing} compact />
        <span className="font-mono text-muted-foreground">) {multiplier.toFixed(2)} x (</span>
        <SkillTierPill id={`${idPrefix}-driver`} skill="driver" tier={skillTier(skills, "driver")} compact />
        <span className="text-muted-foreground">+</span>
        <span className="font-mono text-muted-foreground">0.6x</span>
        <SkillTierPill id={`${idPrefix}-vertical`} skill="vertical_spacer" tier={skillTier(skills, "vertical_spacer")} compact />
        <span className="text-muted-foreground">+</span>
        <SkillTierPill id={`${idPrefix}-low-post`} skill="low_post_player" tier={skillTier(skills, "low_post_player")} compact />
        <span className="text-muted-foreground">+</span>
        <span className="font-mono text-muted-foreground">0.7x</span>
        <SkillTierPill id={`${idPrefix}-mid-post`} skill="mid_post_player" tier={skillTier(skills, "mid_post_player")} compact />
        <span className="font-mono text-muted-foreground">)</span>
      </span>
    </div>
  );
}

interface OffBallImpactRawEquationProps {
  idPrefix: string;
  skills: Record<string, string>;
  rawValue: number;
  rawComposites: Record<string, number>;
  weights: CohesionExplanationWeights;
}

function OffBallImpactRawEquation({ idPrefix, skills, rawValue, rawComposites, weights }: OffBallImpactRawEquationProps) {
  const finishingScale = weights.COMPOSITE_COEFFICIENTS.off_ball_finishing_scale ?? 0.08;
  const rawFinishing = rawComposites["finishing"] ?? 0;
  const cuttingMult = Math.max(1, 1 + finishingScale * rawFinishing);
  const passerScale = weights.COMPOSITE_COEFFICIENTS.off_ball_passer ?? 0.3;
  const rawSpacing = rawComposites["spacing"] ?? 0;

  return (
    <div id={idPrefix} className="text-[9px] leading-relaxed">
      <span id={`${idPrefix}-label`} className="font-semibold text-foreground">Off-Ball Impact</span>
      <span id={`${idPrefix}-equals`} className="mx-1 text-muted-foreground">=</span>
      <span id={`${idPrefix}-total`} className="font-mono font-semibold text-foreground tabular-nums">{rawValue.toFixed(2)}</span>
      <span id={`${idPrefix}-terms-equals`} className="mx-1 text-muted-foreground">=</span>
      <span id={`${idPrefix}-terms`} className="inline-flex flex-wrap items-center gap-1">
        <CompositeRefPill id={`${idPrefix}-spacing`} compositeKey="spacing" rawValue={rawSpacing} compact />
        <span className="text-muted-foreground">+</span>
        <SkillTierPill id={`${idPrefix}-cutter`} skill="cutter" tier={skillTier(skills, "cutter")} compact />
        <span className="font-mono text-muted-foreground">x max(1, 1 + {finishingScale} x</span>
        <CompositeRefPill id={`${idPrefix}-finishing`} compositeKey="finishing" rawValue={rawFinishing} compact />
        <span className="font-mono text-muted-foreground">) {cuttingMult.toFixed(2)}</span>
        <span className="text-muted-foreground">+</span>
        <span className="font-mono text-muted-foreground">{passerScale}x</span>
        <SkillTierPill id={`${idPrefix}-passer`} skill="passer" tier={skillTier(skills, "passer")} compact />
      </span>
    </div>
  );
}

interface PlayerEquationPanelProps {
  idPrefix: string;
  skills: Record<string, string>;
  rawComposites: Record<string, number>;
  weights: CohesionExplanationWeights;
}

/** Collapsible player-level raw composite formulas for debugging cohesion inputs. */
export function PlayerEquationPanel({ idPrefix, skills, rawComposites, weights }: PlayerEquationPanelProps) {
  return (
    <details id={`${idPrefix}-equations`} className="mt-2 rounded-md border border-border/70 bg-background/70 px-2 py-1.5">
      <summary id={`${idPrefix}-equations-summary`} className="cursor-pointer text-[10px] font-medium text-muted-foreground hover:text-foreground">
        Raw composite equations
      </summary>
      <div id={`${idPrefix}-equations-list`} className="mt-2 space-y-1.5">
        {EQUATION_ORDER.map((composite) => {
          const terms = equationTermsFor(composite);
          if (composite === "pnr_screener") {
            return (
              <PnrScreenerRawEquation
                key={composite}
                idPrefix={`${idPrefix}-equation-${composite}`}
                skills={skills}
                rawValue={rawComposites[composite] ?? 0}
                weights={weights}
              />
            );
          }
          if (composite === "paint_touch") {
            return (
              <PaintTouchRawEquation
                key={composite}
                idPrefix={`${idPrefix}-equation-${composite}`}
                skills={skills}
                rawValue={rawComposites[composite] ?? 0}
                rawComposites={rawComposites}
                weights={weights}
              />
            );
          }
          if (composite === "off_ball_impact") {
            return (
              <OffBallImpactRawEquation
                key={composite}
                idPrefix={`${idPrefix}-equation-${composite}`}
                skills={skills}
                rawValue={rawComposites[composite] ?? 0}
                rawComposites={rawComposites}
                weights={weights}
              />
            );
          }
          return (
            <div key={composite} id={`${idPrefix}-equation-${composite}`} className="text-[9px] leading-relaxed">
              <span id={`${idPrefix}-equation-${composite}-label`} className="font-semibold text-foreground">
                {FORMULA_LABELS[composite]}
              </span>
              <span id={`${idPrefix}-equation-${composite}-equals`} className="mx-1 text-muted-foreground">=</span>
              <span id={`${idPrefix}-equation-${composite}-total`} className="font-mono font-semibold text-foreground tabular-nums">
                {(rawComposites[composite] ?? 0).toFixed(2)}
              </span>
              <span id={`${idPrefix}-equation-${composite}-terms-equals`} className="mx-1 text-muted-foreground">=</span>
              <span id={`${idPrefix}-equation-${composite}-terms`} className="inline-flex flex-wrap items-center gap-1">
                {terms.map((term, index) => {
                  const termKey = term.skill ?? term.composite ?? `term-${index}`;
                  return (
                    <span key={`${composite}-${termKey}`} id={`${idPrefix}-equation-${composite}-term-${termKey}`} className="inline-flex items-center gap-1">
                      {index > 0 && <span id={`${idPrefix}-equation-${composite}-plus-${index}`} className="text-muted-foreground">+</span>}
                      {term.multiplier != null && (
                        <span id={`${idPrefix}-equation-${composite}-mult-${termKey}`} className="font-mono text-muted-foreground">{term.multiplier}x</span>
                      )}
                      {term.composite ? (
                        <CompositeRefPill
                          id={`${idPrefix}-equation-${composite}-pill-${term.composite}`}
                          compositeKey={term.composite}
                          rawValue={rawComposites[term.composite] ?? 0}
                          compact
                        />
                      ) : term.skill ? (
                        <SkillTierPill
                          id={`${idPrefix}-equation-${composite}-pill-${term.skill}`}
                          skill={term.skill}
                          tier={skillTier(skills, term.skill)}
                          compact
                        />
                      ) : null}
                    </span>
                  );
                })}
              </span>
            </div>
          );
        })}
      </div>
    </details>
  );
}
