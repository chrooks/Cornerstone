/**
 * Calibration-page–specific types shared across the three panels.
 * These are not part of the global types.ts — they're internal to /calibration.
 */

import type {
  Player,
  PlayerSkills,
  ThresholdRow,
  AnchorsBySkill,
  SkillTestResult,
} from "@/lib/types";

export interface CalibrationState {
  // Selected player in the left panel
  selectedPlayer: Player | null;
  // Skill being calibrated (drives center + right panels)
  selectedSkill: string;
  // All 19 skill threshold rows from the DB
  thresholds: ThresholdRow[];
  // Per-skill edited (unsaved) threshold JSON — keyed by skill_name
  editedThresholds: Record<string, Record<string, unknown>>;
  // All anchors grouped by skill
  anchors: AnchorsBySkill;
  // The selected player's current skill evaluation
  playerSkills: PlayerSkills | null;
  // Skills snapshot before the last re-evaluate (for highlighting tier changes)
  previousPlayerSkills: PlayerSkills | null;
  // Last test-threshold result per skill
  testResults: Record<string, SkillTestResult>;
}
