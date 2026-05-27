/**
 * API client utility for communicating with the Flask backend.
 * All fetch calls to the backend should go through here to keep
 * base URL and error handling in one place.
 */

import type {
  ApiResponse,
  Player,
  PlayerWithSkills,
  PlayerStatRow,
  StatsBlob,
  PlayerSkills,
  ThresholdRow,
  ThresholdRule,
  AnchorsBySkill,
  Anchor,
  SkillTestResult,
  LeagueAverage,
  PipelineStatus,
  FlaggedPlayerSummary,
  PlayerReviewDetail,
  PlayerProfile,
  FlagResolution,
  LegendSummary,
  LegendDetail,
  LegendProfile,
  LegendClaudeSuggestion,
  EvaluatePayload,
  RosterEvaluation,
  CohesionRotationEvaluation,
  SaveTeamPayload,
  SavedTeamSummary,
  RuleSetSummary,
  RuleSetVersionSummary,
  CreateRuleSetPayload,
  UpdateRuleSetPayload,
  CreateRuleSetVersionPayload,
  RebuildCheckResponse,
  UserProfile,
  CommunityStatsMap,
  CommunityTeamsResponse,
} from "./types";

// Points to the Flask dev server by default; override via env var in production.
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5001";

// Optional API key for calibration write endpoints (PUT/POST/DELETE).
// Set NEXT_PUBLIC_CALIBRATION_API_KEY in .env.local to match the backend.
const CALIBRATION_KEY =
  process.env.NEXT_PUBLIC_CALIBRATION_API_KEY ?? "";

/**
 * Generic fetch wrapper that prepends the backend base URL.
 * Returns the full ApiResponse envelope so callers can inspect success/error.
 *
 * For write requests (POST/PUT/PATCH/DELETE):
 *  - Injects X-Calibration-Key when configured (legacy key, kept for compat)
 *  - Attaches Authorization: Bearer <jwt> when the user has an active Supabase session
 */
export async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  const method = options?.method?.toUpperCase() ?? "GET";
  const isWrite = ["PUT", "POST", "DELETE", "PATCH"].includes(method);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(isWrite && CALIBRATION_KEY ? { "X-Calibration-Key": CALIBRATION_KEY } : {}),
  };

  // Attach the Supabase JWT on all requests when running in the browser.
  // Admin-only GET endpoints (e.g. /api/cohesion/*) need the token too.
  // Public endpoints simply ignore the Authorization header.
  if (typeof window !== "undefined") {
    try {
      const { getAccessToken } = await import("./supabase/client");
      const token = await getAccessToken();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    } catch {
      // No session or not in a browser context — continue without auth header
    }
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers,
    ...options,
  });

  const rawBody = await res.text();
  try {
    return JSON.parse(rawBody) as ApiResponse<T>;
  } catch {
    const preview = rawBody.trim().slice(0, 240);
    return {
      success: false,
      data: null,
      error: preview
        ? `Backend returned ${res.status} ${res.statusText}: ${preview}`
        : `Backend returned ${res.status} ${res.statusText} without a JSON response.`,
    };
  }
}

