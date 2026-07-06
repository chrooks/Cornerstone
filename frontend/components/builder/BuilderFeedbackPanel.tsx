"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getActiveEvaluationVersion } from "@/lib/api/evaluation-versions";
import { CohesionScoreBadge } from "@/components/cohesion/CohesionScoreBadge";
import {
  ImpactTraitList,
  LineupReachSection,
  SkillProfileTrace,
} from "@/components/builder/feedback-read";
import {
  buildSkillTraceEntries,
  getImpactTraitKeysForSkill,
  getLineupReach,
  getPlayerLineupRead,
  getRotationLineupRead,
  rankImpactTraitEntries,
} from "@/lib/builder-read-model";
import {
  COMPOSITE_COLUMNS,
  deriveLineupEffectsByImpactTrait,
  IMPACT_TRAIT_DESCRIPTIONS,
  theoreticalMaxFromEvaluationValues,
} from "@/lib/cohesion-constants";
import { qualityTextColor } from "@/lib/cohesion-colors";
import { scoreFactorExplainer, scoreFactorLabel } from "@/lib/cohesionScoreExplainers";
import { normalizeCohesionNotes } from "@/lib/cohesionHelpers";
import { mapNoteToFilter } from "@/lib/noteFilters";
import { formatSkillName, SKILL_DESCRIPTIONS } from "@/lib/skills";
import { CohesionDebugPanel } from "./CohesionDebugPanel";
import { FeedbackTooltip } from "./FeedbackTooltip";
import { SkillGrid } from "./SkillGrid";
import { TeamShapeGlyph } from "./TeamShapeGlyph";
import { useTweenedNumber } from "@/lib/hooks/useTweened";
import type { ImpactTraitReadEntry, LineupReadContext } from "@/lib/builder-read-model";
import type { SuggestionFilter } from "@/lib/noteFilters";
import type {
  CohesionCompositeScores,
  CohesionPlayerComposites,
  LegendDetail,
  Note,
  PlayerSkillMap,
  PlayerWithSkills,
  RosterEvaluation,
} from "@/lib/types";
import type { EvaluationVersionPayload } from "@/lib/types/evaluation-version";

type FeedbackTab = "feedback" | "skills" | "debug";
export type BuilderInspectionSource = "build" | "build-player";

type CompositeKey = keyof CohesionCompositeScores;

const TIER_VALUES: Record<string, number> = {
  None: 0,
  Capable: 1,
  Proficient: 4,
  Elite: 8,
  "All-Time Great": 16,
};

const COMPOSITE_COEFFICIENTS = {
  spacing_off_dribble: 0.5,
  paint_touch_finishing_scale: 0.08,
  paint_touch_vertical_spacer: 0.6,
  paint_touch_mid_post: 0.7,
  post_game_mid_post: 0.7,
  pnr_screener_secondary_scale: 0.15,
  off_ball_finishing_scale: 0.08,
  off_ball_passer: 0.3,
  shot_creation_spacing: 0.3,
  shot_creation_paint_touch: 0.5,
  transition_passer_scale: 0.2,
  transition_high_flyer: 0.7,
  transition_driver: 0.3,
  transition_spot_up: 0.2,
  perimeter_defense_versatile_defender: 0.7,
  interior_defense_versatile_defender: 0.25,
  interior_defense_rebounder: 0.3,
} as const;

const SCORE_FACTOR_WEIGHTS: Record<string, string> = {
  starting_5: "45%",
  depth: "25%",
  archetype_diversity: "20%",
  floor: "10%",
};

const LINEUP_ONLY_SCORE_FACTOR_WEIGHTS: Record<string, string> = {
  starting_5: "90%",
  archetype_diversity: "10%",
};

const SCORE_FACTOR_DERIVATIONS: Record<string, string> = {
  starting_5: "starting Lineup Cohesion Score divided by 5.0",
  depth: "60% bench viable Lineup Combination rate plus 40% bench median quality",
  archetype_diversity: "archetype count divided by the six supported lineup identities",
  floor: "median score across all current Lineup Combinations divided by 5.0",
};

interface FormulaTerm {
  label: string;
  value: number;
  detail: string;
}

interface RawCompositeBreakdown {
  raw: number;
  terms: FormulaTerm[];
  note?: string;
}

interface BuilderFeedbackPanelProps {
  allSlots: (PlayerWithSkills | null)[];
  cornerstoneId: string | null;
  legendDetail: LegendDetail | null;
  isAdmin: boolean;
  collapsed: boolean;
  hasUnreadFeedback: boolean;
  latestEval: RosterEvaluation | null;
  /** True while the debounced live eval request is in flight. */
  isEvaluating: boolean;
  /** Max roster slots from rules_json. When 5 (Lineup), rotation sections are hidden. */
  maxRosterSlots?: number;
  inspectedPlayer: PlayerWithSkills | null;
  inspectionSource: BuilderInspectionSource;
  focusedPlayerName: string | null;
  onClearPlayerFocus: () => void;
  onCollapse: () => void;
  onExpand: () => void;
  onSuggestionFilter: (filter: SuggestionFilter, note: Note) => void;
}

function formatScore(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "0.0";
  return value.toFixed(1);
}

function compositeValue(player: CohesionPlayerComposites, key: string): number {
  return (player.base as unknown as Record<string, number>)[key] ?? 0;
}

function compositeLabel(key: string): string {
  return COMPOSITE_COLUMNS.find((column) => column.key === key)?.label ?? key.replaceAll("_", " ");
}

function skillTier(skills: PlayerSkillMap | null | undefined, skill: string): string {
  return skills?.[skill] ?? "None";
}

function skillNumericValue(skills: PlayerSkillMap | null | undefined, skill: string): number {
  return TIER_VALUES[skillTier(skills, skill)] ?? 0;
}

function skillFormulaTerm(skills: PlayerSkillMap | null | undefined, skill: string, multiplier = 1): FormulaTerm {
  const tier = skillTier(skills, skill);
  const base = TIER_VALUES[tier] ?? 0;
  return {
    label: formatSkillName(skill),
    value: base * multiplier,
    detail: multiplier === 1 ? tier : `${tier} x ${multiplier}`,
  };
}

function compositeFormulaTerm(
  rawBreakdowns: Partial<Record<CompositeKey, RawCompositeBreakdown>>,
  key: CompositeKey,
  multiplier = 1,
): FormulaTerm {
  const raw = rawBreakdowns[key]?.raw ?? 0;
  return {
    label: `${compositeLabel(key)} raw`,
    value: raw * multiplier,
    detail: multiplier === 1 ? "Impact Trait input" : `Impact Trait input x ${multiplier}`,
  };
}

function sumTerms(terms: FormulaTerm[]): number {
  return terms.reduce((sum, term) => sum + term.value, 0);
}

