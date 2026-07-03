"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { formatSkillName } from "@/lib/skills";
import { SkillPickerBar } from "./SkillPickerBar";
import { ALL_STAT_KEYS, getStatLabel } from "@/lib/stat-keys";
import type {
  ThresholdRow,
  ThresholdRule,
  ConditionItem,
  ConditionsBlock,
  SkillTestResult,
  ConditionResult,
  AnchorsBySkill,
  StatConfidence,
} from "@/lib/types";

// Monaco editor is loaded client-side only to avoid SSR issues
const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((m) => m.default),
  { ssr: false, loading: () => <div className="h-64 bg-muted/30 animate-pulse rounded" /> }
);

interface ThresholdEditorPanelProps {
  selectedSkill: string;
  thresholds: ThresholdRow[];
  editedThresholds: Record<string, Record<string, unknown>>;
  onThresholdChange: (skillName: string, rule: Record<string, unknown>) => void;
  anchors: AnchorsBySkill;
  testResults: Record<string, SkillTestResult>;
  onSkillSelect: (skillName: string) => void;
  leagueAverages: Record<string, number>;
  /**
   * Test All results, owned by CalibrationWorkspace so CalibrationActionBar's
   * "Test All" button can populate it even though it renders this summary table.
   */
  testAllResults: SkillTestResult[];
  showTestAllResults: boolean;
  onDismissTestAllResults: () => void;
  /**
   * Reports the advanced JSON editor's effective error state up to the
   * workspace (null whenever not in advanced mode or the JSON is valid) so
   * CalibrationActionBar can gate Stage Edit / Test Anchors on it even
   * though those buttons live outside this component.
   */
  onJsonErrorChange: (error: string | null) => void;
  /**
   * Skills with an uncommitted threshold_edit run → run_id, owned by
   * CalibrationWorkspace (CalibrationActionBar updates it after staging;
   * this panel only reads it to render the "Staged" badge).
   */
  stagedRuns: Record<string, string>;
  /**
   * Optional: called when the "Staged" badge is clicked so the caller can
   * deep-link to the Pipeline tab for that run.
   */
  onStagedEdit?: (runId: string) => void;
}

/**
 * Immutably update a value at an arbitrary path within a nested object/array.
 * Accepts any value type so it can handle numbers, strings, and booleans.
 */
function updateAtPath(
  obj: unknown,
  path: (string | number)[],
  value: unknown
): unknown {
  if (path.length === 0) return value;
  const [key, ...rest] = path;
  if (Array.isArray(obj)) {
    const arr = [...obj];
    arr[key as number] = updateAtPath(arr[key as number], rest, value);
    return arr;
  }
  if (obj && typeof obj === "object") {
    return { ...(obj as Record<string, unknown>), [key]: updateAtPath((obj as Record<string, unknown>)[key], rest, value) };
  }
  return obj;
}

/** Operators available for condition editing */
const OPERATORS = [">=", "<=", ">", "<", "==", "!="] as const;

/** Per modifier options */
const PER_OPTIONS = [
  { value: "", label: "—" },
  { value: "game", label: "game" },
  { value: "season", label: "season" },
] as const;

/**
 * Render a single editable condition row (leaf or nested OR/AND block).
 * Leaf rows show fully editable stat/operator/per/value fields with hover-reveal
 * delete control. Pending-deleted rows render struck through until saved.
 */