/** Check backend health — used on the homepage to confirm connectivity. */
export async function checkHealth(): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE_URL}/api/health`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

/** List all qualifying players for the current season. Supports ?search=name query. */
export async function listPlayers(
  search?: string
): Promise<ApiResponse<Player[]>> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  const qs = params.toString() ? `?${params}` : "";
  return apiFetch<Player[]>(`/api/players${qs}`);
}

/**
 * Fetch all qualifying players with composite skill tiers and flag summaries
 * embedded inline — used by the /players explorer page.
 *
 * Returns a single request rather than N+1 per-player profile fetches.
 */
export async function listPlayersWithSkills(
  season?: string,
  minMpg?: number,
): Promise<ApiResponse<PlayerWithSkills[]>> {
  const params = new URLSearchParams();
  if (season) params.set("season", season);
  if (minMpg != null) params.set("min_mpg", String(minMpg));
  params.set("include_legends", "true");
  return apiFetch<PlayerWithSkills[]>(`/api/players/bulk?${params}`);
}

// ---------------------------------------------------------------------------
// Manual player include
// ---------------------------------------------------------------------------

/** Result shape from GET /api/players/nba-search */
export interface NbaPlayerSearchResult {
  nba_api_id: number;
  full_name: string;
  is_active: boolean;
}

/**
 * Search the NBA static player roster by name — returns players even if they
 * haven't played this season (e.g. injured players).
 */
export async function searchNbaPlayers(
  query: string,
): Promise<ApiResponse<NbaPlayerSearchResult[]>> {
  const params = new URLSearchParams({ q: query });
  return apiFetch<NbaPlayerSearchResult[]>(`/api/players/nba-search?${params}`);
}

/**
 * Manually add a player to the current season's pool.
 * The player is inserted with games_played=0, minutes_per_game=0, manually_included=true
 * so they bypass the MPG filter in the bulk endpoint.
 */
export async function manuallyIncludePlayer(
  nbaApiId: number,
  season?: string,
): Promise<ApiResponse<PlayerWithSkills>> {
  return apiFetch<PlayerWithSkills>("/api/players/manual-include", {
    method: "POST",
    body: JSON.stringify({ nba_api_id: nbaApiId, season }),
  });
}

/**
 * Remove a player from the manual include list by clearing the manually_included flag.
 * The player will no longer appear in the pool unless they meet the MPG threshold.
 */
export async function removeManualInclude(
  playerId: string,
): Promise<ApiResponse<{ removed: boolean }>> {
  return apiFetch<{ removed: boolean }>(`/api/players/${playerId}/manual-include`, {
    method: "DELETE",
  });
}

/**
 * Fetch all qualifying players with flattened stats for the calibration Stat Leaders table.
 * Stats are in "section.key" format; stabilized values returned as a separate dict.
 * This is a potentially large payload (~400 players × all stat sections).
 */
export async function listPlayersStatsBulk(
  season?: string,
): Promise<ApiResponse<PlayerStatRow[]>> {
  const params = new URLSearchParams();
  if (season) params.set("season", season);
  const qs = params.toString() ? `?${params}` : "";
  return apiFetch<PlayerStatRow[]>(`/api/players/stats-bulk${qs}`);
}

/** Get the full stats blob for a player. Pass refresh=true to bypass the cache. */
export async function getPlayerStats(
  playerId: string,
  season?: string,
  refresh = false,
): Promise<ApiResponse<StatsBlob>> {
  const params = new URLSearchParams();
  if (season) params.set("season", season);
  if (refresh) params.set("refresh", "true");
  const qs = params.toString() ? `?${params}` : "";
  return apiFetch<StatsBlob>(`/api/players/${playerId}/stats${qs}`);
}

/** Get all skill evaluations for a player. Pass refresh=true to bypass cache. */
export async function getPlayerSkills(
  playerId: string,
  refresh = false
): Promise<ApiResponse<PlayerSkills>> {
  const params = refresh ? "?refresh=true" : "";
  return apiFetch<PlayerSkills>(`/api/players/${playerId}/skills${params}`);
}

/** Get league average stats. */
export async function getLeagueAverages(): Promise<ApiResponse<LeagueAverage[]>> {
  return apiFetch<LeagueAverage[]>("/api/league-averages");
}

// ---------------------------------------------------------------------------
// Skill Thresholds (Calibration)
// ---------------------------------------------------------------------------

/** Get all 19 skill threshold rules. */
export async function getAllThresholds(): Promise<ApiResponse<ThresholdRow[]>> {
  return apiFetch<ThresholdRow[]>("/api/skills/thresholds");
}

/** Upsert a threshold rule for a skill. The backend validates and busts the cache. */
export async function saveThreshold(
  skillName: string,
  rule: ThresholdRule
): Promise<ApiResponse<{ skill_name: string; message: string }>> {
  return apiFetch(`/api/skills/thresholds/${encodeURIComponent(skillName)}`, {
    method: "PUT",
    body: JSON.stringify(rule),
  });
}

/**
 * Test a skill's threshold rule against its anchor players.
 * Pass overrideThresholds to test unsaved edits before committing.
 */
export async function testThresholds(
  skillName: string,
  overrideThresholds?: Record<string, ThresholdRule>
): Promise<ApiResponse<SkillTestResult | SkillTestResult[]>> {
  const body: Record<string, unknown> = { skill_name: skillName };
  if (overrideThresholds) {
    body.override_thresholds = overrideThresholds;
  }
  return apiFetch(`/api/skills/test-thresholds`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Anchors (Calibration)
// ---------------------------------------------------------------------------

/** Get all anchor players grouped by skill. */
export async function getAnchors(): Promise<ApiResponse<AnchorsBySkill>> {
  return apiFetch<AnchorsBySkill>("/api/anchors");
}

/** Create or update an anchor for a player+skill combination. */
export async function createAnchor(params: {
  player_id: string;
  skill_name: string;
  expected_tier: string;
  notes?: string;
}): Promise<ApiResponse<Anchor>> {
  return apiFetch<Anchor>("/api/anchors", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

/** Delete an anchor by its UUID. */
export async function deleteAnchor(
  anchorId: string
): Promise<ApiResponse<{ deleted: string }>> {
  return apiFetch(`/api/anchors/${anchorId}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Pipeline (Prompt 7)
