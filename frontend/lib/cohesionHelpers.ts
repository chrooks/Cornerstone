/**
 * cohesionHelpers.ts — Adapter layer between cohesion engine responses and
 * the UI components.
 *
 * Provides a normalizer that converts CohesionNote[] into Note[] so NotesList
 * can consume them without modification.
 */

import type {
  CohesionNote,
  Note,
  NoteCategory,
  NoteSeverity,
} from "@/lib/types";

// -- Category-to-NoteCategory mapping ----------------------------------------
// Offense-oriented cohesion categories
const OFFENSE_CATEGORIES = new Set([
  "spacing",
  "shot_creation",
  "paint_touch",
  "transition",
  "off_ball",
  "off_ball_impact",
  "post_game",
  "pnr_screener",
  "pnr_pairing",
]);

// Defense-oriented cohesion categories
const DEFENSE_CATEGORIES = new Set([
  "anchor",
  "perimeter_defense",
  "interior_defense",
  "perimeter_defense_total",
  "interior_defense_total",
  "defense_gap",
  "rebounding",
]);

// -- CohesionNote.type → NoteSeverity mapping --------------------------------
const TYPE_TO_SEVERITY: Record<CohesionNote["type"], NoteSeverity> = {
  strength: "strength",
  weakness: "warning",
  suggestion: "suggestion",
};

/**
 * Derive the NoteCategory bucket from a cohesion category string.
 * Offense and defense categories map to their respective buckets;
 * anything else (e.g. "passing", "depth") falls into "roster_balance".
 */
function mapCategoryToNoteCategory(category: string): NoteCategory {
  if (OFFENSE_CATEGORIES.has(category)) return "offense";
  if (DEFENSE_CATEGORIES.has(category)) return "defense";
  return "roster_balance";
}

/**
 * Convert an array of CohesionNote objects into the legacy Note shape
 * so NotesList, bucketing logic, and suggestion click-through all work
 * without any changes to those components.
 *
 * Mapping rules (from ExecPlan Phase 1):
 *   - type → severity  (strength→strength, weakness→warning, suggestion→suggestion)
 *   - category → dimension  (for DIMENSION_FALLBACK filter click-through)
 *   - synthetic trace_key   ("cohesion_<category>_<index>")
 *   - presence_type = "presence" always (cohesion has no absence concept)
 *   - category → NoteCategory bucket (offense / defense / roster_balance)
 */
export function normalizeCohesionNotes(notes: CohesionNote[]): Note[] {
  // Use content-derived trace_key (type + category) instead of index-based.
  // Backend _dedupe_and_limit guarantees at most one note per (type, category)
  // pair, so this is unique and stable across re-evaluations.
  return notes.map((note) => ({
    severity: TYPE_TO_SEVERITY[note.type],
    category: mapCategoryToNoteCategory(note.category),
    text: note.text,
    trace_key: `cohesion_${note.type}_${note.category}`,
    presence_type: "presence" as const,
    dimension: note.category,
    engine_category: note.category,
    engine_severity: note.severity,
    engine_raw_value: note.raw_value,
  }));
}
