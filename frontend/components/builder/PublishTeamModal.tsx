"use client";

/**
 * PublishTeamModal (#94) — the Lab's commit moment.
 *
 * Drafting stays frictionless; the friction concentrates here, at the one
 * genuinely committing act (research: lab-consequence-decision-weight.md §3,
 * the Frostpunk Book of Laws pattern). The moment restates the eval being
 * committed, pins the RuleSet Version + Evaluation Version it is sealed
 * against, and names the consequence of the visibility actually chosen — the
 * leaderboard line is only honest because the choice lives inside the moment.
 */

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";

export type TeamVisibility = "private" | "public";

interface PublishTeamModalProps {
  open: boolean;
  onClose: () => void;
  onPublish: (visibility: TeamVisibility) => void;
  isSaving: boolean;
  teamName: string;
  starRating: number;
  startingLineupScore: number;
  ruleSetLabel: string;
  ruleSetVersionLabel: string;
  /** Engine truth — the Evaluation Version that produced this score. */
  evaluationVersionSlug: string | null;
}

const VISIBILITY_OPTIONS: { value: TeamVisibility; label: string; consequence: string }[] = [
  {
    value: "private",
    label: "Private",
    consequence: "Stays in your Lab. Nobody else can see it.",
  },
  {
    value: "public",
    label: "Public",
    consequence: "Enters the {ruleset} leaderboard, where anyone can see and compare it.",
  },
];

export function PublishTeamModal({
  open,
  onClose,
  onPublish,
  isSaving,
  teamName,
  starRating,
  startingLineupScore,
  ruleSetLabel,
  ruleSetVersionLabel,
  evaluationVersionSlug,
}: PublishTeamModalProps) {
  const [visibility, setVisibility] = useState<TeamVisibility>("private");

  const chosen = VISIBILITY_OPTIONS.find((option) => option.value === visibility)!;
  const consequence = chosen.consequence.replace("{ruleset}", ruleSetLabel);

  return (
    <Modal
      id="publish-team-modal"
      open={open}
      onClose={onClose}
      ariaLabelledBy="publish-team-modal-title"
      maxWidthClass="max-w-md"
    >
      <h2
        id="publish-team-modal-title"
        className="text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-[#0e0907]/50"
      >
        Publish this Team
      </h2>

      {/* The eval being committed — restated, not re-derived */}
      <div id="publish-team-eval" className="mt-3 border-b border-[#d9d0c9] pb-4">
        <p id="publish-team-name" className="text-lg font-bold text-[#0e0907]">
          {teamName}
        </p>
        <p className="mt-1 flex items-baseline gap-2">
          <span id="publish-team-stars" className="font-mono text-2xl font-bold tabular-nums text-[#0e0907]">
            {starRating.toFixed(2)}
          </span>
          <span className="text-[0.75rem] text-[#0e0907]/50">
            stars · Starting Lineup {startingLineupScore.toFixed(1)}
          </span>
        </p>
      </div>

      {/* Version pins — what this eval is sealed against */}
      <dl id="publish-team-versions" className="mt-4 space-y-1 text-[0.75rem]">
        <div className="flex justify-between gap-3">
          <dt className="text-[#0e0907]/50">RuleSet Version</dt>
          <dd id="publish-ruleset-version" className="font-mono text-[#0e0907]">
            {ruleSetVersionLabel}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-[#0e0907]/50">Evaluation Version</dt>
          <dd id="publish-evaluation-version" className="font-mono text-[#0e0907]">
            {evaluationVersionSlug ?? "—"}
          </dd>
        </div>
      </dl>

      {/* The choice that decides the consequence */}
      <fieldset id="publish-visibility" className="mt-4">
        <legend className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[#0e0907]/50">
          Visibility
        </legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {VISIBILITY_OPTIONS.map((option) => (
            <button
              key={option.value}
              id={`publish-visibility-${option.value}`}
              type="button"
              role="radio"
              aria-checked={visibility === option.value}
              onClick={() => setVisibility(option.value)}
              className={cn(
                "rounded-[4px] border px-3 py-2 text-[0.8125rem] font-medium transition-colors cursor-pointer",
                visibility === option.value
                  ? "border-[#0e0907] bg-[#ffa05c] text-[#0e0907]"
                  : "border-[#d9d0c9] bg-[#f0f0f0] text-[#0e0907]/60 hover:border-[#0e0907]/40",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p id="publish-consequence" aria-live="polite" className="mt-2 text-[0.75rem] text-[#0e0907]/70">
          {consequence}
        </p>
      </fieldset>

      <p id="publish-sealed-note" className="mt-4 text-[0.71875rem] italic text-[#7e2c0c]">
        The roster and its eval are sealed on publish — pinned to the versions above and never rescored.
        Name and visibility stay editable.
      </p>

      <div className="mt-5 flex items-center justify-end gap-2">
        <button
          id="publish-cancel-btn"
          type="button"
          onClick={onClose}
          disabled={isSaving}
          className="rounded-[4px] border border-[#d9d0c9] bg-transparent px-3 py-1.5 text-sm font-medium text-[#0e0907]/70 transition-colors cursor-pointer hover:border-[#0e0907]/40 hover:text-[#0e0907] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Keep Tuning
        </button>
        <button
          id="publish-confirm-btn"
          type="button"
          onClick={() => onPublish(visibility)}
          disabled={isSaving}
          className="rounded-[4px] border border-[#0e0907] bg-[#ffa05c] px-4 py-1.5 text-sm font-semibold text-[#0e0907] transition-colors cursor-pointer hover:bg-[#fe6d34] disabled:cursor-not-allowed disabled:border-[#d9d0c9] disabled:bg-[#f0f0f0] disabled:text-[#0e0907]/40"
        >
          {isSaving ? "Publishing..." : "Publish Team"}
        </button>
      </div>
    </Modal>
  );
}
