/**
 * runReview.ts — Pure predicates for pipeline run review affordances.
 *
 * Single source of truth for both the list-row Review button and the
 * RunDiffPreview guard. Keeps business rules out of render logic.
 */

import type { PipelineRun } from "@/lib/types";

/** Pipeline names whose runs stage changes that require review before committing. */
export const STAGED_PIPELINE_NAMES = [
  "skill_evaluation",
  "threshold_edit",
] as const;

/** True when the run's pipeline produces staged changes (skill_evaluation or threshold_edit). */
export function isStagedRun(run: PipelineRun): boolean {
  return (STAGED_PIPELINE_NAMES as readonly string[]).includes(run.pipeline_name);
}

/**
 * True when the run is staged, succeeded, and has not yet been committed or discarded.
 * These runs show the "Review changes" affordance.
 */
export function isReviewableRun(run: PipelineRun): boolean {
  return (
    isStagedRun(run) &&
    run.status === "success" &&
    run.committed_at === null
  );
}

/**
 * True when the run can no longer be acted on — either committed or discarded.
 * Terminal runs show a read-only "View changes" affordance.
 */
export function isTerminalRun(run: PipelineRun): boolean {
  return run.committed_at !== null || run.status === "discarded";
}
