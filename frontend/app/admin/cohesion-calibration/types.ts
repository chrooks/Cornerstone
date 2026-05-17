/**
 * types.ts — Shared type definitions for the cohesion calibration page and its components.
 */

import type { CohesionLineupCombination, CohesionLineupSummary, CohesionPlayerComposites, Player } from "@/lib/types";

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

/** Composite data for one player, fetched from GET /api/cohesion/player/<id>/composites. */
export interface PlayerCompositeData {
  player_id: string;
  name: string;
  height: string | null;
  skills: Record<string, string>;
  composites_raw: Record<string, number>;
  composites_normalized: Record<string, number>;
  bell_curve: {
    amplitude: number;
    peak: number;
    range_down: number;
    range_up: number;
    flat_down: number;
    flat_up: number;
  };
}

/** Bell curve data for one player, fetched from GET /api/cohesion/bell-curve/<id>. */
export interface BellCurveData {
  player_id: string;
  name: string;
  curve: { height: number; height_display: string; value: number }[];
}

// ---------------------------------------------------------------------------
// Lineup tester types
// ---------------------------------------------------------------------------

/** RP-PD boost info from the cohesion engine (rim protector → perimeter defender). */
export interface RpPdBoostInfo {
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
}

/** A player slot in the lineup tester. */
export interface LineupSlot {
  player: Player | null;
  skills: Record<string, string>;
  rawComposites: Record<string, number>;
  normalizedComposites: Record<string, number>;
  bellCurve: PlayerCompositeData["bell_curve"] | null;
  height: string | null;
  replacing: boolean;
}

/** Lineup test result from POST /api/cohesion/lineup/evaluate. */
export interface LineupTestResult {
  id: string;
  timestamp: number;
  playerIds: string[];
  playerNames: string[];
  cohesion_score: number;
  mode?: "lineup" | "rotation";
  subscores: Record<string, number>;
  synergies_applied: string[];
  archetype_labels?: string[];
  archetype_details?: {
    archetype: string;
    subscore_key: string | null;
    subscore_value: number;
  }[];
  accentuation: { strength_amplification: number; weakness_coverage: number };
  accentuation_details?: {
    strength?: { score: number; credit: number; checks: number; terms: Record<string, unknown>[] };
    weakness?: { score: number; credit: number; checks: number; terms: Record<string, unknown>[] };
  };
  /** RP-PD boosted bell curves — reflects the actual defensive picture the engine scores. */
  boosted_bell_curves?: (PlayerCompositeData["bell_curve"] | null)[];
  /** Teammate perimeter-disruptor boosts created by the lineup's best rim protector. */
  rp_pd_boosts?: RpPdBoostInfo[];
  star_rating?: number;
  star_rating_breakdown?: {
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
  lineup_summary?: CohesionLineupSummary;
  lineup_combinations?: CohesionLineupCombination[];
  player_composites?: CohesionPlayerComposites[];
  selectedCombinationIndex?: number;
}

/** Active tab in the center panel. */
export type CenterTab = "bell_curves" | "lineup" | "weights" | "handlers";