// ---------------------------------------------------------------------------

/** Get aggregate pipeline status (player counts, flag counts). */
export async function getPipelineStatus(
  season?: string
): Promise<ApiResponse<PipelineStatus>> {
  const qs = season ? `?season=${encodeURIComponent(season)}` : "";
  return apiFetch<PipelineStatus>(`/api/pipeline/status${qs}`);
}

/**
 * Step 0: Kick off a background stats fetch for all qualifying players.
 * Returns immediately with a job_id — poll with getJobStatus() for progress.
 */
export async function runStatsFetch(season?: string, refresh = false): Promise<ApiResponse<{
  job_id: string;
}>> {
  return apiFetch("/api/pipeline/fetch-stats", {
    method: "POST",
    body: JSON.stringify({ season: season ?? undefined, refresh }),
  });
}

/** Poll the progress of a background fetch-stats job. */
export async function getJobStatus(jobId: string): Promise<ApiResponse<{
  status: "running" | "complete" | "error";
  progress: number;
  total: number;
  fetched: number;
  errors: number;
  result: {
    total: number;
    fetched: number;
    skipped: number;
    errors: number;
    salary_matched: number;
    salary_unmatched: number;
  } | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}>> {
  return apiFetch(`/api/pipeline/job-status/${encodeURIComponent(jobId)}`);
}

/**
 * Trigger the stat skill mapping batch pipeline.
 * Calls POST /api/skills/batch with no player_ids (processes all qualifying players).
 */
export async function runSkillsBatch(season?: string): Promise<ApiResponse<{
  total: number;
  processed: number;
  results: Record<string, unknown>;
}>> {
  return apiFetch("/api/skills/batch", {
    method: "POST",
    body: JSON.stringify({ season: season ?? undefined }),
  });
}

/**
 * Trigger the composite pipeline batch.
 * Calls POST /api/composite/batch with no player_ids (processes all qualifying players).
 */
export async function runCompositeBatch(season?: string): Promise<ApiResponse<{
  total: number;
  processed: number;
  claude_calls_made: number;
  claude_calls_skipped: number;
  auto_accepted: number;
  flagged_for_review: number;
  errors: number;
  estimated_cost_usd: number;
}>> {
  return apiFetch("/api/composite/batch", {
    method: "POST",
    body: JSON.stringify({ season: season ?? undefined }),
  });
}

// ---------------------------------------------------------------------------
// Review Queue (Prompt 7)
// ---------------------------------------------------------------------------

/** Get players with unresolved flags, with optional filters. */
export async function getReviewQueue(params?: {
  season?: string;
  search?: string;
  team?: string;
  position?: string;
  flag_reason?: string;
}): Promise<ApiResponse<FlaggedPlayerSummary[]>> {
  const q = new URLSearchParams();
  if (params?.season)      q.set("season", params.season);
  if (params?.search)      q.set("search", params.search);
  if (params?.team)        q.set("team", params.team);
  if (params?.position)    q.set("position", params.position);
  if (params?.flag_reason) q.set("flag_reason", params.flag_reason);
  const qs = q.toString() ? `?${q}` : "";
  return apiFetch<FlaggedPlayerSummary[]>(`/api/review/queue${qs}`);
}

/** Get all flags and profiles for a single player. */
export async function getPlayerFlags(
  playerId: string,
  season?: string
): Promise<ApiResponse<PlayerReviewDetail>> {
  const qs = season ? `?season=${encodeURIComponent(season)}` : "";
  return apiFetch<PlayerReviewDetail>(`/api/review/${playerId}/flags${qs}`);
}

