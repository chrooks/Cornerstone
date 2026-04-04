"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { listLegends } from "@/lib/api";
import type { LegendSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

// Total skill count — must match backend ALL_SKILLS list
const TOTAL_SKILLS = 20;

// Sort options
type SortKey = "alpha" | "completion" | "era";
// Filter options
type FilterKey = "all" | "complete" | "in_progress" | "not_started";

/** Format a skill count as a human-readable progress label. */
function progressLabel(legend: LegendSummary): string {
  return `${legend.completion}/${TOTAL_SKILLS} skills`;
}

/** Determine completion state for a legend. */
function completionState(legend: LegendSummary): "complete" | "in_progress" | "not_started" {
  if (legend.completion === TOTAL_SKILLS) return "complete";
  if (legend.completion > 0) return "in_progress";
  return "not_started";
}

/** Single legend card shown in the grid. */
function LegendCard({ legend }: { legend: LegendSummary }) {
  const state = completionState(legend);
  const pct = Math.round((legend.completion / TOTAL_SKILLS) * 100);

  return (
    <Link
      href={`/legends/${legend.id}`}
      className={cn(
        "block rounded-lg border bg-card p-4 hover:shadow-md transition-shadow",
        // Left border accent based on completion state
        state === "complete" && "border-l-4 border-l-emerald-500",
        state === "in_progress" && "border-l-4 border-l-amber-400",
        state === "not_started" && "border-l-4 border-l-muted-foreground/30"
      )}
    >
      {/* Legend name + completion indicator */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p
            className={cn(
              "font-semibold text-sm leading-tight truncate",
              state === "not_started" && "text-muted-foreground"
            )}
          >
            {legend.name}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{legend.peak_era}</p>
        </div>

        {/* State badge */}
        {state === "complete" ? (
          <span
            className="flex-shrink-0 text-emerald-600 font-bold text-lg"
            title="Fully profiled"
          >
            ✓
          </span>
        ) : state === "in_progress" ? (
          <span className="flex-shrink-0 text-xs text-amber-600 font-medium whitespace-nowrap">
            {legend.completion}/{TOTAL_SKILLS}
          </span>
        ) : (
          <span className="flex-shrink-0 text-xs text-muted-foreground/60">
            0/{TOTAL_SKILLS}
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="mt-3 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            state === "complete" && "bg-emerald-500",
            state === "in_progress" && "bg-amber-400",
            state === "not_started" && "bg-muted-foreground/20"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p
        className={cn(
          "text-xs mt-1",
          state === "complete" && "text-emerald-600",
          state === "in_progress" && "text-amber-600",
          state === "not_started" && "text-muted-foreground/60"
        )}
      >
        {progressLabel(legend)}
      </p>
    </Link>
  );
}

export default function LegendsPage() {
  const [legends, setLegends] = useState<LegendSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("alpha");
  const [filterKey, setFilterKey] = useState<FilterKey>("all");

  useEffect(() => {
    setLoading(true);
    listLegends()
      .then((res) => {
        if (res.success && res.data) {
          setLegends(res.data);
        } else {
          setError(res.error ?? "Failed to load legends");
        }
      })
      .catch(() => setError("Failed to load legends"))
      .finally(() => setLoading(false));
  }, []);

  // Derived counts for the overall progress bar
  const totalProfiled = legends.filter((l) => l.completion === TOTAL_SKILLS).length;
  const totalLegends  = legends.length;
  const overallPct    = totalLegends > 0 ? Math.round((totalProfiled / totalLegends) * 100) : 0;

  // Apply filter + sort
  const displayLegends = useMemo(() => {
    let filtered = legends;

    if (filterKey === "complete") {
      filtered = legends.filter((l) => l.completion === TOTAL_SKILLS);
    } else if (filterKey === "in_progress") {
      filtered = legends.filter((l) => l.completion > 0 && l.completion < TOTAL_SKILLS);
    } else if (filterKey === "not_started") {
      filtered = legends.filter((l) => l.completion === 0);
    }

    return [...filtered].sort((a, b) => {
      if (sortKey === "completion") {
        // Most complete first
        return b.completion - a.completion || a.name.localeCompare(b.name);
      }
      if (sortKey === "era") {
        return a.peak_era.localeCompare(b.peak_era) || a.name.localeCompare(b.name);
      }
      // Default: alphabetical
      return a.name.localeCompare(b.name);
    });
  }, [legends, sortKey, filterKey]);

  if (loading) {
    return (
      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-48" />
          <div className="h-4 bg-muted rounded w-full" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="h-28 bg-muted rounded-lg" />
            ))}
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="max-w-5xl mx-auto px-4 py-8">
        <p className="text-destructive">{error}</p>
      </main>
    );
  }

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Legends</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manually profile all-time greats using historical knowledge and Claude's assessment.
        </p>
      </div>

      {/* Overall progress bar */}
      <div className="mb-6 p-4 rounded-lg border bg-card">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">
            {totalProfiled} / {totalLegends} legends profiled
          </span>
          <span className="text-sm text-muted-foreground">{overallPct}%</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all"
            style={{ width: `${overallPct}%` }}
          />
        </div>
      </div>

      {/* Sort + filter controls */}
      <div className="flex flex-wrap gap-3 mb-6">
        {/* Sort */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground font-medium">Sort:</label>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="text-xs rounded border border-border bg-background px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="alpha">Alphabetical</option>
            <option value="completion">Completion</option>
            <option value="era">Era</option>
          </select>
        </div>

        {/* Filter */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground font-medium">Filter:</label>
          {(["all", "complete", "in_progress", "not_started"] as FilterKey[]).map((key) => (
            <button
              key={key}
              onClick={() => setFilterKey(key)}
              className={cn(
                "text-xs px-2 py-1 rounded border transition-colors",
                filterKey === key
                  ? "bg-foreground text-background border-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {key === "all" ? "All" : key === "complete" ? "Complete" : key === "in_progress" ? "In Progress" : "Not Started"}
            </button>
          ))}
        </div>
      </div>

      {/* Legend grid */}
      {displayLegends.length === 0 ? (
        <p className="text-muted-foreground text-sm">No legends match this filter.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {displayLegends.map((legend) => (
            <LegendCard key={legend.id} legend={legend} />
          ))}
        </div>
      )}
    </main>
  );
}
