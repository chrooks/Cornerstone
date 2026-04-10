/**
 * Complete list of stat key options for use in condition editors.
 * Each option maps a raw `section.stat_key` value to a human-readable label.
 * Built from STAT_ORDER sections and STAT_LABELS in PlayerStatDisplay.tsx.
 */

export interface StatKeyOption {
  /** The raw `section.stat_key` string used in condition objects, e.g. "tracking_shooting.catch_shoot_fg3_pct" */
  value: string;
  /** Human-readable label formatted as "Section Name › Stat Label", e.g. "Tracking — Shooting › Catch & Shoot 3P%" */
  label: string;
}

/** Section display names keyed by STAT_ORDER section key */
const SECTION_DISPLAY_NAMES: Record<string, string> = {
  box_score: "Box Score",
  advanced: "Advanced",
  tracking_shooting: "Tracking — Shooting",
  tracking_drives: "Tracking — Drives",
  tracking_passing: "Tracking — Passing",
  tracking_defense: "Tracking — Defense",
  tracking_possessions: "Tracking — Possessions",
  tracking_touches: "Tracking — Touches",
  shot_zones: "Shot Zones",
  shot_detail: "Shot Detail",
  play_type: "Play Type",
  hustle: "Hustle",
  matchup_defense: "Matchup Defense",
  salary: "Salary",
  computed: "Computed",
};

/** Stat labels keyed by short stat key — mirrors STAT_LABELS in PlayerStatDisplay.tsx */
const STAT_LABELS: Record<string, string> = {
  // Box score
  pts: "Pts",
  reb: "Reb",
  oreb: "OReb",
  dreb: "DReb",
  ast: "Ast",
  stl: "Stl",
  blk: "Blk",
  tov: "TO",
  pf: "Fouls",
  plus_minus: "+/-",
  min: "Min",
  fgm: "FGM",
  fga: "FGA",
  fg_pct: "FG%",
  fg3m: "3PM",
  fg3a: "3PA",
  fg3_pct: "3P%",
  ftm: "FTM",
  fta: "FTA",
  ft_pct: "FT%",
  // Advanced
  usg_pct: "Usage%",
  ts_pct: "TS%",
  efg_pct: "eFG%",
  off_rating: "OffRtg",
  def_rating: "DefRtg",
  net_rating: "NetRtg",
  ast_pct: "AST%",
  ast_to: "AST/TO",
  ast_ratio: "AST Ratio",
  oreb_pct: "OReb%",
  dreb_pct: "DReb%",
  reb_pct: "Reb%",
  tm_tov_pct: "TOV%",
  pace: "Pace",
  pie: "PIE",
  // Tracking — Shooting
  catch_shoot_fgm: "Catch & Shoot FGM",
  catch_shoot_fga: "Catch & Shoot FGA",
  catch_shoot_fg_pct: "Catch & Shoot FG%",
  catch_shoot_fg3m: "Catch & Shoot 3PM",
  catch_shoot_fg3a: "Catch & Shoot 3PA",
  catch_shoot_fg3_pct: "Catch & Shoot 3P%",
  catch_shoot_pts: "Catch & Shoot Pts",
  pullup_fgm: "Pull-Up FGM",
  pullup_fga: "Pull-Up FGA",
  pullup_fg_pct: "Pull-Up FG%",
  pullup_fg3m: "Pull-Up 3PM",
  pullup_fg3a: "Pull-Up 3PA",
  pullup_fg3_pct: "Pull-Up 3P%",
  pullup_pts: "Pull-Up Pts",
  // Tracking — Drives
  drives: "Drives",
  drive_pts: "Drive Pts",
  drive_fg_pct: "Drive FG%",
  drive_ast: "Drive Ast",
  drive_tov: "Drive TO",
  drive_pf: "Drive Fouls",
  drive_fga: "Drive FGA",
  drive_fgm: "Drive FGM",
  // Tracking — Passing
  passes_made: "Passes Made",
  passes_received: "Passes Rec",
  potential_ast: "Pot Ast",
  ast_pts_created: "Ast Pts Created",
  // Tracking — Defense
  def_at_rim_fga: "Rim Att Def",
  def_at_rim_fgm: "Rim FGM Allowed",
  defended_at_rim_fg_pct: "Rim FG% Allowed",
  matchup_zone_time: "Zone Time",
  // Tracking — Possessions / Touches
  touches: "Touches",
  front_ct_touches: "Front Ct Touches",
  time_of_poss: "Time of Poss",
  elbow_touches: "Elbow Touches",
  paint_touches: "Paint Touches",
  post_touches: "Post Touches",
  // Shot Zones
  restricted_area_fga: "RA Att",
  restricted_area_fgm: "RA Made",
  restricted_area_fg_pct: "RA FG%",
  paint_non_ra_fga: "Paint Att",
  paint_non_ra_fgm: "Paint Made",
  paint_non_ra_fg_pct: "Paint FG%",
  mid_range_fga: "Mid Att",
  mid_range_fgm: "Mid Made",
  mid_range_fg_pct: "Mid FG%",
  corner3_fga: "Corner 3 Att",
  corner3_fgm: "Corner 3 Made",
  corner3_fg_pct: "Corner 3%",
  atb3_fga: "ATB 3 Att",
  atb3_fgm: "ATB 3 Made",
  atb3_fg_pct: "ATB 3%",
  // Shot Detail
  dunks_fga: "Dunks",
  tip_shots_fga: "Tip Shots",
  floating_jump_shot_fga: "Floater Att",
  floating_jump_shot_fg_pct: "Floater FG%",
  // Play Type
  spotup_poss: "Spot-up Poss",
  spotup_ppp: "Spot-up PPP",
  spotup_freq: "Spot-up Freq",
  transition_poss: "Trans Poss",
  transition_ppp: "Trans PPP",
  transition_freq: "Trans Freq",
  isolation_poss: "ISO Poss",
  isolation_ppp: "ISO PPP",
  isolation_freq: "ISO Freq",
  pr_ball_handler_poss: "PnR BH Poss",
  pr_ball_handler_ppp: "PnR BH PPP",
  pr_ball_handler_freq: "PnR BH Freq",
  pr_roll_man_poss: "PnR Roll Poss",
  pr_roll_man_ppp: "PnR Roll PPP",
  pr_roll_man_freq: "PnR Roll Freq",
  postup_poss: "Post Poss",
  postup_ppp: "Post PPP",
  postup_freq: "Post Freq",
  handoff_poss: "Handoff Poss",
  handoff_ppp: "Handoff PPP",
  handoff_freq: "Handoff Freq",
  cut_poss: "Cut Poss",
  cut_ppp: "Cut PPP",
  cut_freq: "Cut Freq",
  offscreen_poss: "Off Screen Poss",
  offscreen_ppp: "Off Screen PPP",
  offscreen_freq: "Off Screen Freq",
  // Hustle
  contested_shots: "Contested Shots",
  contested_shots_2pt: "Cont 2PT",
  contested_shots_3pt: "Cont 3PT",
  deflections: "Deflections",
  loose_balls_recovered: "Loose Balls",
  charges_drawn: "Charges Drawn",
  screen_assists: "Screen Ast",
  screen_ast_pts: "Screen Ast Pts",
  box_outs_off: "Off Box Outs",
  box_outs_def: "Def Box Outs",
  // Matchup Defense
  partial_possessions: "Matchup Poss",
  matchup_fg_pct: "Matchup FG%",
  matchup_3pt_fg_pct: "Matchup 3P%",
  switches_on: "Switches",
  // Salary
  annual_salary: "Annual Salary",
};

