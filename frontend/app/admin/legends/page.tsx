"use client";

/**
 * /admin/legends — standalone Legends shell.
 *
 * Kept as a routable page so `/admin/legends/<legend_id>` sub-routes remain
 * accessible via direct navigation and deep-links.
 *
 * The workspace content is now in LegendsWorkspace so it can be embedded
 * inside the draft workspace LegendsTab without layout duplication.
 */

import { LegendsWorkspace } from "./LegendsWorkspace";

export default function LegendsPage() {
  return (
    <main id="legends-page" className="max-w-5xl mx-auto px-4 py-8">
      <LegendsWorkspace />
    </main>
  );
}
