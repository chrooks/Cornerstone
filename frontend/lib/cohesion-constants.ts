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

/** The 12 Impact Trait scoring columns in canonical order. */
export const COMPOSITE_COLUMNS: CompositeColumn[] = [
  { key: "spacing", abbr: "Spc", label: "Spacing" },
  { key: "finishing", abbr: "Fin", label: "Finishing" },
  { key: "paint_touch", abbr: "RP", label: "Rim Pressure" },
  { key: "anchor", abbr: "Anc", label: "Anchor" },
  { key: "post_game", abbr: "Post", label: "Post Game" },
  { key: "pnr_screener", abbr: "PnR", label: "PnR Screener" },
  { key: "off_ball_impact", abbr: "OBI", label: "Off-Ball Impact" },
  { key: "shot_creation", abbr: "SC", label: "Shot Creation" },
  { key: "rebounding", abbr: "Reb", label: "Rebounding" },
  { key: "transition", abbr: "Trn", label: "Transition" },
  { key: "perimeter_defense", abbr: "PD", label: "Perimeter Defense" },
  { key: "interior_defense", abbr: "ID", label: "Interior Defense" },
];

/** Human-readable explanations of player-level Impact Traits. */
export const IMPACT_TRAIT_DESCRIPTIONS: Record<string, string> = {
  spacing: "Floor spacing from shooting gravity.",
  finishing: "Ability to score at the rim.",
  paint_touch: "Rim pressure and interior presence from finishing, vertical spacing, and post play.",
  anchor: "Defensive anchoring through rim protection, size, rebounding, and screening.",
  post_game: "Half-court post scoring threat.",
  pnr_screener: "Pick-and-roll screening, rolling, popping, and slip value.",
  off_ball_impact: "Cutting, movement, relocation, and secondary playmaking without dominating the ball.",
  shot_creation: "Ability to generate shots for self and teammates.",
  rebounding: "Board-crashing value on both ends.",
  transition: "Open-court value as runner, finisher, or pace-pusher.",
  perimeter_defense: "On-ball and help defense around the perimeter.",
  interior_defense: "Rim protection, post defense, and interior rebounding.",
};

// ---------------------------------------------------------------------------
// Subscore labels and groupings (the 16 lineup-level subscores)
// ---------------------------------------------------------------------------

/** Maps subscore keys to display labels. */
export const SUBSCORE_LABELS: Record<string, string> = {
  spacing_creation_ratio: "Spacing / Creation",
  creation_offball_ratio: "Creation / Off-Ball",
  spacing_paint_touch_ratio: "Spacing / Rim Pressure",
  rebound_transition_ratio: "Rebound / Transition",
  rebounding_spacing_deficit: "Spacing Support",
  paint_touch_total: "Rim Pressure",
  post_game_total: "Post Game",
  pnr_pairing: "PnR Pairing",
  pnr_screener_total: "PnR Screener",
  anchor_total: "Anchor",
  perimeter_defense_total: "Perim Defense",
  interior_defense_total: "Interior Defense",
  collective_passing: "Passing",
  rebounding: "Rebounding",
  transition: "Transition",
  defensive_coverage: "Def Coverage",
  defensive_gaps: "Def Gaps",
};

/** Human-readable explanations of Lineup Subscores. */
export const SUBSCORE_DESCRIPTIONS: Record<string, string> = {
  spacing_creation_ratio: "Whether the Lineup has enough spacing for on-ball creators to operate.",
  creation_offball_ratio: "Whether the Lineup balances on-ball creation with off-ball value.",
  spacing_paint_touch_ratio: "Whether the Lineup has enough spacing to support rim pressure.",
  rebound_transition_ratio: "Whether rebounding and transition play support each other.",
  rebounding_spacing_deficit: "Whether spacing is adequate or rebounding can offset a spacing deficit.",
  paint_touch_total: "Lineup-wide ability to pressure the rim.",
  post_game_total: "Top post option, secondary post option, and post depth blended together.",
  pnr_pairing: "How well pick-and-roll handlers and screeners match in quality and balance.",
  pnr_screener_total: "Lineup-wide screening, rolling, popping, and slip value.",
  anchor_total: "Stabilizing big-man presence through interior defense, rebounding, vertical size, and screening.",
  perimeter_defense_total: "Primary perimeter defender quality with secondary support and depth.",
  interior_defense_total: "Primary interior defender quality with secondary support and depth.",
  collective_passing: "Primary creator passing plus lineup-wide passing depth.",
  rebounding: "Top rebounders plus team rebounding depth.",
  transition: "Lineup-wide transition pressure and open-court value.",
  defensive_coverage: "Stacked height-based defensive bell-curve coverage after lineup effects.",
  defensive_gaps: "How many height bands avoid falling below the defensive gap threshold.",
  accentuation_strength: "How much the Lineup amplifies its best traits.",
  accentuation_weakness: "How well the Lineup covers its weakest traits.",
};

/** Subscores organized into display groups for UI rendering. */
export const SUBSCORE_GROUPS: { heading: string; entries: { key: string; label: string }[] }[] = [
  {
    heading: "Fit Ratios",
    entries: [
      { key: "spacing_creation_ratio", label: "Spacing / Creation" },
      { key: "creation_offball_ratio", label: "Creation / Off-Ball" },
      { key: "spacing_paint_touch_ratio", label: "Spacing / Rim Pressure" },
      { key: "rebound_transition_ratio", label: "Rebound / Transition" },
      { key: "rebounding_spacing_deficit", label: "Spacing Support" },
    ],
  },
  {
    heading: "Lineup Qualities",
    entries: [
      { key: "paint_touch_total", label: "Rim Pressure" },
      { key: "post_game_total", label: "Post Game" },
      { key: "pnr_pairing", label: "PnR Pairing" },
      { key: "anchor_total", label: "Anchor" },
      { key: "collective_passing", label: "Passing" },
      { key: "rebounding", label: "Rebounding" },
      { key: "transition", label: "Transition" },
    ],
  },
  {
    heading: "Defense",
    entries: [
      { key: "perimeter_defense_total", label: "Perim Defense" },
      { key: "interior_defense_total", label: "Interior Defense" },
      { key: "defensive_coverage", label: "Def Coverage" },
      { key: "defensive_gaps", label: "Def Gaps" },
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
