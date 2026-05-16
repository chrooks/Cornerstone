/**
 * DraftBanner — Persistent amber band when a draft Evaluation Version exists.
 *
 * Shows pending-changes count and provides View Diff + Publish buttons.
 */

"use client";

interface DraftBannerProps {
  changeCount: number;
  onViewDiff: () => void;
  onPublish: () => void;
}

export function DraftBanner({
  changeCount,
  onViewDiff,
  onPublish,
}: DraftBannerProps) {
  return (
    <div
      id="eval-version-draft-banner"
      className="flex-shrink-0 flex items-center justify-between px-6 py-2 bg-amber-500/10 border-b border-amber-500/30"
    >
      <div className="flex items-center gap-2 text-xs text-amber-700">
        <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
        <span className="font-medium">DRAFT MODE</span>
        <span className="text-amber-600/70">
          {changeCount === 0
            ? "No changes yet"
            : `${changeCount} change${changeCount === 1 ? "" : "s"} pending`}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          id="eval-version-view-diff-btn"
          type="button"
          onClick={onViewDiff}
          className="text-[10px] font-medium px-2.5 py-1 rounded-md border border-amber-500/30 text-amber-700 hover:bg-amber-500/10 transition-colors cursor-pointer"
        >
          View diff
        </button>
        <button
          id="eval-version-publish-btn"
          type="button"
          onClick={onPublish}
          className="text-[10px] font-medium px-2.5 py-1 rounded-md bg-amber-600 text-white hover:bg-amber-700 transition-colors cursor-pointer"
        >
          Publish
        </button>
      </div>
    </div>
  );
}
