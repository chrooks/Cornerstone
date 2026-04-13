/**
 * playerFilters.ts — Core filter engine for the /players explorer.
 *
 * Adapted from tectonic-tools/src/components/filters.ts (same author).
 * Architecture: filters are plain objects with an `apply` function — easy to
 * define for any domain. Active filters are stored as a flat array with stable
 * IDs for drag ordering. The eval logic is fully decoupled from the UI.
 */

import type { PlayerWithSkills } from "@/lib/types";
import { SKILL_TIERS, tierToNum } from "@/lib/tiers";
import { ALL_SKILL_NAMES, SKILL_LABELS } from "@/lib/skills";

// Re-export tierToNum so existing imports from this file keep working.
export { tierToNum };

// Re-export skill metadata from the centralized source of truth.
export { ALL_SKILL_NAMES, SKILL_LABELS };

// ---------------------------------------------------------------------------
// Developer-configurable constants
// ---------------------------------------------------------------------------

/** Maximum number of active filter entries (including parens) allowed at once. */
export const MAX_ACTIVE_FILTERS = 10;

/**
 * Parse a height string like "6-5" (feet-inches) into total inches.
 * Returns null when the string can't be parsed.
 */
export function parseHeight(h: string | null | undefined): number | null {
  if (!h) return null;
  const match = h.match(/^(\d+)-(\d+)$/);
  if (!match) return null;
  return parseInt(match[1], 10) * 12 + parseInt(match[2], 10);
}

/**
 * Format a height string "6-5" (feet-inches) as `6'5"`.
 * Returns an empty string for null / unparseable input.
 */
export function formatHeight(h: string | null | undefined): string {
  if (!h) return "";
  const m = h.match(/^(\d+)-(\d+)$/);
  return m ? `${m[1]}'${m[2]}"` : h;
}

/** Format a salary in dollars as "$Xm" or "$Xk". */
export function formatSalary(salary: number | null): string {
  if (salary == null) return "—";
  if (salary >= 1_000_000) return `$${(salary / 1_000_000).toFixed(1)}m`;
  return `$${Math.round(salary / 1_000)}k`;
}

// ---------------------------------------------------------------------------
// Filter type definitions
// ---------------------------------------------------------------------------

type BaseFilter = {
  /** Label shown in the filter type dropdown. */
  label: string;
  /** The apply function determines whether a player passes this filter. */
  apply: (player: PlayerWithSkills, value: string) => boolean;
};

/** Text input filter — user types a substring or number. */
type TextFilter = BaseFilter & { inputMethod: "text" };

/**
 * Select filter — user picks from a predefined list.
 * `inputValues` may be a static array or a function of the loaded player set
 * (e.g. to derive unique team names at runtime).
 */
type SelectFilter = BaseFilter & {
  inputMethod: "select";
  inputValues: string[] | ((players: PlayerWithSkills[]) => string[]);
};

/**
 * Skill-tier filter — renders two dropdowns: skill name + minimum tier.
 * Value is encoded as "skill_name|tier_label" (e.g. "spot_up_shooter|Elite or higher").
 */
type SkillTierFilter = BaseFilter & {
  inputMethod: "skill_tier";
  skillNames: readonly string[];
  tierOptions: readonly string[];
};

/**
 * Numeric filter — renders an operator dropdown (≥ ≤ = > <) + a number input.
 * Value is encoded as "op|number" (e.g. "≥|25").
 * `unit` is an optional display hint for the placeholder (e.g. "$M", "in", "lbs").
 */
type NumericFilter = BaseFilter & {
  inputMethod: "numeric";
  unit?: string;
};

/**
 * Skill-count filter — counts how many skills are at or above a chosen tier,
 * then compares the count with an operator.
 * Renders: tier dropdown + operator dropdown + count input.
 * Value is encoded as "tier|op|count" (e.g. "Elite or higher|≥|3").
 */
type SkillCountFilter = BaseFilter & {
  inputMethod: "skill_count";
  tierOptions: readonly string[];
};

export type PlayerFilterType = TextFilter | SelectFilter | SkillTierFilter | NumericFilter | SkillCountFilter;

// ---------------------------------------------------------------------------
// Numeric operator helpers — shared by NumericFilter and SkillCountFilter
// ---------------------------------------------------------------------------

/** The five comparison operators available in numeric and skill-count filters. */
export const NUMERIC_OPERATORS = ["≥", "≤", "=", ">", "<"] as const;
export type NumericOperator = typeof NUMERIC_OPERATORS[number];

/**
 * Apply a comparison operator between a player value and a threshold.
 * Handles all five operators; returns false for unrecognised strings.
 */
function applyNumericOp(playerVal: number, op: string, threshold: number): boolean {
  switch (op) {
    case "≥": return playerVal >= threshold;
    case "≤": return playerVal <= threshold;
    case "=": return playerVal === threshold;
    case ">": return playerVal > threshold;
    case "<": return playerVal < threshold;
    default:  return false;
  }
}

