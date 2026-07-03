"use client";

/**
 * CalibrationActionBar — the bottom action footer for the calibration center
 * pane. Rendered by CalibrationWorkspace BELOW the center panel (Threshold
 * Editor or Stat Leaders) so it is visible in both views, not just the editor.
 *
 * Owns: stage edit / test anchors / test all / reset handlers + their
 * in-flight (saving/testing/testingAll) state. Reads thresholds +
 * editedThresholds directly (same currentRule derivation ThresholdEditorPanel
 * uses) so it doesn't need the editor mounted to act on the selected skill.
 */

import { useCallback, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { saveThresholdEdit, testThresholds } from "@/lib/api";
import { stripDeleted } from "./threshold-utils";
import type { Player, SkillTestResult, ThresholdRow, ThresholdRule } from "@/lib/types";

interface CalibrationActionBarProps {
  selectedSkill: string;
  thresholds: ThresholdRow[];
  editedThresholds: Record<string, Record<string, unknown>>;
  onThresholdChange: (skillName: string, rule: Record<string, unknown>) => void;
  onSaved: (skillName: string, savedRule: Record<string, unknown>) => void;
  onStagedEdit?: (runId: string) => void;
  /** Called after a successful stage so the editor panel's "Staged" badge can appear. */
  onSkillStaged: (skillName: string, runId: string) => void;
  onTestResult: (result: SkillTestResult) => void;
  onTestAllComplete: (results: SkillTestResult[]) => void;
  selectedPlayer: Player | null;
  onReEvaluatePlayer: () => void;
  onToast: (message: string, type: "success" | "error") => void;
  /**
   * Effective JSON error from the advanced editor — null whenever the
   * advanced editor isn't open or currently valid. Reported up from
   * ThresholdEditorPanel via onJsonErrorChange; stays null (never stuck)
   * when the Stat Leaders view is showing and the editor is unmounted.
   */
  jsonError: string | null;
}

export function CalibrationActionBar({
  selectedSkill,
  thresholds,
  editedThresholds,
  onThresholdChange,
  onSaved,
  onStagedEdit,
  onSkillStaged,
  onTestResult,
  onTestAllComplete,
  selectedPlayer,
  onReEvaluatePlayer,
  onToast,
  jsonError,
}: CalibrationActionBarProps) {
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingAll, setTestingAll] = useState(false);

  const thresholdRow = thresholds.find((t) => t.skill_name === selectedSkill);
  // Same derivation as ThresholdEditorPanel's currentRule — duplicated here
  // (rather than shared) since it's a one-line fallback chain.
  const currentRule = useMemo<Record<string, unknown>>(
    () =>
      (editedThresholds[selectedSkill] as Record<string, unknown>) ??
      (thresholdRow?.thresholds as Record<string, unknown>) ??
      {},
    [editedThresholds, selectedSkill, thresholdRow?.thresholds]
  );

  const hasUnsavedChanges = !!editedThresholds[selectedSkill];

  // Named "stage edit" not "save": this stages a draft run; the threshold is
  // applied only when that run is committed in the Pipeline tab.
  const handleStageEdit = useCallback(async () => {
    setSaving(true);
    try {
      // Strip pending-delete markers before sending to the API — _deleted items
      // must never reach the backend. stripDeleted is the sole gatekeeper.
      const cleanRule = stripDeleted(currentRule) as ThresholdRule;
      const res = await saveThresholdEdit(selectedSkill, cleanRule);
      if (res.success && res.data) {
        const runId = res.data.run_id;
        // Clear the unsaved-edit flag for this skill in the parent (use clean rule)
        onSaved(selectedSkill, cleanRule as Record<string, unknown>);
        // Mark this skill as staged-pending-commit so the badge appears.
        onSkillStaged(selectedSkill, runId);
        // Honest signifier: staging is not the same as applying. The threshold
        // only lands when the run is committed in the Pipeline tab.
        onToast(
          `Edit staged (run ${runId.slice(0, 8)}…) — commit it in the Pipeline tab to apply.`,
          "success"
        );
        // Notify the parent so it can deep-link to the Pipeline tab
        if (onStagedEdit) {
          onStagedEdit(runId);
        }
      } else if (!res.success && res.error?.startsWith("pending_commit_run_exists")) {
        onToast(
          "Commit or discard the current threshold_edit run before staging a new one.",
          "error"
        );
      } else if (!res.success && res.error === "no_open_draft") {
        onToast("No open draft — open a draft before editing thresholds.", "error");
      } else {
        onToast(res.error ?? "Failed to stage threshold edit", "error");
      }
    } catch {
      onToast("Failed to stage threshold edit", "error");
    } finally {
      setSaving(false);
    }
  }, [currentRule, selectedSkill, onSaved, onStagedEdit, onSkillStaged, onToast]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    try {
      // Build override map for the current skill if it has unsaved edits.
      // Strip _deleted markers so the test engine sees the same rule as the save path.
      const overrides =
        editedThresholds[selectedSkill]
          ? { [selectedSkill]: stripDeleted(editedThresholds[selectedSkill]) as ThresholdRule }
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
  }, [editedThresholds, selectedSkill, onTestResult, onToast]);

  const handleTestAll = useCallback(async () => {
    setTestingAll(true);
    try {
      // Strip _deleted markers from all edited skills before sending to the test engine.
      const overrides =
        Object.keys(editedThresholds).length > 0
          ? Object.fromEntries(
              Object.entries(editedThresholds).map(([k, v]) => [k, stripDeleted(v) as ThresholdRule])
            )
          : undefined;
      const res = await testThresholds("all", overrides);
      if (res.success && res.data && Array.isArray(res.data)) {
        onTestAllComplete(res.data as SkillTestResult[]);
      } else {
        onToast(res.error ?? "Test all failed", "error");
      }
    } catch {
      onToast("Test all failed", "error");
    } finally {
      setTestingAll(false);
    }
  }, [editedThresholds, onTestAllComplete, onToast]);

  const handleResetToSaved = useCallback(() => {
    if (thresholdRow) {
      onThresholdChange(selectedSkill, thresholdRow.thresholds as Record<string, unknown>);
    }
  }, [thresholdRow, selectedSkill, onThresholdChange]);

  return (
    <div
      id="calibration-action-bar"
      className="flex-shrink-0 border-t border-border bg-background px-4 py-3"
    >
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

        {/* Test Against Anchors — disabled when the advanced editor has invalid JSON */}
        <button
          type="button"
          onClick={handleTest}
          disabled={testing || !!jsonError}
          title={jsonError ? "Fix JSON errors before testing" : undefined}
          className={cn(
            "text-xs px-3 py-1.5 rounded-md border border-primary text-primary",
            "hover:bg-primary/10 transition-colors disabled:opacity-50"
          )}
        >
          {testing ? "Testing…" : "Test Anchors"}
        </button>

        {/* Stage Edit — honest label: this stages a draft run; the threshold
            is applied only when the run is committed in the Pipeline tab. */}
        <button
          type="button"
          id="threshold-stage-edit-btn"
          onClick={handleStageEdit}
          disabled={saving || !!jsonError}
          title="Stages a draft run with this rule. Commit it in the Pipeline tab to apply."
          className={cn(
            "text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground",
            "hover:bg-primary/90 transition-colors disabled:opacity-50"
          )}
        >
          {saving ? "Staging…" : "Stage Edit"}
        </button>
      </div>
    </div>
  );
}
