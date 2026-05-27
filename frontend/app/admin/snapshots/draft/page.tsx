"use client";

/**
 * /admin/snapshots/draft — Draft workspace shell.
 *
 * Owns:
 *  - Draft fetch + reload cycle
 *  - URL-pinned tab state via `?tab=` (useSearchParams)
 *  - TabStrip rendering
 *  - Empty State Affordance (no draft)
 *  - Sticky lifecycle action bar (cross-tab)
 *
 * Tab rendering is delegated to the _tabs/ components.
 * The redirect to /admin/snapshots on no-draft is REMOVED — replaced by EmptyDraftCard.
 *
 * Next 15: useSearchParams must be in a child of <Suspense>. The shell is split
 * into DraftWorkspaceShell (reads searchParams) + this page (wraps in Suspense).
 */

import { Suspense } from "react";
import { DraftWorkspaceShell } from "./_components/DraftWorkspaceShell";

export default function SnapshotDraftPage() {
  return (
    <Suspense
      fallback={
        <main
          id="snapshot-draft-page-suspense"
          className="max-w-[1180px] mx-auto px-4 py-8"
        >
          <div className="flex items-center gap-2 text-neutral-400 text-sm">
            <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            Loading workspace…
          </div>
        </main>
      }
    >
      <DraftWorkspaceShell />
    </Suspense>
  );
}
