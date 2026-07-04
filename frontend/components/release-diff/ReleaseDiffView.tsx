"use client";

/**
 * ReleaseDiffView — draft-vs-published diff Surface (#8).
 *
 * Fetches GET /api/snapshots/diff and delegates rendering to ReleaseDiffBody
 * (shared with the public /snapshots/[id] page and the admin release detail
 * embed). This file owns only the draft workspace's fetch, loading skeleton,
 * and error/retry states.
 */

import { useCallback, useEffect, useState } from "react";
import { getSnapshotDiff } from "@/lib/api";
import type { ReleaseDiff } from "@/lib/types";
import { ReleaseDiffBody } from "./ReleaseDiffBody";

type ViewState = "loading" | "error" | "ready";

export interface ReleaseDiffViewProps {
  /** Refetch key — the open draft's id. */
  draftId: string;
}

export function ReleaseDiffView({ draftId }: ReleaseDiffViewProps) {
  const [viewState, setViewState] = useState<ViewState>("loading");
  const [diff, setDiff] = useState<ReleaseDiff | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setViewState("loading");
    try {
      const res = await getSnapshotDiff();
      if (res.success && res.data) {
        setDiff(res.data);
        setViewState("ready");
      } else {
        setErrorMessage(res.error ?? "Failed to load diff");
        setViewState("error");
      }
    } catch {
      setErrorMessage("Failed to load diff");
      setViewState("error");
    }
  }, []);

  useEffect(() => {
    void load();
    // draftId is the refetch key: a new draft means a new diff.
  }, [load, draftId]);

  if (viewState === "loading") {
    return (
      <div id="diff-loading" className="space-y-3">
        <div
          className="h-20 rounded-[6px] border border-[#d9d0c9] animate-pulse"
          style={{ backgroundColor: "#fef9f5" }}
        />
        <div className="h-10 rounded-[6px] border border-[#d9d0c9] animate-pulse bg-white" />
        <div className="h-10 rounded-[6px] border border-[#d9d0c9] animate-pulse bg-white" />
      </div>
    );
  }

  if (viewState === "error" || !diff) {
    return (
      <div
        id="diff-error-state"
        className="rounded-[6px] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800"
      >
        <p className="mb-2">
          Couldn&apos;t compute the diff: {errorMessage ?? "unknown error"}
        </p>
        <button
          id="diff-error-retry-btn"
          type="button"
          onClick={() => void load()}
          className="text-xs font-medium border border-amber-300 rounded-[4px] px-3 py-1.5 bg-white hover:bg-amber-100 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  const { summary, active_release } = diff;

  return (
    <ReleaseDiffBody
      // Remount per fetch so the auto-expand initializer sees fresh data.
      key={`${draftId}:${diff.draft.id}`}
      summary={summary}
      playersAdded={diff.players_added}
      playersRemoved={diff.players_removed}
      playersChanged={diff.players_changed}
      comparedWithLabel={active_release.label}
      skillRenames={diff.skill_renames}
      emptyHeading="No changes vs published release"
      emptyNote={`Publishing this draft would freeze the same ${summary.unchanged} player${
        summary.unchanged !== 1 ? "s" : ""
      } as “${active_release.label}”.`}
    />
  );
}
