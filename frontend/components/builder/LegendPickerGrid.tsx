"use client";

/**
 * LegendPickerGrid.tsx — Legend selection grid for the /builder page.
 *
 * Accepts PlayerWithSkills[] rows where is_legend=true (from the bulk endpoint).
 * Cards render identically to PlayerCard but call onSelectLegend on click.
 */

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { BuilderLegendCard } from "./BuilderLegendCard";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { formatHeight } from "@/components/players/playerFilters";
import type { PlayerWithSkills } from "@/lib/types";

type ViewMode = "cards" | "table";
type SortKey = "alpha" | "era" | "position";

interface LegendPickerGridProps {
  legends: PlayerWithSkills[];
  onSelectLegend: (legend: PlayerWithSkills) => void;
}

export function LegendPickerGrid({ legends, onSelectLegend }: LegendPickerGridProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [sortKey, setSortKey] = useState<SortKey>("alpha");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? legends.filter((l) => l.name.toLowerCase().includes(q)) : legends;
  }, [legends, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sortKey === "era") {
        // Sort by peak_year ascending
        const ay = a.peak_year ?? 9999;
        const by = b.peak_year ?? 9999;
        return ay - by || a.name.localeCompare(b.name);
      }
      if (sortKey === "position") {
        return (a.position ?? "").localeCompare(b.position ?? "") || a.name.localeCompare(b.name);
      }
      return a.name.localeCompare(b.name);
    });
  }, [filtered, sortKey]);

  return (
    <div id="legend-picker" className="space-y-4">
      {/* Controls row */}
      <div id="legend-picker-controls" className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <input
          id="legend-picker-search"
          type="text"
          placeholder="Search legends…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="text-sm rounded-md border border-input bg-background px-3 py-1.5 w-48 focus:outline-none focus:ring-1 focus:ring-ring"
        />

        {/* Sort */}
        <div className="flex items-center gap-2">
          <label htmlFor="legend-picker-sort" className="text-xs text-muted-foreground font-medium">Sort:</label>
          <select
            id="legend-picker-sort"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="text-xs rounded border border-border bg-background px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="alpha">Alphabetical</option>
            <option value="era">Era</option>
            <option value="position">Position</option>
          </select>
        </div>

        {/* Count */}
        <span id="legend-picker-count" className="text-xs text-muted-foreground ml-auto">
          {sorted.length} legend{sorted.length !== 1 ? "s" : ""}
        </span>

        {/* View mode toggle */}
        <div id="legend-picker-view-toggle" className="flex rounded-md border border-border overflow-hidden text-xs font-medium">
          <button
            id="legend-picker-cards-btn"
            type="button"
            onClick={() => setViewMode("cards")}
            className={cn(
              "px-3 py-1.5 transition-colors",
              viewMode === "cards"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            Cards
          </button>
          <button
            id="legend-picker-table-btn"
            type="button"
            onClick={() => setViewMode("table")}
            className={cn(
              "px-3 py-1.5 border-l border-border transition-colors",
              viewMode === "table"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            Table
          </button>
        </div>
      </div>

      {/* Cards grid */}
      {viewMode === "cards" && (
        <div id="legend-picker-cards" className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {sorted.map((legend) => (
            <BuilderLegendCard key={legend.id} player={legend} onSelect={onSelectLegend} />
          ))}
          {sorted.length === 0 && (
            <p className="col-span-full text-sm text-muted-foreground py-8 text-center">
              No legends match your search.
            </p>
          )}
        </div>
      )}

      {/* Table view */}
      {viewMode === "table" && (
        <div id="legend-picker-table-container" className="rounded-lg border border-border overflow-hidden">
          <table id="legend-picker-table" className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-2 w-10"></th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Era</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Pos</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Team</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Bio</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((legend, i) => (
                <tr
                  key={legend.id}
                  id={`legend-picker-row-${legend.id}`}
                  onClick={() => onSelectLegend(legend)}
                  className={cn(
                    "cursor-pointer hover:bg-amber-50/60 transition-colors",
                    i > 0 && "border-t border-border/60",
                  )}
                >
                  <td className="px-4 py-2">
                    <PlayerHeadshot nba_api_id={legend.nba_api_id} size={32} name={legend.name} />
                  </td>
                  <td className="px-4 py-2 font-medium">
                    <span className="text-amber-500 mr-1">★</span>
                    {legend.peak_year != null ? `${legend.peak_year} ` : ""}
                    {legend.name}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{legend.peak_year ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{legend.position ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{legend.team ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground text-xs">
                    {[
                      legend.age != null ? `Age ${legend.age}` : null,
                      formatHeight(legend.height) || null,
                      legend.weight != null ? `${legend.weight} lbs` : null,
                    ].filter(Boolean).join(" · ")}
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No legends match your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