/** Connector indicating how an active filter joins the one before it. */
export type FilterConnector = "AND" | "OR";

/** An active filter entry in the filter list. */
export type ActiveFilter = {
  id: string;               // stable unique ID for dnd-kit drag ordering
  filter: PlayerFilterType; // the filter template (label, apply fn, inputMethod, …)
  value: string;            // the user-selected or typed value
  connector: FilterConnector; // how this entry joins the previous one; ignored for index 0
  negated: boolean;         // if true, the filter result is inverted (NOT)
};

/** A parenthesis marker — acts as a grouping delimiter in the flat filter list. */
export type ParenMarker = {
  id: string;
  paren: "(" | ")";
  connector: FilterConnector;
};

/** The unified type stored in filter state arrays. */
export type FilterEntry = ActiveFilter | ParenMarker;

export function isParenMarker(entry: FilterEntry): entry is ParenMarker {
  return "paren" in entry;
}

// ---------------------------------------------------------------------------
// evalFilterEntries — recursive Boolean evaluator
// ---------------------------------------------------------------------------

/**
 * Recursively evaluate a FilterEntry list against a player.
 * Handles AND/OR operator precedence (AND binds tighter than OR)
 * and nested parenthesized groups — identical logic to tectonic-tools.
 */
export function evalFilterEntries(
  player: PlayerWithSkills,
  entries: FilterEntry[],
): boolean {
  if (entries.length === 0) return true;

  // Convert the flat list into segments: either a leaf or a group (paren contents)
  type Segment =
    | { connector: FilterConnector; kind: "leaf"; filter: ActiveFilter }
    | { connector: FilterConnector; kind: "group"; items: FilterEntry[] };

  const segments: Segment[] = [];
  let i = 0;
  while (i < entries.length) {
    const entry = entries[i];
    if (isParenMarker(entry)) {
      if (entry.paren === "(") {
        let depth = 1;
        let j = i + 1;
        while (j < entries.length && depth > 0) {
          const inner = entries[j];
          if (isParenMarker(inner)) {
            if (inner.paren === "(") depth++;
            else if (inner.paren === ")") depth--;
          }
          j++;
        }
        // depth===0 → j is one past the matching ")"; unmatched → include everything
        const contentEnd = depth === 0 ? j - 1 : j;
        segments.push({ connector: entry.connector, kind: "group", items: entries.slice(i + 1, contentEnd) });
        i = j;
      } else {
        i++; // unmatched ")" — skip
      }
    } else {
      segments.push({ connector: entry.connector, kind: "leaf", filter: entry });
      i++;
    }
  }

  // Split segments into AND-groups at OR boundaries (AND binds tighter than OR)
  const groups: Segment[][] = [];
  let currentGroup: Segment[] = [];
  for (const seg of segments) {
    if (seg.connector === "OR" && currentGroup.length > 0) {
      groups.push(currentGroup);
      currentGroup = [];
    }
    currentGroup.push(seg);
  }
  groups.push(currentGroup);

  // Result is true when any OR-group is fully satisfied (every AND-segment passes)
  return groups.some((group) =>
    group.every((seg) => {
      if (seg.kind === "leaf") {
        const result = seg.filter.filter.apply(player, seg.filter.value);
        return seg.filter.negated ? !result : result;
      }
      return evalFilterEntries(player, seg.items);
    }),
  );
}

// ---------------------------------------------------------------------------
// Available filter definitions
// ---------------------------------------------------------------------------

/** Tier minimum options for the skill-tier filter dropdown. */
const TIER_OPTIONS = ["Capable or higher", "Proficient or higher", "Elite or higher", "All-Time Great"] as const;

/** Minimum numeric tier for each tier option string. */
function minTierNum(option: string): number {
  switch (option) {
    case "All-Time Great":       return 4;
    case "Elite or higher":      return 3;
    case "Proficient or higher": return 2;
    case "Capable or higher":    return 1;
    default:                     return 1;
  }
}

// ---------------------------------------------------------------------------
// Position ordering — used for both sorting and the inclusive "Plays" filter.
// Hybrid positions (G, GF, F, FC) sit between the two pure positions they span.
// ---------------------------------------------------------------------------

/** Numeric sort value for each position. Hybrids fall between their neighbors. */
export const POSITION_ORDER: Record<string, number> = {
  PG: 1,
  G:  1.5,
  SG: 2,
  GF: 2.5,
  SF: 3,
  F:  3.5,
  PF: 4,
  FC: 4.5,
  C:  5,
};

