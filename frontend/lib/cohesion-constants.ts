/**
 * cohesion-constants.ts — Single source of truth for cohesion engine display constants.
 *
 * Shared across CohesionResultDetails, CohesionScoreDisplay, and the
 * cohesion calibration admin page. Eliminates previously duplicated
 * definitions of Impact Trait columns, subscore groupings, and synergy descriptions.
 */

// ---------------------------------------------------------------------------
// Impact Trait columns (the 12 player-level normalized basketball effects)
// ---------------------------------------------------------------------------

export interface CompositeColumn {
  key: string;
  label: string;
  abbr: string;
}

/** The 13 Impact Trait scoring columns in canonical order. */
export const COMPOSITE_COLUMNS: CompositeColumn[] = [
  { key: "spacing", abbr: "Spc", label: "Spacing" },
  { key: "finishing", abbr: "Fin", label: "Finishing" },
  { key: "paint_touch", abbr: "RP", label: "Rim Pressure" },
  { key: "post_game", abbr: "Post", label: "Post Game" },
  { key: "pnr_screener", abbr: "PnR", label: "PnR Screener" },
  { key: "off_ball_impact", abbr: "OBI", label: "Off-Ball Impact" },
  { key: "shot_creation", abbr: "SC", label: "Shot Creation" },
  { key: "ball_security", abbr: "BS", label: "Ball Security" },
  { key: "defensive_rebounding", abbr: "DRb", label: "Def Rebounding" },
  { key: "offensive_rebounding", abbr: "ORb", label: "Off Rebounding" },
  { key: "transition", abbr: "Trn", label: "Transition" },
  { key: "perimeter_defense", abbr: "PD", label: "Perimeter Defense" },
  { key: "interior_defense", abbr: "ID", label: "Interior Defense" },
];

/** Human-readable explanations of player-level Impact Traits. */
export const IMPACT_TRAIT_DESCRIPTIONS: Record<string, string> = {
  spacing: "Floor spacing from shooting gravity.",
  finishing: "Ability to score at the rim.",
  paint_touch: "Rim pressure and interior presence from finishing, vertical spacing, and post play.",
  post_game: "Half-court post scoring threat.",
  pnr_screener: "Pick-and-roll screening, rolling, popping, and slip value.",
  off_ball_impact: "Cutting, movement, relocation, and secondary playmaking without dominating the ball.",
  shot_creation: "Ability to generate shots for self and teammates.",
  ball_security: "Turnover avoidance and ball-handling safety.",
  defensive_rebounding: "Securing defensive boards through positioning and effort.",
  offensive_rebounding: "Crashing the offensive glass for second-chance opportunities.",
  transition: "Open-court value as runner, finisher, or pace-pusher.",
  perimeter_defense: "On-ball and help defense around the perimeter.",
  interior_defense: "Rim protection, post defense, and interior rebounding.",
};

// ---------------------------------------------------------------------------
// Subscore labels and groupings (the 16 lineup-level subscores)
// ---------------------------------------------------------------------------

/** Maps subscore keys to display labels. */
export const SUBSCORE_LABELS: Record<string, string> = {
  // Offense quality
  spacing: "Spacing",
  shot_creation: "Shot Creation",
  paint_touch: "Rim Pressure",
  collective_passing: "Passing",
  off_ball_impact: "Off-Ball Impact",
  ball_security: "Ball Security",
  pnr_pairing: "PnR Pairing",
  post_game: "Post Game",
  // Offense balance
  spacing_creation_ratio: "Spacing / Creation",
  creation_offball_ratio: "Creation / Off-Ball",
  spacing_paint_touch_ratio: "Spacing / Rim Pressure",
  // Defense
  interior_defense: "Interior Defense",
  defensive_coverage: "Def Coverage",
  defensive_gaps: "Def Gaps",
  perimeter_defense: "Perim Defense",
  switchability: "Switchability",
  // Rebounding/transition
  defensive_rebounding: "Def Rebounding",
  offensive_rebounding: "Off Rebounding",
  transition: "Transition",
  rebound_transition_ratio: "Rebound / Transition",
};

