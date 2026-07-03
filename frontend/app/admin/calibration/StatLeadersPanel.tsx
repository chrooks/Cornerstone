"use client";

/**
 * StatLeadersPanel.tsx — Center panel for the calibration Stat Leaders view.
 *
 * Responsibilities:
 *  - Fetches all qualifying player stats once on mount via listPlayersStatsBulk
 *  - Renders the same skill-selector pill tabs as ThresholdEditorPanel
 *  - Computes derived memos: allStatKeys, activeSkillStatKeys, thresholdMap, sortedPlayers
 *  - Passes everything down to StatLeadersTable
 *  - Manages sort state with shift-click multi-sort (max 3 keys)
 *
 * Layout:
 *   flex flex-col h-full overflow-hidden
 *   ├── flex-shrink-0 border-b  ← skill tabs + Raw/Stabilized toggle
 *   └── flex-1 overflow-hidden  ← StatLeadersTable
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { listPlayersStatsBulk } from "@/lib/api";
import { SkillPickerBar } from "./SkillPickerBar";
import { StatLeadersTable, type ThresholdMap, type StatSortKey, type ComputedStatDef } from "./StatLeadersTable";
import { resolveComputedValue } from "./computed-stats";
import type { ThresholdRow, PlayerStatRow, ConditionItem } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StatLeadersPanelProps {
  /** All skill threshold rules (source of truth from parent) */
  thresholds: ThresholdRow[];
  /** Unsaved edits for any skill — override the saved rule when present */
  editedThresholds: Record<string, Record<string, unknown>>;
  /** Skill that was selected in the Threshold Editor — pre-selects the tab */
  initialSkill: string;
  /** Callback to keep the parent's selectedSkill in sync */
  onSkillSelect: (skill: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers — threshold map construction
// ---------------------------------------------------------------------------

/**
 * Walk a conditions block recursively, collecting leaf conditions
 * (those with a .stat field) and adding them to the thresholdMap
 * under the given tier key.
 *
 * Handles both flat conditions `{stat, operator, value}` and nested
 * AND/OR blocks `{logic, conditions: [...]}`.
 */
function walkConditionsBlock(
  block: unknown,
  tier: string,
  map: ThresholdMap,
): void {
  if (!block || typeof block !== "object") return;
  const b = block as Record<string, unknown>;

  // Handle top-level conditions array (standard ConditionsBlock shape)
  if (Array.isArray(b.conditions)) {
    for (const item of b.conditions as ConditionItem[]) {
      if (item.conditions) {
        // Nested block — recurse
        walkConditionsBlock(item, tier, map);
      } else if (typeof item.stat === "string" && item.operator && item.value !== undefined) {
        // Leaf condition — record it under this tier
        const key = item.stat;
        if (!map[key]) map[key] = {};
        if (!map[key][tier]) map[key][tier] = [];
        map[key][tier].push({ op: item.operator, value: item.value });
      }
    }
  }
}

/**
 * Build the threshold map for a single skill rule.
 * Maps each stat key → per-tier conditions array for Elite/Proficient/Capable.
 * The volume_gate is intentionally excluded — it's not a quality tier.
 */
function buildThresholdMap(rule: Record<string, unknown>): ThresholdMap {
  const map: ThresholdMap = {};
  const tiersObj = rule.tiers as Record<string, unknown> | undefined;
  if (!tiersObj) return map;

  for (const tier of ["Elite", "Proficient", "Capable"] as const) {
    // JSONB may store tiers as "Elite" or "elite" — check both
    const block = tiersObj[tier] ?? tiersObj[tier.toLowerCase()];
    if (block) walkConditionsBlock(block, tier, map);
  }
  return map;
}

/**
 * Collect all stat keys referenced anywhere in a threshold rule:
 * volume_gate, all tiers, and tier_bumps.
 * Returns the Set so the caller can union them.
 */
function collectStatKeysFromRule(rule: Record<string, unknown>): Set<string> {
  const keys = new Set<string>();

  const collect = (block: unknown) => {
    if (!block || typeof block !== "object") return;
    const b = block as Record<string, unknown>;
    if (Array.isArray(b.conditions)) {
      for (const item of b.conditions as ConditionItem[]) {
        if (item.conditions) {
          collect(item);
        } else if (typeof item.stat === "string") {
          keys.add(item.stat);
        }
      }
    }
  };

  // Walk volume_gate
  collect(rule.volume_gate);

  // Walk every tier block
  const tiersObj = rule.tiers as Record<string, unknown> | undefined;
  if (tiersObj) {
    for (const block of Object.values(tiersObj)) collect(block);
  }

  // Walk tier_bumps — conditions may be nested AND/OR blocks, so use collect()
  // which recursively handles both leaf {stat, operator, value} and nested {logic, conditions:[]}
  if (Array.isArray(rule.tier_bumps)) {
    for (const bump of rule.tier_bumps as Array<Record<string, unknown>>) {
      const cond = bump.condition as Record<string, unknown> | undefined;
      if (!cond) continue;
      if (typeof cond.stat === "string") {
        // Leaf condition directly on the bump
        keys.add(cond.stat);
      } else {
        // Nested block (e.g. {logic: "AND", conditions: [...]}) — recurse
        collect(cond);
      }
    }
  }

  return keys;
}

/**
 * Given all threshold rules and the editedThresholds overrides, compute the
 * superset of all stat keys referenced across every skill rule.
 * Keys are sorted: first by section name, then by the key's leaf name.
 */
function computeAllStatKeys(
  thresholds: ThresholdRow[],
  editedThresholds: Record<string, Record<string, unknown>>,
): string[] {
  const allKeys = new Set<string>();
  for (const row of thresholds) {
    // Use the edited (unsaved) version of the rule if available, else the saved one
    const rule = (editedThresholds[row.skill_name] ?? row.thresholds) as Record<string, unknown>;
    // Convert Set to array before iterating to satisfy TypeScript's downlevel iteration check
    for (const key of Array.from(collectStatKeysFromRule(rule))) {
      allKeys.add(key);
    }
  }

  // Sort by section then by leaf key name for stable column ordering
  return Array.from(allKeys).sort((a, b) => {
    const [sA, kA] = a.includes(".") ? a.split(".", 2) : ["", a];
    const [sB, kB] = b.includes(".") ? b.split(".", 2) : ["", b];
    if (sA !== sB) return sA.localeCompare(sB);
    return (kA ?? "").localeCompare(kB ?? "");
  });
}

// ---------------------------------------------------------------------------
// Sort logic
// ---------------------------------------------------------------------------

/**
 * Resolve a stat value for sorting, handling computed.* keys by deriving
 * their values from the provided computed stat definitions.
 */
function resolveStatValue(
  player: PlayerStatRow,
  key: string,
  showStabilized: boolean,
  computedDefs: ComputedStatDef[],
): number | null {
  const getRaw = (statKey: string): number | null => {
    const raw = player.stats[statKey] ?? null;
    return showStabilized ? (player.stabilized[statKey] ?? raw) : raw;
  };
  return resolveComputedValue(getRaw, key, computedDefs);
}

/** Stable multi-key sort for PlayerStatRow using the provided stat key sort keys. */
function sortPlayers(
  players: PlayerStatRow[],
  sortKeys: StatSortKey[],
  showStabilized: boolean,
  computedDefs: ComputedStatDef[],
): PlayerStatRow[] {
  if (sortKeys.length === 0) return players;
  return [...players].sort((a, b) => {
    for (const { key, dir } of sortKeys) {
      const aVal = resolveStatValue(a, key, showStabilized, computedDefs);
      const bVal = resolveStatValue(b, key, showStabilized, computedDefs);
      // Nulls sort to the end regardless of direction
      if (aVal === null && bVal === null) continue;
      if (aVal === null) return 1;
      if (bVal === null) return -1;
      const cmp = aVal - bVal;
      if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
    }
    // Stable fallback: alphabetical by name
    return a.name.localeCompare(b.name);
  });
}

// ---------------------------------------------------------------------------
// MAX_SORT_KEYS constant
// ---------------------------------------------------------------------------

const MAX_SORT_KEYS = 3;

// ---------------------------------------------------------------------------
// StatLeadersPanel
// ---------------------------------------------------------------------------

export function StatLeadersPanel({
  thresholds,
  editedThresholds,
  initialSkill,
  onSkillSelect,
}: StatLeadersPanelProps) {
  // --- Data state ---
  const [players, setPlayers] = useState<PlayerStatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // --- UI state ---
  const [activeSkill, setActiveSkill] = useState<string>(initialSkill);
  const [showStabilized, setShowStabilized] = useState(false);
  // Sort keys: array of {key, dir}, max MAX_SORT_KEYS
  const [sortKeys, setSortKeys] = useState<StatSortKey[]>([]);

  // Fetch all player stats once on mount
  useEffect(() => {
    setLoading(true);
    setFetchError(null);
    listPlayersStatsBulk()
      .then((res) => {
        if (res.success && res.data) {
          setPlayers(res.data);
        } else {
          setFetchError(res.error ?? "Failed to load player stats");
        }
      })
      .catch((err: unknown) => {
        setFetchError(err instanceof Error ? err.message : "Unknown error");
      })
      .finally(() => setLoading(false));
  }, []);

  // --- Derived memos ---

  /**
   * Superset of all stat keys referenced across ALL threshold rules.
   * Sorted by section then leaf name for consistent column ordering.
   * Recomputed whenever thresholds or editedThresholds change.
   */
  const allStatKeys = useMemo(
    () => computeAllStatKeys(thresholds, editedThresholds),
    [thresholds, editedThresholds],
  );

  /**
   * Stat keys used by the active skill only.
   * These become the pinned amber columns in the table.
   */
  const activeSkillStatKeys = useMemo((): Set<string> => {
    const rule = (editedThresholds[activeSkill] ??
      thresholds.find((t) => t.skill_name === activeSkill)?.thresholds) as
      | Record<string, unknown>
      | undefined;
    if (!rule) return new Set();
    return collectStatKeysFromRule(rule);
  }, [activeSkill, thresholds, editedThresholds]);

  /**
   * Computed stat definitions for the active skill (e.g. passer_composite).
   * These are derived stats the skill engine computes at evaluation time from
   * weighted sums of raw stats — they're not stored in player_stats, so the
   * table must compute them on the fly for tier coloring to work.
   */
  const computedStatDefs = useMemo((): ComputedStatDef[] => {
    const rule = (editedThresholds[activeSkill] ??
      thresholds.find((t) => t.skill_name === activeSkill)?.thresholds) as
      | Record<string, unknown>
      | undefined;
    if (!rule || !Array.isArray(rule.computed_stats)) return [];
    return rule.computed_stats as ComputedStatDef[];
  }, [activeSkill, thresholds, editedThresholds]);

  /**
   * Threshold conditions map for the active skill.
   * Maps each stat key → per-tier condition arrays for cell color coding.
   */
  const thresholdMap = useMemo((): ThresholdMap => {
    const rule = (editedThresholds[activeSkill] ??
      thresholds.find((t) => t.skill_name === activeSkill)?.thresholds) as
      | Record<string, unknown>
      | undefined;
    if (!rule) return {};
    return buildThresholdMap(rule);
  }, [activeSkill, thresholds, editedThresholds]);

  /**
   * Players sorted by the active sortKeys.
   * Passes computedStatDefs so computed.* keys (e.g. passer_composite) sort correctly.
   */
  const sortedPlayers = useMemo(
    () => sortPlayers(players, sortKeys, showStabilized, computedStatDefs),
    [players, sortKeys, showStabilized, computedStatDefs],
  );

  // --- Handlers ---

  /** Handle skill tab click — update local state and notify parent. */
  const handleSkillClick = useCallback(
    (skill: string) => {
      setActiveSkill(skill);
      onSkillSelect(skill);
    },
    [onSkillSelect],
  );

  /**
   * Handle column header click for sorting.
   * - Plain click: single sort key (clear others), toggle direction if already sorted
   * - Shift+click: add/toggle as secondary/tertiary key (max MAX_SORT_KEYS)
   */
  const handleHeaderClick = useCallback(
    (key: string, additive: boolean) => {
      setSortKeys((prev) => {
        const existingIdx = prev.findIndex((sk) => sk.key === key);
        if (!additive) {
          // Single sort: if already on this key, toggle direction; else replace all
          if (existingIdx >= 0 && prev.length === 1) {
            return [{ key, dir: prev[existingIdx].dir === "asc" ? "desc" : "asc" }];
          }
          return [{ key, dir: "desc" }];
        }
        // Additive sort (shift+click)
        if (existingIdx >= 0) {
          // Toggle direction of existing key
          return prev.map((sk, i) =>
            i === existingIdx
              ? { ...sk, dir: sk.dir === "asc" ? "desc" : "asc" }
              : sk,
          );
        }
        // Add new key if under the max
        if (prev.length < MAX_SORT_KEYS) {
          return [...prev, { key, dir: "desc" }];
        }
        // At max — replace the last key
        return [...prev.slice(0, MAX_SORT_KEYS - 1), { key, dir: "desc" }];
      });
    },
    [],
  );

  // --- Render ---

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ─── Skill selector (dense, collapsible) + Raw/Stabilized toggle ─── */}
      <SkillPickerBar
        selectedSkill={activeSkill}
        hasRule={(skill) => thresholds.some((t) => t.skill_name === skill)}
        onSelect={handleSkillClick}
        rightSlot={
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
              Values
            </span>
            <div className="flex rounded border border-border overflow-hidden">
              <button
                type="button"
                onClick={() => setShowStabilized(false)}
                className={cn(
                  "px-2 py-0.5 text-xs transition-colors",
                  !showStabilized
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                Raw
              </button>
              <button
                type="button"
                onClick={() => setShowStabilized(true)}
                className={cn(
                  "px-2 py-0.5 text-xs transition-colors border-l border-border",
                  showStabilized
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                Stabilized
              </button>
            </div>
          </div>
        }
      />

      {/* ─── Table area ─── */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          /* Loading spinner */
          <div className="flex h-full items-center justify-center">
            <div className="space-y-2 text-center">
              <div className="inline-block size-5 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
              <p className="text-xs text-muted-foreground">Loading player stats…</p>
            </div>
          </div>
        ) : fetchError ? (
          /* Error state */
          <div className="flex h-full items-center justify-center p-4">
            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-destructive">Failed to load stats</p>
              <p className="text-xs text-muted-foreground">{fetchError}</p>
            </div>
          </div>
        ) : (
          /* Table */
          <StatLeadersTable
            players={sortedPlayers}
            allStatKeys={allStatKeys}
            activeSkillStatKeys={activeSkillStatKeys}
            thresholdMap={thresholdMap}
            computedStatDefs={computedStatDefs}
            showStabilized={showStabilized}
            sortKeys={sortKeys}
            onHeaderClick={handleHeaderClick}
          />
        )}
      </div>
    </div>
  );
}