/** Resolve a single skill flag. */
export async function resolveFlag(
  playerId: string,
  params: {
    skill_name: string;
    resolution: FlagResolution;
    resolved_value?: string | null;
    notes?: string | null;
    season?: string;
  }
): Promise<ApiResponse<{ flag_id: string; resolved_tier: string; all_flags_resolved: boolean }>> {
  return apiFetch(`/api/review/${playerId}/resolve`, {
    method: "POST",
    body: JSON.stringify(params),
  });
}

/** Manually override the final tier for any skill (flagged or not). */
export async function manualOverrideSkill(
  playerId: string,
  params: {
    skill_name: string;
    resolved_value: string;
    notes?: string | null;
    season?: string;
  }
): Promise<ApiResponse<{ skill_name: string; resolved_tier: string }>> {
  return apiFetch(`/api/review/${playerId}/manual-override`, {
    method: "POST",
    body: JSON.stringify(params),
  });
}

/** Get per-condition pass/fail breakdown for a player's specific skill. */
export async function getSkillBreakdown(
  playerId: string,
  skillName: string,
  season?: string
): Promise<ApiResponse<{
  skill_name: string;
  condition_results: import("./types").ConditionResult[];
  stat_tier: string;
  volume_gate_passed: boolean;
}>> {
  const params = new URLSearchParams({ skill_name: skillName });
  if (season) params.set("season", season);
  return apiFetch(`/api/review/${playerId}/skill-breakdown?${params}`);
}

/** Resolve all unresolved flags for a player (trust_stats or trust_claude only). */
export async function bulkResolveFlags(
  playerId: string,
  resolution: "trust_stats" | "trust_claude",
  notes?: string,
  season?: string
): Promise<ApiResponse<{ resolved_count: number; all_flags_resolved: boolean }>> {
  return apiFetch("/api/review/bulk-resolve", {
    method: "POST",
    body: JSON.stringify({ player_id: playerId, resolution, notes, season }),
  });
}

// ---------------------------------------------------------------------------
// Player Profile (Prompt 7)
// ---------------------------------------------------------------------------

/**
 * Permanently delete a player and all associated data (draft_skill_profiles, draft_skill_flags, player_stats).
 * This is irreversible.
 */
export async function deletePlayer(
  playerId: string,
): Promise<ApiResponse<{ deleted: boolean; player_id: string }>> {
  return apiFetch(`/api/players/${playerId}`, { method: "DELETE" });
}

/**
 * Update bio fields for a manually-included player.
 * Only allowed when the player's manually_included flag is true.
 * Salary should be passed as full dollars (e.g. 9500000 for $9.5M).
 */
