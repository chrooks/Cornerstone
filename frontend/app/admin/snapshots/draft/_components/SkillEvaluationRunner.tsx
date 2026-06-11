"use client";

/**
 * SkillEvaluationRunner — staged-run trigger for the draft Pipeline tab.
 *
 * Lets an admin kick off a `skill_evaluation` run scoped to:
 *  - an optional Skill subset (multi-select over the canonical 21-skill taxonomy)
 *  - an optional player subset (shared PlayerSubsetPicker — name search → chip list)
 * Either axis empty means "all" (all 21 Skills / all qualifying players).
 *
 * On success it hands the new run_id back to the parent so the Pipeline tab
 * can deep-link to the staged run's diff preview — the same flow threshold
 * edits use. A pending-commit run surfaces as a friendly inline message.
 */

import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { triggerSkillEvaluation } from "@/lib/api";
import { ALL_SKILL_NAMES, SKILL_LABELS, TOTAL_SKILLS } from "@/lib/skills";
import { PlayerSubsetPicker, type PlayerLite } from "./PlayerSubsetPicker";

interface SkillEvaluationRunnerProps {
  /** Disabled when the draft is frozen (review state) — runs can't be staged. */
  disabled?: boolean;
  /** Called with the staged run_id so the parent can deep-link to its diff. */
  onStaged: (runId: string) => void;
}

export function SkillEvaluationRunner({
  disabled = false,
  onStaged,
}: SkillEvaluationRunnerProps) {
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [selectedPlayers, setSelectedPlayers] = useState<PlayerLite[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleSkill = useCallback((skill: string) => {
    setSelectedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(skill)) next.delete(skill);
      else next.add(skill);
      return next;
    });
  }, []);

  const selectAllSkills = useCallback(() => {
    setSelectedSkills(new Set(ALL_SKILL_NAMES));
  }, []);

  const clearSkills = useCallback(() => {
    setSelectedSkills(new Set());
  }, []);

  const skillCount = selectedSkills.size;
  const playerCount = selectedPlayers.length;

  const skillScopeLabel =
    skillCount === 0 ? `all ${TOTAL_SKILLS} Skills` : `${skillCount} Skill${skillCount === 1 ? "" : "s"}`;
  const playerScopeLabel =
    playerCount === 0 ? "all qualifying players" : `${playerCount} player${playerCount === 1 ? "" : "s"}`;

  const handleRun = useCallback(async () => {
    if (disabled || submitting) return;
    setSubmitting(true);
    setError(null);

    const body = {
      ...(playerCount > 0 ? { player_ids: selectedPlayers.map((p) => p.id) } : {}),
      ...(skillCount > 0 ? { skill_filter: Array.from(selectedSkills) } : {}),
    };

    try {
      const res = await triggerSkillEvaluation(body);
      if (res.success && res.data) {
        onStaged(res.data.run_id);
        return;
      }
      const msg = res.error ?? "";
      if (msg.includes("pending_commit_run_exists")) {
        setError(
          "A pipeline run is already staged. Commit or discard it from the list below before staging another."
        );
      } else {
        setError(msg || "Could not start the skill-evaluation run.");
      }
    } catch {
      setError("Could not reach the backend to start the run.");
    } finally {
      setSubmitting(false);
    }
  }, [
    disabled,
    submitting,
    playerCount,
    skillCount,
    selectedPlayers,
    selectedSkills,
    onStaged,
  ]);

  return (
    <section
      id="skill-eval-runner"
      className="rounded-[6px] border border-[#d9d0c9] bg-white px-5 py-4 mb-6"
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-[#0e0907]">
            Run Skill Evaluation
          </h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            Stage a run scoped to any subset of players and/or Skills. Leave a
            scope empty to cover everything.
          </p>
        </div>
      </div>

      {/* Stats-layer vs published-composite signifier (#5a): make it honest
          that this stage updates stat-derived ratings only. */}
      <div
        id="skill-eval-layer-note"
        className="rounded-[6px] border border-[#d9d0c9] bg-[#fef9f5] px-3 py-2 mb-4 text-xs text-neutral-600"
      >
        Updates <span className="font-medium text-[#0e0907]">stat-derived</span> ratings only.
        A Player&rsquo;s <span className="font-medium text-[#0e0907]">published</span> rating
        comes from the composite — re-run <span className="font-medium text-[#0e0907]">Compositing</span>{" "}
        or use a <span className="font-medium text-[#0e0907]">manual override</span> in Review/Player Pool
        for the change to reach the published profile.
      </div>

      {/* Skill subset */}
      <div id="skill-eval-skill-picker" className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-neutral-400">
            Skills
          </span>
          <div className="flex items-center gap-3">
            <button
              id="skill-eval-skills-select-all-btn"
              type="button"
              onClick={selectAllSkills}
              disabled={disabled}
              className="text-[11px] text-neutral-500 underline hover:text-[#0e0907] disabled:opacity-50"
            >
              Select all
            </button>
            <button
              id="skill-eval-skills-clear-btn"
              type="button"
              onClick={clearSkills}
              disabled={disabled || skillCount === 0}
              className="text-[11px] text-neutral-500 underline hover:text-[#0e0907] disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {ALL_SKILL_NAMES.map((skill) => {
            const active = selectedSkills.has(skill);
            return (
              <button
                key={skill}
                id={`skill-eval-skill-chip-${skill}`}
                type="button"
                aria-pressed={active}
                onClick={() => toggleSkill(skill)}
                disabled={disabled}
                className={cn(
                  "text-[11px] font-medium px-2.5 py-1 rounded border transition-colors disabled:opacity-50",
                  active
                    ? "bg-[#ffa05c]/20 text-[#fe6d34] border-[#ffa05c]/50"
                    : "bg-white text-neutral-600 border-[#d9d0c9] hover:border-neutral-400"
                )}
              >
                {SKILL_LABELS[skill] ?? skill}
              </button>
            );
          })}
        </div>
      </div>

      {/* Player subset — shared picker (#76) */}
      <PlayerSubsetPicker
        idPrefix="skill-eval-player"
        selected={selectedPlayers}
        onChange={setSelectedPlayers}
        disabled={disabled}
      />

      {error && (
        <div
          id="skill-eval-error"
          className="rounded-[6px] border border-red-200 bg-red-50 px-3 py-2 mb-3 text-xs text-red-700"
        >
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <p id="skill-eval-scope-summary" className="text-xs text-neutral-500">
          Will evaluate <span className="font-medium text-[#0e0907]">{playerScopeLabel}</span>{" "}
          against <span className="font-medium text-[#0e0907]">{skillScopeLabel}</span>.
        </p>
        <button
          id="pipeline-skill-eval-run-btn"
          type="button"
          onClick={handleRun}
          disabled={disabled || submitting}
          className={cn(
            "text-xs font-semibold px-4 py-2 rounded transition-colors",
            "bg-[#fe6d34] text-white hover:bg-[#e85c25]",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          {submitting ? "Staging…" : "Stage run"}
        </button>
      </div>
    </section>
  );
}
