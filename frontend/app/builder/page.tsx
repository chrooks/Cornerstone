/**
 * /builder — Team Builder page.
 *
 * Two states driven by URL params:
 *   - Picker mode  (no ?cornerstone=): legend picker grid
 *   - Builder mode (?cornerstone=<id>): split-panel builder
 *
 * Wrapped in Suspense — required by Next.js App Router when useSearchParams()
 * is used in a client component.
 */

import { Suspense } from "react";
import { BuilderPage } from "@/components/builder/BuilderPage";

function BuilderPageFallback() {
  return (
    <main className="max-w-screen-2xl mx-auto px-4 py-8 space-y-4">
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 bg-muted rounded" />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-28 bg-muted rounded-lg" />
          ))}
        </div>
      </div>
    </main>
  );
}

export default function BuilderRoute() {
  return (
    <Suspense fallback={<BuilderPageFallback />}>
      <BuilderPage />
    </Suspense>
  );
}