/** Human-readable explanations of Lineup Subscores. */
export const SUBSCORE_DESCRIPTIONS: Record<string, string> = {
  spacing: "Lineup-wide floor spacing from shooting gravity.",
  shot_creation: "Lineup-wide ability to generate shots for self and teammates.",
  paint_touch: "Lineup-wide ability to pressure the rim.",
  collective_passing: "Primary creator passing plus lineup-wide passing depth.",
  off_ball_impact: "Lineup-wide cutting, movement, and secondary playmaking.",
  ball_security: "Lineup-wide turnover avoidance and ball-handling safety.",
  pnr_pairing: "How well pick-and-roll handlers and screeners match in quality and balance.",
  post_game: "Top post option, secondary post option, and post depth blended together.",
  spacing_creation_ratio: "Whether the Lineup has enough spacing for on-ball creators to operate.",
  creation_offball_ratio: "Whether the Lineup balances on-ball creation with off-ball value.",
  spacing_paint_touch_ratio: "Whether the Lineup has enough spacing to support rim pressure.",
  interior_defense: "Primary interior defender quality with secondary support and depth.",
  defensive_coverage: "Stacked height-based defensive bell-curve coverage after lineup effects.",
  defensive_gaps: "How many height bands avoid falling below the defensive gap threshold.",
  perimeter_defense: "Primary perimeter defender quality with secondary support and depth.",
  switchability: "How well the Lineup can switch defensive assignments across positions.",
  defensive_rebounding: "Top defensive rebounders plus team rebounding depth.",
  offensive_rebounding: "Top offensive rebounders plus team offensive rebounding depth.",
  transition: "Lineup-wide transition pressure and open-court value.",
  rebound_transition_ratio: "Whether rebounding and transition play support each other.",
  accentuation_strength: "How much the Lineup amplifies its best traits.",
  accentuation_weakness: "How well the Lineup covers its weakest traits.",
};

/** Subscores organized into the two-level category structure for UI rendering. */
export const SUBSCORE_GROUPS: { heading: string; entries: { key: string; label: string }[] }[] = [
  {
    heading: "Offense — Quality",
    entries: [
      { key: "spacing", label: "Spacing" },
      { key: "shot_creation", label: "Shot Creation" },
      { key: "paint_touch", label: "Rim Pressure" },
      { key: "collective_passing", label: "Passing" },
      { key: "off_ball_impact", label: "Off-Ball Impact" },
      { key: "ball_security", label: "Ball Security" },
      { key: "pnr_pairing", label: "PnR Pairing" },
      { key: "post_game", label: "Post Game" },
    ],
  },
  {
    heading: "Offense — Balance",
    entries: [
      { key: "spacing_creation_ratio", label: "Spacing / Creation" },
      { key: "creation_offball_ratio", label: "Creation / Off-Ball" },
      { key: "spacing_paint_touch_ratio", label: "Spacing / Rim Pressure" },
    ],
  },
  {
    heading: "Defense",
    entries: [
      { key: "interior_defense", label: "Interior Defense" },
      { key: "defensive_coverage", label: "Def Coverage" },
      { key: "defensive_gaps", label: "Def Gaps" },
      { key: "perimeter_defense", label: "Perim Defense" },
      { key: "switchability", label: "Switchability" },
    ],
  },
  {
    heading: "Rebounding / Transition",
    entries: [
      { key: "defensive_rebounding", label: "Def Rebounding" },
      { key: "offensive_rebounding", label: "Off Rebounding" },
      { key: "transition", label: "Transition" },
      { key: "rebound_transition_ratio", label: "Rebound / Transition" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Synergy descriptions
// ---------------------------------------------------------------------------

/** Human-readable explanations of offensive synergy codes. */
export const SYNERGY_DESCRIPTIONS: Record<string, string> = {
  "OFF-02": "Screeners boost movement shooters by freeing them off the ball.",
  "OFF-03": "Movement shooters are penalized when no screener is available.",
  "OFF-04": "Screeners boost cutters by opening off-ball lanes.",
  "OFF-12": "Cutters are penalized when the lineup has no passer to find them.",
  "OFF-13": "Cutters are penalized when lineup spacing is too cramped.",
  "OFF-14": "Creators boost cutters by bending the defense.",
  "OFF-15": "Vertical spacers are penalized without passers or drivers to activate them.",
  "OFF-16": "Passers or drivers boost vertical spacers as lob and rim-pressure targets.",
  "OFF-31": "Passers boost transition threats in the open court.",
  "OFF-32": "Transition threats and passers boost Above the Rim Finishers.",
  "OFF-37": "Only one passer is present, making playmaking fragile.",
};

// ---------------------------------------------------------------------------
// Bell curve chart constants
// ---------------------------------------------------------------------------

/** Distinct colors for overlaying player bell curves. */
export const PLAYER_COLORS = [
  "#3b82f6", "#ef4444", "#22c55e", "#f59e0b",
  "#a855f7", "#ec4899", "#06b6d4", "#f97316",
];

/** Bell curve height range: 6'0" (72in) to 7'4" (88in). */
export const BELL_MIN_IN = 72;
export const BELL_MAX_IN = 88;
