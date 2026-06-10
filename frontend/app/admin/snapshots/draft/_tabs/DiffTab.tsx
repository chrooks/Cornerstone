"use client";

/**
 * DiffTab — pre-publish review step (#8).
 *
 * Compares the open draft against the active published Snapshot Release so an
 * admin can scan exactly what a publish will change before pulling the
 * trigger. Display-only; all computation happens server-side at
 * GET /api/snapshots/diff, which mirrors the publish RPC's freeze selection.
 */

import type {
  SnapshotDraftSummary,
  SnapshotCountSummary,
  SnapshotPublishValidation,
} from "@/lib/types";
import type { TabSlug } from "../_lib/tabRouting";
import { ReleaseDiffView } from "../_components/release-diff/ReleaseDiffView";

export interface DiffTabProps {
  draft: SnapshotDraftSummary;
  summary: SnapshotCountSummary | null;
  validation: SnapshotPublishValidation | null;
  reload: () => Promise<void>;
  onTabChange: (slug: TabSlug) => void;
}

export function DiffTab({ draft }: DiffTabProps) {
  return (
    <div id="diff-tab-content" className="max-w-3xl">
      <div id="diff-tab-header" className="mb-6">
        <h2 className="text-base font-semibold text-[#0e0907]">
          Draft vs Published
        </h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          What publishing this draft will change relative to the active
          release.
        </p>
      </div>

      <ReleaseDiffView draftId={draft.id} />
    </div>
  );
}