/**
 * Explicit per-section ordering of stat keys.
 * Mirrors STAT_ORDER in PlayerStatDisplay.tsx.
 */
const STAT_ORDER: Record<string, string[]> = {
  box_score: [
    "pts", "reb", "ast", "stl", "blk", "tov", "pf", "plus_minus",
    "fgm", "fga", "fg_pct",
    "fg3m", "fg3a", "fg3_pct",
    "ftm", "fta", "ft_pct",
    "oreb", "dreb",
    "min",
  ],
  advanced: [
    "usg_pct", "ts_pct", "efg_pct",
    "off_rating", "def_rating", "net_rating",
    "ast_pct", "ast_to", "ast_ratio",
    "oreb_pct", "dreb_pct", "reb_pct",
    "tm_tov_pct", "pace", "pie",
  ],
  tracking_shooting: [
    "catch_shoot_fg3m", "catch_shoot_fg3a", "catch_shoot_fg3_pct",
    "catch_shoot_fgm", "catch_shoot_fga", "catch_shoot_fg_pct",
    "catch_shoot_pts",
    "pullup_fg3m", "pullup_fg3a", "pullup_fg3_pct",
    "pullup_fgm", "pullup_fga", "pullup_fg_pct",
    "pullup_pts",
  ],
  tracking_drives: [
    "drives", "drive_pts", "drive_fg_pct", "drive_fgm", "drive_fga",
    "drive_ast", "drive_tov", "drive_pf",
  ],
  tracking_passing: [
    "passes_made", "passes_received", "ast", "potential_ast", "ast_pts_created",
  ],
  tracking_defense: [
    "def_at_rim_fgm", "def_at_rim_fga", "defended_at_rim_fg_pct", "matchup_zone_time",
  ],
  tracking_possessions: [
    "touches", "front_ct_touches", "time_of_poss", "elbow_touches",
  ],
  tracking_touches: [
    "paint_touches", "post_touches", "elbow_touches",
  ],
  shot_zones: [
    "restricted_area_fgm", "restricted_area_fga", "restricted_area_fg_pct",
    "paint_non_ra_fgm", "paint_non_ra_fga", "paint_non_ra_fg_pct",
    "mid_range_fgm", "mid_range_fga", "mid_range_fg_pct",
    "corner3_fgm", "corner3_fga", "corner3_fg_pct",
    "atb3_fgm", "atb3_fga", "atb3_fg_pct",
  ],
  shot_detail: [
    "dunks_fga", "tip_shots_fga", "floating_jump_shot_fga", "floating_jump_shot_fg_pct",
  ],
  play_type: [
    "transition_poss", "transition_ppp", "transition_freq",
    "spotup_poss", "spotup_ppp", "spotup_freq",
    "isolation_poss", "isolation_ppp", "isolation_freq",
    "pr_ball_handler_poss", "pr_ball_handler_ppp", "pr_ball_handler_freq",
    "pr_roll_man_poss", "pr_roll_man_ppp", "pr_roll_man_freq",
    "postup_poss", "postup_ppp", "postup_freq",
    "handoff_poss", "handoff_ppp", "handoff_freq",
    "cut_poss", "cut_ppp", "cut_freq",
    "offscreen_poss", "offscreen_ppp", "offscreen_freq",
  ],
  hustle: [
    "contested_shots", "contested_shots_2pt", "contested_shots_3pt",
    "deflections", "loose_balls_recovered", "charges_drawn",
    "screen_assists", "screen_ast_pts",
    "box_outs_off", "box_outs_def",
  ],
  matchup_defense: [
    "partial_possessions", "matchup_fg_pct", "matchup_3pt_fg_pct", "switches_on",
  ],
  salary: ["annual_salary"],
};

