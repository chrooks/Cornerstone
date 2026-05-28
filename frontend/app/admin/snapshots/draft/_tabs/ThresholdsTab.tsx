"use client";

/**
 * ThresholdsTab — thin wrapper around CalibrationWorkspace for the draft workspace.
 *
 * When a threshold edit is staged, shows a toast with a "View in Pipeline" link
 * and rewrites the URL to `?tab=pipeline&run=<id>`.
 *
 * Layout: the tool is sized to the viewport below the sticky 48px navbar
 * (100dvh - 3rem). The draft header + tab strip sit above it in normal flow,
 * so the page scrolls them away — scroll down once and the tool fills the
 * screen with no header chrome and no forced bottom gap. The 1180px shell cap
 * is broken out to near-full width (dense 3-pane data tool, not a reading
 * column).
 */

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalibrationWorkspace } from "@/app/admin/calibration/CalibrationWorkspace";
import type {
  SnapshotDraftSummary,
  SnapshotCountSummary,
  SnapshotPublishValidation,
} from "@/lib/types";
import type { TabSlug } from "../_lib/tabRouting";

export interface ThresholdsTabProps {
  draft: SnapshotDraftSummary;
  summary: SnapshotCountSummary | null;
  validation: SnapshotPublishValidation | null;
  reload: () => Promise<void>;
  onTabChange: (slug: TabSlug) => void;
}

export function ThresholdsTab({ onTabChange }: ThresholdsTabProps) {
  const router = useRouter();

  const handleStagedEdit = useCallback(
    (runId: string) => {
      // Deep-link to pipeline tab with the staged run highlighted
      router.push(`?tab=pipeline&run=${runId}`);
      toast.success(
        `Threshold edit staged: run ${runId.slice(0, 8)}…`,
        {
          action: {
            label: "View in Pipeline",
            onClick: () => {
              router.push(`?tab=pipeline&run=${runId}`);
              onTabChange("pipeline");
            },
          },
          duration: 6000,
        }
      );
    },
    [router, onTabChange]
  );

  return (
    <div
      id="thresholds-tab-content"
      className="h-[calc(100dvh-3rem)] overflow-hidden mx-[calc(50%-50vw+1rem)]"
    >
      <CalibrationWorkspace embedded onStagedEdit={handleStagedEdit} />
    </div>
  );
}