function computeRawCompositeBreakdowns(skills: PlayerSkillMap | null | undefined): Record<CompositeKey, RawCompositeBreakdown> {
  const c = COMPOSITE_COEFFICIENTS;
  const raw = {} as Record<CompositeKey, RawCompositeBreakdown>;

  raw.spacing = {
    terms: [
      skillFormulaTerm(skills, "movement_shooter"),
      skillFormulaTerm(skills, "spot_up_shooter"),
      skillFormulaTerm(skills, "off_dribble_shooter", c.spacing_off_dribble),
    ],
    raw: 0,
  };
  raw.spacing.raw = sumTerms(raw.spacing.terms);

  raw.finishing = {
    terms: [
      skillFormulaTerm(skills, "high_flyer"),
      skillFormulaTerm(skills, "crafty_finisher"),
    ],
    raw: 0,
  };
  raw.finishing.raw = sumTerms(raw.finishing.terms);

  raw.defensive_rebounding = {
    terms: [skillFormulaTerm(skills, "rebounder")],
    raw: 0,
  };
  raw.defensive_rebounding.raw = sumTerms(raw.defensive_rebounding.terms);

  raw.offensive_rebounding = {
    terms: [skillFormulaTerm(skills, "offensive_rebounder")],
    raw: 0,
  };
  raw.offensive_rebounding.raw = sumTerms(raw.offensive_rebounding.terms);

  raw.perimeter_defense = {
    terms: [
      skillFormulaTerm(skills, "perimeter_disruptor"),
      skillFormulaTerm(skills, "versatile_defender", c.perimeter_defense_versatile_defender),
    ],
    raw: 0,
  };
  raw.perimeter_defense.raw = sumTerms(raw.perimeter_defense.terms);

  raw.interior_defense = {
    terms: [
      skillFormulaTerm(skills, "rim_protector"),
      skillFormulaTerm(skills, "versatile_defender", c.interior_defense_versatile_defender),
      skillFormulaTerm(skills, "rebounder", c.interior_defense_rebounder),
    ],
    raw: 0,
  };
  raw.interior_defense.raw = sumTerms(raw.interior_defense.terms);

  const finishingMultiplier = Math.max(1, 1 + c.paint_touch_finishing_scale * raw.finishing.raw);
  const paintTouchTerms = [
    skillFormulaTerm(skills, "driver"),
    skillFormulaTerm(skills, "vertical_spacer", c.paint_touch_vertical_spacer),
    skillFormulaTerm(skills, "low_post_player"),
    skillFormulaTerm(skills, "mid_post_player", c.paint_touch_mid_post),
  ];
  raw.paint_touch = {
    terms: [
      ...paintTouchTerms,
      {
        label: "Finishing multiplier",
        value: finishingMultiplier,
        detail: `1 + ${c.paint_touch_finishing_scale} x ${formatScore(raw.finishing.raw)} raw finishing`,
      },
    ],
    raw: sumTerms(paintTouchTerms) * finishingMultiplier,
    note: "Skill subtotal is multiplied by finishing, so finishers turn touches into stronger rim pressure.",
  };

  raw.ball_security = {
    terms: [skillFormulaTerm(skills, "passer")],
    raw: 0,
  };
  raw.ball_security.raw = sumTerms(raw.ball_security.terms);

  raw.post_game = {
    terms: [
      skillFormulaTerm(skills, "low_post_player"),
      skillFormulaTerm(skills, "mid_post_player", c.post_game_mid_post),
    ],
    raw: 0,
  };
  raw.post_game.raw = sumTerms(raw.post_game.terms);

  const pnrSecondaryMultiplier = Math.max(
    1,
    1 + c.pnr_screener_secondary_scale * (
      skillNumericValue(skills, "vertical_spacer") + skillNumericValue(skills, "spot_up_shooter")
    ),
  );
  raw.pnr_screener = {
    terms: [
      {
        label: formatSkillName("pnr_finisher"),
        value: skillNumericValue(skills, "pnr_finisher") * pnrSecondaryMultiplier,
        detail: `${skillTier(skills, "pnr_finisher")} x ${formatScore(pnrSecondaryMultiplier)}`,
      },
      skillFormulaTerm(skills, "screen_setter"),
    ],
    raw: 0,
    note: "Vertical spacing and spot-up shooting amplify the PnR finisher input.",
  };
  raw.pnr_screener.raw = sumTerms(raw.pnr_screener.terms);

  const passerTransitionMultiplier = Math.max(1, 1 + c.transition_passer_scale * skillNumericValue(skills, "passer"));
  raw.transition = {
    terms: [
      {
        label: formatSkillName("transition_threat"),
        value: skillNumericValue(skills, "transition_threat") * passerTransitionMultiplier,
        detail: `${skillTier(skills, "transition_threat")} x ${formatScore(passerTransitionMultiplier)}`,
      },
      skillFormulaTerm(skills, "high_flyer", c.transition_high_flyer),
      skillFormulaTerm(skills, "driver", c.transition_driver),
      skillFormulaTerm(skills, "spot_up_shooter", c.transition_spot_up),
    ],
    raw: 0,
    note: "Passing amplifies open-court threat before the athletic and shooting inputs are added.",
  };
  raw.transition.raw = sumTerms(raw.transition.terms);

  const cuttingFinishingMultiplier = Math.max(1, 1 + c.off_ball_finishing_scale * raw.finishing.raw);
  raw.off_ball_impact = {
    terms: [
      compositeFormulaTerm(raw, "spacing"),
      {
        label: formatSkillName("cutter"),
        value: skillNumericValue(skills, "cutter") * cuttingFinishingMultiplier,
        detail: `${skillTier(skills, "cutter")} x ${formatScore(cuttingFinishingMultiplier)}`,
      },
      skillFormulaTerm(skills, "passer", c.off_ball_passer),
    ],
    raw: 0,
    note: "Spacing plus cutting gravity drive this, with passing as a secondary input.",
  };
  raw.off_ball_impact.raw = sumTerms(raw.off_ball_impact.terms);

  raw.shot_creation = {
    terms: [
      skillFormulaTerm(skills, "pnr_ball_handler"),
      skillFormulaTerm(skills, "passer"),
      skillFormulaTerm(skills, "off_dribble_shooter"),
      skillFormulaTerm(skills, "isolation_scorer"),
      compositeFormulaTerm(raw, "spacing", c.shot_creation_spacing),
      compositeFormulaTerm(raw, "paint_touch", c.shot_creation_paint_touch),
    ],
    raw: 0,
    note: "This raw rating combines creation skills with Spacing and Rim Pressure Impact Traits.",
  };
  raw.shot_creation.raw = sumTerms(raw.shot_creation.terms);

  return raw;
}

function CompositeScoreTooltip({
  id,
  label,
  normalized,
  breakdown,
}: {
  id: string;
  label: string;
  normalized: number | null;
  breakdown: RawCompositeBreakdown | null;
}) {
  return (
    <div className="space-y-2">
      <p className="font-semibold text-[#0e0907]">{label}</p>
      {normalized == null ? (
        <p>Raw PlayerPool read. The normalized score appears after this Player is in the live evaluation.</p>
      ) : (
        <p>
          Normalized Impact Trait:{" "}
          <span className="font-mono text-[#0e0907]">{formatScore(normalized)}</span> / 10.
          The raw score is bell-curve normalized against the player pool.
        </p>
      )}
      {breakdown && (
        <>
          <p>
            Raw score: <span className="font-mono text-[#0e0907]">{formatScore(breakdown.raw)}</span>
          </p>
          <div className="space-y-1">
            {breakdown.terms.map((term) => (
              <div key={`${id}-${term.label}`} className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="text-[#0e0907]/80">{term.label}</span>
                  <span className="ml-1 text-[#0e0907]/40">({term.detail})</span>
                </span>
                <span className="shrink-0 font-mono text-[#0e0907]">{formatScore(term.value)}</span>
              </div>
            ))}
          </div>
          {breakdown.note && <p className="border-t border-[#d9d0c9]/70 pt-2 text-[#0e0907]/55">{breakdown.note}</p>}
        </>
      )}
    </div>
  );
}

function ScoreExplainerTooltip({ score }: { score: number | null | undefined }) {
  return (
    <div className="space-y-2">
      <p className="font-semibold text-[#0e0907]">Score</p>
      <p>
        Current live evaluation: <span className="font-mono text-[#0e0907]">{formatScore(score)}</span> / 5.
      </p>
      <p>
        Built from Lineup cohesion, depth, versatility, and floor checks. Higher means the current Build is scoring better as a complete Team, not just stacking individual talent.
      </p>
    </div>
  );
}

function LineupMetricTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="font-semibold text-[#0e0907]">{label}</p>
      <p>{children}</p>
    </div>
  );
}

function scoreTone(value: number): string {
  if (value >= 7) return "bg-[#059669]/10 text-[#047857] border-[#059669]/25";
  if (value >= 4) return "bg-[#d97706]/10 text-[#a34400] border-[#d97706]/25";
  return "bg-[#e53e3e]/10 text-[#b91c1c] border-[#e53e3e]/25";
}

function rawToTenPointScale(key: CompositeKey, raw: number, theoreticalMax: Record<string, number>): number {
  const max = theoreticalMax[key] ?? 10;
  if (max <= 0) return 0;
  return Math.min(10, Math.max(0, (raw / max) * 10));
}

