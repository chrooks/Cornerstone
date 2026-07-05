"use client";

/**
 * LegendsTab — thin wrapper around LegendsWorkspace for the draft workspace.
 */

import { LegendsWorkspace } from "@/app/admin/legends/LegendsWorkspace";
import type {
  SnapshotDraftSummary,
  SnapshotCountSummary,
  SnapshotPublishValidation,
} from "@/lib/types";
import type { TabSlug } from "../_lib/tabRouting";

export interface LegendsTabProps {
  draft: SnapshotDraftSummary;
  summary: SnapshotCountSummary | null;
  validation: SnapshotPublishValidation | null;
  reload: () => Promise<void>;
  onTabChange: (slug: TabSlug) => void;
}

export function LegendsTab(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _props: LegendsTabProps
) {
  return (
    <div id="legends-tab-content" className="py-2">
      <LegendsWorkspace />
    </div>
  );
}
