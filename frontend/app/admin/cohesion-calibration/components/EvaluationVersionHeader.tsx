/**
 * EvaluationVersionHeader — Status chip + New Draft / Continue / Discard buttons.
 *
 * Mounted at the top of the cohesion calibration page header. Shows
 * the currently active Evaluation Version slug and status, or switches
 * to draft mode when a draft exists.
 */

"use client";

import type { EvaluationVersion } from "@/lib/types/evaluation-version";

interface EvaluationVersionHeaderProps {
  active: EvaluationVersion | null;
  draft: EvaluationVersion | null;
  loading: boolean;
  onCreateDraft: () => void;
  onDiscardDraft: () => void;
}

export function EvaluationVersionHeader({
  active,
  draft,
  loading,
  onCreateDraft,
  onDiscardDraft,
}: EvaluationVersionHeaderProps) {
  if (loading) {
    return (
      <div id="eval-version-header" className="flex items-center gap-2 text-xs text-muted-foreground">
        <div className="size-3 animate-spin rounded-full border border-muted-foreground border-t-primary" />
        Loading version…
      </div>
    );
  }

  const current = draft ?? active;
  const isDraft = draft !== null;

  return (
    <div id="eval-version-header" className="flex items-center gap-3">
      {/* Status chip */}
      <div
        id="eval-version-chip"
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
          isDraft
            ? "bg-amber-500/10 text-amber-600 border border-amber-500/30"
            : "bg-emerald-500/10 text-emerald-600 border border-emerald-500/30"
        }`}
      >
        <span
          className={`size-1.5 rounded-full ${
            isDraft ? "bg-amber-500" : "bg-emerald-500"
          }`}
        />
        {current?.slug ?? "—"}
        <span className="opacity-60">·</span>
        {isDraft ? "draft" : "published"}
        {!isDraft && " · active"}
      </div>

      {/* Action buttons */}
      {isDraft ? (
        <button
          id="eval-version-discard-btn"
          type="button"
          onClick={onDiscardDraft}
          className="text-[10px] font-medium px-2.5 py-1 rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
        >
          Discard draft
        </button>
      ) : (
        <button
          id="eval-version-new-draft-btn"
          type="button"
          onClick={onCreateDraft}
          className="text-[10px] font-medium px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors cursor-pointer"
        >
          New Draft
        </button>
      )}
    </div>
  );
}
