"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { saveThreshold, testThresholds } from "@/lib/api";
import type {
  ThresholdRow,
  ThresholdRule,
  ConditionItem,
  ConditionsBlock,
  SkillTestResult,
  ConditionResult,
  AnchorsBySkill,
  Player,
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
  onTestResult: (result: SkillTestResult) => void;
  onTestAllResults: (results: SkillTestResult[]) => void;
  selectedPlayer: Player | null;
  onReEvaluatePlayer: () => void;
  onSkillSelect: (skillName: string) => void;
  onToast: (message: string, type: "success" | "error") => void;
  leagueAverages: Record<string, number>;
}

/**
 * Skill categories for the tab bar — must match the canonical skill keys
 * defined in backend/services/claude_assessment.py.
 */
const SKILL_CATEGORIES: Record<string, string[]> = {
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
    "vertical_spacer",
    "screen_setter",
    "passer",
    "mid_post_player",
    "low_post_player",
  ],
  "Low Confidence": [
    "switchable_defender",
    "point_of_attack_defender",
    "high_flyer",
  ],
};

function formatSkillName(name: string): string {
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
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

/** Render a single condition row (leaf or nested OR/AND block) */
function ConditionRow({
  condition,
  path,
  onValueChange,
  depth = 0,
}: {
  condition: ConditionItem;
  path: (string | number)[];
  onValueChange: (path: (string | number)[], value: unknown) => void;
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
            condition={child}
            path={[...path, "conditions", i]}
            onValueChange={onValueChange}
            depth={depth + 1}
          />
        ))}
      </div>
    );
  }

  // Leaf condition row
  const statLabel = condition.stat
    ?.split(".")
    .map((part) =>
      part
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")
    )
    .join(" › ") ?? "";

  const isStabilized = condition.stat?.startsWith("stabilized.");
  const perLabel = condition.per ? ` / ${condition.per}` : "";

  return (
    <div className="flex items-center gap-2 py-1 text-xs">
      <span className="flex-1 text-muted-foreground truncate font-mono text-[10px]" title={condition.stat}>
        {statLabel}
        {isStabilized && (
          <span className="ml-1 text-[9px] bg-blue-100 text-blue-600 px-1 rounded">stab</span>
        )}
        {perLabel && (
          <span className="ml-1 text-[9px] text-muted-foreground">{perLabel}</span>
        )}
      </span>
      <span className="text-muted-foreground font-mono w-5 text-center flex-shrink-0">
        {condition.operator}
      </span>
      <input
        type="number"
        step="0.01"
        value={condition.value ?? 0}
        onChange={(e) => onValueChange([...path, "value"], parseFloat(e.target.value))}
        className={cn(
          "w-20 text-right border border-input rounded px-1.5 py-0.5 text-xs font-mono",
          "focus:outline-none focus:ring-1 focus:ring-ring bg-background"
        )}
      />
    </div>
  );
}

/** Render a conditions block (volume gate or tier) */
function ConditionsBlockEditor({
  block,
  path,
  onValueChange,
}: {
  block: ConditionsBlock;
  path: (string | number)[];
  onValueChange: (path: (string | number)[], value: unknown) => void;
}) {
  if (!block?.conditions) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="space-y-0.5">
      {block.conditions.map((cond, i) => (
        <ConditionRow
          key={i}
          condition={cond as ConditionItem}
          path={[...path, "conditions", i]}
          onValueChange={onValueChange}
        />
      ))}
    </div>
  );
}

const SECTION_LABELS_TEST: Record<string, string> = {
  volume_gate: "Volume Gate",
  elite: "Elite",
  capable: "Capable",
  tier_bump: "Tier Bump",
};

