/**
 * Shared TypeScript types used across the frontend.
 * Types mirror the backend response shapes exactly to ensure type safety at API boundaries.
 */

/** Standard API response envelope from the Flask backend. */
export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

/** A player record from the players table */
export interface Player {
  id: string;
  nba_api_id: number;
  name: string;
  team: string | null;
  position: string | null;
  age: number | null;
  games_played: number | null;
  minutes_per_game: number | null;
  season: string;
}

/** Full stats blob returned by GET /api/players/<id>/stats */
export interface StatsBlob {
  metadata?: {
    player_id?: string;
    player_name?: string;
    season?: string;
    games_played?: number;
    minutes_per_game?: number;
    team?: string;
    position?: string;
  };
  box_score?: Record<string, number | null>;
  advanced?: Record<string, number | null>;
  tracking_shooting?: Record<string, number | null>;
  tracking_drives?: Record<string, number | null>;
  tracking_passing?: Record<string, number | null>;
  tracking_defense?: Record<string, number | null>;
  tracking_possessions?: Record<string, number | null>;
  tracking_touches?: Record<string, number | null>;
  shot_zones?: Record<string, number | null>;
  shot_detail?: Record<string, number | null>;
  play_type?: Record<string, number | null>;
  hustle?: Record<string, number | null>;
  matchup_defense?: Record<string, number | null>;
  salary?: Record<string, number | null>;
  stabilized?: Record<string, number>;
  [key: string]: unknown;
}

/** Skill tier value — ordered highest to lowest */
export type SkillTier = "All-Time Great" | "Elite" | "Proficient" | "Capable" | "None";

/** Stat confidence level */
export type StatConfidence = "high" | "moderate" | "low";

/** Result of evaluating a single skill for a player */
export interface SkillResult {
  skill_name: string;
  tier: SkillTier;
  stat_confidence: StatConfidence;
  review_recommended: boolean;
  data_missing: boolean;
  driving_stats: Record<string, number>;
  volume_gate_passed: boolean;
  tier_bump_applied: boolean;
  auto_promoted: boolean;
  flags: string[];
  /** Bayesian-stabilized values for stats this skill stabilizes, keyed "section.key" */
  stabilized_vals?: Record<string, number>;
}

/** Skill evaluation map — keyed by skill_name */
export type PlayerSkills = Record<string, SkillResult>;

/** A conditions block (AND/OR group) with leaf conditions or nested blocks */
export interface ConditionsBlock {
  logic?: "AND" | "OR";
  conditions?: ConditionItem[];
}

/** A single condition — either a leaf or a nested block */
export interface ConditionItem {
  stat?: string;
  operator?: string;
  value?: number;
  per?: "game" | "season";
  logic?: "AND" | "OR";
  conditions?: ConditionItem[];
  /** Pending-delete flag set in the calibration UI. Stripped by stripDeleted() before save. */
  _deleted?: boolean;
}

/** Stabilization config for a single stat */
export interface StabilizationConfig {
  stat: string;
  k: number;
  stabilized_key: string;
  league_avg_key?: string;
}

/** Tier bump rule — promotes a player from Capable to Elite when a condition is met */
export interface TierBump {
  condition: ConditionItem;
  effect: string;
  /** Ceiling for bump_up_one_tier — bump cannot promote above this tier */
  max_tier?: SkillTier;
  /** Floor for bump_down_one_tier — bump cannot demote below this tier */
  min_tier?: SkillTier;
  /** Pending-delete flag set in the calibration UI. Stripped by stripDeleted() before save. */
  _deleted?: boolean;
}

/** Auto-promotion rule — links one skill's achievement to another skill's minimum tier */
export interface AutoPromotion {
  if_tier_gte: SkillTier;
  then_set_skill: string;
  to_minimum_tier: SkillTier;
}

/** Full threshold JSONB rule for a skill */
export interface ThresholdRule {
  volume_gate?: ConditionsBlock;
  tiers: Record<string, ConditionsBlock>;
  stabilization?: StabilizationConfig[];
  tier_bumps?: TierBump[];
  pre_adjustments?: unknown[];
  auto_promotions?: AutoPromotion[];
  stat_confidence?: StatConfidence;
  always_flag_for_review?: boolean;
  [key: string]: unknown;
}

/** Row from skill_thresholds table */
export interface ThresholdRow {
  id: string;
  skill_name: string;
  thresholds: ThresholdRule;
  updated_at: string;
}

/** An anchor player record */
export interface Anchor {
  id: string;
  player_id: string;
  player_name: string;
  team?: string | null;
  skill_name: string;
  expected_tier: SkillTier;
  notes?: string | null;
  created_at: string;
}

/** Anchors grouped by skill name */
export type AnchorsBySkill = Record<string, Anchor[]>;

