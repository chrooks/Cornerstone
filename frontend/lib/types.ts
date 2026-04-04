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

/** Health check response from GET /api/health */
export interface HealthResponse {
  status: string;
  message: string;
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
export type SkillTier = "All-Time Great" | "Elite" | "Capable" | "None";

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
  max_tier: SkillTier;
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
  };
  skills: Record<string, CompositeSkillResult> | null;
  flag_summary: FlagSummary;
}

/** Valid resolution choices for a skill flag */
export type FlagResolution = "trust_stats" | "trust_claude" | "manual_override";
