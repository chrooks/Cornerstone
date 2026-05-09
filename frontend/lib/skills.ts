/**
 * lib/skills.ts — Single source of truth for all skill metadata.
 *
 * To add a new skill:
 *   1. Add it to SKILL_CATEGORIES under the appropriate confidence bucket
 *   2. Add its label to SKILL_LABELS
 *   3. Add its abbreviation to SKILL_ABBREV
 *   4. Add its type priority to SKILL_TYPE_PRIORITY
 *   5. Add it to the appropriate SKILL_GROUPS entry (legends page)
 *   6. Mirror the change in backend/services/claude_assessment.py (ALL_SKILLS in legends.py and compositing.py derive from it automatically)
 */

// ---------------------------------------------------------------------------
// Canonical skill list grouped by stat confidence
// ---------------------------------------------------------------------------

export const SKILL_CATEGORIES: Record<string, string[]> = {
  "High Confidence": [
    "spot_up_shooter",
    "off_dribble_shooter",
    "offensive_rebounder",
    "rebounder",
    "rim_protector",
    "isolation_scorer",
  ],
  Moderate: [
    "movement_shooter",
    "cutter",
    "transition_threat",
    "pnr_ball_handler",
    "pnr_finisher",
    "crafty_finisher",
    "driver",
    "vertical_spacer",
    "screen_setter",
    "passer",
    "mid_post_player",
    "low_post_player",
  ],
  "Low Confidence": [
    "versatile_defender",
    "perimeter_disruptor",
    "high_flyer",
  ],
};

/** Flat ordered list of all skill names, in display order. */
export const ALL_SKILL_NAMES: string[] = Object.values(SKILL_CATEGORIES).flat();

/** Total number of skills — derive this rather than hardcoding. */
export const TOTAL_SKILLS = ALL_SKILL_NAMES.length;

// ---------------------------------------------------------------------------
// Human-readable display names
// ---------------------------------------------------------------------------

export const SKILL_LABELS: Record<string, string> = {
  spot_up_shooter:          "Spot Up Shooter",
  off_dribble_shooter:      "Off-Dribble Shooter",
  offensive_rebounder:      "Offensive Rebounder",
  rebounder:                "Rebounder",
  rim_protector:            "Rim Protector",
  isolation_scorer:         "Isolation Scorer",
  movement_shooter:         "Movement Shooter",
  cutter:                   "Cutter",
  transition_threat:        "Transition Threat",
  pnr_ball_handler:         "PnR Ball Handler",
  pnr_finisher:             "PnR Finisher",
  crafty_finisher:          "Crafty Finisher",
  driver:                   "Driver",
  vertical_spacer:          "Vertical Spacer",
  screen_setter:            "Screen Setter",
  passer:                   "Passer",
  mid_post_player:          "Mid-Post Player",
  low_post_player:          "Low-Post Player",
  versatile_defender:       "Versatile Defender",
  perimeter_disruptor:      "Perimeter Disruptor",
  high_flyer:               "High Flyer",
};

/** Converts a skill key to its display name, with snake_case title-case fallback. */
export function formatSkillName(name: string): string {
  return (
    SKILL_LABELS[name] ??
    name.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
  );
}

// ---------------------------------------------------------------------------
// Table column abbreviations (PlayerTable)
// ---------------------------------------------------------------------------

export const SKILL_ABBREV: Record<string, string> = {
  spot_up_shooter:          "Spot Up",
  off_dribble_shooter:      "Off Drib",
  offensive_rebounder:      "Off Reb",
  rebounder:                "Reb",
  rim_protector:            "Rim Prot",
  isolation_scorer:         "Iso",
  movement_shooter:         "Move Shoot",
  cutter:                   "Cutter",
  transition_threat:        "Trans",
  pnr_ball_handler:         "PnR BH",
  pnr_finisher:             "PnR Fin",
  crafty_finisher:          "Crafty",
  driver:                   "Driver",
  vertical_spacer:          "V-Space",
  screen_setter:            "Screener",
  passer:                   "Passer",
  mid_post_player:          "Mid Post",
  low_post_player:          "Lo Post",
  versatile_defender:       "Versa Def",
  perimeter_disruptor:      "Perim Disr",
  high_flyer:               "Hi Fly",
};

// ---------------------------------------------------------------------------
// Card display priority (PlayerCard — lower = shown first)
// ---------------------------------------------------------------------------

export const SKILL_TYPE_PRIORITY: Record<string, number> = {
  // Additive (0) — always valuable to have multiples on a team
  spot_up_shooter:          0,
  movement_shooter:         0,
  rebounder:                0,
  offensive_rebounder:      0,
  rim_protector:            0,
  vertical_spacer:          0,
  screen_setter:            0,
  versatile_defender:      0,
  cutter:                   0,
  // Threshold (1) — valuable when at least one player excels
  off_dribble_shooter:      1,
  crafty_finisher:          1,
  driver:                   1,
  pnr_finisher:             1,
  passer:                   1,
  mid_post_player:          1,
  low_post_player:          1,
  high_flyer:               1,
  perimeter_disruptor:      1,
  // Zero-sum (2) — team typically needs just one at a high level
  isolation_scorer:         2,
  pnr_ball_handler:         2,
  transition_threat:        2,
};

// ---------------------------------------------------------------------------
// Public player profile — 7 horizontal category columns
// Skills within each column render in the order listed here;
// the profile component sorts them highest tier first at render time.
// ---------------------------------------------------------------------------

export const PUBLIC_SKILL_CATEGORIES: Record<string, string[]> = {
  "Perimeter Scoring":     ["spot_up_shooter", "movement_shooter", "off_dribble_shooter"],
  "On-Ball Creation":      ["isolation_scorer", "pnr_ball_handler", "driver"],
  "Off-Ball & Transition": ["cutter", "transition_threat", "pnr_finisher"],
  "Interior Scoring":      ["crafty_finisher", "high_flyer", "vertical_spacer", "mid_post_player", "low_post_player"],
  "Playmaking":            ["passer"],
  "Physicality":           ["screen_setter", "offensive_rebounder", "rebounder"],
  "Defense":               ["rim_protector", "perimeter_disruptor", "versatile_defender"],
};

/** Profile-ordered flat list of all skill names — matches PUBLIC_SKILL_CATEGORIES order. */
export const PROFILE_SKILL_ORDER: string[] = Object.values(PUBLIC_SKILL_CATEGORIES).flat();

// ---------------------------------------------------------------------------
// Legends page grouping (by skill_category type, not confidence)
// ---------------------------------------------------------------------------

export const SKILL_GROUPS: { label: string; skills: string[] }[] = [
  {
    label: "Additive Skills",
    skills: [
      "spot_up_shooter",
      "off_dribble_shooter",
      "isolation_scorer",
      "movement_shooter",
      "cutter",
      "transition_threat",
      "pnr_ball_handler",
      "pnr_finisher",
      "crafty_finisher",
      "passer",
      "offensive_rebounder",
      "vertical_spacer",
    ],
  },
  {
    label: "Threshold-Based Skills",
    skills: [
      "rebounder",
      "rim_protector",
      "screen_setter",
      "driver",
      "mid_post_player",
      "low_post_player",
    ],
  },
  {
    label: "Zero-Sum Skills",
    skills: [
      "versatile_defender",
      "perimeter_disruptor",
      "high_flyer",
    ],
  },
];
