"use client";

/**
 * /admin/calibration — standalone Threshold Calibration shell.
 *
 * Power-user deep-link preserved for direct navigation and `[skill_name]` hash
 * anchor compatibility (e.g. `/admin/calibration#spot_up_shooter`).
 *
 * The workspace content is now in CalibrationWorkspace so it can be embedded
 * inside the draft workspace ThresholdsTab without layout duplication.
 */

import { Toaster } from "sonner";
import { CalibrationWorkspace } from "./CalibrationWorkspace";

export default function CalibrationPage() {
  return (
    <>
      <Toaster
        position="bottom-right"
        richColors
        closeButton
        toastOptions={{ duration: 4000 }}
      />
      {/* Full-screen chrome: back link above the workspace */}
      <div className="flex flex-col h-screen overflow-hidden bg-background">
        <header
          id="calibration-page-header"
          className="flex-shrink-0 flex items-center gap-3 px-6 py-3 border-b border-border bg-background z-10"
        >
          <a
            id="calibration-back-link"
            href="/admin"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Cornerstone
          </a>
          <span className="text-muted-foreground/30">/</span>
          <span className="text-sm font-semibold text-foreground">
            Threshold Calibration
          </span>
        </header>
        <div className="flex-1 overflow-hidden">
          <CalibrationWorkspace embedded />
        </div>
      </div>
    </>
  );
}
