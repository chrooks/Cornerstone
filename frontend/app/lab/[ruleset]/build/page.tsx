/**
 * /lab/[ruleset]/build — Team Builder (Build phase of the Lab lifecycle).
 *
 * Requires ?cornerstone=<id> in search params. If missing, redirects to the
 * Legends picker at /lab/[ruleset]/legends. All builder logic lives in
 * BuilderPage; this file is a thin route wrapper with Suspense boundary.
 */

import { Suspense } from "react";
import { BuilderPage } from "@/components/builder/BuilderPage";

/* Skeleton shown while BuilderPage resolves useSearchParams */
function BuilderPageFallback() {
  return (
    <main className="max-w-screen-2xl mx-auto px-6 py-8 space-y-4">
      <div className="animate-pulse space-y-4">
        {/* Breadcrumb skeleton */}
        <div className="h-4 w-56 bg-[#0e0907]/[0.06] rounded-sm" />
        {/* Title skeleton */}
        <div className="h-8 w-72 bg-[#0e0907]/[0.06] rounded-sm" />
        {/* Split panel skeleton */}
        <div className="flex gap-4 h-[calc(100vh-10rem)]">
          <div className="flex-1 bg-[#0e0907]/[0.04] rounded-lg" />
          <div className="w-[35%] bg-[#0e0907]/[0.04] rounded-lg" />
        </div>
      </div>
    </main>
  );
}

export default function BuildRoute() {
  return (
    <Suspense fallback={<BuilderPageFallback />}>
      <BuilderPage />
    </Suspense>
  );
}