function allImpactTraitEntries(
  evaluation: RosterEvaluation | null,
  player: PlayerWithSkills | null,
  theoreticalMax: Record<string, number>,
): ImpactTraitReadEntry[] {
  const playerName = player?.name.toLowerCase();
  const evaluatedPlayer = playerName
    ? evaluation?.player_composites.find((item) => item.name.toLowerCase() === playerName) ?? null
    : null;
  const rawBreakdowns = computeRawCompositeBreakdowns(player?.skills);

  return COMPOSITE_COLUMNS.map((column) => {
    const key = column.key as CompositeKey;
    const normalizedValue = evaluatedPlayer ? compositeValue(evaluatedPlayer, column.key) : null;
    const rawValue = rawBreakdowns[key]?.raw ?? 0;
    return {
      ...column,
      rawValue,
      normalizedValue,
      affected: false,
      value: normalizedValue ?? rawToTenPointScale(key, rawValue, theoreticalMax),
      valueLabel: normalizedValue == null ? `raw ${formatScore(rawValue)}` : formatScore(normalizedValue),
    };
  });
}

function SectionLabel({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="text-[0.625rem] font-semibold uppercase tracking-[0.18em] text-[#0e0907]/40">
      {children}
    </p>
  );
}

function InlineData({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <span id={id} className={cn("font-mono tabular-nums text-[#0e0907]/65", className)}>
      {children}
    </span>
  );
}

function scoreShapeText(factors: { key: string; label: string; value: number }[]): string {
  if (factors.length === 0) return "Score Shape after eval.";

  const sorted = [...factors].sort((a, b) => b.value - a.value);
  const strongest = sorted[0];
  const weakest = sorted[sorted.length - 1];
  if (!strongest || !weakest) return "Score Shape after eval.";

  if (strongest.value - weakest.value < 0.12) {
    return "Balanced shape. No clear drag.";
  }

  return `${strongest.label} carrying. ${weakest.label} next ceiling.`;
}

function feedbackFragmentText(text: string): string {
  return text
    .replace(/^Lineup-level defensive coverage is a clear strength\.$/, "Defensive coverage strong.")
    .replace(/^Lineup-level spacing support is a clear strength\.$/, "Spacing support strong.")
    .replace(/^No warning note yet\.$/, "No drag yet.");
}

function ScoreFactorTooltip({
  factor,
  isLineupOnly = false,
}: {
  factor: { key: string; label: string; value: number };
  isLineupOnly?: boolean;
}) {
  const factorWeights = isLineupOnly ? LINEUP_ONLY_SCORE_FACTOR_WEIGHTS : SCORE_FACTOR_WEIGHTS;

  return (
    <div className="space-y-2">
      <p className="font-semibold text-[#0e0907]">{factor.label}</p>
      <p>{scoreFactorExplainer(factor.key)}</p>
      <p>
        Rollup weight: <span className="font-mono text-[#0e0907]">{factorWeights[factor.key] ?? "n/a"}</span>.
      </p>
      <p>
        Derived from {SCORE_FACTOR_DERIVATIONS[factor.key] ?? "the cohesion engine"}.
      </p>
      <p>
        Current normalized value:{" "}
        <span className="font-mono text-[#0e0907]">{Math.round(factor.value * 100)}%</span>.
      </p>
    </div>
  );
}

