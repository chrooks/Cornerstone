"use client";

/**
 * SkillEvaluationRunner — staged-run trigger for the draft Pipeline tab.
 *
 * Lets an admin kick off a `skill_evaluation` run scoped to:
 *  - an optional Skill subset (multi-select over the canonical Skill taxonomy)
 *  - an optional player subset (shared PlayerSubsetPicker — name search → chip list)
 * Either axis empty means "all" (every Skill / all qualifying players).
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

  /* M2.16 modes. `withClaude` is only valid on top of `recomputeComposite`,
     and both need a Skill filter — the backend rejects the other shapes. */
  const [recomputeComposite, setRecomputeComposite] = useState(false);
  const [withClaude, setWithClaude] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* A state updater must stay pure — StrictMode runs it twice. Compute the
     next value here, then set both pieces of state. */
  const toggleRecomposite = useCallback(() => {
    const next = !recomputeComposite;
    setRecomputeComposite(next);
    if (!next) setWithClaude(false);
  }, [recomputeComposite]);

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

  /* Either mode needs a Skill filter, so "all Skills" is not what an empty
     picker means there — it means the run cannot go. Say that, rather than
     promising a scope the layer note directly contradicts. */
  const needsSkillFilter = recomputeComposite || withClaude;
  const skillScopeLabel =
    skillCount === 0
      ? needsSkillFilter
        ? "no Skills selected"
        : `all ${TOTAL_SKILLS} Skills`
      : `${skillCount} Skill${skillCount === 1 ? "" : "s"}`;
  const playerScopeLabel =
    playerCount === 0 ? "all qualifying players" : `${playerCount} player${playerCount === 1 ? "" : "s"}`;

  /* What this click actually does, in the order it does it. */
  const modeSummary = withClaude
    ? "It asks Claude for a fresh tier on each non-HIGH Skill, then writes the merged result into the published composite."
    : recomputeComposite
    ? "It writes the fresh stat tiers into the published composite."
    : "It stops at the stats layer — no published rating changes.";

  const handleRun = useCallback(async () => {
    if (disabled || submitting) return;

    /* Transparent Friction on the one control that spends money: a whole-league
       Claude run is one API call per Player, and nothing else on this page
       bills. The cheaper modes stay one click. */
    if (withClaude) {
      const scope =
        playerCount === 0
          ? "every qualifying Player"
          : `${playerCount} Player${playerCount === 1 ? "" : "s"}`;
      const confirmed = window.confirm(
        `Ask Claude about ${scope}, across ${skillCount} Skill${skillCount === 1 ? "" : "s"}?\n\n` +
          "That is one Anthropic API call per Player, and it is billed whether or " +
          "not you commit the run."
      );
      if (!confirmed) return;
    }

    setSubmitting(true);
    setError(null);

    const body = {
      ...(playerCount > 0 ? { player_ids: selectedPlayers.map((p) => p.id) } : {}),
      ...(skillCount > 0 ? { skill_filter: Array.from(selectedSkills) } : {}),
      ...(recomputeComposite ? { recompute_composite: true } : {}),
      ...(recomputeComposite && withClaude ? { with_claude: true } : {}),
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
    recomputeComposite,
    withClaude,
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
        className="rounded-[6px] border border-[#d9d0c9] bg-[#fef9f5] px-3 py-2 mb-4 text-xs text-neutral-600 space-y-1"
      >
        <p>
          On its own this run updates <span className="font-medium text-[#0e0907]">stat-derived</span>{" "}
          ratings only. A Player&rsquo;s <span className="font-medium text-[#0e0907]">published</span>{" "}
          rating comes from the composite, so without the first box below the change stops at the stats layer.
        </p>
        <p>
          <span className="font-medium text-[#0e0907]">Recompute composite</span> merges the fresh stat
          tiers into the composite for the chosen Skills. A Skill you already resolved by hand keeps your
          decision and gets a new flag when the fresh tier contradicts it.
        </p>
        <p>
          <span className="font-medium text-[#0e0907]">Ask Claude</span> also asks Claude for fresh tiers on
          the chosen non-HIGH Skills before that merge, and costs an API call per Player.
        </p>
        <p>Both modes need at least one Skill selected.</p>
      </div>

      {/* M2.16 modes */}
      <div id="skill-eval-modes" className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-5">
        <label
          htmlFor="skill-eval-recompute-composite"
          className="flex items-center gap-2 text-xs text-neutral-700"
        >
          <input
            id="skill-eval-recompute-composite"
            type="checkbox"
            checked={recomputeComposite}
            onChange={toggleRecomposite}
            disabled={disabled}
            className="h-3.5 w-3.5 accent-[#fe6d34] disabled:opacity-50"
          />
          Recompute composite
        </label>
        <label
          htmlFor="skill-eval-with-claude"
          className={cn(
            "flex items-center gap-2 text-xs",
            recomputeComposite ? "text-neutral-700" : "text-neutral-400"
          )}
        >
          <input
            id="skill-eval-with-claude"
            type="checkbox"
            checked={withClaude}
            onChange={() => setWithClaude((prev) => !prev)}
            disabled={disabled || !recomputeComposite}
            className="h-3.5 w-3.5 accent-[#fe6d34] disabled:opacity-50"
          />
          Ask Claude (non-HIGH Skills)
        </label>
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
          role="alert"
          className="rounded-[6px] border border-red-200 bg-red-50 px-3 py-2 mb-3 text-xs text-red-700"
        >
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <p id="skill-eval-scope-summary" className="text-xs text-neutral-500">
          Will evaluate <span className="font-medium text-[#0e0907]">{playerScopeLabel}</span>{" "}
          against <span className="font-medium text-[#0e0907]">{skillScopeLabel}</span>.{" "}
          {modeSummary}
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