/** Expandable per-condition breakdown for a single anchor player */
function AnchorConditionBreakdown({
  conditions,
  forceOpen,
}: {
  conditions: ConditionResult[];
  forceOpen?: boolean;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  // forceOpen overrides local toggle when set
  const open = forceOpen !== undefined ? forceOpen : localOpen;

  // Group by section in display order
  const sectionOrder = ["volume_gate", "elite", "capable", "tier_bump"] as const;
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
  // null = each breakdown controls itself; true/false = all forced open/closed
  const [allOpen, setAllOpen] = useState<boolean | null>(null);

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-3 text-xs">
        <span className="font-medium">{result.anchors_tested} anchors tested</span>
        <span className="text-emerald-600">{result.passed} passed</span>
        {result.failed > 0 && <span className="text-red-600">{result.failed} failed</span>}
        <button
          type="button"
          onClick={() => setAllOpen((v) => (v === true ? false : true))}
          className="ml-auto text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {allOpen === true ? "Collapse all" : "Expand all"}
        </button>
      </div>
      {[...result.results]
        .sort((a, b) => {
          // Sort by expected tier: Elite (0) → Capable (1) → None (2)
          const tierOrder: Record<string, number> = { Elite: 0, Capable: 1, None: 2 };
          return (tierOrder[a.expected_tier] ?? 3) - (tierOrder[b.expected_tier] ?? 3);
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
              forceOpen={allOpen ?? undefined}
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
  onTestResult,
  onTestAllResults,
  selectedPlayer,
  onReEvaluatePlayer,
  onSkillSelect,
  onToast,
  leagueAverages,
}: ThresholdEditorPanelProps) {
  const [isAdvancedMode, setIsAdvancedMode] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingAll, setTestingAll] = useState(false);
  const [showTestAllResults, setShowTestAllResults] = useState(false);
  const [testAllResults, setTestAllResults] = useState<SkillTestResult[]>([]);

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

  // Accepts any value type — numbers for threshold values, strings for
  // stat_confidence, booleans for always_flag_for_review
  const handleValueChange = useCallback(
    (path: (string | number)[], value: unknown) => {
      const updated = updateAtPath(currentRule, path, value) as Record<string, unknown>;
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

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await saveThreshold(selectedSkill, currentRule as ThresholdRule);
      if (res.success) {
        onToast("Threshold saved", "success");
      } else {
        onToast(res.error ?? "Failed to save", "error");
      }
    } catch {
      onToast("Failed to save", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      // Build override map for the current skill if it has unsaved edits
      const overrides =
        editedThresholds[selectedSkill]
          ? { [selectedSkill]: editedThresholds[selectedSkill] as ThresholdRule }
          : undefined;

      const res = await testThresholds(selectedSkill, overrides);
      if (res.success && res.data && !Array.isArray(res.data)) {
        onTestResult(res.data as SkillTestResult);
      } else {
        onToast(res.error ?? "Test failed", "error");
      }
    } catch {
      onToast("Test failed", "error");
    } finally {
      setTesting(false);
    }
  };

  const handleTestAll = async () => {
    setTestingAll(true);
    try {
      const overrides =
        Object.keys(editedThresholds).length > 0
          ? (editedThresholds as Record<string, ThresholdRule>)
          : undefined;
      const res = await testThresholds("all", overrides);
      if (res.success && res.data && Array.isArray(res.data)) {
        setTestAllResults(res.data as SkillTestResult[]);
        setShowTestAllResults(true);
        onTestAllResults(res.data as SkillTestResult[]);
      } else {
        onToast(res.error ?? "Test all failed", "error");
      }
    } catch {
      onToast("Test all failed", "error");
    } finally {
      setTestingAll(false);
    }
  };

  const handleResetToSaved = () => {
    if (thresholdRow) {
      onThresholdChange(selectedSkill, thresholdRow.thresholds as Record<string, unknown>);
      if (isAdvancedMode) {
        setJsonText(JSON.stringify(thresholdRow.thresholds, null, 2));
        setJsonError(null);
      }
    }
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
    max_tier: string;
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
      {/* Skill selector tabs */}
      <div className="flex-shrink-0 border-b border-border bg-background">
        <div>
          {Object.entries(SKILL_CATEGORIES).map(([category, skills]) => (
            <div key={category} className="px-3 pt-2">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 px-1">
                {category}
              </div>
              <div className="flex gap-0.5 flex-wrap pb-1">
                {skills.map((skill) => {
                  const row = thresholds.find((t) => t.skill_name === skill);
                  const badgeLabel = anchorCountBySkill[skill];
                  const isSelected = skill === selectedSkill;
                  const tr = testResultBySkill[skill];
                  const allPass = tr && tr.anchors_tested > 0 && tr.failed === 0;
                  const anyFail = tr && tr.failed > 0;
                  // Skills without a DB row are shown but disabled until a rule is created
                  const hasRule = !!row;
                  return (
                    <button
                      key={skill}
                      type="button"
                      disabled={!hasRule}
                      title={!hasRule ? "No threshold rule configured yet" : undefined}
                      onClick={() => {
                        if (!hasRule) return;
                        // Ensure edits are initialized before switching skills
                        if (!editedThresholds[skill]) {
                          onThresholdChange(skill, row.thresholds as Record<string, unknown>);
                        }
                        // Notify parent to update selectedSkill via the proper prop callback
                        onSkillSelect(skill);
                      }}
                      className={cn(
                        "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs whitespace-nowrap transition-colors",
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : hasRule
                            ? "hover:bg-muted text-muted-foreground hover:text-foreground"
                            : "text-muted-foreground/40 cursor-not-allowed",
                        hasRule && anyFail && !isSelected && "text-red-600",
                        hasRule && allPass && !isSelected && "text-emerald-600"
                      )}
                    >
                      {formatSkillName(skill)}
                      {badgeLabel && (
                        <span
                          className={cn(
                            "text-[9px] px-1 rounded-full",
                            isSelected
                              ? "bg-primary-foreground/20 text-primary-foreground"
                              : anyFail
                                ? "bg-red-100 text-red-700"
                                : allPass
                                  ? "bg-emerald-100 text-emerald-700"
                                  : "bg-muted-foreground/20"
                          )}
                        >
                          {badgeLabel}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Editor header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-border bg-background">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{formatSkillName(selectedSkill)}</h2>
          {hasUnsavedChanges && (
            <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
              Unsaved
            </span>
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
            {/* Volume Gate */}
            {rule.volume_gate && (
              <Section title="Volume Gate" subtitle="Minimum usage required for evaluation">
                <ConditionsBlockEditor
                  block={rule.volume_gate as ConditionsBlock}
                  path={["volume_gate"]}
                  onValueChange={handleValueChange}
                />
              </Section>
            )}

            {/* Tier Thresholds */}
            {["Elite", "Capable"].map((tierName) => {
              // Resolve the actual key from the data — JSONB may store "elite" or "Elite"
              const actualKey =
                tiers[tierName] !== undefined ? tierName : tierName.toLowerCase();
              const tierBlock = tiers[actualKey];
              if (!tierBlock) return null;
              return (
                <Section
                  key={tierName}
                  title={`${tierName} Threshold`}
                  titleClassName={
                    tierName === "Elite"
                      ? "text-emerald-700"
                      : "text-amber-700"
                  }
                >
                  <ConditionsBlockEditor
                    block={tierBlock}
                    path={["tiers", actualKey]}
                    onValueChange={handleValueChange}
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

            {/* Tier Bumps */}
            {tierBumps.length > 0 && (
              <Section title="Tier Bumps" subtitle="Promote tier when condition(s) met">
                <div className="space-y-2">
                  {tierBumps.map((bump, i) => {
                    const cond = bump.condition as ConditionItem;
                    if (!cond) return null;

                    // AND/OR block condition — render each leaf inside the block
                    if (cond.conditions) {
                      return (
                        <div key={i} className="space-y-1">
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <span className="font-semibold uppercase">{cond.logic ?? "AND"}</span>
                            <span>→ {bump.max_tier}</span>
                          </div>
                          {(cond.conditions as ConditionItem[]).map((leaf, j) => (
                            <div key={j} className="flex items-center gap-2 text-xs py-0.5 pl-3 border-l border-border">
                              <span className="flex-1 font-mono text-[10px] text-muted-foreground truncate">
                                {leaf.stat}
                              </span>
                              <span className="text-muted-foreground font-mono w-5">{leaf.operator}</span>
                              <input
                                type="number"
                                step="0.01"
                                value={leaf.value ?? 0}
                                onChange={(e) =>
                                  handleValueChange(
                                    ["tier_bumps", i, "condition", "conditions", j, "value"],
                                    parseFloat(e.target.value)
                                  )
                                }
                                className="w-20 text-right border border-input rounded px-1 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring bg-background"
                              />
                            </div>
                          ))}
                        </div>
                      );
                    }

                    // Leaf condition — single stat
                    if (!cond.stat) return null;
                    return (
                      <div key={i} className="flex items-center gap-2 text-xs py-0.5">
                        <span className="flex-1 font-mono text-[10px] text-muted-foreground truncate">
                          {cond.stat}
                        </span>
                        <span className="text-muted-foreground font-mono w-5">{cond.operator}</span>
                        <input
                          type="number"
                          step="0.01"
                          value={cond.value ?? 0}
                          onChange={(e) =>
                            handleValueChange(
                              ["tier_bumps", i, "condition", "value"],
                              parseFloat(e.target.value)
                            )
                          }
                          className="w-20 text-right border border-input rounded px-1 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring bg-background"
                        />
                        <span className="text-[10px] text-muted-foreground">
                          → {bump.max_tier}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}

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
                onClick={() => setShowTestAllResults(false)}
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

      {/* Save / Test controls at the bottom */}
      <div className="flex-shrink-0 border-t border-border bg-background px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Re-evaluate player button */}
          {selectedPlayer && (
            <button
              type="button"
              onClick={onReEvaluatePlayer}
              className={cn(
                "text-xs px-3 py-1.5 rounded-md border border-border",
                "hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              )}
            >
              Re-evaluate {selectedPlayer.name.split(" ").pop()}
            </button>
          )}

          <div className="flex-1" />

          {/* Reset to saved */}
          {hasUnsavedChanges && (
            <button
              type="button"
              onClick={handleResetToSaved}
              className="text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground"
            >
              Reset
            </button>
          )}

          {/* Test All */}
          <button
            type="button"
            onClick={handleTestAll}
            disabled={testingAll}
            className={cn(
              "text-xs px-3 py-1.5 rounded-md border border-border",
              "hover:bg-muted transition-colors text-muted-foreground disabled:opacity-50"
            )}
          >
            {testingAll ? "Testing…" : "Test All"}
          </button>

          {/* Test Against Anchors — disabled when advanced editor has invalid JSON */}
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || (isAdvancedMode && !!jsonError)}
            title={isAdvancedMode && !!jsonError ? "Fix JSON errors before testing" : undefined}
            className={cn(
              "text-xs px-3 py-1.5 rounded-md border border-primary text-primary",
              "hover:bg-primary/10 transition-colors disabled:opacity-50"
            )}
          >
            {testing ? "Testing…" : "Test Anchors"}
          </button>

          {/* Save */}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !!jsonError}
            className={cn(
              "text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground",
              "hover:bg-primary/90 transition-colors disabled:opacity-50"
            )}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
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
