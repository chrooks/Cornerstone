/**
 * noteFilters.ts — Maps GM suggestion notes to player-search filter descriptors.
 *
 * Used by NotesList/AssistantGmNotes to turn a suggestion like
 * "Add a perimeter spacer" into a clickable link that injects a
 * `{ skill, tier }` filter into the right-rail PlayerPickerPanel.
 *
 * Priority:
 *   1. Explicit trace-key override (complement + directional guidance rules)
 *   2. Dimension-based fallback
 *
 * Return null if the note has no meaningful filter mapping.
 */

import type { Note } from "@/lib/types";

/** A filter descriptor consumable by the player picker's skill-tier filter. */
export interface SuggestionFilter {
  skill: string;
  tier: "Capable or higher" | "Proficient or higher" | "Elite or higher" | "All-Time Great";
}

// Trace-key specific overrides — more precise than dimension fallback.
const TRACE_KEY_FILTERS: Record<string, SuggestionFilter> = {
  // Cornerstone complement rules (cornerstone_complement.py)
  COMPLEMENT_CREATOR:      { skill: "pnr_ball_handler",   tier: "Capable or higher" },
  COMPLEMENT_PNR_FINISHER: { skill: "pnr_finisher",       tier: "Capable or higher" },
  COMPLEMENT_SPACING:      { skill: "spot_up_shooter",    tier: "Capable or higher" },
  COMPLEMENT_RIM:          { skill: "rim_protector",      tier: "Capable or higher" },
  COMPLEMENT_PASSER:       { skill: "passer",             tier: "Capable or higher" },
  COMPLEMENT_PERIMETER_D:  { skill: "versatile_defender", tier: "Capable or higher" },
  COMPLEMENT_REBOUNDER:    { skill: "rebounder",          tier: "Capable or higher" },
};

// Default skill to surface when only a dimension is known.
// Includes both legacy dimension keys and cohesion engine category keys.
const DIMENSION_FALLBACK: Record<string, SuggestionFilter> = {
  // Legacy dimension keys
  spacing:    { skill: "spot_up_shooter",    tier: "Capable or higher" },
  creation:   { skill: "pnr_ball_handler",   tier: "Capable or higher" },
  paint:      { skill: "driver",             tier: "Capable or higher" },
  defense:    { skill: "versatile_defender", tier: "Capable or higher" },
  transition: { skill: "transition_threat",  tier: "Capable or higher" },
  // Cohesion engine category keys (mapped to closest skill filter)
  shot_creation:  { skill: "pnr_ball_handler",   tier: "Capable or higher" },
  paint_touch:    { skill: "driver",             tier: "Capable or higher" },
  anchor:         { skill: "rim_protector",      tier: "Capable or higher" },
  post_game:      { skill: "low_post_player",    tier: "Capable or higher" },
  pnr_screener:   { skill: "pnr_finisher",       tier: "Capable or higher" },
  off_ball:       { skill: "cutter",             tier: "Capable or higher" },
  rebounding:     { skill: "rebounder",          tier: "Capable or higher" },
  passing:        { skill: "passer",             tier: "Capable or higher" },
  defense_gap:    { skill: "versatile_defender", tier: "Capable or higher" },
};

/**
 * Derive a player-search filter from a suggestion note.
 * Prefers the trace_key override; falls back to the note's dimension.
 */
export function mapNoteToFilter(note: Note): SuggestionFilter | null {
  const byTrace = TRACE_KEY_FILTERS[note.trace_key];
  if (byTrace) return byTrace;
  if (note.dimension && DIMENSION_FALLBACK[note.dimension]) {
    return DIMENSION_FALLBACK[note.dimension];
  }
  return null;
}
