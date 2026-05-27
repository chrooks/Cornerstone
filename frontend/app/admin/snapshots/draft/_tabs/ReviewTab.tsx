"use client";

/**
 * ReviewTab — thin wrapper around ReviewQueueWorkspace for the draft workspace.
 */

import { ReviewQueueWorkspace } from "@/app/admin/review/ReviewQueueWorkspace";
import type {
  SnapshotDraftSummary,
  SnapshotCountSummary,
  SnapshotPublishValidation,
} from "@/lib/types";
import type { TabSlug } from "../_lib/tabRouting";

export interface ReviewTabProps {
  draft: SnapshotDraftSummary;
  summary: SnapshotCountSummary | null;
  validation: SnapshotPublishValidation | null;
  reload: () => Promise<void>;
  onTabChange: (slug: TabSlug) => void;
}

export function ReviewTab(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _props: ReviewTabProps
) {
  return (
    <div id="review-tab-content" className="py-2">
      <ReviewQueueWorkspace />
    </div>
  );
}
