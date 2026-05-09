/**
 * /lab/[ruleset]/eval — Final roster evaluation page within the Lab flow.
 *
 * Reads the same URL params as /lab/[ruleset]/build (?cornerstone=, ?s1-s8=).
 * EvaluatePage reads the ruleset from useParams() internally.
 * Wrapped in Suspense — required by Next.js App Router when useSearchParams()
 * is used in a client component.
 */

import { Suspense } from "react";
import { EvaluatePage } from "@/components/builder/EvaluatePage";

function EvaluatePageFallback() {
  return (
    <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 bg-muted rounded" />
        <div className="flex gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-7 w-24 bg-muted rounded" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          {[0, 1].map((col) => (
            <div key={col} className="space-y-3">
              <div className="h-5 w-24 bg-muted rounded" />
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-14 bg-muted rounded-lg" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

export default function EvaluateRoute() {
  return (
    <Suspense fallback={<EvaluatePageFallback />}>
      <EvaluatePage />
    </Suspense>
  );
}
