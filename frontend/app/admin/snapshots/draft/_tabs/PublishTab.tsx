"use client";

/**
 * PublishTab: CountSummary, validation, and a CTA that opens the shell's
 * PublishModal. Only reachable when draft.status === "review" (gate enforced
 * by resolveActiveTab).
 *
 * The shell owns publish state and the PublishModal so that the sticky-bar
 * Publish button and this tab's Publish CTA cannot fire two concurrent
 * publish requests. This tab is display-only.
 *
 * Publish gates surfaced here:
 *   - players_missing_canonical > 0 (hard — disables the CTA; no canonical link)
 *   - legends_missing_canonical > 0 (hard — disables the CTA; the publish RPC
 *     hard-blocks with legends_missing_canonical_player otherwise)
 *   - open_flags > 0 (banner only — the modal enforces the block + override flow)
 */

import { CountSummary } from "../../_components/CountSummary";
import type {
  SnapshotDraftSummary,
  SnapshotCountSummary,
  SnapshotPublishValidation,
} from "@/lib/types";
import type { TabSlug } from "../_lib/tabRouting";

export interface PublishTabProps {
  draft: SnapshotDraftSummary;
  summary: SnapshotCountSummary | null;
  validation: SnapshotPublishValidation | null;
  reload: () => Promise<void>;
  onTabChange: (slug: TabSlug) => void;
  onOpenPublishModal: () => void;
  isPublishing: boolean;
}

export function PublishTab({
  summary,
  validation,
  onTabChange,
  onOpenPublishModal,
  isPublishing,
}: PublishTabProps) {
  const missingComposite = validation?.players_missing_composite ?? 0;
  const missingCanonical = validation?.players_missing_canonical ?? 0;
  const legendsMissingCanonical = validation?.legends_missing_canonical ?? 0;
  const openFlags = validation?.open_flags ?? 0;

  const hasOpenFlagsGate = openFlags > 0;
  const isCanonicalBlocked = missingCanonical > 0 || legendsMissingCanonical > 0;

  const flagsBannerText =
    openFlags === 1
      ? "Cannot publish: 1 open flag must be resolved. Resolve it in Review, or override in the publish dialog."
      : `Cannot publish: ${openFlags} open flags must be resolved. Resolve them in Review, or override in the publish dialog.`;

  return (
    <div id="publish-tab-content" className="max-w-2xl">
      <div id="publish-tab-header" className="mb-6">
        <h2 className="text-base font-semibold text-[#0e0907]">Publish Snapshot</h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          Review the counts below, then publish to make this snapshot the active release.
        </p>
      </div>

      {/* #8: pre-publish review Affordance — the Diff tab shows exactly what
          this publish will change vs the active release. */}
      <div
        id="publish-tab-diff-link-card"
        className="rounded-[6px] border border-[#d9d0c9] px-5 py-3.5 mb-6 flex items-center justify-between gap-4"
        style={{ backgroundColor: "#fef9f5" }}
      >
        <p className="text-xs text-neutral-600">
          Publishing replaces the active release. Review the diff to see
          exactly what changes.
        </p>
        <button
          id="publish-tab-diff-link"
          type="button"
          onClick={() => onTabChange("diff")}
          className="text-xs font-semibold text-[#fe6d34] hover:text-[#0e0907] transition-colors whitespace-nowrap"
        >
          Review the diff &rarr;
        </button>
      </div>

      {summary ? (
        <div id="publish-tab-summary" className="mb-8">
          <CountSummary
            id="publish-tab-count-summary"
            summary={summary}
            missingCompositePlayers={validation?.missing_composite_players ?? []}
          />
        </div>
      ) : (
        <div
          id="publish-tab-summary-loading"
          className="h-24 rounded-[6px] border border-[#d9d0c9] animate-pulse mb-8"
          style={{ backgroundColor: "#fef9f5" }}
        />
      )}

      {missingCanonical > 0 && (
        <div
          id="publish-tab-blocked"
          className="rounded-[6px] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800 mb-6"
        >
          <strong>Cannot publish:</strong> {missingCanonical} player
          {missingCanonical !== 1 ? "s" : ""} missing canonical profiles.
          Run the ingestion pipelines and composite review first.
        </div>
      )}

      {legendsMissingCanonical > 0 && (
        <div
          id="publish-tab-legends-blocked"
          className="rounded-[6px] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800 mb-6"
        >
          <strong>Cannot publish:</strong> {legendsMissingCanonical} legend
          {legendsMissingCanonical !== 1 ? "s" : ""} missing a canonical link.
          Each Legend needs a canonical_players row before the snapshot can be frozen.
        </div>
      )}

      {hasOpenFlagsGate && (
        <div
          id="publish-tab-open-flags-blocked"
          className="rounded-[6px] border border-[#fe6d34] bg-[#fef0ea] px-5 py-4 text-sm text-[#0e0907] mb-6"
        >
          {flagsBannerText}
        </div>
      )}

      <div id="publish-tab-cta">
        <button
          id="publish-tab-publish-btn"
          type="button"
          onClick={onOpenPublishModal}
          disabled={isCanonicalBlocked || isPublishing}
          className="text-sm font-semibold px-6 py-2.5 rounded-[4px]
            bg-[#ffa05c] text-[#0e0907] hover:bg-[#fe6d34]
            focus:outline-none focus:ring-2 focus:ring-[#ffa05c] focus:ring-offset-2
            disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isPublishing ? "Publishing…" : "Publish snapshot"}
        </button>
        {missingComposite > 0 && (
          <p className="text-xs text-neutral-500 mt-2">
            {missingComposite} player{missingComposite !== 1 ? "s" : ""} missing composite
            Skill Profiles. You can still publish and acknowledge.
          </p>
        )}
      </div>
    </div>
  );
}
