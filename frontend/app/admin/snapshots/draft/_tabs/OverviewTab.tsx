"use client";

/**
 * OverviewTab — extracted body of the former draft page.
 *
 * Receives all data from the workspace shell via props.
 * No data fetching here — shell owns the fetch + reload cycle.
 */

import {
  triggerStatFetch,
  triggerSalaryScrape,
  triggerBioTeamSync,
} from "@/lib/api";
import type {
  SnapshotDraftSummary,
  SnapshotCountSummary,
  SnapshotPublishValidation,
} from "@/lib/types";
import { PipelineCard } from "../../_components/PipelineCard";
import { StatusCard } from "../../_components/StatusCard";
import { CountSummary } from "../../_components/CountSummary";
import type { TabSlug } from "../_lib/tabRouting";

export interface OverviewTabProps {
  draft: SnapshotDraftSummary;
  summary: SnapshotCountSummary | null;
  validation: SnapshotPublishValidation | null;
  reload: () => Promise<void>;
  onTabChange: (slug: TabSlug) => void;
}

export function OverviewTab({
  draft,
  summary,
  validation,
  onTabChange,
}: OverviewTabProps) {
  const isFrozen = draft.status === "review";

  return (
    <div id="overview-tab-content">
      {/* 3-up pipeline cards */}
      <section id="overview-pipeline-section" className="mb-10">
        <h2 className="text-[11px] uppercase tracking-wider font-semibold text-neutral-400 mb-4">
          Ingestion Pipelines
        </h2>
        <div
          id="overview-pipeline-grid"
          className="grid grid-cols-1 md:grid-cols-3 gap-4"
        >
          <PipelineCard
            id="pipeline-card-stat-fetch"
            title="Stat Fetch"
            description="Pull current-season stats from NBA.com for all qualifying players."
            frozen={isFrozen}
            onBulkRun={async () => {
              const res = await triggerStatFetch();
              if (!res.success || !res.data) throw new Error(res.error ?? "Failed");
              return res.data.run_id;
            }}
            onPlayerRun={async (playerId) => {
              const res = await triggerStatFetch({ player_ids: [playerId] });
              if (!res.success || !res.data) throw new Error(res.error ?? "Failed");
              return res.data.run_id;
            }}
          />

          <PipelineCard
            id="pipeline-card-salary-scrape"
            title="Salary Scrape"
            description="Scrape current contract values from ESPN for all players."
            frozen={isFrozen}
            onBulkRun={async () => {
              const res = await triggerSalaryScrape();
              if (!res.success || !res.data) throw new Error(res.error ?? "Failed");
              return res.data.run_id;
            }}
            onPlayerRun={async (playerId) => {
              const res = await triggerSalaryScrape(playerId);
              if (!res.success || !res.data) throw new Error(res.error ?? "Failed");
              return res.data.run_id;
            }}
          />

          <PipelineCard
            id="pipeline-card-bio-team-sync"
            title="Bio / Team Sync"
            description="Refresh name, team, position, and physical attributes from NBA.com."
            frozen={isFrozen}
            onBulkRun={async () => {
              const res = await triggerBioTeamSync();
              if (!res.success || !res.data) throw new Error(res.error ?? "Failed");
              return res.data.run_id;
            }}
            onPlayerRun={async (playerId) => {
              const res = await triggerBioTeamSync(playerId);
              if (!res.success || !res.data) throw new Error(res.error ?? "Failed");
              return res.data.run_id;
            }}
          />
        </div>
      </section>

      {/* 2-up status cards — deep-link into sibling tabs */}
      <section id="overview-status-section" className="mb-10">
        <h2 className="text-[11px] uppercase tracking-wider font-semibold text-neutral-400 mb-4">
          Evaluation Status
        </h2>
        <div
          id="overview-status-grid"
          className="grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          <StatusCard
            id="status-card-skill-mapping"
            title="Skill Mapping"
            description="Run the stat-to-skill threshold engine and edit threshold rules."
            href="?tab=thresholds"
          />
          <StatusCard
            id="status-card-compositing"
            title="Compositing"
            description="Resolve Claude vs. stats disagreements and manage composite profiles."
            href="?tab=review"
          />
        </div>
      </section>

      {/* Count summary (review state only) */}
      {draft.status === "review" && summary && (
        <section id="overview-count-summary-section" className="mb-10">
          <h2 className="text-[11px] uppercase tracking-wider font-semibold text-neutral-400 mb-4">
            Publish Summary
          </h2>
          <CountSummary
            id="overview-count-summary"
            summary={summary}
            missingCompositePlayers={validation?.missing_composite_players ?? []}
          />
          <div className="mt-4">
            <button
              id="overview-go-to-publish-btn"
              type="button"
              onClick={() => onTabChange("publish")}
              className="text-sm font-medium text-[#fe6d34] underline hover:no-underline transition-colors"
            >
              Go to Publish tab
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