/** Per-condition breakdown entry returned by the test endpoint */
export interface ConditionResult {
  section: "volume_gate" | "elite" | "capable" | "tier_bump";
  stat: string;
  operator: string;
  threshold: number;
  actual_value: number | null;
  passed: boolean | null;
  per: string | null;
  stabilized: boolean;
  /** Incrementing ID shared by all conditions in the same AND/OR block */
  group_id: number | null;
  /** Logic operator for the block this condition belongs to */
  group_logic: "AND" | "OR" | null;
  /** Nesting depth — 0 for top-level, 1 for nested, etc. */
  depth: number;
}

/** Single anchor test result */
export interface AnchorTestResult {
  player_id: string;
  player_name: string;
  expected_tier: SkillTier;
  actual_tier: SkillTier | "Unknown";
  passed: boolean;
  error?: string;
  driving_stats: Record<string, number>;
  volume_gate_passed: boolean;
  data_missing: boolean;
  condition_results: ConditionResult[];
}

/** Test-thresholds response for a single skill */
export interface SkillTestResult {
  skill_name: string;
  anchors_tested: number;
  passed: number;
  failed: number;
  results: AnchorTestResult[];
}

/** League average stat entry */
export interface LeagueAverage {
  stat_key: string;
  value: number;
  sample_size: number;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Prompt 7 — Pipeline, Review, Player Profile
// ---------------------------------------------------------------------------

/** Aggregate pipeline status from GET /api/pipeline/status */
export interface PipelineStatus {
  season: string;
  total_qualifying_players: number;
  players_with_stats: number;
  players_with_skills: number;
  players_with_composite: number;
  unresolved_flags: number;
  total_flags: number;
  flagged_players: number;
}

/** Single entry in the review queue (one row per player with unresolved flags) */
export interface FlaggedPlayerSummary {
  player_id: string;
  player_name: string;
  team: string | null;
  position: string | null;
  unresolved_flag_count: number;
  flag_reasons: string[];
}

/** A single skill flag record from the skill_flags table */
export interface SkillFlag {
  id: string;
  skill_name: string;
  stat_rating: string;
  claude_rating: string;
  flag_reason: string;
  stat_values: Record<string, number> | null;
  claude_justification: string | null;
  resolution: string | null;
  resolved_value: string | null;
  resolved_at: string | null;
  notes: string | null;
}

/** Composite skill result stored in the skill_profiles.profile JSONB */
export interface CompositeSkillResult {
  final_tier: string;
  stat_tier: string | null;
  claude_tier: string | null;
  source: string;       // stats_only | auto_accepted | flagged | resolved
  flagged: boolean;
  flag_reason: string | null;
  stat_confidence: StatConfidence | null;
  claude_confidence: string | null;
  agreement: string | null;
}

/** Full data returned by GET /api/review/<player_id>/flags */
export interface PlayerReviewDetail {
  player: {
    id: string;
    name: string;
    team: string | null;
    position: string | null;
    age: number | null;
    games_played: number | null;
    minutes_per_game: number | null;
    height: string | null;
    weight: number | null;
    nba_api_id?: number | null;
  };
  flags: SkillFlag[];
  profiles: {
    stats: Record<string, string>;              // skill → tier
    claude: Record<string, string | null>;      // skill → tier | null (null = not assessed)
    composite: Record<string, CompositeSkillResult>;
  };
}

/** Flag summary for the player profile page */
export interface FlagSummary {
  total: number;
  unresolved: number;
}

/** Full player profile data from GET /api/players/<player_id>/profile */
export interface PlayerProfile {
  player: {
    id: string;
    name: string;
    team: string | null;
    position: string | null;
    age: number | null;
    games_played: number | null;
    minutes_per_game: number | null;
    salary: number | null;
    height: string | null;
    weight: number | null;
    season: string;
    nba_api_id?: number | null;
    manually_included?: boolean;
  };
  skills: Record<string, CompositeSkillResult> | null;
  flag_summary: FlagSummary;
}

/** Valid resolution choices for a skill flag */
export type FlagResolution = "trust_stats" | "trust_claude" | "manual_override";

// ---------------------------------------------------------------------------
// Calibration — Stat Leaders table
// ---------------------------------------------------------------------------

/**
 * A single player row returned by GET /api/players/stats-bulk.
 * Stats are flattened to "section.key" format (e.g. "box_score.pts": 25.3).
 * Stabilized values are a subset in the same "section.key" format.
 */
export interface PlayerStatRow {
  id: string;
  name: string;
  team: string | null;
  position: string | null;
  /** Raw stat values keyed by "section.key" format. Value may be null for missing data. */
  stats: Record<string, number | null>;
  /** Bayesian-stabilized values for a subset of stats, keyed by "section.key" format. */
  stabilized: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Players Explorer — bulk list with embedded skills
// ---------------------------------------------------------------------------

/**
 * Condensed skill map returned by GET /api/players/bulk.
 * Maps skill_name → final_tier string. Only final_tier is included (no full
 * composite details) to keep the bulk payload light.
 */
export type PlayerSkillMap = Record<string, string>;

/** A player row from GET /api/players/bulk — includes embedded skill tiers and flag summary. */
export interface PlayerWithSkills {
  id: string;
  name: string;
  team: string | null;
  position: string | null;
  age: number | null;
  height: string | null;
  weight: number | null;
  salary: number | null;
  games_played: number | null;
  minutes_per_game: number | null;
  season: string;
  /** True for legend rows merged in via ?include_legends=true. */
  is_legend?: boolean;
  /** True when a player was manually added to the pool (e.g. injured with 0 games). */
  manually_included?: boolean;
  /** Peak season start year — present only for legend rows. */
  peak_year?: number | null;
  /** NBA.com player ID — used to construct headshot URLs. */
  nba_api_id?: number | null;
  /** Composite skill profile condensed to final_tier per skill, or null if no profile exists yet. */
  skills: PlayerSkillMap | null;
  /** Aggregate flag status — used to surface review badges in the explorer. */
  flag_summary: { total: number; unresolved: number };
}

// ---------------------------------------------------------------------------
// Prompt 8 — Legends Profile Builder
// ---------------------------------------------------------------------------

/** A legend row from the legends table (used in grid view) */
export interface LegendSummary {
  id: string;
  name: string;
  peak_era: string;
  notes: string | null;
  age: number | null;
  height: string | null;
  weight: number | null;
  peak_year: number | null;
  team: string | null;
  position: string | null;
  nba_api_id?: number | null;
  /** Number of the 20 skills that have been deliberately rated (even "None" counts) */
  completion: number;
  completion_pct: number;
}

/** Tier value for a legend skill — null means unrated (not yet evaluated) */
export type LegendTier = "None" | "Capable" | "Proficient" | "Elite" | "All-Time Great" | null;

/** Profile map for a legend — all 20 skills, each may be null (unrated) or a tier value */
export type LegendProfile = Record<string, LegendTier>;

/** A single legend with full skill profile (used in editor view) */
export interface LegendDetail extends LegendSummary {
  profile: LegendProfile;
}

/** Claude's suggestion for a single skill */
export interface ClaudeSkillSuggestion {
  tier: Exclude<LegendTier, null>;
  justification: string;
}

/** Full Claude suggestion response for a legend */
export interface LegendClaudeSuggestion {
  skills: Record<string, ClaudeSkillSuggestion>;
}

// ---------------------------------------------------------------------------
// Roster Evaluator — Scores, GM Notes, Evaluation
// ---------------------------------------------------------------------------

/** The 9 numeric dimension scores produced by the 4-layer scoring pipeline (all 0–100) */
export interface Scores {
  overall: number;
  offense: number;
  defense: number;
  spacing: number;
  creation: number;
  paint: number;
  transition: number;
  optionality: number;
  robustness: number;
}

export type NoteSeverity = "critical" | "warning" | "suggestion" | "strength";

export type NoteCategory = "offense" | "defense" | "two_way" | "roster_balance";

/**
 * A single note returned by the roster rule engine.
 * WARNING: text may contain user-supplied player names — always render as text content,
 * never as innerHTML, to prevent XSS.
 */
export interface Note {
  severity: NoteSeverity;
  category: NoteCategory;
  text: string;
  trace_key: string;
  /** Whether this note fires from what IS on the roster ("presence") or what is MISSING ("absence"). */
  presence_type: "presence" | "absence";
}

/** Per-player entry in the height coverage map */
export interface PlayerCoverageEntry {
  name: string;
  is_cornerstone: boolean;
  /** Height in inches, null if no height provided */
  height_in: number | null;
  /** Height as "6-8" string, null if no height provided */
  height_str: string | null;
  /** Versatile defender tier — sets the base guard range */
  vd_tier: string;
  /** Perimeter disruptor tier — extends the lower bound of the guard range */
  pd_tier: string;
  /** Low end of guard range in inches, null if no height provided */
  range_low: number | null;
  /** High end of guard range in inches, null if no height provided */
  range_high: number | null;
}

/** Height coverage map — shows which guard heights are covered by the roster */
export interface HeightCoverageData {
  players: PlayerCoverageEntry[];
  /** Low end of target coverage window in inches (72 = 6'0") */
  target_low: number;
  /** High end of target coverage window in inches (86 = 7'2") */
  target_high: number;
  /** List of inches in the target window that are NOT covered by any player */
  holes: number[];
  /** True when every inch in [target_low, target_high] is covered */
  full_coverage: boolean;
}

/** Full evaluation result from POST /api/builder/evaluate */
export interface RosterEvaluation {
  scores: Scores;
  notes: Note[];
  player_traces: Record<string, Record<string, unknown>> | null;
  aggregate_traces: Record<string, unknown> | null;
  /** Always populated — height guard coverage across the 6'0"–7'2" window */
  height_coverage: HeightCoverageData | null;
}

/** Request payload for POST /api/builder/evaluate */
export interface EvaluatePayload {
  players: Array<{
    name: string;
    /** 0 = cornerstone, 1–9 = supporting slots */
    slot: number;
    /** Exactly one player per roster must have this set to true */
    is_cornerstone: boolean;
    height: string | null;
    skills: Record<string, string>;
  }>;
  mode: "live" | "final";
  debug: boolean;
}