function RotationIdentityStrip({ evaluation }: { evaluation: RosterEvaluation | null }) {
  const compositeAverages = useMemo(() => {
    const players = evaluation?.player_composites ?? [];
    if (players.length === 0) return [];
    return COMPOSITE_COLUMNS.map((column) => {
      const total = players.reduce((sum, player) => sum + compositeValue(player, column.key), 0);
      return {
        ...column,
        value: total / players.length,
      };
    }).sort((a, b) => b.value - a.value).slice(0, 6);
  }, [evaluation]);

  const archetypes = evaluation?.lineup_summary.archetype_labels ?? [];

  return (
    <section id="builder-skill-rotation-identity" className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <SectionLabel id="builder-skill-rotation-identity-label">Build Trait Snapshot</SectionLabel>
          <h3 id="builder-skill-rotation-identity-title" className="mt-1 text-[1rem] font-semibold text-[#0e0907]">
            Build Impact Traits
          </h3>
          <p id="builder-skill-rotation-identity-archetypes" className="mt-0.5 text-[0.75rem] text-[#0e0907]/55">
            Identity tags: <span className="font-medium text-[#0e0907]/70">{archetypes.length > 0 ? archetypes.join(" / ") : "Still forming"}</span>
          </p>
        </div>
        {evaluation && (
          <FeedbackTooltip
            id="builder-skill-rotation-score-tooltip"
            as="div"
            align="right"
            content={<ScoreExplainerTooltip score={evaluation.star_rating} />}
            className="shrink-0"
          >
            <div id="builder-skill-rotation-score" className="border border-[#d9d0c9] bg-[#f0f0f0]/60 px-3 py-2 text-right">
              <p className="text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-[#0e0907]/40">Score</p>
              <p className="font-mono text-[1rem] font-semibold tabular-nums text-[#0e0907]">
                {evaluation.star_rating.toFixed(2)}
              </p>
            </div>
          </FeedbackTooltip>
        )}
      </div>

      {compositeAverages.length > 0 ? (
        <div id="builder-skill-rotation-composites" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {compositeAverages.map((item) => (
            <FeedbackTooltip
              key={item.key}
              id={`builder-skill-rotation-composite-${item.key}-tooltip`}
              as="div"
              content={(
                <LineupMetricTooltip label={item.label}>
                  Average normalized {item.label.toLowerCase()} Impact Trait across the evaluated Players. This is a Build trait snapshot, not the weighted Lineup Subscore used by the engine.
                </LineupMetricTooltip>
              )}
              className="w-full"
            >
              <div id={`builder-skill-rotation-composite-${item.key}`} className="w-full border border-[#d9d0c9]/70 bg-[#f7f7f7] px-3 py-2 transition-colors hover:border-[#ffa05c]/45">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-[0.75rem] font-medium text-[#0e0907]/70">{item.label}</span>
                  <span className="font-mono text-[0.75rem] tabular-nums text-[#0e0907]">{formatScore(item.value)}</span>
                </div>
                <div className="mt-2 h-1.5 bg-[#d9d0c9]/45">
                  <div className="h-full bg-[#ffa05c]" style={{ width: `${Math.min(100, Math.max(0, item.value * 10))}%` }} />
                </div>
              </div>
            </FeedbackTooltip>
          ))}
        </div>
      ) : (
        <p id="builder-skill-rotation-empty" className="border border-dashed border-[#d9d0c9] bg-[#f0f0f0]/55 px-3 py-3 text-[0.8125rem] text-[#0e0907]/55">
          Add Players to form a readable Rotation identity.
        </p>
      )}
    </section>
  );
}

function PlayerContributionInspector({
  evaluation,
  player,
  theoreticalMax,
}: {
  evaluation: RosterEvaluation | null;
  player: PlayerWithSkills | null;
  theoreticalMax: Record<string, number>;
}) {
  const composite = useMemo(() => {
    if (!evaluation || !player) return null;
    const playerName = player.name.toLowerCase();
    return evaluation.player_composites.find((item) => item.name.toLowerCase() === playerName) ?? null;
  }, [evaluation, player]);

  const rawBreakdowns = useMemo(() => computeRawCompositeBreakdowns(player?.skills), [player?.skills]);
  const ranked = useMemo(() => {
    return COMPOSITE_COLUMNS.map((column) => {
      const key = column.key as CompositeKey;
      const rawValue = rawBreakdowns[key]?.raw ?? 0;
      const normalizedValue = composite ? compositeValue(composite, column.key) : null;
      return {
        ...column,
        rawValue,
        normalizedValue,
        value: normalizedValue ?? rawToTenPointScale(key, rawValue, theoreticalMax),
      };
    }).sort((a, b) => b.value - a.value);
  }, [composite, rawBreakdowns, theoreticalMax]);

  const top = ranked.slice(0, 4);
  const gaps = ranked.slice(-4).reverse();

  return (
    <section id="builder-skill-player-contribution" className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <SectionLabel id="builder-skill-player-contribution-label">Player Contribution</SectionLabel>
          <h3 id="builder-skill-player-contribution-title" className="mt-1 truncate text-[1rem] font-semibold text-[#0e0907]">
            {player ? player.name : "Hover Player or click slot"}
          </h3>
        </div>
        {player?.position && (
          <span id="builder-skill-player-position" className="border border-[#d9d0c9]/70 bg-[#f0f0f0]/60 px-2 py-1 text-[0.6875rem] font-medium text-[#0e0907]/55">
            {player.position}
          </span>
        )}
      </div>

      {!player && (
        <p id="builder-skill-player-empty" className="border border-dashed border-[#d9d0c9] bg-[#f0f0f0]/55 px-3 py-3 text-[0.8125rem] text-[#0e0907]/55">
          Hover a Player in the PlayerPool or click a Rotation slot to inspect identity impact.
        </p>
      )}

      {player && !composite && (
        <p id="builder-skill-player-raw-mode" className="border border-[#d9d0c9]/60 bg-[#f0f0f0]/55 px-3 py-2 text-[0.75rem] text-[#0e0907]/55">
          Showing raw PlayerPool formulas. Normalized Impact Traits appear after this Player enters the live eval.
        </p>
      )}

      {player && ranked.length > 0 && (
        <div id="builder-skill-player-impact-grid" className="grid gap-3 xl:grid-cols-2">
          <div id="builder-skill-player-adds" className="space-y-2">
            <p className="text-[0.75rem] font-semibold text-[#0e0907]">Changes identity through</p>
            <div className="grid gap-2">
              {top.map((item) => (
                <FeedbackTooltip
                  key={item.key}
                  id={`builder-skill-player-adds-${item.key}-tooltip`}
                  as="div"
                  content={(
                    <CompositeScoreTooltip
                      id={`builder-skill-player-adds-${item.key}`}
                      label={item.label}
                      normalized={item.normalizedValue}
                      breakdown={rawBreakdowns[item.key as CompositeKey] ?? null}
                    />
                  )}
                  className="w-full"
                >
                  <div id={`builder-skill-player-adds-${item.key}`} className={cn("flex w-full items-center justify-between border px-3 py-2 transition-colors hover:border-[#ffa05c]/60", scoreTone(item.value))}>
                    <span className="truncate text-[0.75rem] font-medium">{item.label}</span>
                    <span className="font-mono text-[0.75rem] tabular-nums">
                      {item.normalizedValue == null ? `raw ${formatScore(item.rawValue)}` : formatScore(item.normalizedValue)}
                    </span>
                  </div>
                </FeedbackTooltip>
              ))}
            </div>
          </div>
          <div id="builder-skill-player-gaps" className="space-y-2">
            <p className="text-[0.75rem] font-semibold text-[#0e0907]">Does not cover</p>
            <div className="grid gap-2">
              {gaps.map((item) => (
                <FeedbackTooltip
                  key={item.key}
                  id={`builder-skill-player-gap-${item.key}-tooltip`}
                  as="div"
                  content={(
                    <CompositeScoreTooltip
                      id={`builder-skill-player-gap-${item.key}`}
                      label={item.label}
                      normalized={item.normalizedValue}
                      breakdown={rawBreakdowns[item.key as CompositeKey] ?? null}
                    />
                  )}
                  className="w-full"
                >
                  <div id={`builder-skill-player-gap-${item.key}`} className={cn("flex w-full items-center justify-between border px-3 py-2 transition-colors hover:border-[#ffa05c]/60", scoreTone(item.value))}>
                    <span className="truncate text-[0.75rem] font-medium">{item.label}</span>
                    <span className="font-mono text-[0.75rem] tabular-nums">
                      {item.normalizedValue == null ? `raw ${formatScore(item.rawValue)}` : formatScore(item.normalizedValue)}
                    </span>
                  </div>
                </FeedbackTooltip>
              ))}
            </div>
          </div>
          <div id="builder-skill-player-formula-index" className="space-y-2 xl:col-span-2">
            <p className="text-[0.75rem] font-semibold text-[#0e0907]">Impact Trait formulas</p>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {COMPOSITE_COLUMNS.map((column) => {
                const key = column.key as CompositeKey;
                const normalizedValue = composite ? compositeValue(composite, column.key) : null;
                const rawValue = rawBreakdowns[key]?.raw ?? 0;
                const toneValue = normalizedValue ?? rawToTenPointScale(key, rawValue, theoreticalMax);

                return (
                  <FeedbackTooltip
                    key={column.key}
                    id={`builder-skill-player-formula-${column.key}-tooltip`}
                    as="div"
                    content={(
                      <CompositeScoreTooltip
                        id={`builder-skill-player-formula-${column.key}`}
                        label={column.label}
                        normalized={normalizedValue}
                        breakdown={rawBreakdowns[key] ?? null}
                      />
                    )}
                    className="w-full"
                  >
                    <div id={`builder-skill-player-formula-${column.key}`} className={cn("flex w-full items-center justify-between border px-2.5 py-1.5 transition-colors hover:border-[#ffa05c]/60", scoreTone(toneValue))}>
                      <span className="truncate text-[0.6875rem] font-medium">{column.label}</span>
                      <span className="font-mono text-[0.6875rem] tabular-nums">
                        {normalizedValue == null ? `raw ${formatScore(rawValue)}` : formatScore(normalizedValue)}
                      </span>
                    </div>
                  </FeedbackTooltip>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function LineupImpactSummary({ evaluation, isLineupOnly = false }: { evaluation: RosterEvaluation | null; isLineupOnly?: boolean }) {
  const LINEUP_FACTOR_KEYS = new Set(["starting_5", "archetype_diversity"]);
  const LINEUP_LABELS: Record<string, string> = { starting_5: "Lineup Strength", archetype_diversity: "Versatility" };
  const breakdown = evaluation
    ? Object.entries(evaluation.star_rating_breakdown)
      .filter(([key]) => !isLineupOnly || LINEUP_FACTOR_KEYS.has(key))
      .map(([key, value]) => ({
        key,
        label: isLineupOnly ? (LINEUP_LABELS[key] ?? scoreFactorLabel(key)) : scoreFactorLabel(key),
        value,
      }))
    : [];

  return (
    <section id="builder-skill-lineup-impact" className="space-y-3">
      <SectionLabel id="builder-skill-lineup-impact-label">Lineup Impact</SectionLabel>
      {evaluation ? (
        <>
          <div id="builder-skill-lineup-summary" className={cn("grid gap-2", isLineupOnly ? "sm:grid-cols-1" : "sm:grid-cols-3")}>
            <FeedbackTooltip
              id="builder-skill-lineup-starting-tooltip"
              as="div"
              content={(
                <LineupMetricTooltip label={isLineupOnly ? "Lineup Strength" : "Starting Lineup"}>
                  {isLineupOnly
                    ? "Cohesion score for this starting five."
                    : "Cohesion score for slots 1 through 5. It reflects how the starting group fits across spacing, creation, defense, rebounding, and synergy checks."}
                </LineupMetricTooltip>
              )}
              className="w-full"
            >
              <div className="w-full border border-[#d9d0c9]/70 bg-[#f7f7f7] px-3 py-2 transition-colors hover:border-[#ffa05c]/45">
                <p className="text-[0.625rem] font-medium uppercase tracking-[0.14em] text-[#0e0907]/35">{isLineupOnly ? "Lineup Strength" : "Starting Lineup"}</p>
                <p className="mt-1 font-mono text-[0.8125rem] tabular-nums text-[#0e0907]">{evaluation.starting_lineup.cohesion_score.toFixed(2)}</p>
              </div>
            </FeedbackTooltip>
            {!isLineupOnly && (
              <>
                <FeedbackTooltip
                  id="builder-skill-lineup-viable-tooltip"
                  as="div"
                  content={(
                    <LineupMetricTooltip label="Viable Combos">
                      Number of evaluated lineup combinations above the engine&apos;s viability floor. A high count means the build can survive substitutions.
                    </LineupMetricTooltip>
                  )}
                  className="w-full"
                >
                  <div className="w-full border border-[#d9d0c9]/70 bg-[#f7f7f7] px-3 py-2 transition-colors hover:border-[#ffa05c]/45">
                    <p className="text-[0.625rem] font-medium uppercase tracking-[0.14em] text-[#0e0907]/35">Viable Combos</p>
                    <p className="mt-1 font-mono text-[0.8125rem] tabular-nums text-[#0e0907]">
                      {evaluation.lineup_summary.viable_lineups}/{evaluation.lineup_summary.total_lineups}
                    </p>
                  </div>
                </FeedbackTooltip>
                <FeedbackTooltip
                  id="builder-skill-lineup-median-tooltip"
                  as="div"
                  align="right"
                  content={(
                    <LineupMetricTooltip label="Median">
                      Middle evaluated lineup score. It shows the typical substitution quality, not the best or worst group.
                    </LineupMetricTooltip>
                  )}
                  className="w-full"
                >
                  <div className="w-full border border-[#d9d0c9]/70 bg-[#f7f7f7] px-3 py-2 transition-colors hover:border-[#ffa05c]/45">
                    <p className="text-[0.625rem] font-medium uppercase tracking-[0.14em] text-[#0e0907]/35">Median</p>
                    <p className="mt-1 font-mono text-[0.8125rem] tabular-nums text-[#0e0907]">{evaluation.lineup_summary.median_score.toFixed(2)}</p>
                  </div>
                </FeedbackTooltip>
              </>
            )}
          </div>
          <div id="builder-skill-lineup-breakdown" className="grid gap-2 sm:grid-cols-2">
            {breakdown.map((item) => (
              <FeedbackTooltip
                key={item.key}
                id={`builder-skill-lineup-breakdown-${item.key}-tooltip`}
                as="div"
                content={(
                  <LineupMetricTooltip label={item.label}>
                    Contribution factor inside the final score. The engine combines these factors so a weakness can drag down an otherwise strong build.
                  </LineupMetricTooltip>
                )}
                className="w-full"
              >
                <div id={`builder-skill-lineup-breakdown-${item.key}`} className="w-full border border-[#d9d0c9]/60 bg-[#f0f0f0]/40 px-3 py-2 transition-colors hover:border-[#ffa05c]/45">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[0.75rem] text-[#0e0907]/65">{item.label}</span>
                    <span className="font-mono text-[0.75rem] tabular-nums text-[#0e0907]">{Math.round(item.value * 100)}%</span>
                  </div>
                </div>
              </FeedbackTooltip>
            ))}
          </div>
        </>
      ) : (
        <p id="builder-skill-lineup-empty" className="border border-dashed border-[#d9d0c9] bg-[#f0f0f0]/55 px-3 py-3 text-[0.8125rem] text-[#0e0907]/55">
          Lineup impact appears after live eval.
        </p>
      )}
    </section>
  );
}

/** Flash + pulse past this delta; below it, flash only (delta-scaled emphasis). */
const SCORE_PULSE_THRESHOLD = 0.25;
const SCORE_MIN_DELTA = 0.005;

/**
 * #88: the star caption rolls between consecutive engine scores with a signed
 * delta chip and a delta-scaled flash. First eval rolls up from 0 (full
 * treatment); later tweaks use shorter rolls. Reduced motion snaps instantly.
 */
function AnimatedScoreCaption({ score }: { score: number }) {
  const [target, setTarget] = useState(0);
  const prevScoreRef = useRef<number | null>(null);
  const [delta, setDelta] = useState<{ value: number; seq: number } | null>(null);

  useEffect(() => {
    const prev = prevScoreRef.current;
    prevScoreRef.current = score;
    setTarget(score);
    if (prev == null || Math.abs(score - prev) < SCORE_MIN_DELTA) return;
    setDelta((current) => ({ value: score - prev, seq: (current?.seq ?? 0) + 1 }));
  }, [score]);

  const magnitude = Math.abs(delta?.value ?? 0);
  // Delta-scaled roll length, capped under Nielsen's ~1s flow limit.
  const rollMs = delta == null ? 800 : Math.min(900, 300 + magnitude * 1200);
  const displayed = useTweenedNumber(target, rollMs) ?? score;
  const isGain = (delta?.value ?? 0) > 0;

  return (
    <div id="builder-new-feedback-score-caption" className="mt-2 flex items-center justify-center gap-2">
      <div
        key={delta?.seq ?? 0}
        className={cn(
          "rounded-sm",
          delta && (magnitude >= SCORE_PULSE_THRESHOLD ? "eval-flash-pulse" : "eval-flash"),
        )}
        style={{
          "--flash-color": isGain ? "rgba(5, 150, 105, 0.22)" : "rgba(229, 62, 62, 0.18)",
        } as CSSProperties}
      >
        <CohesionScoreBadge
          id="builder-new-feedback-score"
          value={displayed}
          precision={2}
          featured
          ariaLabel={`Team Cohesion score: ${score.toFixed(2)} out of 5`}
        />
      </div>
      {/* Always mounted so the live region announces the first delta too. */}
      <span
        id="builder-new-feedback-score-delta"
        aria-live="polite"
        className={cn(
          "font-mono text-[0.8125rem] font-semibold tabular-nums",
          isGain ? "text-[#047857]" : "text-[#b91c1c]",
          !delta && "invisible",
        )}
      >
        {delta ? `${isGain ? "+" : ""}${delta.value.toFixed(2)}` : ""}
      </span>
    </div>
  );
}

function NewFeedbackRead({
  allSlots,
  latestEval,
  isEvaluating,
  inspectedPlayer,
  inspectionSource,
  isLineupOnly = false,
  theoreticalMax,
  lineupEffectsByImpactTrait,
  onSuggestionFilter,
}: Pick<BuilderFeedbackPanelProps, "allSlots" | "latestEval" | "isEvaluating" | "inspectedPlayer" | "inspectionSource" | "onSuggestionFilter"> & {
  isLineupOnly?: boolean;
  theoreticalMax: Record<string, number>;
  lineupEffectsByImpactTrait: Record<string, string[]>;
}) {
  const [selectedSkillKey, setSelectedSkillKey] = useState<string | null>(null);
  const targetPlayer = inspectedPlayer;
  const isPlayerRead = targetPlayer !== null;
  const isBuildPlayerRead = inspectionSource === "build-player" && targetPlayer !== null;
  const skills = buildSkillTraceEntries(targetPlayer?.skills);
  const selectedSkill = skills.find((skill) => skill.skill === selectedSkillKey) ?? null;
  const affectedTraitKeys = new Set(getImpactTraitKeysForSkill(selectedSkill?.skill));
  const affectedLineupEffectKeys = new Set(
    Array.from(affectedTraitKeys).flatMap((traitKey) => lineupEffectsByImpactTrait[traitKey] ?? []),
  );
  const traits = allImpactTraitEntries(latestEval, targetPlayer, theoreticalMax).map((trait) => ({
    ...trait,
    affected: affectedTraitKeys.has(trait.key as CompositeKey),
  }));
  const displayedTraits = rankImpactTraitEntries(traits, {
    includeZero: true,
  });
  const playerAdds = rankImpactTraitEntries(traits, { limit: 3 });
  const reach = getLineupReach(allSlots, targetPlayer);
  const playerLineupRead = getPlayerLineupRead(latestEval, targetPlayer, {
    startingWorksLabel: "Starting Fit",
    bestWorksLabel: "Lineup Works Through",
    medianWorksLabel: "Typical Fit",
    addsLabel: "Player Adds Here",
    medianAddsLabel: "Player Still Adds",
  });
  const rotationLineupRead = getRotationLineupRead(latestEval);
  const normalizedNotes = useMemo(
    () => normalizeCohesionNotes(latestEval?.notes ?? []),
    [latestEval?.notes],
  );
  const suggestions = normalizedNotes.filter((note) => note.severity === "suggestion").slice(0, 3);
  const strengths = normalizedNotes.filter((note) => note.severity === "strength").slice(0, 2);
  const warnings = normalizedNotes.filter((note) => note.severity === "warning").slice(0, 2);
  // Starters only — a filled bench can't stand in for an incomplete starting five.
  const filledCount = allSlots.slice(0, 5).filter(Boolean).length;
  const LINEUP_ONLY_FACTOR_KEYS = new Set(["starting_5", "archetype_diversity"]);
  const LINEUP_ONLY_LABELS: Record<string, string> = {
    starting_5: "Lineup Strength",
    archetype_diversity: "Versatility",
  };
  const scoreFactors = latestEval
    ? Object.entries(latestEval.star_rating_breakdown)
      .filter(([key]) => !isLineupOnly || LINEUP_ONLY_FACTOR_KEYS.has(key))
      .map(([key, value]) => ({
        key,
        label: isLineupOnly ? (LINEUP_ONLY_LABELS[key] ?? scoreFactorLabel(key)) : scoreFactorLabel(key),
        value,
      }))
      .sort((a, b) => b.value - a.value)
    : [];
  const scoreShape = scoreShapeText(scoreFactors);
  const reachLabel = isPlayerRead ? "Lineup Reach" : "Rotation Reach";
  const reachCopy = isPlayerRead
      ? "Player presence across viable Lineup Combinations."
      : "Lineup Combination spread. Viability. Typical fit.";
  const reachValue = isPlayerRead
      ? `${playerLineupRead?.count ?? 0}/${playerLineupRead?.viableTotal ?? 0}`
      : `${rotationLineupRead?.viable ?? 0}/${rotationLineupRead?.total ?? 0}`;
  const reachValueLabel = isPlayerRead ? "viable" : "viable";
  const reachQualityValue = isPlayerRead
      ? playerLineupRead && playerLineupRead.viableTotal > 0 ? playerLineupRead.count / playerLineupRead.viableTotal : 0
      : rotationLineupRead && rotationLineupRead.total > 0 ? rotationLineupRead.viable / rotationLineupRead.total : 0;
  const reachQualityKind = "lineupViability";
  const reachStatus = !isPlayerRead && rotationLineupRead
      ? (
        <>
          <InlineData id="builder-new-feedback-lineup-reach-total-count">{rotationLineupRead.total}</InlineData> Lineup Combinations.{" "}
          <InlineData id="builder-new-feedback-lineup-reach-viable-count" className={qualityTextColor(rotationLineupRead.total > 0 ? rotationLineupRead.viable / rotationLineupRead.total : 0, "lineupViability")}>{rotationLineupRead.viable}</InlineData> viable. Median{" "}
          <InlineData id="builder-new-feedback-lineup-reach-median-score" className={qualityTextColor((rotationLineupRead.medianScore ?? 0) / 5, "ratio")}>{rotationLineupRead.medianScore.toFixed(2)}</InlineData>.
        </>
      )
      : !isPlayerRead
        ? "Need 5 Players before Lineup Combinations exist."
        : reach.filledCount < 5
          ? (
            <>
              Need <InlineData id="builder-new-feedback-lineup-reach-needed-count">{Math.max(0, 5 - reach.filledCount)}</InlineData> more Player{5 - reach.filledCount === 1 ? "" : "s"} before Lineup Combinations exist.
            </>
          )
          : playerLineupRead
            ? playerLineupRead.viableTotal > 0
              ? (
                <>
                  {targetPlayer?.name ?? "This Player"} in{" "}
                  <InlineData id="builder-new-feedback-lineup-reach-player-viable-count" className={qualityTextColor(playerLineupRead.count / playerLineupRead.viableTotal, "lineupViability")}>{playerLineupRead.count}</InlineData> of{" "}
                  <InlineData id="builder-new-feedback-lineup-reach-viable-total">{playerLineupRead.viableTotal}</InlineData> viable Lineup Combinations.{" "}
                  <InlineData id="builder-new-feedback-lineup-reach-player-total-count">{playerLineupRead.allCount}</InlineData> of{" "}
                  <InlineData id="builder-new-feedback-lineup-reach-total-count">{playerLineupRead.total}</InlineData> total.
                </>
              )
              : (
                <>
                  No viable Lineup Combinations yet. {targetPlayer?.name ?? "This Player"} appears in{" "}
                  <InlineData id="builder-new-feedback-lineup-reach-player-total-count">{playerLineupRead.allCount}</InlineData> of{" "}
                  <InlineData id="builder-new-feedback-lineup-reach-total-count">{playerLineupRead.total}</InlineData> total.
                </>
              )
            : reach.isInSelection
              ? (
                <>
                  Waiting on live eval. {targetPlayer?.name ?? "This Player"} appears in{" "}
                  <InlineData id="builder-new-feedback-lineup-reach-calculated-player-count">{reach.playerLineups}</InlineData> of{" "}
                  <InlineData id="builder-new-feedback-lineup-reach-calculated-total">{reach.totalLineups}</InlineData> possible Lineup Combinations.
                </>
              )
              : `${targetPlayer?.name ?? "This Player"} not in Build yet.`;
  const lineupReachContexts = isPlayerRead ? playerLineupRead?.contexts ?? [] : rotationLineupRead?.contexts ?? [];

  return (
    <div id="builder-new-feedback-read" className="space-y-4">
      <section
        id="builder-new-feedback-current-read"
        className="border border-[#d9d0c9] bg-[#f0f0f0]/55 px-3 py-3"
      >
        <div className="min-w-0">
          <SectionLabel id="builder-new-feedback-current-read-label">Feedback Read</SectionLabel>
          <h3 id="builder-new-feedback-current-read-title" className="mt-1 text-[1rem] font-semibold text-[#0e0907]">
            Team Shape
          </h3>
          {isBuildPlayerRead && (
            <p id="builder-new-feedback-current-read-focus" className="mt-1 text-[0.75rem] leading-snug text-[#0e0907]/55">
              Focus: <span className="font-medium text-[#0e0907]/70">{targetPlayer.name}</span>
            </p>
          )}
        </div>

        <div id="builder-new-feedback-shape" className="mt-2">
          <TeamShapeGlyph
            subscores={latestEval?.starting_lineup.subscores ?? null}
            medianSubscores={latestEval?.lineup_summary.rotation_median_subscores ?? null}
            viableLineups={latestEval?.lineup_summary.viable_lineups}
            totalLineups={latestEval?.lineup_summary.total_lineups}
            filledCount={filledCount}
            isRecomputing={isEvaluating}
            isLineupOnly={isLineupOnly}
            affectedKeys={affectedLineupEffectKeys}
          />
        </div>

        {latestEval && <AnimatedScoreCaption score={latestEval.star_rating} />}
      </section>

      <FeedbackNotesSection
        suggestions={suggestions}
        strengths={strengths}
        warnings={warnings}
        isBuildPlayerRead={isBuildPlayerRead}
        onSuggestionFilter={onSuggestionFilter}
      />

      <section id="builder-new-feedback-score-factors" className="border border-[#d9d0c9]/70 bg-[#f7f7f7] px-3 py-3">
        <SectionLabel id="builder-new-feedback-score-factors-label">Score Factors</SectionLabel>
        {scoreFactors.length > 0 ? (
          <>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {scoreFactors.map((factor) => (
                <FeedbackTooltip
                  key={factor.key}
                  id={`builder-new-feedback-score-factor-${factor.key}-tooltip`}
                  as="div"
                  content={<ScoreFactorTooltip factor={factor} isLineupOnly={isLineupOnly} />}
                  className="w-full"
                >
                  <div id={`builder-new-feedback-score-factor-${factor.key}`} className="flex w-full items-center justify-between gap-3 border border-[#d9d0c9]/55 bg-[#f0f0f0]/45 px-2.5 py-1.5 transition-colors hover:border-[#ffa05c]/45">
                    <span className="truncate text-[0.75rem] text-[#0e0907]/65">{factor.label}</span>
                    <span className={cn("font-mono text-[0.6875rem] font-semibold tabular-nums", qualityTextColor(factor.value, "scoreFactor"))}>{Math.round(factor.value * 100)}%</span>
                  </div>
                </FeedbackTooltip>
              ))}
            </div>
            <p id="builder-new-feedback-score-shape" className="mt-2 text-[0.75rem] leading-snug text-[#0e0907]/50">
              {scoreShape}
            </p>
          </>
        ) : (
          <p id="builder-new-feedback-score-factors-empty" className="mt-2 text-[0.8125rem] text-[#0e0907]/50">
            Score factors appear after live eval.
          </p>
        )}
      </section>

      {isPlayerRead && (
        <section id="builder-new-feedback-player-contribution" className="space-y-3">
          <div id="builder-new-feedback-player-contribution-header">
            <SectionLabel id="builder-new-feedback-player-contribution-label">Player Contribution</SectionLabel>
            <h3 id="builder-new-feedback-player-contribution-title" className="mt-1 text-[0.9375rem] font-semibold text-[#0e0907]">
              {targetPlayer.name} Contribution
            </h3>
            <p id="builder-new-feedback-player-contribution-copy" className="mt-1 text-[0.75rem] leading-snug text-[#0e0907]/50">
              Skill Profile and Impact Traits for the selected Player.
            </p>
          </div>
          <div id="builder-new-feedback-player-ladder" className="grid gap-3 xl:grid-cols-2">
            <SkillProfileTrace
              idBase="builder-new-feedback-skills"
              skills={skills}
              selectedSkillKey={selectedSkillKey}
              onSelectSkill={setSelectedSkillKey}
              affectedTraitKeys={Array.from(affectedTraitKeys)}
              traceVerb="feeds"
              emptyText="Select a Player in the Build to see the Skills that feed this read."
              scroll
              renderSkillTooltip={(skill, trigger) => (
                  <FeedbackTooltip
                    key={skill.skill}
                    id={`builder-new-feedback-skill-${skill.skill}-tooltip`}
                    as="div"
                    content={(
                      <LineupMetricTooltip label={skill.label}>
                        {SKILL_DESCRIPTIONS[skill.skill] ?? "Skill definition not written yet."}
                      </LineupMetricTooltip>
                    )}
                    className="w-full"
                  >
                    {trigger}
                  </FeedbackTooltip>
              )}
            />

            <ImpactTraitList
              idBase="builder-new-feedback-impact-traits"
              label="Impact Traits"
              traits={displayedTraits}
              emptyText="Impact Traits appear once a Player has Skill Profile data."
              scroll
              renderTraitTooltip={(trait, trigger) => (
                  <FeedbackTooltip
                    key={trait.key}
                    id={`builder-new-feedback-impact-trait-${trait.key}-tooltip`}
                    as="div"
                    content={(
                      <LineupMetricTooltip label={trait.label}>
                        {IMPACT_TRAIT_DESCRIPTIONS[trait.key] ?? "Impact Trait description not written yet."}
                      </LineupMetricTooltip>
                    )}
                    className="w-full"
                  >
                    {trigger}
                  </FeedbackTooltip>
              )}
            />
          </div>
        </section>
      )}

      {!isLineupOnly && (
        <LineupReachSection
          idBase="builder-new-feedback-lineup-reach"
          label={reachLabel}
          copy={reachCopy}
          status={reachStatus}
          metric={{ value: reachValue, label: reachValueLabel, qualityValue: reachQualityValue, qualityKind: reachQualityKind }}
          contexts={lineupReachContexts}
          playerAdds={isPlayerRead ? playerAdds : []}
          renderContextTooltip={(context: LineupReadContext, trigger) => (
            <FeedbackTooltip
              id={`builder-new-feedback-lineup-reach-${context.id}-tooltip`}
              as="div"
              content={(
                <LineupMetricTooltip label={context.label}>
                  {context.helper ?? "Lineup Combination context for this read."}
                </LineupMetricTooltip>
              )}
              className="w-full"
            >
              {trigger}
            </FeedbackTooltip>
          )}
        />
      )}

    </div>
  );
}

function FeedbackNotesSection({
  suggestions,
  strengths,
  warnings,
  isBuildPlayerRead,
  onSuggestionFilter,
}: {
  suggestions: Note[];
  strengths: Note[];
  warnings: Note[];
  isBuildPlayerRead: boolean;
  onSuggestionFilter: (filter: SuggestionFilter, note: Note) => void;
}) {
  const showContext = strengths.length > 0 || warnings.length > 0 || isBuildPlayerRead;

  return (
    <section id="builder-new-feedback-primary-notes" className="border border-[#d9d0c9]/70 bg-[#f7f7f7] px-3 py-3">
      <SectionLabel id="builder-new-feedback-primary-notes-label">Build Notes</SectionLabel>
      <div className="mt-2 grid gap-3 2xl:grid-cols-[1.15fr_1fr]">
        <div id="builder-new-feedback-next-search" className="border border-[#d97706]/25 bg-[#d97706]/10 px-3 py-3">
          <SectionLabel id="builder-new-feedback-next-search-label">Next Search</SectionLabel>
          <div className="mt-2 space-y-2">
            {suggestions.length > 0 ? suggestions.map((note) => {
              const filter = mapNoteToFilter(note);
              return (
                <button
                  key={note.trace_key}
                  id={`builder-new-feedback-suggestion-${note.trace_key}`}
                  type="button"
                  disabled={!filter}
                  onClick={() => filter && onSuggestionFilter(filter, note)}
                  className="flex w-full items-start justify-between gap-3 border border-[#d97706]/25 bg-[#f7f7f7]/65 px-2.5 py-2 text-left text-[0.75rem] text-[#a34400] transition-colors enabled:hover:border-[#ffa05c]/60 enabled:hover:bg-[#ffa05c]/15 disabled:cursor-default disabled:opacity-70"
                >
                  <span>{note.text}</span>
                  <span className="shrink-0 font-mono text-[0.625rem] uppercase tracking-[0.14em]">Filter</span>
                </button>
              );
            }) : (
              <p id="builder-new-feedback-next-search-empty" className="text-[0.8125rem] text-[#0e0907]/50">
                Suggestions appear once the engine finds a pressure point.
              </p>
            )}
          </div>
        </div>

        {showContext && (
          <div id="builder-new-feedback-note-context" className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-1">
            <div id="builder-new-feedback-strengths" className="border border-[#059669]/20 bg-[#059669]/5 px-3 py-3">
              <SectionLabel id="builder-new-feedback-strengths-label">What Holds</SectionLabel>
              <div className="mt-2 space-y-1.5">
                {strengths.length > 0 ? strengths.map((note) => (
                  <p key={note.trace_key} className="text-[0.75rem] leading-snug text-[#047857]">{feedbackFragmentText(note.text)}</p>
                )) : (
                  <p className="text-[0.75rem] text-[#0e0907]/50">No clear hold yet.</p>
                )}
              </div>
            </div>
            <div id="builder-new-feedback-warnings" className="border border-[#e53e3e]/20 bg-[#e53e3e]/5 px-3 py-3">
              <SectionLabel id="builder-new-feedback-warnings-label">What Drags</SectionLabel>
              <div className="mt-2 space-y-1.5">
                {warnings.length > 0 ? warnings.map((note) => (
                  <p key={note.trace_key} className="text-[0.75rem] leading-snug text-[#b91c1c]">{feedbackFragmentText(note.text)}</p>
                )) : (
                  <p className="text-[0.75rem] text-[#0e0907]/50">No drag yet.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function SkillProfileDiagnostic({
  allSlots,
  cornerstoneId,
  legendDetail,
  latestEval,
  inspectedPlayer,
  theoreticalMax,
  isLineupOnly = false,
}: Pick<BuilderFeedbackPanelProps, "allSlots" | "cornerstoneId" | "legendDetail" | "latestEval" | "inspectedPlayer"> & {
  theoreticalMax: Record<string, number>;
  isLineupOnly?: boolean;
}) {
  return (
    <div id="builder-skill-profile-diagnostic" className="space-y-5">
      <section id="builder-skill-profile-purpose" className="border border-[#d9d0c9]/70 bg-[#f0f0f0]/45 px-3 py-3">
        <SectionLabel id="builder-skill-profile-purpose-label">Skill Profile Matrix</SectionLabel>
        <p id="builder-skill-profile-purpose-copy" className="mt-2 text-[0.8125rem] leading-snug text-[#0e0907]/55">
          Audit every Player Skill Profile in the current Build. Use this tab for full coverage checks, not the primary contribution read.
        </p>
      </section>
      <RotationIdentityStrip evaluation={latestEval} />
      <PlayerContributionInspector evaluation={latestEval} player={inspectedPlayer} theoreticalMax={theoreticalMax} />
      <LineupImpactSummary evaluation={latestEval} isLineupOnly={isLineupOnly} />
      <section id="builder-skill-profile-matrix" className="space-y-3">
        <SectionLabel id="builder-skill-profile-matrix-label">Full Skill Profile</SectionLabel>
        <div className="h-[360px] overflow-hidden border border-[#d9d0c9]/70 bg-[#f7f7f7]">
          <SkillGrid
            allSlots={allSlots}
            cornerstoneId={cornerstoneId}
            legendProfile={legendDetail?.profile ?? null}
            hideEmptyColumns
          />
        </div>
      </section>
    </div>
  );
}

export function BuilderFeedbackPanel({
  allSlots,
  cornerstoneId,
  legendDetail,
  isAdmin,
  collapsed,
  hasUnreadFeedback,
  latestEval,
  isEvaluating,
  maxRosterSlots,
  inspectedPlayer,
  inspectionSource,
  onClearPlayerFocus,
  onCollapse,
  onExpand,
  onSuggestionFilter,
}: BuilderFeedbackPanelProps) {
  const isLineupOnly = (maxRosterSlots ?? 9) <= 5;
  const [activeTab, setActiveTab] = useState<FeedbackTab>("feedback");
  const [evaluationPayload, setEvaluationPayload] = useState<EvaluationVersionPayload | null>(null);
  const tabs: { id: FeedbackTab; label: string; adminOnly?: boolean }[] = [
    { id: "feedback", label: "Feedback" },
    { id: "skills", label: "Skill Matrix" },
    { id: "debug", label: "Debug", adminOnly: true },
  ];

  const visibleTabs = tabs.filter((tab) => !tab.adminOnly || isAdmin);
  const theoreticalMax = useMemo(
    () => theoreticalMaxFromEvaluationValues(evaluationPayload?.values),
    [evaluationPayload],
  );
  const lineupEffectsByImpactTrait = useMemo(
    () => deriveLineupEffectsByImpactTrait(evaluationPayload?.taxonomy.subscore_tree),
    [evaluationPayload],
  );

  useEffect(() => {
    let active = true;
    getActiveEvaluationVersion().then((res) => {
      if (active && res.success && res.data) {
        setEvaluationPayload(res.data.payload);
      }
    }).catch(() => {
      // Builder feedback can still render normalized evaluation data if Version lookup fails.
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div id="builder-feedback-panel" className="flex min-w-0 flex-col lg:h-full">
      {collapsed && (
        <button
          id="builder-notes-collapsed"
          type="button"
          onClick={onExpand}
          title="Expand Feedback"
          aria-label={hasUnreadFeedback ? "Expand Feedback, new feedback available" : "Expand Feedback"}
          className={cn(
            "flex min-h-12 w-full flex-shrink-0 items-center justify-center gap-2 border transition-colors hover:bg-[#0e0907]/[0.02] lg:h-full lg:w-10 lg:flex-col",
            hasUnreadFeedback
              ? "border-[#ffa05c] bg-[#ffa05c]/10 ring-1 ring-[#ffa05c]/45"
              : "border-[#d9d0c9] bg-[#f7f7f7]",
          )}
        >
          <div
            id="builder-feedback-collapsed-dot"
            className={cn(
              "h-3 w-3 rounded-full transition-colors",
              hasUnreadFeedback ? "animate-pulse bg-[#ffa05c]" : "bg-[#d9d0c9]",
            )}
          />
          <span className="text-[0.5625rem] font-medium uppercase tracking-wider text-[#0e0907]/35 lg:[writing-mode:vertical-lr]">
            Feedback
          </span>
        </button>
      )}
      <div
        id="builder-feedback-expanded-panel"
        className={cn(
          "flex min-w-0 flex-col overflow-visible border border-[#d9d0c9] bg-[#f7f7f7] lg:h-full lg:overflow-hidden",
          collapsed && "hidden",
        )}
      >
      <div id="builder-feedback-header" className="flex shrink-0 items-center justify-between gap-3 border-b border-[#d9d0c9] bg-[#f0f0f0]/55 px-3 py-2">
        <div className="min-w-0">
          <div id="builder-feedback-tabs" className="flex items-center gap-1">
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                id={`builder-feedback-tab-${tab.id}`}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "px-2.5 py-1.5 text-[0.8125rem] font-medium transition-colors",
                  activeTab === tab.id
                    ? "bg-[#0e0907] text-[#f8f3f1]"
                    : "text-[#0e0907]/50 hover:bg-[#0e0907]/[0.04] hover:text-[#0e0907]/75",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {inspectionSource === "build-player" && inspectedPlayer && (
            <p id="builder-feedback-focus-label" className="mt-1 truncate text-[0.6875rem] text-[#0e0907]/45">
              Focus: <span className="text-[#0e0907]/60">{inspectedPlayer.name}</span>
              <button
                id="builder-feedback-clear-focus"
                type="button"
                onClick={onClearPlayerFocus}
                className="ml-2 font-medium text-[#a34400] hover:text-[#fe6d34]"
              >
                Show Team Eval
              </button>
            </p>
          )}
        </div>
        <button
          id="builder-feedback-collapse-btn"
          type="button"
          onClick={onCollapse}
          title="Collapse feedback"
          className="hidden size-7 shrink-0 items-center justify-center text-[#0e0907]/35 transition-colors hover:bg-[#0e0907]/[0.04] hover:text-[#0e0907]/65 lg:flex"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div id="builder-feedback-content" className="flex-1 overflow-visible p-3 lg:min-h-0 lg:overflow-x-hidden lg:overflow-y-auto">
        <div id="builder-feedback-tab-panel-feedback" className={cn(activeTab !== "feedback" && "hidden")}>
          <NewFeedbackRead
            allSlots={allSlots}
            latestEval={latestEval}
            isEvaluating={isEvaluating}
            inspectedPlayer={inspectedPlayer}
            inspectionSource={inspectionSource}
            isLineupOnly={isLineupOnly}
            theoreticalMax={theoreticalMax}
            lineupEffectsByImpactTrait={lineupEffectsByImpactTrait}
            onSuggestionFilter={onSuggestionFilter}
          />
        </div>

        <div id="builder-feedback-tab-panel-skills" className={cn(activeTab !== "skills" && "hidden")}>
          <SkillProfileDiagnostic
            allSlots={allSlots}
            cornerstoneId={cornerstoneId}
            legendDetail={legendDetail}
            latestEval={latestEval}
            inspectedPlayer={inspectedPlayer}
            theoreticalMax={theoreticalMax}
            isLineupOnly={isLineupOnly}
          />
        </div>

        {isAdmin && (
          <div id="builder-feedback-debug-panel" className="space-y-4">
            <div id="builder-feedback-tab-panel-debug" className={cn(activeTab !== "debug" && "hidden")}>
              {latestEval ? (
                <>
                  <CohesionDebugPanel evaluation={latestEval} />
                  <details id="builder-feedback-debug-notes-json">
                    <summary className="cursor-pointer text-[0.625rem] font-semibold uppercase tracking-wider text-[#0e0907]/35 hover:text-[#0e0907]/60">
                      Raw Notes JSON
                    </summary>
                    <pre id="builder-feedback-debug-notes-json-content" className="mt-2 max-h-[400px] overflow-auto border border-[#d9d0c9]/60 bg-[#f0f0f0]/50 p-2 text-[0.5625rem] font-mono text-[#0e0907]/45 whitespace-pre-wrap">
                      {JSON.stringify(latestEval.notes, null, 2)}
                    </pre>
                  </details>
                </>
              ) : (
                <p id="builder-feedback-debug-empty" className="border border-dashed border-[#d9d0c9] bg-[#f0f0f0]/55 px-3 py-3 text-[0.8125rem] text-[#0e0907]/55">
                  Debug data appears after live eval.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
