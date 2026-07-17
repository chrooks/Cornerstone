/**
 * player-composites.ts — Client-side raw Impact Trait formulas.
 *
 * Mirrors the cohesion engine's per-player composite math so pre-eval surfaces
 * (PlayerPool reads, Player Shape glyphs, profile modals) can show a raw
 * formula read before a Player enters a live evaluation. Values here are raw
 * sums, NOT league percentiles — label them accordingly.
 */

import { COMPOSITE_COLUMNS } from "@/lib/cohesion-constants";
import { formatSkillName } from "@/lib/skills";
import type { CohesionCompositeScores, PlayerSkillMap } from "@/lib/types";

export type CompositeKey = keyof CohesionCompositeScores;

export const TIER_VALUES: Record<string, number> = {
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

export interface FormulaTerm {
  label: string;
  value: number;
  detail: string;
}

export interface RawCompositeBreakdown {
  raw: number;
  terms: FormulaTerm[];
  note?: string;
}

export function formatScore(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "0.0";
  return value.toFixed(1);
}

export function compositeLabel(key: string): string {
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

/** Scale a raw composite onto the 0-10 axis using the theoretical max for its key. */
export function rawToTenPointScale(key: CompositeKey, raw: number, theoreticalMax: Record<string, number>): number {
  const max = theoreticalMax[key] ?? 10;
  if (max <= 0) return 0;
  return Math.min(10, Math.max(0, (raw / max) * 10));
}

export function computeRawCompositeBreakdowns(skills: PlayerSkillMap | null | undefined): Record<CompositeKey, RawCompositeBreakdown> {
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

  // #100: passing = passer tier value alone (mirrors team _collective_passing).
  raw.passing = {
    terms: [skillFormulaTerm(skills, "passer")],
    raw: 0,
  };
  raw.passing.raw = sumTerms(raw.passing.terms);

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