/**
 * Build the full stat key list by iterating all STAT_ORDER sections.
 * Keys are deduplicated (e.g. "ast" appears in both box_score and tracking_passing).
 */
function buildStatKeyOptions(): StatKeyOption[] {
  const seen = new Set<string>();
  const options: StatKeyOption[] = [];

  for (const [section, keys] of Object.entries(STAT_ORDER)) {
    const sectionName = SECTION_DISPLAY_NAMES[section] ?? section;
    for (const key of keys) {
      const value = `${section}.${key}`;
      if (seen.has(value)) continue;
      seen.add(value);

      const statLabel = STAT_LABELS[key] ?? key;
      options.push({
        value,
        label: `${sectionName} › ${statLabel}`,
      });
    }
  }

  // Computed stat keys used by specific skills (not in STAT_ORDER sections)
  const computedKeys: StatKeyOption[] = [
    { value: "computed.movement_shooter_weighted_ppp", label: "Computed › Movement Shooter Weighted PPP" },
    { value: "computed.pnr_bh_weighted_ppp", label: "Computed › PnR BH Weighted PPP" },
    { value: "computed.post_weighted_ppp", label: "Computed › Post Weighted PPP" },
  ];
  for (const opt of computedKeys) {
    if (!seen.has(opt.value)) {
      seen.add(opt.value);
      options.push(opt);
    }
  }

  // Stabilized variants for the most commonly stabilized stats.
  // These use the "stabilized.section.stat_key" format resolved by the backend evaluator.
  const stabilizedVariants: Array<[string, string]> = [
    ["tracking_shooting.catch_shoot_fg3_pct", "Tracking — Shooting › Catch & Shoot 3P% (stabilized)"],
    ["tracking_shooting.catch_shoot_fg_pct", "Tracking — Shooting › Catch & Shoot FG% (stabilized)"],
    ["play_type.spotup_ppp", "Play Type › Spot-up PPP (stabilized)"],
    ["play_type.cut_ppp", "Play Type › Cut PPP (stabilized)"],
    ["play_type.transition_ppp", "Play Type › Trans PPP (stabilized)"],
    ["play_type.isolation_ppp", "Play Type › ISO PPP (stabilized)"],
    ["play_type.offscreen_ppp", "Play Type › Off Screen PPP (stabilized)"],
    ["play_type.handoff_ppp", "Play Type › Handoff PPP (stabilized)"],
    ["play_type.pr_ball_handler_ppp", "Play Type › PnR BH PPP (stabilized)"],
    ["tracking_drives.drive_fg_pct", "Tracking — Drives › Drive FG% (stabilized)"],
    ["computed.movement_shooter_weighted_ppp", "Computed › Movement Shooter Weighted PPP (stabilized)"],
  ];
  for (const [rawKey, label] of stabilizedVariants) {
    const value = `stabilized.${rawKey}`;
    if (!seen.has(value)) {
      seen.add(value);
      options.push({ value, label });
    }
  }

  return options;
}

/** Full sorted list of all known stat keys with their human-readable labels. */
export const ALL_STAT_KEYS: StatKeyOption[] = buildStatKeyOptions();

/**
 * Look up a human-readable label for a raw stat key (e.g. "tracking_shooting.catch_shoot_fg3_pct").
 * Falls back to a title-cased version of the key if not found.
 */
export function getStatLabel(value: string): string {
  const found = ALL_STAT_KEYS.find((o) => o.value === value);
  if (found) return found.label;

  // Fallback: convert "section.stat_key" → "Section › Stat Key"
  return value
    .split(".")
    .map((part) =>
      part
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")
    )
    .join(" › ");
}
