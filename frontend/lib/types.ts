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
  /** True when this player record represents a legend rather than an active player. */
  is_legend?: boolean;
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
  /** True when the player is on a rookie scale contract (first round pick, ≤3 years experience). */
  is_rookie_deal?: boolean;
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
// Evaluation Types
// ---------------------------------------------------------------------------

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
  /** Which scoring dimension this note affects (e.g. "spacing", "defense"). Null for dimension-agnostic notes. */
  dimension: string | null;
  /** Original engine category key (e.g. "spacing", "defense_gap"). Admin debug only. */
  engine_category?: string;
  /** Numeric severity from the engine (0.0-1.0). Admin debug only. */
  engine_severity?: number;
  /** Raw value that triggered the note (e.g. composite average). Admin debug only. */
  engine_raw_value?: number;
}

// ---------------------------------------------------------------------------
// Cohesion Engine Types
// ---------------------------------------------------------------------------

export type CohesionNoteType = "strength" | "weakness" | "suggestion";

/** A structured cohesion-engine note. */
export interface CohesionNote {
  type: CohesionNoteType;
  category: string;
  severity: number;
  raw_value: number;
  text: string;
}

/** A player's normalized base composites in the cohesion engine. */
export interface CohesionCompositeScores {
  spacing: number;
  finishing: number;
  paint_touch: number;
  anchor: number;
  post_game: number;
  pnr_screener: number;
  off_ball_impact: number;
  shot_creation: number;
  rebounding: number;
  transition: number;
  perimeter_defense: number;
  interior_defense: number;
}

/** Defensive bell curve parameters for one player. */
export interface CohesionBellCurve {
  amplitude: number;
  peak: number;
  range_down: number;
  range_up: number;
  flat_down: number;
  flat_up: number;
}

/** Per-player composite payload returned by the cohesion engine. */
export interface CohesionPlayerComposites {
  player_id: string;
  name: string;
  base: CohesionCompositeScores;
  bell_curve: CohesionBellCurve;
}

/** One evaluated starting lineup in the cohesion response. */
export interface CohesionLineupData {
  cohesion_score: number;
  subscores: Record<string, number>;
  synergies_applied: string[];
  archetype_labels?: string[];
  archetype_details?: {
    archetype: string;
    subscore_key: string | null;
    subscore_value: number;
  }[];
  accentuation: {
    strength_amplification: number;
    weakness_coverage: number;
  };
  accentuation_details?: {
    strength?: {
      score: number;
      credit: number;
      checks: number;
      terms: {
        player: string;
        composite: string;
        value: number;
        teammate: string;
        teammate_composite: string;
        teammate_value: number;
        contribution: number;
      }[];
    };
    weakness?: {
      score: number;
      credit: number;
      checks: number;
      terms: {
        player: string;
        composite: string;
        weakness_depth: number;
        teammate: string;
        cover_value: number;
        contribution: number;
      }[];
    };
  };
  /** RP-PD boosted curves for the evaluated starting lineup. */
  boosted_bell_curves?: (CohesionBellCurve | null)[];
  /** Per-player perimeter-disruptor boosts provided by the best rim protector. */
  rp_pd_boosts?: {
    player_index: number;
    player_name: string;
    provider_index: number;
    provider_name: string;
    provider_rim_protector_tier: string;
    boost: number;
    original_pd_tier: string;
    effective_pd_tier: string;
    original_pd_value: number;
    effective_pd_value: number;
  }[];
}

/** Summary across all evaluated five-man lineups. */
export interface CohesionLineupSummary {
  total_lineups: number;
  viable_lineups: number;
  median_score: number;
  archetype_labels: string[];
  bench_lineups?: number;
  bench_viable_lineups?: number;
  bench_median_score?: number;
  depth_viable_ratio?: number;
  depth_quality?: number;
  depth_score?: number;
  rotation_median_subscores?: Record<string, number>;
}

/** Full evaluation result from POST /api/builder/evaluate. */
export interface RosterEvaluation {
  star_rating: number;
  star_rating_breakdown: {
    starting_5: number;
    depth: number;
    archetype_diversity: number;
    floor: number;
  };
  theoretical_best_starting_rating?: number;
  theoretical_best_starting_breakdown?: {
    starting_5: number;
    depth: number;
    archetype_diversity: number;
    floor: number;
  };
  starting_lineup: CohesionLineupData;
  player_composites: CohesionPlayerComposites[];
  lineup_summary: CohesionLineupSummary;
  lineup_combinations?: CohesionLineupCombination[];
  notes: CohesionNote[];
  team_description: string | null;
}

// ---------------------------------------------------------------------------
// Saved Teams
// ---------------------------------------------------------------------------

/** Published RuleSet shown at the Lab entry point. */
export interface RuleSetSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: "active" | "coming_soon" | "archived";
  display_order: number;
  current_version: {
    id: string;
    version_label: string;
    rules_hash: string;
    rules_json: Record<string, unknown>;
    published_at: string | null;
  } | null;
  rules: Record<string, unknown> | null;
}

/** A single RuleSet Version (draft, published, or retired). */
export interface RuleSetVersionSummary {
  id: string;
  version_label: string;
  rules_hash: string;
  rules_json: Record<string, unknown>;
  status: "draft" | "published" | "retired";
  published_at: string | null;
  created_at: string;
}

/** RuleSet with all its versions — returned by admin detail endpoint. */
export interface RuleSetDetail extends RuleSetSummary {
  versions: RuleSetVersionSummary[];
}

/** Payload for POST /api/rulesets. */
export interface CreateRuleSetPayload {
  slug: string;
  name: string;
  description?: string;
  status?: "active" | "coming_soon" | "archived";
  display_order?: number;
}

