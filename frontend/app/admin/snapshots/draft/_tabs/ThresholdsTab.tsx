"use client";

/**
 * ThresholdsTab — thin wrapper around CalibrationWorkspace for the draft workspace.
 *
 * When a threshold edit is staged, shows a toast with a "View in Pipeline" link
 * and rewrites the URL to `?tab=pipeline&run=<id>`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
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

// Bottom clearance below the tool: the shell's pb-28 (112px) plus breathing
// room so the floating "Move to review" action bar never overlaps the tool.
const BOTTOM_CLEARANCE = 128;

export function ThresholdsTab({ onTabChange }: ThresholdsTabProps) {
  const router = useRouter();

  // Fill from the tool's top to the viewport bottom instead of a guessed
  // calc(). Robust to whatever chrome (shell header, tab strip) sits above.
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const compute = () => {
      const top = el.getBoundingClientRect().top;
      setHeight(Math.max(440, window.innerHeight - top - BOTTOM_CLEARANCE));
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
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
      ref={containerRef}
      id="thresholds-tab-content"
      // Break out of the shell's max-w-[1180px] cap: this is a dense 3-pane
      // data tool that wants the full viewport width, not a reading column.
      // mx-[calc(50%-50vw+1rem)] extends to 1rem from each viewport edge.
      className="h-[calc(100vh-240px)] overflow-hidden mx-[calc(50%-50vw+1rem)]"
      style={height ? { height } : undefined}
    >
      <CalibrationWorkspace embedded onStagedEdit={handleStagedEdit} />
    </div>
  );
}
