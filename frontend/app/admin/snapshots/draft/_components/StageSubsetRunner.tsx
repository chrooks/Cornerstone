"use client";

/**
 * StageSubsetRunner — subset-scoped trigger for a single draft pipeline stage.
 *
 * Generalizes the SkillEvaluationRunner shape (#73) across the remaining
 * stages (#76): pick any subset of Players via the shared PlayerSubsetPicker,
 * leave it empty to run the whole league, then run that one stage.
 *
 * Two stage flavors:
 *  - "run"       (salary_scrape / bio_team_sync) — kicks off a pipeline run and
 *                hands the run_id back so the Pipeline tab refreshes its list.
 *  - "composite" — runs synchronously and returns a result summary; on success
 *                it surfaces a "Review N flagged Players →" Affordance scoped to
 *                exactly the Players just composited.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  triggerSalaryScrapeRun,
  triggerBioTeamSyncRun,
  runCompositeBatchScoped,
} from "@/lib/api";
import type { CompositeBatchResult } from "@/lib/types";
import { PlayerSubsetPicker, type PlayerLite } from "./PlayerSubsetPicker";

type RunStage = "salary_scrape" | "bio_team_sync";
type StageKind = RunStage | "composite";

interface StageCopy {
  title: string;
  description: string;
  verb: string;
}

const STAGE_COPY: Record<StageKind, StageCopy> = {
  salary_scrape: {
    title: "Run Salary Scrape",
    description:
      "Pull current salary figures. Scope to a subset of Players or leave empty to scrape the whole league.",
    verb: "scrape",
  },
  bio_team_sync: {
    title: "Run Bio / Team Sync",
    description:
      "Refresh team, position, and bio data. Scope to a subset or leave empty to sync all qualifying Players.",
    verb: "sync",
  },
  composite: {
    title: "Run Compositing",
    description:
      "Merge stat-derived and Claude ratings into composite profiles. Scope to a subset or leave empty to composite all qualifying Players.",
    verb: "composite",
  },
};

interface StageSubsetRunnerProps {
  stage: StageKind;
  /** Disabled when the draft is frozen (review state). */
  disabled?: boolean;
  /** Run-stage success hands the run_id up so the Pipeline tab can refresh. */
  onStaged?: (runId: string) => void;
}

export function StageSubsetRunner({
  stage,
  disabled = false,
  onStaged,
}: StageSubsetRunnerProps) {
  const [selectedPlayers, setSelectedPlayers] = useState<PlayerLite[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compositeResult, setCompositeResult] = useState<CompositeBatchResult | null>(null);
  const [compositedIds, setCompositedIds] = useState<string[]>([]);

  const copy = STAGE_COPY[stage];
  const playerCount = selectedPlayers.length;
  const scopeLabel =
    playerCount === 0
      ? "all qualifying Players"
      : `${playerCount} player${playerCount === 1 ? "" : "s"}`;

  const handleRun = useCallback(async () => {
    if (disabled || submitting) return;
    setSubmitting(true);
    setError(null);
    setCompositeResult(null);

    const playerIds = selectedPlayers.map((p) => p.id);
    const opts = playerIds.length > 0 ? { player_ids: playerIds } : {};

    try {
      if (stage === "composite") {
        const res = await runCompositeBatchScoped(opts);
        if (res.success && res.data) {
          setCompositeResult(res.data);
          setCompositedIds(playerIds);
          return;
        }
        setError(res.error || "Could not run compositing.");
        return;
      }

      const trigger =
        stage === "salary_scrape" ? triggerSalaryScrapeRun : triggerBioTeamSyncRun;
      const res = await trigger(opts);
      if (res.success && res.data) {
        onStaged?.(res.data.run_id);
        return;
      }
      setError(res.error || `Could not start the ${copy.verb} run.`);
    } catch {
      setError("Could not reach the backend to start the run.");
    } finally {
      setSubmitting(false);
    }
  }, [disabled, submitting, stage, selectedPlayers, onStaged, copy.verb]);

  // The review link scopes to exactly the Players just composited; an empty
  // subset (full-league run) omits the param so the queue shows everything.
  const reviewHref =
    compositedIds.length > 0
      ? `/admin/review?players=${compositedIds.join(",")}`
      : "/admin/review";

  return (
    <section
      id={`${stage}-runner`}
      className="rounded-[6px] border border-[#d9d0c9] bg-white px-5 py-4 mb-6"
    >
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-[#0e0907]">{copy.title}</h3>
        <p className="text-xs text-neutral-500 mt-0.5">{copy.description}</p>
      </div>

      <PlayerSubsetPicker
        idPrefix={`${stage}-player`}
        selected={selectedPlayers}
        onChange={setSelectedPlayers}
        disabled={disabled}
      />

      {error && (
        <div
          id={`${stage}-error`}
          className="rounded-[6px] border border-red-200 bg-red-50 px-3 py-2 mb-3 text-xs text-red-700"
        >
          {error}
        </div>
      )}

      {compositeResult && (
        <div
          id={`${stage}-result`}
          className="rounded-[6px] border border-[#ffa05c]/40 bg-[#fff8f4] px-3 py-2 mb-3 text-xs text-[#0e0907]"
        >
          <p>
            Composited{" "}
            <span className="font-semibold">{compositeResult.processed}</span> of{" "}
            {compositeResult.total} Players —{" "}
            <span className="font-semibold">{compositeResult.auto_accepted}</span> skills auto-accepted,{" "}
            <span className="font-semibold">{compositeResult.flagged_for_review}</span> flagged for review.
          </p>
          {compositeResult.flagged_for_review > 0 && (
            <Link
              id={`${stage}-review-link`}
              href={reviewHref}
              className="mt-2 inline-block rounded border border-[#ffa05c]/60 bg-[#fff8f4] px-3 py-1.5 font-semibold text-[#fe6d34] hover:bg-[#ffa05c]/10 transition-colors"
            >
              Review flagged Players →
            </Link>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <p id={`${stage}-scope-summary`} className="text-xs text-neutral-500">
          Will {copy.verb} <span className="font-medium text-[#0e0907]">{scopeLabel}</span>.
        </p>
        <button
          id={`pipeline-${stage}-run-btn`}
          type="button"
          onClick={handleRun}
          disabled={disabled || submitting}
          className={cn(
            "text-xs font-semibold px-4 py-2 rounded transition-colors",
            "bg-[#fe6d34] text-white hover:bg-[#e85c25]",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          {submitting ? "Running…" : stage === "composite" ? "Run compositing" : "Start run"}
        </button>
      </div>
    </section>
  );
}
