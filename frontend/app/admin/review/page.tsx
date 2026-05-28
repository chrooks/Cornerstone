"use client";

/**
 * /admin/review — standalone Review Queue shell.
 *
 * Kept as a routable page so `/admin/review/<player_id>` sub-routes remain
 * accessible via direct navigation and deep-links.
 *
 * The workspace content is now in ReviewQueueWorkspace so it can be embedded
 * inside the draft workspace ReviewTab without layout duplication.
 */

import { ReviewQueueWorkspace } from "./ReviewQueueWorkspace";

export default function ReviewQueuePage() {
  return (
    <main id="review-queue-page" className="max-w-5xl mx-auto px-4 py-8">
      <ReviewQueueWorkspace />
    </main>
  );
}
