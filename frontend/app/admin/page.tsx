"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getPipelineStatus, getReviewQueue, listLegends, testThresholds } from "@/lib/api";
import type { PipelineStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types for the hub dashboard stats
// ---------------------------------------------------------------------------

interface HubStats {
  pipeline: PipelineStatus | null;
  pendingReview: number | null;
  anchorPassRate: number | null;    // 0–100
  anchorCount: number | null;       // total anchors tested
  legendsTotal: number;
  legendsComplete: number;
  legendsProfiled: number;          // complete = all 20 skills
  autoAccepted: number | null;
  pipelineError: boolean;
  reviewError: boolean;
  anchorError: boolean;
  legendsError: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derive a pipeline stage label from the status counts. */
function pipelineStageLabel(status: PipelineStatus | null): string {
  if (!status) return "—";
  if (status.players_with_composite > 0) {
    return `Composited: ${status.players_with_composite} players`;
  }
  if (status.players_with_skills > 0) {
    return `Skills: ${status.players_with_skills} players`;
  }
  if (status.players_with_stats > 0) {
    return `Stats: ${status.players_with_stats} players`;
  }
  return "Not started";
}

// ---------------------------------------------------------------------------
// Navigation card
// ---------------------------------------------------------------------------

interface NavCardProps {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  badge: React.ReactNode;
}

function NavCard({ href, title, description, icon, badge }: NavCardProps) {
  return (
    <Link
      href={href}
      className="block rounded-lg border bg-card p-5 hover:shadow-md hover:border-foreground/20 transition-all group"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        {/* Icon */}
        <div className="flex-shrink-0 text-2xl text-muted-foreground group-hover:text-foreground transition-colors">
          {icon}
        </div>
        {/* Badge */}
        <div>{badge}</div>
      </div>
      <h3 className="font-semibold text-sm mb-0.5">{title}</h3>
      <p className="text-xs text-muted-foreground">{description}</p>
    </Link>
  );
}

/** Small inline loading spinner for badge states. */
function Spinner() {
  return (
    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
  );
}

// ---------------------------------------------------------------------------
// Stat block (bottom row)
// ---------------------------------------------------------------------------

interface StatBlockProps {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  progress?: number | null;   // 0–100
}

function StatBlock({ label, value, detail, progress }: StatBlockProps) {
  return (
    <div className="rounded-lg border bg-card px-5 py-4 flex-1 min-w-0">
      <p className="text-xs text-muted-foreground font-medium mb-1">{label}</p>
      <p className="text-lg font-bold tracking-tight">{value}</p>
      {detail && <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>}
      {progress != null && (
        <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full"
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hub dashboard page (admin)
// ---------------------------------------------------------------------------

export default function AdminHubPage() {
  const [stats, setStats] = useState<HubStats>({
    pipeline:         null,
    pendingReview:    null,
    anchorPassRate:   null,
    anchorCount:      null,
    legendsTotal:     36,
    legendsComplete:  0,
    legendsProfiled:  0,
    autoAccepted:     null,
    pipelineError:    false,
    reviewError:      false,
    anchorError:      false,
    legendsError:     false,
  });

  // Track loading state per data source so the page renders immediately with spinners
  const [pipelineLoading, setPipelineLoading] = useState(true);
  const [reviewLoading, setReviewLoading] = useState(true);
  const [anchorLoading, setAnchorLoading] = useState(true);
  const [legendsLoading, setLegendsLoading] = useState(true);

  useEffect(() => {
    // Fetch all four data sources in parallel — each resolves independently
    // so a slow endpoint doesn't block the others from rendering.

    // 1. Pipeline status
    getPipelineStatus()
      .then((res) => {
        if (res.success && res.data) {
          setStats((prev) => ({
            ...prev,
            pipeline: res.data,
            autoAccepted: res.data ? res.data.total_flags - res.data.unresolved_flags : null,
          }));
        } else {
          setStats((prev) => ({ ...prev, pipelineError: true }));
        }
      })
      .catch(() => setStats((prev) => ({ ...prev, pipelineError: true })))
      .finally(() => setPipelineLoading(false));

    // 2. Review queue pending count (we only need the count — fetch minimal params)
    getReviewQueue()
      .then((res) => {
        if (res.success && res.data) {
          setStats((prev) => ({ ...prev, pendingReview: res.data!.length }));
        } else {
          setStats((prev) => ({ ...prev, reviewError: true }));
        }
      })
      .catch(() => setStats((prev) => ({ ...prev, reviewError: true })))
      .finally(() => setReviewLoading(false));

    // 3. Anchor pass rate — test all anchors and compute overall pass rate
    testThresholds("all")
      .then((res) => {
        if (res.success && res.data) {
          // Data may be a single result or an array (all-skill test returns array)
          const results = Array.isArray(res.data) ? res.data : [res.data];
          let totalTested = 0;
          let totalPassed = 0;
          for (const r of results) {
            totalTested += r.anchors_tested ?? 0;
            totalPassed += r.passed ?? 0;
          }
          const passRate = totalTested > 0 ? Math.round((totalPassed / totalTested) * 100) : null;
          setStats((prev) => ({ ...prev, anchorPassRate: passRate, anchorCount: totalTested }));
        } else {
          setStats((prev) => ({ ...prev, anchorError: true }));
        }
      })
      .catch(() => setStats((prev) => ({ ...prev, anchorError: true })))
      .finally(() => setAnchorLoading(false));

    // 4. Legends completion
    listLegends()
      .then((res) => {
        if (res.success && res.data) {
          const total   = res.data.length;
          const complete = res.data.filter((l) => l.completion >= 20).length;
          const profiled = res.data.filter((l) => l.completion > 0).length;
          setStats((prev) => ({
            ...prev,
            legendsTotal:    total,
            legendsComplete: complete,
            legendsProfiled: profiled,
          }));
        } else {
          setStats((prev) => ({ ...prev, legendsError: true }));
        }
      })
      .catch(() => setStats((prev) => ({ ...prev, legendsError: true })))
      .finally(() => setLegendsLoading(false));
  }, []);

  // ---------------------------------------------------------------------------
  // Badge builders for each navigation card
  // ---------------------------------------------------------------------------

  const pipelineBadge = (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full border border-border bg-muted text-muted-foreground whitespace-nowrap">
      {pipelineLoading ? <Spinner /> : stats.pipelineError ? "—" : pipelineStageLabel(stats.pipeline)}
    </span>
  );

  const pendingCount = stats.pendingReview;
  const reviewBadge = (
    <span
      className={cn(
        "text-xs font-medium px-2 py-0.5 rounded-full border whitespace-nowrap",
        reviewLoading
          ? "border-border bg-muted text-muted-foreground"
          : stats.reviewError
          ? "border-border bg-muted text-muted-foreground"
          : pendingCount != null && pendingCount > 0
          ? "border-amber-300 bg-amber-50 text-amber-700"
          : "border-emerald-300 bg-emerald-50 text-emerald-700"
      )}
    >
      {reviewLoading ? <Spinner /> : stats.reviewError ? "—" : `${pendingCount ?? "—"} pending`}
    </span>
  );

  const anchorBadge = (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full border border-border bg-muted text-muted-foreground whitespace-nowrap">
      {anchorLoading ? (
        <Spinner />
      ) : stats.anchorError ? (
        "—"
      ) : stats.anchorCount === 0 ? (
        "No anchors set"
      ) : stats.anchorPassRate != null ? (
        `${stats.anchorPassRate}% anchors passing`
      ) : (
        "—"
      )}
    </span>
  );

  const legendsBadge = (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full border border-border bg-muted text-muted-foreground whitespace-nowrap">
      {legendsLoading ? (
        <Spinner />
      ) : stats.legendsError ? (
        "—"
      ) : (
        `${stats.legendsComplete}/${stats.legendsTotal} complete`
      )}
    </span>
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const pipelineStatus = stats.pipeline;
  const totalQualifying = pipelineStatus?.total_qualifying_players ?? 0;
  const totalComposite  = pipelineStatus?.players_with_composite ?? 0;
  const playerCompletePct = totalQualifying > 0
    ? Math.round((totalComposite / totalQualifying) * 100)
    : 0;

  const legendCompletePct = stats.legendsTotal > 0
    ? Math.round((stats.legendsComplete / stats.legendsTotal) * 100)
    : 0;

  return (
    <main id="hub-page" className="max-w-5xl mx-auto px-4 py-10">
      {/* Page header */}
      <div id="hub-header" className="mb-8">
        <h1 id="hub-title" className="text-3xl font-bold tracking-tight">Cornerstone</h1>
        <p id="hub-subtitle" className="text-muted-foreground mt-1">
          Internal tool for building NBA player skill profiles.
        </p>
      </div>

      {/* Row 1 — Navigation cards (4 across) */}
      <div id="hub-nav-cards" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div id="hub-card-pipeline">
          <NavCard
            href="/admin/pipeline"
            title="Pipeline"
            description="Run stat mapping and Claude assessment"
            icon="▶"
            badge={pipelineBadge}
          />
        </div>
        <div id="hub-card-review">
          <NavCard
            href="/admin/review"
            title="Review Queue"
            description="Resolve flagged skill assessments"
            icon="📋"
            badge={reviewBadge}
          />
        </div>
        <div id="hub-card-calibration">
          <NavCard
            href="/admin/calibration"
            title="Calibration"
            description="Tune skill classification thresholds"
            icon="⚙"
            badge={anchorBadge}
          />
        </div>
        <div id="hub-card-legends">
          <NavCard
            href="/admin/legends"
            title="Legends"
            description="Profile all-time greats"
            icon="★"
            badge={legendsBadge}
          />
        </div>
      </div>

      {/* Row 2 — Status summary (3 stat blocks) */}
      <div id="hub-stats-row" className="flex flex-col sm:flex-row gap-4">
        <div id="hub-stat-players">
          <StatBlock
            label="Current Players"
            value={
              pipelineLoading ? (
                <Spinner />
              ) : (
                `${totalComposite} / ${totalQualifying} profiles complete`
              )
            }
            detail={pipelineLoading ? undefined : `${playerCompletePct}%`}
            progress={pipelineLoading ? null : playerCompletePct}
          />
        </div>

        <div id="hub-stat-legends">
          <StatBlock
            label="Legends"
            value={
              legendsLoading ? (
                <Spinner />
              ) : (
                `${stats.legendsComplete} / ${stats.legendsTotal} profiled`
              )
            }
            detail={legendsLoading ? undefined : `${legendCompletePct}%`}
            progress={legendsLoading ? null : legendCompletePct}
          />
        </div>

        <div id="hub-stat-review">
          <StatBlock
            label="Review Queue"
            value={
              reviewLoading || pipelineLoading ? (
                <Spinner />
              ) : (
                `${stats.pendingReview ?? "—"} pending`
              )
            }
            detail={
              !pipelineLoading && pipelineStatus
                ? (() => {
                    const autoAccepted = stats.autoAccepted ?? 0;
                    // Errors = flags that are neither pending nor auto-accepted
                    const errors = Math.max(
                      0,
                      pipelineStatus.total_flags - (pipelineStatus.unresolved_flags ?? 0) - autoAccepted
                    );
                    return `${autoAccepted} auto-accepted · ${errors} errors`;
                  })()
                : undefined
            }
          />
        </div>
      </div>
    </main>
  );
}