export async function updatePlayerBio(
  playerId: string,
  fields: {
    team?: string | null;
    position?: string | null;
    height?: string | null;
    weight?: number | null;
    salary?: number | null;
  }
): Promise<ApiResponse<{ updated: boolean; fields: string[] }>> {
  return apiFetch(`/api/players/${playerId}/bio`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
}

/** Get the canonical player profile (player metadata + composite skills + flag summary). */
export async function getPlayerProfile(
  playerId: string,
  season?: string
): Promise<ApiResponse<PlayerProfile>> {
  const qs = season ? `?season=${encodeURIComponent(season)}` : "";
  return apiFetch<PlayerProfile>(`/api/players/${playerId}/profile${qs}`);
}

/** Fast player name search (DB-only, no nba_api calls). */
export async function searchPlayers(
  q: string,
  season?: string
): Promise<ApiResponse<Pick<Player, "id" | "name" | "team" | "position">[]>> {
  const params = new URLSearchParams({ q });
  if (season) params.set("season", season);
  return apiFetch(`/api/players/search?${params}`);
}

// ---------------------------------------------------------------------------
// Legends (Prompt 8)
// ---------------------------------------------------------------------------

/** Get all 36 legends with completion counts (lightweight — no full profiles). */
export async function listLegends(): Promise<ApiResponse<LegendSummary[]>> {
  return apiFetch<LegendSummary[]>("/api/legends");
}

/**
 * Fetch all qualifying active players (no legends) with composite skill tiers.
 * Used by the builder's player picker panel.
 */
export async function listActivePlayersWithSkills(): Promise<ApiResponse<PlayerWithSkills[]>> {
  return apiFetch<PlayerWithSkills[]>("/api/players/bulk?include_legends=false");
}

/** Get a single legend with its full skill profile. */
export async function getLegend(legendId: string): Promise<ApiResponse<LegendDetail>> {
  return apiFetch<LegendDetail>(`/api/legends/${encodeURIComponent(legendId)}`);
}

/**
 * Upsert a partial skill profile update for a legend.
 * Partial updates are supported — only the skills in `profile` are changed.
 * Pass `notes` to simultaneously update the legend's notes field.
 */
export async function updateLegendSkills(
  legendId: string,
  params: { profile?: Partial<LegendProfile>; notes?: string }
): Promise<ApiResponse<{ completion: number; completion_pct: number; updated_skills: string[] }>> {
  return apiFetch(`/api/legends/${encodeURIComponent(legendId)}/skills`, {
    method: "PUT",
    body: JSON.stringify(params),
  });
}

/**
 * Update physical attributes for a legend (age, height, weight, peak_year).
 * Partial updates supported — only pass the fields that changed.
 */
export async function updateLegendAttributes(
  legendId: string,
  params: { age?: number | null; height?: string | null; weight?: number | null; peak_year?: number | null; team?: string | null; position?: string | null }
): Promise<ApiResponse<{ age: number | null; height: string | null; weight: number | null; peak_year: number | null; team: string | null; position: string | null }>> {
  return apiFetch(`/api/legends/${encodeURIComponent(legendId)}/attributes`, {
    method: "PUT",
    body: JSON.stringify(params),
  });
}

/**
 * Get Claude's skill suggestions for a legend.
 * Results are NOT persisted — the client decides what to accept.
 */
export async function getLegendClaudeSuggestion(
  legendId: string
): Promise<ApiResponse<LegendClaudeSuggestion>> {
  return apiFetch<LegendClaudeSuggestion>(
    `/api/legends/${encodeURIComponent(legendId)}/claude-suggestion`,
    { method: "POST" }
  );
}

// ---------------------------------------------------------------------------
// Roster Evaluator
// ---------------------------------------------------------------------------

/** List published RuleSets for Lab selection. */
export async function listRuleSets(): Promise<ApiResponse<RuleSetSummary[]>> {
  return apiFetch<RuleSetSummary[]>("/api/rulesets");
}

// ---------------------------------------------------------------------------
// RuleSets (Admin)
// ---------------------------------------------------------------------------

/** Create a new RuleSet. */
export async function createRuleSet(
  payload: CreateRuleSetPayload,
): Promise<ApiResponse<RuleSetSummary>> {
  return apiFetch<RuleSetSummary>("/api/rulesets", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Update RuleSet metadata. */
export async function updateRuleSet(
  slug: string,
  payload: UpdateRuleSetPayload,
): Promise<ApiResponse<RuleSetSummary>> {
  return apiFetch<RuleSetSummary>(`/api/rulesets/${encodeURIComponent(slug)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

/** List all versions for a RuleSet (admin). */
export async function listRuleSetVersions(
  slug: string,
): Promise<ApiResponse<RuleSetVersionSummary[]>> {
  return apiFetch<RuleSetVersionSummary[]>(
    `/api/rulesets/${encodeURIComponent(slug)}/versions`,
  );
}

/** Create a new draft RuleSet Version. */
export async function createRuleSetVersion(
  slug: string,
  payload: CreateRuleSetVersionPayload,
): Promise<ApiResponse<RuleSetVersionSummary>> {
  return apiFetch<RuleSetVersionSummary>(
    `/api/rulesets/${encodeURIComponent(slug)}/versions`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

/** Publish a draft RuleSet Version. */
export async function publishRuleSetVersion(
  slug: string,
  versionId: string,
): Promise<ApiResponse<RuleSetVersionSummary>> {
  return apiFetch<RuleSetVersionSummary>(
    `/api/rulesets/${encodeURIComponent(slug)}/versions/${encodeURIComponent(versionId)}/publish`,
    { method: "POST" },
  );
}

/** Get the current user's minimal User Profile. */
export async function getUserProfile(): Promise<ApiResponse<UserProfile>> {
  return apiFetch<UserProfile>("/api/me/profile");
}

/** Update the current user's minimal User Profile. */
export async function updateUserProfile(
  payload: Partial<Pick<UserProfile, "display_name" | "favorite_player_name">>,
): Promise<ApiResponse<UserProfile>> {
  return apiFetch<UserProfile>("/api/me/profile", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

/** Evaluate a roster and return GM notes (live or final mode). */
export async function evaluateRoster(
  payload: EvaluatePayload,
): Promise<ApiResponse<RosterEvaluation>> {
  return apiFetch<RosterEvaluation>("/api/builder/evaluate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Save a valid Team under the active RuleSet and Snapshot Release. */
export async function saveTeam(
  payload: SaveTeamPayload,
): Promise<ApiResponse<SavedTeamSummary>> {
  return apiFetch<SavedTeamSummary>("/api/saved-teams", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** List the current user's Saved Teams. */
export async function listSavedTeams(): Promise<ApiResponse<SavedTeamSummary[]>> {
  return apiFetch<SavedTeamSummary[]>("/api/saved-teams");
}

/** Get one Saved Team owned by the current user. */
export async function getSavedTeam(savedTeamId: string): Promise<ApiResponse<SavedTeamSummary>> {
  return apiFetch<SavedTeamSummary>(`/api/saved-teams/${encodeURIComponent(savedTeamId)}`);
}

/** Fetch a rebuild compatibility report for a Saved Team. */
export async function getRebuildCheck(
  savedTeamId: string,
): Promise<ApiResponse<RebuildCheckResponse>> {
  return apiFetch<RebuildCheckResponse>(
    `/api/saved-teams/${encodeURIComponent(savedTeamId)}/rebuild-check`,
  );
}

/** Delete a Saved Team. */
export async function deleteSavedTeam(
  savedTeamId: string,
): Promise<ApiResponse<{ id: string; deleted: boolean }>> {
  return apiFetch<{ id: string; deleted: boolean }>(
    `/api/saved-teams/${encodeURIComponent(savedTeamId)}`,
    { method: "DELETE" },
  );
}

/** Rename a Saved Team. */
export async function renameSavedTeam(
  savedTeamId: string,
  name: string,
): Promise<ApiResponse<{ id: string; name: string }>> {
  return apiFetch<{ id: string; name: string }>(
    `/api/saved-teams/${encodeURIComponent(savedTeamId)}`,
    { method: "PATCH", body: JSON.stringify({ name }) },
  );
}

/** Update a Saved Team's visibility (private, unlisted, or public). */
export async function updateSavedTeamVisibility(
  savedTeamId: string,
  visibility: "private" | "unlisted" | "public",
): Promise<ApiResponse<{ id: string; name: string; visibility: string }>> {
  return apiFetch<{ id: string; name: string; visibility: string }>(
    `/api/saved-teams/${encodeURIComponent(savedTeamId)}`,
    { method: "PATCH", body: JSON.stringify({ visibility }) },
  );
}

/** Get a public or unlisted Saved Team (no auth required). */
export async function getSharedTeam(
  savedTeamId: string,
): Promise<ApiResponse<SavedTeamSummary>> {
  return apiFetch<SavedTeamSummary>(
    `/api/shared/${encodeURIComponent(savedTeamId)}`,
  );
}

/** Fetch a rebuild compatibility report for a shared (public/unlisted) Saved Team. */
export async function getSharedRebuildCheck(
  savedTeamId: string,
): Promise<ApiResponse<RebuildCheckResponse>> {
  return apiFetch<RebuildCheckResponse>(
    `/api/shared/${encodeURIComponent(savedTeamId)}/rebuild-check`,
  );
}

// ---------------------------------------------------------------------------
// Cohesion Calibration (admin-only)
// ---------------------------------------------------------------------------

/** Fetch a single player's base composites for the cohesion calibration panel. */
export async function fetchPlayerComposites(
  playerId: string,
): Promise<ApiResponse<{
  player_id: string;
  name: string;
  height: string | null;
  skills: Record<string, string>;
  composites_raw: Record<string, number>;
  composites_normalized: Record<string, number>;
  bell_curve: { amplitude: number; peak: number; range_down: number; range_up: number; flat_down: number; flat_up: number };
}>> {
  return apiFetch(`/api/cohesion/player/${encodeURIComponent(playerId)}/composites`);
}

/** Fetch bell curve params + pre-computed curve array for chart rendering. */
export async function fetchBellCurve(
  playerId: string,
): Promise<ApiResponse<{
  player_id: string;
  name: string;
  params: Record<string, number>;
  curve: { height: number; height_display: string; value: number }[];
}>> {
  return apiFetch(`/api/cohesion/bell-curve/${encodeURIComponent(playerId)}`);
}

/** Evaluate a 5-player lineup via the cohesion engine. */
export async function evaluateLineup(
  players: { id?: string; name: string; height: string | null; skills: Record<string, string> }[],
): Promise<ApiResponse<{
  cohesion_score: number;
  subscores: Record<string, number>;
  synergies_applied: string[];
  archetype_labels?: string[];
  archetype_details?: { archetype: string; subscore_key: string | null; subscore_value: number }[];
  accentuation: { strength_amplification: number; weakness_coverage: number };
  accentuation_details?: {
    strength?: { score: number; credit: number; checks: number; terms: Record<string, unknown>[] };
    weakness?: { score: number; credit: number; checks: number; terms: Record<string, unknown>[] };
  };
  boosted_bell_curves?: ({ amplitude: number; peak: number; range_down: number; range_up: number; flat_down: number; flat_up: number } | null)[];
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
}>> {
  return apiFetch("/api/cohesion/lineup/evaluate", {
    method: "POST",
    body: JSON.stringify({ players }),
  });
}

/** Evaluate a 5+ player calibration rotation via the deterministic cohesion engine. */
export async function evaluateRotation(
  players: { id?: string; name: string; slot: number; height: string | null; skills: Record<string, string> }[],
): Promise<ApiResponse<CohesionRotationEvaluation>> {
  return apiFetch<CohesionRotationEvaluation>("/api/cohesion/rotation/evaluate", {
    method: "POST",
    body: JSON.stringify({ players }),
  });
}

/** Fetch all cohesion engine weight constants (merged with any runtime overrides). */
export async function fetchCohesionWeights(): Promise<ApiResponse<Record<string, unknown>>> {
  return apiFetch<Record<string, unknown>>("/api/cohesion/weights");
}

/** Apply partial weight overrides (in-memory, resets on server restart). */
export async function updateCohesionWeights(
  overrides: Record<string, unknown>,
): Promise<ApiResponse<Record<string, unknown>>> {
  return apiFetch<Record<string, unknown>>("/api/cohesion/weights", {
    method: "PUT",
    body: JSON.stringify(overrides),
  });
}

// ---------------------------------------------------------------------------
// Formula Editor
// ---------------------------------------------------------------------------

/** Fetch composite formulas from draft or active Evaluation Version. */
export async function fetchCompositeFormulas(): Promise<ApiResponse<{
  formulas: Record<string, { factors: unknown[]; amplifiers: unknown[]; depends_on: string[] }>;
  source: "draft" | "active";
}>> {
  return apiFetch("/api/cohesion/formulas");
}

/** Fetch distribution histogram for a composite with optional formula override. */
export async function fetchDistributionPreview(
  compositeKey: string,
  formulaOverride?: { factors: unknown[]; amplifiers: unknown[]; depends_on: string[] },
): Promise<ApiResponse<{
  bins: { min: number; max: number; count: number }[];
  total_players: number;
  mean: number;
  median: number;
  p90: number;
}>> {
  return apiFetch("/api/cohesion/distribution-preview", {
    method: "POST",
    body: JSON.stringify({
      composite_key: compositeKey,
      formula_override: formulaOverride ?? null,
    }),
  });
}

// ---------------------------------------------------------------------------
// Community Leaderboard
// ---------------------------------------------------------------------------

/** Fetch per-RuleSet aggregate stats (team count, avg score, top cornerstone). */
export async function getCommunityStats(): Promise<ApiResponse<CommunityStatsMap>> {
  return apiFetch<CommunityStatsMap>("/api/community/stats");
}

/** Fetch paginated list of public Saved Teams for the leaderboard. */
export async function getCommunityTeams(params?: {
  ruleset_slug?: string;
  team_size?: number;
  sort?: "score" | "date";
  page?: number;
  per_page?: number;
}): Promise<ApiResponse<CommunityTeamsResponse>> {
  const searchParams = new URLSearchParams();
  if (params?.ruleset_slug) searchParams.set("ruleset_slug", params.ruleset_slug);
  if (params?.team_size != null) searchParams.set("team_size", String(params.team_size));
  if (params?.sort) searchParams.set("sort", params.sort);
  if (params?.page != null) searchParams.set("page", String(params.page));
  if (params?.per_page != null) searchParams.set("per_page", String(params.per_page));

  const qs = searchParams.toString();
  return apiFetch<CommunityTeamsResponse>(`/api/community/teams${qs ? `?${qs}` : ""}`);
}

// ---------------------------------------------------------------------------
// Snapshot Release API wrappers (A-11: returns Promise<ApiResponse<T>>)
// ---------------------------------------------------------------------------

import type {
  SnapshotRelease,
  SnapshotDraftSummary,
  PipelineRun,
  SnapshotPublishValidation,
  SnapshotCountSummary,
} from "./types";

export function getActiveSnapshot(): Promise<ApiResponse<SnapshotRelease>> {
  return apiFetch<SnapshotRelease>("/api/snapshots/active");
}

export function getDraftSnapshot(): Promise<ApiResponse<SnapshotDraftSummary | null>> {
  return apiFetch<SnapshotDraftSummary | null>("/api/snapshots/draft");
}

export function createDraftSnapshot(): Promise<ApiResponse<SnapshotRelease>> {
  return apiFetch<SnapshotRelease>("/api/snapshots/drafts", { method: "POST" });
}

export function moveDraftToReview(id: string): Promise<ApiResponse<SnapshotRelease>> {
  return apiFetch<SnapshotRelease>(`/api/snapshots/drafts/${id}/move-to-review`, { method: "POST" });
}

export function moveReviewToDraft(id: string): Promise<ApiResponse<SnapshotRelease>> {
  return apiFetch<SnapshotRelease>(`/api/snapshots/drafts/${id}/move-to-draft`, { method: "POST" });
}

export function discardDraft(id: string): Promise<ApiResponse<null>> {
  return apiFetch<null>(`/api/snapshots/drafts/${id}`, { method: "DELETE" });
}

export function publishDraft(
  id: string,
  label: string,
  allow_missing_composite: boolean,
): Promise<ApiResponse<SnapshotRelease>> {
  return apiFetch<SnapshotRelease>(`/api/snapshots/drafts/${id}/publish`, {
    method: "POST",
    body: JSON.stringify({ label, allow_missing_composite }),
  });
}

export function resetWorkingState(): Promise<ApiResponse<{ ok: boolean }>> {
  return apiFetch<{ ok: boolean }>("/api/snapshots/reset-working-state", { method: "POST" });
}

export function getDraftValidation(id: string): Promise<ApiResponse<SnapshotPublishValidation>> {
  return apiFetch<SnapshotPublishValidation>(`/api/snapshots/drafts/${id}/validation`);
}

export function getDraftSummary(id: string): Promise<ApiResponse<SnapshotCountSummary>> {
  return apiFetch<SnapshotCountSummary>(`/api/snapshots/drafts/${id}/summary`);
}

export function listSnapshotReleases(limit = 20): Promise<ApiResponse<SnapshotRelease[]>> {
  return apiFetch<SnapshotRelease[]>(`/api/snapshots/releases?limit=${limit}`);
}

export function reactivateSnapshotRelease(id: string): Promise<ApiResponse<SnapshotRelease>> {
  return apiFetch<SnapshotRelease>(`/api/snapshots/releases/${id}/reactivate`, {
    method: "POST",
  });
}

export function getPipelineRun(runId: string): Promise<ApiResponse<PipelineRun>> {
  return apiFetch<PipelineRun>(`/api/pipeline-runs/${runId}`);
}

export function triggerStatFetch(opts?: {
  player_ids?: string[];
  season?: string;
  refresh?: boolean;
}): Promise<ApiResponse<{ run_id: string }>> {
  return apiFetch<{ run_id: string }>("/api/pipeline/fetch-stats", {
    method: "POST",
    body: JSON.stringify(opts ?? {}),
  });
}

export function triggerSalaryScrape(player_id?: string): Promise<ApiResponse<{ run_id: string }>> {
  const path = player_id
    ? `/api/pipeline/salary-scrape/${player_id}`
    : "/api/pipeline/salary-scrape";
  return apiFetch<{ run_id: string }>(path, { method: "POST" });
}

export function triggerBioTeamSync(player_id?: string): Promise<ApiResponse<{ run_id: string }>> {
  const path = player_id
    ? `/api/pipeline/bio-team-sync/${player_id}`
    : "/api/pipeline/bio-team-sync";
  return apiFetch<{ run_id: string }>(path, { method: "POST" });
}
