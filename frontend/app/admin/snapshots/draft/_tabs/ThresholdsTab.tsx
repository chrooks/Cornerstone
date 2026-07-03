"use client";

/**
 * ThresholdsTab — thin wrapper around CalibrationWorkspace for the draft workspace.
 *
 * When a threshold edit is staged, shows a toast with a "View in Pipeline" link
 * and rewrites the URL to `?tab=pipeline&run=<id>`.
 *
 * Layout: the tool fills exactly the viewport space below whatever chrome sits
 * above it (sticky navbar + draft header + tab strip), measured at mount and on
 * resize. No page scroll is ever needed — the workspace's own action footer is
 * always visible at the bottom of the pane, and inner panels scroll internally.
 * The 1180px shell cap is broken out to near-full width (dense 3-pane data
 * tool, not a reading column).
 */

import { useCallback, useLayoutEffect, useRef, useState } from "react";
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
  const paneRef = useRef<HTMLDivElement>(null);
  // Fallback matches the old fixed assumption until the first measure runs.
  const [paneHeight, setPaneHeight] = useState("calc(100dvh - 3rem)");

  // Size the pane to the viewport space below the chrome actually above it
  // (navbar + draft header + tab strip), so the action footer is always
  // visible without any page scroll.
  useLayoutEffect(() => {
    const measure = () => {
      const el = paneRef.current;
      if (!el) return;
      const topInDocument = el.getBoundingClientRect().top + window.scrollY;
      setPaneHeight(`calc(100dvh - ${Math.max(0, Math.round(topInDocument))}px)`);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

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
      ref={paneRef}
      style={{ height: paneHeight }}
      className="overflow-hidden mx-[calc(50%-50vw+1rem)]"
    >
      <CalibrationWorkspace embedded onStagedEdit={handleStagedEdit} />
    </div>
  );
}