/** Payload for PATCH /api/rulesets/<slug>. */
export interface UpdateRuleSetPayload {
  name?: string;
  description?: string;
  status?: "active" | "coming_soon" | "archived";
  display_order?: number;
}

/** Payload for POST /api/rulesets/<slug>/versions. */
export interface CreateRuleSetVersionPayload {
  version_label: string;
  rules_json: Record<string, unknown>;
}

/** Minimal user-owned profile data for the Profile page. */
export interface UserProfile {
  id: string | null;
  user_id: string;
  display_name: string | null;
  favorite_player_name: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** One ordered Player snapshot persisted inside a Saved Team. */
export interface SaveTeamPlayerPayload {
  slot: number;
  is_cornerstone: boolean;
  snapshot_player_id?: string | null;
  canonical_player_id?: string | null;
  player_id: string | null;
  legend_id: string | null;
  salary_snapshot: number;
  player_name_snapshot: string;
  team_snapshot: string | null;
  position_snapshot: string | null;
  skill_profile_snapshot: Record<string, string>;
  /** True when the player is on a rookie scale contract. */
  is_rookie_deal?: boolean;
}

/** Request payload for POST /api/saved-teams. */
export interface SaveTeamPayload {
  ruleset_slug: string;
  ruleset_version_id: string;
  rules_hash: string;
  team_size: number;
  snapshot_release_id?: string;
  name?: string;
  cornerstone_legend_id: string | null;
  players: SaveTeamPlayerPayload[];
  evaluation: RosterEvaluation & {
    starting_lineup_score?: number;
  };
}

/** Summary returned after a Team is saved. */
export interface SavedTeamSummary {
  id: string;
  name: string;
  ruleset_slug: string;
  ruleset_version_id: string | null;
  ruleset_version_label?: string | null;
  ruleset_version_hash: string | null;
  team_size?: number | null;
  snapshot_release_id: string;
  visibility: "private" | "unlisted" | "public";
  cornerstone_legend_id?: string | null;
  total_salary?: number;
  created_at?: string | null;
  updated_at?: string | null;
  evaluation?: {
    id: string | null;
    evaluation_version: string | null;
    star_rating: number | null;
    starting_lineup_score: number | null;
    team_description: string | null;
    evaluation_payload?: RosterEvaluation | Record<string, unknown> | null;
    created_at: string | null;
  } | null;
  players?: SaveTeamPlayerPayload[];
}

// ---------------------------------------------------------------------------
// Rebuild compatibility check
// ---------------------------------------------------------------------------

/** Version drift between original and current RuleSet Version. */
export interface VersionDrift {
  original: {
    id: string;
    version_label: string;
    rules_hash: string;
    rules_json: Record<string, unknown>;
  } | null;
  current: {
    id: string;
    version_label: string;
    rules_hash: string;
    rules_json: Record<string, unknown>;
  };
  changed: boolean;
}

/** Saved player snapshot data frozen at save time. */
export interface RebuildPlayerSaved {
  player_name_snapshot: string;
  salary_snapshot: number;
  skill_profile_snapshot: Record<string, string>;
}

/** Current player data from the current Snapshot Release. */
export interface RebuildPlayerCurrent {
  source_player_id: string;
  name: string;
  salary: number;
  team: string | null;
  position: string | null;
  skill_profile_snapshot: Record<string, string>;
}

/** One player's resolution report from rebuild-check. */
export interface RebuildPlayerReport {
  slot: number;
  status: "matched" | "missing";
  saved: RebuildPlayerSaved;
  current: RebuildPlayerCurrent | null;
}

/** Full response from GET /api/saved-teams/<id>/rebuild-check. */
export interface RebuildCheckResponse {
  saved_team_id: string;
  ruleset_slug: string;
  version_drift: VersionDrift;
  cornerstone: {
    legend_id: string;
    name: string;
    status: "legend";
    available: boolean;
  };
  players: RebuildPlayerReport[];
  rebuild_ready: boolean;
  builder_url_params: Record<string, string>;
}

/** One ranked five-player combination returned by calibration rotation diagnostics. */
export interface CohesionLineupCombination extends CohesionLineupData {
  rank: number;
  combination_index: number;
  is_viable: boolean;
  player_ids: string[];
  player_names: string[];
  is_starting_lineup: boolean;
}

/** Full deterministic result from POST /api/cohesion/rotation/evaluate. */
export interface CohesionRotationEvaluation extends RosterEvaluation {
  lineup_combinations: CohesionLineupCombination[];
}

/** Request payload for POST /api/builder/evaluate */
export interface EvaluatePayload {
  players: Array<{
    id?: string;
    player_id?: string;
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

// ---------------------------------------------------------------------------
// Community leaderboard
// ---------------------------------------------------------------------------

/** Per-RuleSet aggregate stats for the Community tab. */
export interface CommunityRuleSetStats {
  team_count: number;
  avg_score: number | null;
  top_cornerstone: string;
}

/** Keyed by ruleset_slug. */
export type CommunityStatsMap = Record<string, CommunityRuleSetStats>;

/** Single entry in the community teams leaderboard. */
export interface CommunityTeamEntry {
  id: string;
  name: string;
  ruleset_slug: string;
  team_size: number | null;
  cornerstone_name: string;
  star_rating: number | null;
  starting_lineup_score: number | null;
  created_at: string | null;
}

/** Paginated response from GET /api/community/teams. */
export interface CommunityTeamsResponse {
  teams: CommunityTeamEntry[];
  total: number;
  page: number;
  per_page: number;
}