export const AVAILABLE_FILTERS: PlayerFilterType[] = [
  // ── Text filters ──────────────────────────────────────────────────────────

  {
    label: "Name",
    inputMethod: "text",
    apply: (player, value) =>
      player.name.toLowerCase().includes(value.toLowerCase()),
  },

  // ── Select filters ────────────────────────────────────────────────────────

  {
    label: "Team",
    inputMethod: "select",
    // Derive unique team names from the loaded player set at runtime
    inputValues: (players) =>
      Array.from(new Set(players.map((p) => p.team).filter(Boolean) as string[])).sort(),
    apply: (player, value) => player.team === value,
  },

  {
    label: "Position",
    inputMethod: "select",
    // All 9 positions ordered from guard to center
    inputValues: ["PG", "G", "SG", "GF", "SF", "F", "PF", "FC", "C"],
    // Exact match — only players whose listed position is exactly this value
    apply: (player, value) => (player.position ?? "") === value,
  },

  {
    label: "Plays",
    inputMethod: "select",
    inputValues: ["PG", "G", "SG", "GF", "SF", "F", "PF", "FC", "C"],
    // Inclusive match — a player "plays" a position if their listed position is
    // adjacent to it in the PG→C spectrum (i.e. within ±0.5 of its sort number).
    // E.g. "Plays PF" returns players with position F, PF, or FC.
    apply: (player, value) => {
      const playerPos = player.position ?? "";
      const targetOrder = POSITION_ORDER[value];
      const playerOrder = POSITION_ORDER[playerPos];
      if (targetOrder == null || playerOrder == null) return false;
      return Math.abs(playerOrder - targetOrder) <= 0.5;
    },
  },

  // ── Numeric comparison filters — operator + value encoded as "op|n" ────────

  {
    label: "Age",
    inputMethod: "numeric",
    apply: (player, value) => {
      const [op, raw] = value.split("|");
      const n = parseFloat(raw);
      return !isNaN(n) && player.age != null && applyNumericOp(player.age, op, n);
    },
  },

  {
    label: "Height",
    inputMethod: "numeric",
    unit: "in",
    apply: (player, value) => {
      const [op, raw] = value.split("|");
      const n = parseFloat(raw);
      const h = parseHeight(player.height);
      return !isNaN(n) && h != null && applyNumericOp(h, op, n);
    },
  },

  {
    label: "Weight",
    inputMethod: "numeric",
    unit: "lbs",
    apply: (player, value) => {
      const [op, raw] = value.split("|");
      const n = parseFloat(raw);
      return !isNaN(n) && player.weight != null && applyNumericOp(player.weight, op, n);
    },
  },

  {
    label: "Salary",
    inputMethod: "numeric",
    unit: "$M",
    apply: (player, value) => {
      const [op, raw] = value.split("|");
      const n = parseFloat(raw) * 1_000_000;
      return !isNaN(n) && player.salary != null && applyNumericOp(player.salary, op, n);
    },
  },

  {
    label: "MPG",
    inputMethod: "numeric",
    apply: (player, value) => {
      const [op, raw] = value.split("|");
      const n = parseFloat(raw);
      return !isNaN(n) && player.minutes_per_game != null && applyNumericOp(player.minutes_per_game, op, n);
    },
  },

  {
    label: "Games Played",
    inputMethod: "numeric",
    apply: (player, value) => {
      const [op, raw] = value.split("|");
      const n = parseFloat(raw);
      return !isNaN(n) && player.games_played != null && applyNumericOp(player.games_played, op, n);
    },
  },

  // ── Skill-count filter — tier + operator + count encoded as "tier|op|n" ───

  {
    label: "Skill Count",
    inputMethod: "skill_count",
    tierOptions: TIER_OPTIONS,
    /**
     * Value is encoded as "tier|op|count", e.g. "Elite or higher|≥|3".
     * Counts how many of the player's skills are at or above the chosen tier,
     * then applies the operator to compare against the target count.
     */
    apply: (player, value) => {
      const parts = value.split("|");
      if (parts.length < 3) return false;
      // Tier is everything before the last two segments (op and count)
      const tier  = parts.slice(0, -2).join("|");
      const op    = parts[parts.length - 2];
      const n     = parseFloat(parts[parts.length - 1]);
      if (isNaN(n) || !player.skills) return false;
      const minNum = minTierNum(tier);
      const count  = Object.values(player.skills).filter((t) => tierToNum(t) >= minNum).length;
      return applyNumericOp(count, op, n);
    },
  },

  {
    label: "Legend",
    inputMethod: "select",
    inputValues: ["Yes", "No"],
    apply: (player, value) =>
      value === "Yes" ? player.is_legend === true : player.is_legend !== true,
  },

  // ── Skill-tier filter — two-dropdown input (skill + min tier) ─────────────

  {
    label: "Skill",
    inputMethod: "skill_tier",
    skillNames: ALL_SKILL_NAMES,
    tierOptions: TIER_OPTIONS,
    /**
     * Value is encoded as "skill_name|tier_option", e.g. "spot_up_shooter|Elite or higher".
     * The apply function decodes and compares tier numerically.
     */
    apply: (player, value) => {
      const sep = value.indexOf("|");
      if (sep === -1) return false;
      const skillName = value.slice(0, sep);
      const tierOption = value.slice(sep + 1);
      const playerTier = tierToNum(player.skills?.[skillName]);
      return playerTier >= minTierNum(tierOption);
    },
  },
];
