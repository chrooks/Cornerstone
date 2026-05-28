"use client";

/**
 * /admin/calibration: standalone Threshold Calibration shell.
 *
 * Power-user deep-link preserved for direct navigation. The workspace content
 * lives in CalibrationWorkspace so it can be embedded inside the draft
 * workspace ThresholdsTab without layout duplication.
 *
 * Per-skill deep-link: `?skill=<skill_name>` (or `#<skill_name>`) opens the
 * workspace on that skill. Validated against the taxonomy in CalibrationWorkspace.
 */

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Toaster } from "sonner";
import { CalibrationWorkspace } from "./CalibrationWorkspace";

/** Reads the deep-link skill from the query param or URL hash, then renders the workspace. */
function CalibrationShell() {
  const params = useSearchParams();
  const fromQuery = params.get("skill");
  const fromHash =
    typeof window !== "undefined"
      ? decodeURIComponent(window.location.hash.replace(/^#/, ""))
      : "";
  const initialSkill = fromQuery ?? (fromHash || undefined);

  return (
    <div className="flex-1 overflow-hidden">
      <CalibrationWorkspace embedded initialSkill={initialSkill} />
    </div>
  );
}

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
        <Suspense fallback={<div className="flex-1" />}>
          <CalibrationShell />
        </Suspense>
      </div>
    </>
  );
}