function ConditionRow({
  condition,
  path,
  onValueChange,
  onDelete,
  onUndoDelete,
  depth = 0,
}: {
  condition: ConditionItem;
  path: (string | number)[];
  onValueChange: (path: (string | number)[], value: unknown) => void;
  onDelete: (path: (string | number)[]) => void;
  onUndoDelete: (path: (string | number)[]) => void;
  depth?: number;
}) {
  // Nested block — render recursively with indentation
  if (condition.conditions) {
    const logic = condition.logic ?? "OR";
    return (
      <div
        className={cn(
          "border-l-2 pl-3 my-1",
          logic === "OR" ? "border-amber-300" : "border-blue-300"
        )}
      >
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">
          {logic}
        </span>
        {condition.conditions.map((child, i) => (
          <ConditionRow
            key={i}
            condition={child as ConditionItem}
            path={[...path, "conditions", i]}
            onValueChange={onValueChange}
            onDelete={onDelete}
            onUndoDelete={onUndoDelete}
            depth={depth + 1}
          />
        ))}
      </div>
    );
  }

  // Pending-delete state: show struck-through row with undo button
  if (condition._deleted) {
    return (
      <div className="flex items-center gap-2 py-1 text-xs opacity-50 line-through">
        <span className="flex-1 font-mono text-[10px] text-muted-foreground truncate">
          {getStatLabel(condition.stat ?? "")}
        </span>
        <span className="text-muted-foreground font-mono w-5 text-center">{condition.operator}</span>
        <span className="font-mono w-16 text-right">{condition.value ?? 0}</span>
        {/* Undo delete — removes line-through and restores the row */}
        <button
          type="button"
          title="Undo delete"
          onClick={() => onUndoDelete(path)}
          className="no-underline not-italic opacity-100 text-[10px] text-blue-500 hover:text-blue-700 px-1 flex-shrink-0"
          style={{ textDecoration: "none" }}
        >
          undo
        </button>
      </div>
    );
  }

  // Active leaf condition row — fully editable with hover-reveal delete button
  return (
    // group/ allows the hover-reveal delete button to respond to row hover
    <div className="group/row flex items-center gap-1.5 py-1 text-xs">
      {/* Stat key — searchable datalist input showing human label */}
      <input
        list="stat-keys-datalist"
        value={condition.stat ?? ""}
        onChange={(e) => onValueChange([...path, "stat"], e.target.value)}
        placeholder="stat key…"
        className={cn(
          "flex-1 min-w-0 border border-input rounded px-1.5 py-0.5 text-[10px] font-mono",
          "focus:outline-none focus:ring-1 focus:ring-ring bg-background truncate"
        )}
        title={condition.stat}
      />
      {/* Operator select */}
      <select
        value={condition.operator ?? ">="}
        onChange={(e) => onValueChange([...path, "operator"], e.target.value)}
        className={cn(
          "w-12 border border-input rounded px-1 py-0.5 text-[10px] font-mono",
          "focus:outline-none focus:ring-1 focus:ring-ring bg-background flex-shrink-0"
        )}
      >
        {OPERATORS.map((op) => (
          <option key={op} value={op}>{op}</option>
        ))}
      </select>
      {/* Per modifier select */}
      <select
        value={condition.per ?? ""}
        onChange={(e) => onValueChange([...path, "per"], e.target.value || undefined)}
        className={cn(
          "w-16 border border-input rounded px-1 py-0.5 text-[10px]",
          "focus:outline-none focus:ring-1 focus:ring-ring bg-background flex-shrink-0"
        )}
      >
        {PER_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {/* Numeric value input */}
      <input
        type="number"
        step="0.01"
        value={condition.value ?? 0}
        onChange={(e) => onValueChange([...path, "value"], parseFloat(e.target.value))}
        className={cn(
          "w-20 text-right border border-input rounded px-1.5 py-0.5 text-xs font-mono",
          "focus:outline-none focus:ring-1 focus:ring-ring bg-background flex-shrink-0"
        )}
      />
      {/* Hover-reveal delete button — visible only on row hover */}
      <button
        type="button"
        title="Delete condition (staged — won't apply until Save)"
        onClick={() => onDelete(path)}
        className={cn(
          "flex-shrink-0 w-5 h-5 flex items-center justify-center rounded",
          "text-muted-foreground hover:text-red-600 hover:bg-red-50",
          "opacity-0 group-hover/row:opacity-100 transition-opacity text-[11px] leading-none"
        )}
      >
        ×
      </button>
    </div>
  );
}

/**
 * Render a conditions block (volume gate or tier threshold).
 * Includes an "+ Add condition" button for leaf-only groups.
 */
function ConditionsBlockEditor({
  block,
  path,
  onValueChange,
  onDelete,
  onUndoDelete,
}: {
  block: ConditionsBlock;
  path: (string | number)[];
  onValueChange: (path: (string | number)[], value: unknown) => void;
  onDelete: (path: (string | number)[]) => void;
  onUndoDelete: (path: (string | number)[]) => void;
}) {
  if (!block?.conditions) return <span className="text-xs text-muted-foreground">—</span>;

  // Determine whether the top-level conditions are all leaf conditions (no nested blocks).
  // Only show the "Add condition" button for flat groups to avoid complexity with nested logic.
  const allLeaves = block.conditions.every(
    (c) => !(c as ConditionItem).conditions
  );

  /** Append a new blank leaf condition to this group */
  const handleAddCondition = () => {
    const newCondition: ConditionItem = { stat: "", operator: ">=", value: 0 };
    onValueChange(
      [...path, "conditions", block.conditions!.length],
      newCondition
    );
  };

  return (
    <div className="space-y-0.5">
      {block.conditions.map((cond, i) => (
        <ConditionRow
          key={i}
          condition={cond as ConditionItem}
          path={[...path, "conditions", i]}
          onValueChange={onValueChange}
          onDelete={onDelete}
          onUndoDelete={onUndoDelete}
        />
      ))}
      {/* Add condition button — only shown for flat (all-leaf) groups */}
      {allLeaves && (
        <button
          type="button"
          onClick={handleAddCondition}
          className={cn(
            "mt-1 flex items-center gap-1 text-[10px] text-muted-foreground",
            "hover:text-primary transition-colors"
          )}
        >
          <span className="text-sm leading-none">+</span>
          <span>Add condition</span>
        </button>
      )}
    </div>
  );
}

/** Tier options for the bump ceiling/floor picker */
const TIER_OPTIONS = [
  { value: "", label: "None" },
  { value: "Capable", label: "Capable" },
  { value: "Proficient", label: "Proficient" },
  { value: "Elite", label: "Elite" },
  { value: "All-Time Great", label: "All-Time Great" },
];

/** Effect options for new tier bumps */
const BUMP_EFFECT_OPTIONS = [
  { value: "bump_up_one_tier", label: "Bump up one tier" },
  { value: "bump_down_one_tier", label: "Bump down one tier" },
];

/**
 * Inline form for adding a new tier bump.
 * Rendered below the existing bumps list, hidden behind a "+ Add bump" toggle.
 */
function AddBumpForm({
  onAdd,
}: {
  onAdd: (bump: {
    condition: ConditionItem;
    effect: string;
    max_tier?: string;
    min_tier?: string;
  }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [effect, setEffect] = useState("bump_up_one_tier");
  const [tierValue, setTierValue] = useState("");
  const [stat, setStat] = useState("");
  const [operator, setOperator] = useState(">=");
  const [value, setValue] = useState(0);

  const tierLabel = effect === "bump_up_one_tier" ? "Max tier (ceiling)" : "Min tier (floor)";

  const handleAdd = () => {
    if (!stat) return;
    const bump: {
      condition: ConditionItem;
      effect: string;
      max_tier?: string;
      min_tier?: string;
    } = {
      condition: { stat, operator, value },
      effect,
    };
    if (effect === "bump_up_one_tier" && tierValue) bump.max_tier = tierValue;
    if (effect === "bump_down_one_tier" && tierValue) bump.min_tier = tierValue;
    onAdd(bump);
    // Reset form
    setStat("");
    setOperator(">=");
    setValue(0);
    setTierValue("");
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
      >
        <span className="text-sm leading-none">+</span>
        <span>Add bump</span>
      </button>
    );
  }

  return (
    <div className="mt-2 border border-dashed border-border rounded p-2 space-y-2 bg-muted/10">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
        New Tier Bump
      </div>
      {/* Effect picker */}
      <div className="flex items-center gap-2">
        <label className="text-[10px] text-muted-foreground w-20 flex-shrink-0">Effect</label>
        <select
          value={effect}
          onChange={(e) => setEffect(e.target.value)}
          className="flex-1 border border-input rounded px-1.5 py-0.5 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {BUMP_EFFECT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      {/* Ceiling / floor tier picker */}
      <div className="flex items-center gap-2">
        <label className="text-[10px] text-muted-foreground w-20 flex-shrink-0">{tierLabel}</label>
        <select
          value={tierValue}
          onChange={(e) => setTierValue(e.target.value)}
          className="flex-1 border border-input rounded px-1.5 py-0.5 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {TIER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      {/* Condition fields */}
      <div className="space-y-1">
        <div className="text-[10px] text-muted-foreground font-medium">Condition</div>
        <div className="flex items-center gap-1.5">
          <input
            list="stat-keys-datalist"
            value={stat}
            onChange={(e) => setStat(e.target.value)}
            placeholder="stat key…"
            className="flex-1 min-w-0 border border-input rounded px-1.5 py-0.5 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-ring bg-background"
          />
          <select
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
            className="w-12 border border-input rounded px-1 py-0.5 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-ring bg-background flex-shrink-0"
          >
            {OPERATORS.map((op) => (
              <option key={op} value={op}>{op}</option>
            ))}
          </select>
          <input
            type="number"
            step="0.01"
            value={value}
            onChange={(e) => setValue(parseFloat(e.target.value))}
            className="w-20 text-right border border-input rounded px-1.5 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring bg-background flex-shrink-0"
          />
        </div>
      </div>
      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleAdd}
          disabled={!stat}
          className="text-xs px-2.5 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs px-2.5 py-1 rounded border border-border hover:bg-muted transition-colors text-muted-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Editor for the tier_bumps array. Supports viewing and editing existing bumps
 * (both leaf and AND/OR block conditions), deleting with pending-delete staging,
 * and adding new bumps via inline form.
 */
function TierBumpEditor({
  bumps,
  basePath,
  onValueChange,
  onDeleteBump,
  onUndoDeleteBump,
  onAddBump,
}: {
  bumps: Array<{
    condition: ConditionItem;
    effect: string;
    max_tier?: string;
    min_tier?: string;
    _deleted?: boolean;
  }>;
  basePath: (string | number)[];
  onValueChange: (path: (string | number)[], value: unknown) => void;
  onDeleteBump: (index: number) => void;
  onUndoDeleteBump: (index: number) => void;
  onAddBump: (bump: {
    condition: ConditionItem;
    effect: string;
    max_tier?: string;
    min_tier?: string;
  }) => void;
}) {
  return (
    <div className="space-y-2">
      {bumps.map((bump, i) => {
        const cond = bump.condition as ConditionItem;
        if (!cond) return null;

        // Pending-delete state: show struck-through with undo
        if (bump._deleted) {
          return (
            <div key={i} className="flex items-center gap-2 text-xs opacity-50 line-through">
              <span className="flex-1 font-mono text-[10px] text-muted-foreground truncate">
                {cond.stat ?? "(block condition)"}
              </span>
              <span className="text-[10px] text-muted-foreground">{bump.effect}</span>
              <button
                type="button"
                onClick={() => onUndoDeleteBump(i)}
                className="no-underline not-italic opacity-100 text-[10px] text-blue-500 hover:text-blue-700 px-1 flex-shrink-0"
                style={{ textDecoration: "none" }}
              >
                undo
              </button>
            </div>
          );
        }

        // AND/OR block condition — render each leaf as editable
        if (cond.conditions) {
          return (
            <div key={i} className="group/bump space-y-1 rounded border border-border/50 px-2 py-1.5 bg-muted/5">
              {/* Block header with effect label and hover-delete */}
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className="font-semibold uppercase">{cond.logic ?? "AND"}</span>
                {bump.effect === "bump_down_one_tier"
                  ? <span className="text-orange-500">↓ floor: {bump.min_tier ?? "—"}</span>
                  : <span>→ ceiling: {bump.max_tier ?? "—"}</span>
                }
                <span className="ml-auto text-[9px] bg-muted px-1 rounded">{bump.effect}</span>
                {/* Hover-reveal delete for the whole bump */}
                <button
                  type="button"
                  title="Delete this tier bump (staged)"
                  onClick={() => onDeleteBump(i)}
                  className={cn(
                    "w-5 h-5 flex items-center justify-center rounded flex-shrink-0",
                    "text-muted-foreground hover:text-red-600 hover:bg-red-50",
                    "opacity-0 group-hover/bump:opacity-100 transition-opacity text-[11px]"
                  )}
                >
                  ×
                </button>
              </div>
              {/* Leaf conditions within the block — each fully editable */}
              {(cond.conditions as ConditionItem[]).map((leaf, j) => (
                <div key={j} className="flex items-center gap-1.5 pl-3 border-l border-border">
                  <input
                    list="stat-keys-datalist"
                    value={leaf.stat ?? ""}
                    onChange={(e) =>
                      onValueChange(
                        [...basePath, i, "condition", "conditions", j, "stat"],
                        e.target.value
                      )
                    }
                    placeholder="stat key…"
                    className="flex-1 min-w-0 border border-input rounded px-1.5 py-0.5 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-ring bg-background"
                    title={leaf.stat}
                  />
                  <select
                    value={leaf.operator ?? ">="}
                    onChange={(e) =>
                      onValueChange(
                        [...basePath, i, "condition", "conditions", j, "operator"],
                        e.target.value
                      )
                    }
                    className="w-12 border border-input rounded px-1 py-0.5 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-ring bg-background flex-shrink-0"
                  >
                    {OPERATORS.map((op) => (
                      <option key={op} value={op}>{op}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    value={leaf.value ?? 0}
                    onChange={(e) =>
                      onValueChange(
                        [...basePath, i, "condition", "conditions", j, "value"],
                        parseFloat(e.target.value)
                      )
                    }
                    className="w-20 text-right border border-input rounded px-1.5 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring bg-background flex-shrink-0"
                  />
                </div>
              ))}
            </div>
          );
        }

        // Leaf condition bump — single stat, fully editable with hover-delete
        if (!cond.stat && cond.stat !== "") return null;
        return (
          <div key={i} className="group/bump flex items-center gap-1.5 text-xs py-0.5">
            {/* Stat key */}
            <input
              list="stat-keys-datalist"
              value={cond.stat ?? ""}
              onChange={(e) =>
                onValueChange([...basePath, i, "condition", "stat"], e.target.value)
              }
              placeholder="stat key…"
              className="flex-1 min-w-0 border border-input rounded px-1.5 py-0.5 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-ring bg-background"
              title={cond.stat}
            />
            {/* Operator */}
            <select
              value={cond.operator ?? ">="}
              onChange={(e) =>
                onValueChange([...basePath, i, "condition", "operator"], e.target.value)
              }
              className="w-12 border border-input rounded px-1 py-0.5 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-ring bg-background flex-shrink-0"
            >
              {OPERATORS.map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
            {/* Value */}
            <input
              type="number"
              step="0.01"
              value={cond.value ?? 0}
              onChange={(e) =>
                onValueChange([...basePath, i, "condition", "value"], parseFloat(e.target.value))
              }
              className="w-20 text-right border border-input rounded px-1.5 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring bg-background flex-shrink-0"
            />
            {/* Effect / tier label */}
            {bump.effect === "bump_down_one_tier"
              ? <span className="text-[10px] text-orange-500 flex-shrink-0">↓ floor: {bump.min_tier ?? "—"}</span>
              : <span className="text-[10px] text-muted-foreground flex-shrink-0">↑ ceil: {bump.max_tier ?? "—"}</span>
            }
            {/* Hover-reveal delete button */}
            <button
              type="button"
              title="Delete this tier bump (staged)"
              onClick={() => onDeleteBump(i)}
              className={cn(
                "flex-shrink-0 w-5 h-5 flex items-center justify-center rounded",
                "text-muted-foreground hover:text-red-600 hover:bg-red-50",
                "opacity-0 group-hover/bump:opacity-100 transition-opacity text-[11px] leading-none"
              )}
            >
              ×
            </button>
          </div>
        );
      })}
      {/* Add bump inline form */}
      <AddBumpForm onAdd={onAddBump} />
    </div>
  );
}

const SECTION_LABELS_TEST: Record<string, string> = {
  volume_gate: "Volume Gate",
  "all-time great": "All-Time Great",
  elite: "Elite",
  proficient: "Proficient",
  capable: "Capable",
  tier_bump: "Tier Bump",
};

/** Expandable per-condition breakdown for a single anchor player */
function AnchorConditionBreakdown({
  conditions,
  nudge,
}: {
  conditions: ConditionResult[];
  /** Version-stamped nudge from the parent "Expand/Collapse all" buttons.
   *  When the version changes, local open state is synced to nudge.open,
   *  then individual toggling works normally again. */
  nudge?: { open: boolean; v: number };
}) {
  const [localOpen, setLocalOpen] = useState(false);
  // When a new nudge arrives (version changes), snap local state to match —
  // after that individual toggling is fully independent.
  useEffect(() => {
    if (nudge !== undefined) setLocalOpen(nudge.open);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nudge?.v]);
  const open = localOpen;

  // Group by section in display order
  const sectionOrder = ["volume_gate", "all-time great", "elite", "proficient", "capable", "tier_bump"] as const;
  const grouped = sectionOrder
    .map((s) => ({ section: s, items: conditions.filter((c) => c.section === s) }))
    .filter((g) => g.items.length > 0);

  if (grouped.length === 0) return null;

  const fmt = (c: ConditionResult, v: number | null) =>
    v === null ? "—" : c.stat.endsWith("_pct") ? (v * 100).toFixed(1) + "%" : v.toFixed(2);

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setLocalOpen((v) => !v)}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>{open ? "Hide" : "Show"} condition breakdown</span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-2">
          {grouped.map(({ section, items }) => {
            // Build a list of render nodes: insert a logic label row whenever the group_id changes
            const nodes: React.ReactNode[] = [];
            let lastGroupId: number | null | undefined = undefined;

            items.forEach((c, i) => {
              // Emit a group label when entering a new group
              if (c.group_id !== lastGroupId) {
                lastGroupId = c.group_id;
                // Only show logic label for non-trivial groups (depth > 0 or OR logic)
                if (c.group_logic && (c.depth > 0 || c.group_logic === "OR")) {
                  nodes.push(
                    <div
                      key={`label-${c.group_id}`}
                      className="flex items-center gap-1 mt-1"
                      style={{ paddingLeft: `${c.depth * 12}px` }}
                    >
                      <span className={cn(
                        "text-[9px] font-bold px-1 py-0.5 rounded uppercase tracking-wide",
                        c.group_logic === "OR"
                          ? "bg-purple-100 text-purple-700"
                          : "bg-blue-100 text-blue-700"
                      )}>
                        {c.group_logic}
                      </span>
                      {/* Connecting line for visual grouping */}
                      <span className="flex-1 border-t border-dashed border-muted-foreground/30" />
                    </div>
                  );
                }
              }

              const statLabel = c.stat.split(".").pop() ?? c.stat;
              const passIcon =
                c.passed === null ? (
                  <span className="text-muted-foreground" title="Data missing">?</span>
                ) : c.passed ? (
                  <span className="text-emerald-600">✓</span>
                ) : (
                  <span className="text-red-600">✗</span>
                );

              nodes.push(
                <div
                  key={i}
                  className={cn(
                    "flex items-center gap-1.5 text-[10px] font-mono px-1.5 py-0.5 rounded",
                    c.passed === true && "bg-emerald-50",
                    c.passed === false && "bg-red-50",
                    c.passed === null && "bg-muted/30"
                  )}
                  style={{ marginLeft: `${c.depth * 12}px` }}
                >
                  {passIcon}
                  <span className="flex-1 truncate text-muted-foreground" title={c.stat}>
                    {statLabel}
                    {c.stabilized && <span className="ml-0.5 text-amber-500" title="Stabilized">~</span>}
                    {c.per === "season" && <span className="ml-0.5 text-blue-400" title="Season total">/s</span>}
                  </span>
                  <span className={cn("font-semibold", c.passed === false ? "text-red-700" : "text-foreground")}>
                    {fmt(c, c.actual_value)}
                  </span>
                  <span className="text-muted-foreground">{c.operator}</span>
                  <span className="text-muted-foreground">{fmt(c, c.threshold)}</span>
                </div>
              );
            });

            return (
              <div key={section}>
                <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                  {SECTION_LABELS_TEST[section]}
                </div>
                <div className="space-y-0.5">{nodes}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Anchor test result inline display */
function TestResultDisplay({ result }: { result: SkillTestResult }) {
  // Version-stamped nudge — when version increments all breakdowns sync their
  // local open state, then individual toggling is fully independent again.
  const [allNudge, setAllNudge] = useState<{ open: boolean; v: number } | null>(null);

  return (
    <div className="space-y-2">
      {/* Sticky header row — stays visible while scrolling through long anchor result lists.
          top-[-0.75rem] compensates for the scroll container's py-3 (0.75rem) top padding so the
          bar sticks flush against the editor header above with no gap. */}
      <div className="sticky top-[-0.75rem] z-10 bg-background -mx-4 px-4 py-1.5 border-b border-border flex items-center gap-3 text-xs">
        <span className="font-medium">{result.anchors_tested} anchors tested</span>
        <span className="text-emerald-600">{result.passed} passed</span>
        {result.failed > 0 && <span className="text-red-600">{result.failed} failed</span>}
        {/* Both expand/collapse buttons are always visible so you can batch-toggle
            at any time, then independently toggle individual breakdowns after. */}
        <div className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground">
          <button
            type="button"
            onClick={() => setAllNudge((n) => ({ open: true, v: (n?.v ?? 0) + 1 }))}
            className="hover:text-foreground transition-colors"
          >
            Expand all
          </button>
          <span>·</span>
          <button
            type="button"
            onClick={() => setAllNudge((n) => ({ open: false, v: (n?.v ?? 0) + 1 }))}
            className="hover:text-foreground transition-colors"
          >
            Collapse all
          </button>
        </div>
      </div>
      {[...result.results]
        .sort((a, b) => {
          // Sort by expected tier highest-first using SKILL_TIERS index
          const tierOrder: Record<string, number> = {
            "All-Time Great": 0, Elite: 1, Proficient: 2, Capable: 3, None: 4,
          };
          return (tierOrder[a.expected_tier] ?? 5) - (tierOrder[b.expected_tier] ?? 5);
        })
        .map((r) => (
        <div
          key={r.player_id}
          id={`anchor-result-${r.player_id}`}
          className={cn(
            "rounded-md border p-2 text-xs",
            r.passed ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{r.player_name}</span>
            <span className={cn("font-bold text-[11px]", r.passed ? "text-emerald-700" : "text-red-700")}>
              {r.passed ? "✓ Pass" : "✗ Fail"}
            </span>
          </div>
          {/* Tier mismatch summary */}
          {!r.passed && !r.error && (
            <div className="mt-0.5 text-muted-foreground">
              Expected <strong>{r.expected_tier}</strong> → got{" "}
              <strong>{r.actual_tier}</strong>
              {r.data_missing && <span className="ml-1 text-amber-600">(data missing)</span>}
            </div>
          )}
          {r.error && <div className="mt-0.5 text-muted-foreground italic">{r.error}</div>}
          {/* Per-condition expandable breakdown */}
          {r.condition_results?.length > 0 && (
            <AnchorConditionBreakdown
              conditions={r.condition_results}
              nudge={allNudge ?? undefined}
            />
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Center panel — threshold editor with default form view and full JSON advanced view.
 * Includes skill selector tabs, save/test controls, and "re-evaluate player" button.
 */
export function ThresholdEditorPanel({
  selectedSkill,
  thresholds,
  editedThresholds,
  onThresholdChange,
  anchors,
  testResults,
  onSkillSelect,
  leagueAverages,
  testAllResults,
  showTestAllResults,
  onDismissTestAllResults,
  onJsonErrorChange,
  stagedRuns,
  onStagedEdit,
}: ThresholdEditorPanelProps) {
  const [isAdvancedMode, setIsAdvancedMode] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Get the current threshold row for the selected skill
  const thresholdRow = thresholds.find((t) => t.skill_name === selectedSkill);
  // Use edited version if present, otherwise fall back to saved DB rule.
  // Memoized so useCallback/useEffect deps stay stable.
  const currentRule = useMemo<Record<string, unknown>>(
    () =>
      (editedThresholds[selectedSkill] as Record<string, unknown>) ??
      (thresholdRow?.thresholds as Record<string, unknown>) ??
      {},
    [editedThresholds, selectedSkill, thresholdRow?.thresholds]
  );

  // Sync the JSON editor text when switching to advanced mode or when skill changes
  useEffect(() => {
    if (isAdvancedMode) {
      setJsonText(JSON.stringify(currentRule, null, 2));
      setJsonError(null);
    }
  }, [isAdvancedMode, selectedSkill, currentRule]);

  // Report the effective JSON error up to the workspace — null whenever the
  // advanced editor isn't open, so CalibrationActionBar's Stage Edit / Test
  // Anchors buttons never get stuck disabled by a stale error from a prior
  // advanced-mode session.
  useEffect(() => {
    onJsonErrorChange(isAdvancedMode ? jsonError : null);
  }, [isAdvancedMode, jsonError, onJsonErrorChange]);

  // Accepts any value type — numbers for threshold values, strings for
  // stat_confidence, booleans for always_flag_for_review
  const handleValueChange = useCallback(
    (path: (string | number)[], value: unknown) => {
      const updated = updateAtPath(currentRule, path, value) as Record<string, unknown>;
      onThresholdChange(selectedSkill, updated);
    },
    [currentRule, selectedSkill, onThresholdChange]
  );

  /** Stage a condition for deletion by setting _deleted: true at the given path */
  const handleDeleteCondition = useCallback(
    (path: (string | number)[]) => {
      const updated = updateAtPath(currentRule, [...path, "_deleted"], true) as Record<string, unknown>;
      onThresholdChange(selectedSkill, updated);
    },
    [currentRule, selectedSkill, onThresholdChange]
  );

  /** Undo a pending condition deletion by removing the _deleted flag */
  const handleUndoDelete = useCallback(
    (path: (string | number)[]) => {
      const updated = updateAtPath(currentRule, [...path, "_deleted"], undefined) as Record<string, unknown>;
      onThresholdChange(selectedSkill, updated);
    },
    [currentRule, selectedSkill, onThresholdChange]
  );

  /** Stage a tier bump for deletion by setting _deleted: true on the bump object */
  const handleDeleteBump = useCallback(
    (index: number) => {
      const updated = updateAtPath(currentRule, ["tier_bumps", index, "_deleted"], true) as Record<string, unknown>;
      onThresholdChange(selectedSkill, updated);
    },
    [currentRule, selectedSkill, onThresholdChange]
  );

  /** Undo a pending tier bump deletion */
  const handleUndoDeleteBump = useCallback(
    (index: number) => {
      const updated = updateAtPath(currentRule, ["tier_bumps", index, "_deleted"], undefined) as Record<string, unknown>;
      onThresholdChange(selectedSkill, updated);
    },
    [currentRule, selectedSkill, onThresholdChange]
  );

  /** Append a new tier bump to the tier_bumps array */
  const handleAddBump = useCallback(
    (bump: { condition: ConditionItem; effect: string; max_tier?: string; min_tier?: string }) => {
      const existing = (currentRule.tier_bumps as unknown[] | undefined) ?? [];
      const updated = updateAtPath(currentRule, ["tier_bumps"], [...existing, bump]) as Record<string, unknown>;
      onThresholdChange(selectedSkill, updated);
    },
    [currentRule, selectedSkill, onThresholdChange]
  );

  const handleJsonChange = (val: string | undefined) => {
    const text = val ?? "";
    setJsonText(text);
    try {
      const parsed = JSON.parse(text);
      setJsonError(null);
      onThresholdChange(selectedSkill, parsed);
    } catch (e) {
      setJsonError((e as Error).message);
    }
  };

  const handleToggleAdvanced = () => {
    if (!isAdvancedMode) {
      // Switching to advanced — sync JSON from current rule
      setJsonText(JSON.stringify(currentRule, null, 2));
      setJsonError(null);
    }
    setIsAdvancedMode((v) => !v);
  };

  const rule = currentRule as ThresholdRule;
  const tiers = (rule.tiers ?? {}) as Record<string, ConditionsBlock>;
  const stabilization = (rule.stabilization ?? []) as Array<{
    stat: string;
    k: number;
    stabilized_key: string;
  }>;
  const tierBumps = (rule.tier_bumps ?? []) as Array<{
    condition: ConditionItem;
    effect: string;
    max_tier?: string;
    min_tier?: string;
  }>;
  const autoPromotions = (rule.auto_promotions ?? []) as Array<{
    if_tier_gte: string;
    then_set_skill: string;
    to_minimum_tier: string;
  }>;

  // Count anchors per skill for tab badges
  const anchorCountBySkill: Record<string, string> = {};
  const testResultBySkill: Record<string, SkillTestResult> = testResults;
  for (const [sk, ancs] of Object.entries(anchors)) {
    const tr = testResultBySkill[sk];
    if (tr && tr.anchors_tested > 0) {
      anchorCountBySkill[sk] = `${tr.passed}/${tr.anchors_tested}`;
    } else {
      anchorCountBySkill[sk] = String(ancs.length);
    }
  }

  const currentTestResult = testResults[selectedSkill] ?? null;
  const hasUnsavedChanges = !!editedThresholds[selectedSkill];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Skill selector — dense, collapsible */}
      <SkillPickerBar
        selectedSkill={selectedSkill}
        hasRule={(skill) => thresholds.some((t) => t.skill_name === skill)}
        onSelect={(skill) => {
          const row = thresholds.find((t) => t.skill_name === skill);
          if (!row) return;
          // Ensure edits are initialized before switching skills
          if (!editedThresholds[skill]) {
            onThresholdChange(skill, row.thresholds as Record<string, unknown>);
          }
          onSkillSelect(skill);
        }}
        getBadge={(skill) => {
          const label = anchorCountBySkill[skill];
          if (!label) return null;
          const tr = testResultBySkill[skill];
          const tone =
            tr && tr.anchors_tested > 0
              ? tr.failed > 0
                ? "fail"
                : "pass"
              : "neutral";
          return { label, tone };
        }}
      />

      {/* Editor header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-border bg-background">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{formatSkillName(selectedSkill)}</h2>
          {hasUnsavedChanges && (
            <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
              Unsaved
            </span>
          )}
          {/* Pending-commit badge — an edit is staged but not yet applied.
              Hidden once the user starts a fresh edit (that supersedes it). */}
          {!hasUnsavedChanges && stagedRuns[selectedSkill] && (
            <button
              type="button"
              id="threshold-staged-badge"
              onClick={() => onStagedEdit?.(stagedRuns[selectedSkill])}
              aria-label="Edit staged in a draft run — commit it in the Pipeline tab to apply. Click to open the run."
              className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded hover:bg-blue-200 transition-colors"
            >
              Staged · commit to apply
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={handleToggleAdvanced}
          className={cn(
            "text-xs px-2.5 py-1 rounded-md border transition-colors",
            isAdvancedMode
              ? "border-primary bg-primary/10 text-primary"
              : "border-border hover:bg-muted text-muted-foreground"
          )}
        >
          {isAdvancedMode ? "Default View" : "Advanced Editor"}
        </button>
      </div>

      {/* Editor body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {!thresholdRow ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            No threshold rule found for this skill.
          </div>
        ) : isAdvancedMode ? (
          /* Advanced JSON Editor */
          <div className="space-y-2">
            {jsonError && (
              <div className="text-xs bg-red-50 border border-red-200 text-red-600 px-2 py-1 rounded">
                JSON Error: {jsonError}
              </div>
            )}
            <div className="border border-border rounded overflow-hidden">
              <MonacoEditor
                height="500px"
                language="json"
                value={jsonText}
                onChange={handleJsonChange}
                options={{
                  minimap: { enabled: false },
                  fontSize: 12,
                  lineNumbers: "off",
                  wordWrap: "on",
                  scrollBeyondLastLine: false,
                  folding: true,
                  automaticLayout: true,
                }}
                theme="light"
              />
            </div>
          </div>
        ) : (
          /* Default structured form view */
          <div className="space-y-4">
            {/* Shared datalist rendered once — referenced by all stat key inputs across the panel */}
            <datalist id="stat-keys-datalist">
              {ALL_STAT_KEYS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </datalist>

            {/* Volume Gate */}
            {rule.volume_gate && (
              <Section title="Volume Gate" subtitle="Minimum usage required for evaluation">
                <ConditionsBlockEditor
                  block={rule.volume_gate as ConditionsBlock}
                  path={["volume_gate"]}
                  onValueChange={handleValueChange}
                  onDelete={handleDeleteCondition}
                  onUndoDelete={handleUndoDelete}
                />
              </Section>
            )}

            {/* Tier Thresholds */}
            {["Elite", "Proficient", "Capable"].map((tierName) => {
              // Resolve the actual key from the data — JSONB may store "elite" or "Elite"
              const actualKey =
                tiers[tierName] !== undefined ? tierName : tierName.toLowerCase();
              const tierBlock = tiers[actualKey];
              if (!tierBlock) return null;
              const titleColor =
                tierName === "Elite"      ? "text-emerald-700" :
                tierName === "Proficient" ? "text-sky-700"     :
                                            "text-amber-700";
              return (
                <Section
                  key={tierName}
                  title={`${tierName} Threshold`}
                  titleClassName={titleColor}
                >
                  <ConditionsBlockEditor
                    block={tierBlock}
                    path={["tiers", actualKey]}
                    onValueChange={handleValueChange}
                    onDelete={handleDeleteCondition}
                    onUndoDelete={handleUndoDelete}
                  />
                </Section>
              );
            })}

            {/* Stabilization */}
            {stabilization.length > 0 && (
              <Section
                title="Stabilization"
                subtitle="Bayesian shrinkage toward league average"
              >
                <div className="space-y-1">
                  {stabilization.map((s, i) => {
                    const lgAvg = leagueAverages[s.stat] ?? leagueAverages[s.stabilized_key];
                    return (
                      <div key={i} className="flex items-center gap-2 text-xs py-0.5">
                        <span
                          className="flex-1 font-mono text-[10px] text-muted-foreground truncate"
                          title={s.stat}
                        >
                          {s.stat.split(".").pop()}
                        </span>
                        <span className="text-muted-foreground">K=</span>
                        <input
                          type="number"
                          step="1"
                          value={s.k}
                          onChange={(e) =>
                            handleValueChange(
                              ["stabilization", i, "k"],
                              parseInt(e.target.value, 10)
                            )
                          }
                          className="w-16 text-right border border-input rounded px-1 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring bg-background"
                        />
                        {lgAvg !== undefined && (
                          <span className="text-muted-foreground text-[10px]">
                            lg avg: {lgAvg.toFixed(3)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}

            {/* Tier Bumps — supports edit, delete (pending), undo, and add new */}
            <Section title="Tier Bumps" subtitle="Promote or demote tier when condition(s) met">
              <TierBumpEditor
                bumps={tierBumps as Array<{
                  condition: ConditionItem;
                  effect: string;
                  max_tier?: string;
                  min_tier?: string;
                  _deleted?: boolean;
                }>}
                basePath={["tier_bumps"]}
                onValueChange={handleValueChange}
                onDeleteBump={handleDeleteBump}
                onUndoDeleteBump={handleUndoDeleteBump}
                onAddBump={handleAddBump}
              />
            </Section>

            {/* Auto-Promotions (read-only) */}
            {autoPromotions.length > 0 && (
              <Section title="Auto-Promotions" subtitle="Structural links — not tunable">
                <div className="space-y-1">
                  {autoPromotions.map((promo, i) => (
                    <div key={i} className="text-xs text-muted-foreground">
                      If {formatSkillName(selectedSkill)} ≥{" "}
                      <strong>{promo.if_tier_gte}</strong>, set{" "}
                      <strong>{formatSkillName(promo.then_set_skill)}</strong> ≥{" "}
                      <strong>{promo.to_minimum_tier}</strong>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Stat Confidence + Always Flag */}
            <Section title="Flags & Confidence">
              <div className="space-y-2">
                <div className="flex items-center gap-3 text-xs">
                  <label className="text-muted-foreground w-28 flex-shrink-0">
                    Stat Confidence
                  </label>
                  <select
                    value={(rule.stat_confidence as StatConfidence) ?? "low"}
                    onChange={(e) =>
                      handleValueChange(["stat_confidence"], e.target.value)
                    }
                    className="border border-input rounded px-2 py-0.5 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="high">High</option>
                    <option value="moderate">Moderate</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <label className="text-muted-foreground w-28 flex-shrink-0">
                    Always Flag Review
                  </label>
                  <input
                    type="checkbox"
                    checked={!!(rule.always_flag_for_review)}
                    onChange={(e) =>
                      handleValueChange(["always_flag_for_review"], e.target.checked)
                    }
                    className="accent-primary"
                  />
                </div>
              </div>
            </Section>
          </div>
        )}

        {/* Test results inline */}
        {currentTestResult && <TestResultDisplay result={currentTestResult} />}

        {/* Test All results summary grid */}
        {showTestAllResults && testAllResults.length > 0 && (
          <div className="mt-3 border border-border rounded-md overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border">
              <span className="text-xs font-semibold">Test All Skills — Summary</span>
              <button
                type="button"
                onClick={onDismissTestAllResults}
                className="text-muted-foreground hover:text-foreground text-xs"
              >
                ✕
              </button>
            </div>
            <div className="max-h-52 overflow-y-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/20">
                    <th className="text-left px-3 py-1.5 font-medium">Skill</th>
                    <th className="text-center px-2 py-1.5 font-medium">Anchors</th>
                    <th className="text-center px-2 py-1.5 font-medium">Pass</th>
                    <th className="text-center px-2 py-1.5 font-medium">Fail</th>
                    <th className="text-center px-2 py-1.5 font-medium">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {testAllResults.map((r) => {
                    const rate =
                      r.anchors_tested > 0
                        ? Math.round((r.passed / r.anchors_tested) * 100)
                        : null;
                    return (
                      <tr key={r.skill_name} className="border-b border-border/50">
                        <td className="px-3 py-1">{formatSkillName(r.skill_name)}</td>
                        <td className="text-center px-2 py-1">{r.anchors_tested}</td>
                        <td className="text-center px-2 py-1 text-emerald-600">{r.passed}</td>
                        <td className="text-center px-2 py-1 text-red-600">{r.failed}</td>
                        <td className="text-center px-2 py-1">
                          {rate !== null ? (
                            <span
                              className={cn(
                                "font-medium",
                                rate === 100
                                  ? "text-emerald-600"
                                  : rate > 75
                                    ? "text-amber-600"
                                    : "text-red-600"
                              )}
                            >
                              {rate}%
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Reusable section wrapper */
function Section({
  title,
  subtitle,
  children,
  titleClassName,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  titleClassName?: string;
}) {
  return (
    <div className="space-y-2">
      <div>
        <h3 className={cn("text-xs font-semibold", titleClassName ?? "text-foreground")}>
          {title}
        </h3>
        {subtitle && (
          <p className="text-[10px] text-muted-foreground">{subtitle}</p>
        )}
      </div>
      <div className="rounded-md border border-border px-3 py-2 bg-muted/10">
        {children}
      </div>
    </div>
  );
}
