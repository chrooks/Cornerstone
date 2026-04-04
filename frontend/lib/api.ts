/**
 * API client utility for communicating with the Flask backend.
 * All fetch calls to the backend should go through here to keep
 * base URL and error handling in one place.
 */

import type {
  ApiResponse,
  Player,
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
 * Automatically injects X-Calibration-Key for write requests when configured.
 */
export async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  const method = options?.method?.toUpperCase() ?? "GET";
  const isWrite = ["PUT", "POST", "DELETE"].includes(method);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(isWrite && CALIBRATION_KEY ? { "X-Calibration-Key": CALIBRATION_KEY } : {}),
  };

  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers,
    ...options,
  });

  // Parse the body regardless of status — it contains the error message on failure
  const body = (await res.json()) as ApiResponse<T>;
  return body;
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
 * Step 0: Fetch and cache NBA stats for all qualifying players.
 * Must be run before runSkillsBatch if player_stats table is empty.
 * WARNING: Long-running — can take 30–60 minutes for a full league sweep.
 */
export async function runStatsFetch(season?: string, refresh = false): Promise<ApiResponse<{
  total: number;
  fetched: number;
  skipped: number;
  errors: number;
}>> {
  return apiFetch("/api/pipeline/fetch-stats", {
    method: "POST",
    body: JSON.stringify({ season: season ?? undefined, refresh }),
  });
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
