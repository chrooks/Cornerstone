"use client";

/**
 * DiffDrilldownTable — filterable, sortable, capped table of individual changes.
 *
 * Filters: skill select, change-type segmented, player_id contains-match.
 * Cap: VISIBLE_CAP rows; "Show 250 more" bumps by VISIBLE_CAP.
 * No virtualization library — filter + cap instead.
 */

import { useState, useMemo, useEffect } from "react";
import { cn } from "@/lib/utils";
import { SKILL_LABELS } from "@/lib/skills";
import { DIFF_CHANGE_LABEL, DIFF_CHANGE_TEXT_CLASSES } from "./diffColors";
import { applyDrilldownFilters, VISIBLE_CAP } from "./diffLogic";
import { DiffTierDelta } from "./DiffTierDelta";
import type { RunDiffChange, RunDiffSummary, DiffChangeType } from "@/lib/types";

type SortKey = "skill_name" | "change_type" | "season";

interface DiffDrilldownTableProps {
  changes: RunDiffChange[];
  summary: RunDiffSummary;
  /** Pre-selected skill from clicking a summary row. */
  preselectedSkill?: string | null;
}

const CHANGE_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All" },
  { value: "promotion", label: "Promotions" },
  { value: "demotion", label: "Demotions" },
  { value: "new", label: "New" },
];

export function DiffDrilldownTable({
  changes,
  summary,
  preselectedSkill,
}: DiffDrilldownTableProps) {
  const [skillFilter, setSkillFilter] = useState<string>(preselectedSkill ?? "");
  const [changeTypeFilter, setChangeTypeFilter] = useState<string>("");
  const [playerQuery, setPlayerQuery] = useState<string>("");
  const [visibleCount, setVisibleCount] = useState<number>(VISIBLE_CAP);
  const [sortKey, setSortKey] = useState<SortKey>("skill_name");
  const [sortAsc, setSortAsc] = useState(true);

  // Seed the local skill filter when the parent jumps to a skill (summary row
  // click). After seeding, skillFilter is the single source of truth so the
  // select stays a live control.
  useEffect(() => {
    if (preselectedSkill != null) {
      setSkillFilter(preselectedSkill);
      setVisibleCount(VISIBLE_CAP);
    }
  }, [preselectedSkill]);

  const filteredAndSorted = useMemo(() => {
    const filtered = applyDrilldownFilters(changes, {
      skill: skillFilter || undefined,
      changeType: changeTypeFilter || undefined,
      playerQuery: playerQuery,
    });

    return [...filtered].sort((a, b) => {
      let valA: string = "";
      let valB: string = "";
      if (sortKey === "skill_name") {
        valA = SKILL_LABELS[a.skill_name] ?? a.skill_name;
        valB = SKILL_LABELS[b.skill_name] ?? b.skill_name;
      } else if (sortKey === "change_type") {
        valA = a.change_type;
        valB = b.change_type;
      } else if (sortKey === "season") {
        valA = a.season;
        valB = b.season;
      }
      const cmp = valA.localeCompare(valB);
      return sortAsc ? cmp : -cmp;
    });
  }, [changes, skillFilter, changeTypeFilter, playerQuery, sortKey, sortAsc]);

  const visibleRows = filteredAndSorted.slice(0, visibleCount);
  const hasMore = filteredAndSorted.length > visibleCount;

  // Available skill options from summary
  const skillOptions = useMemo(() => {
    return Object.keys(summary.per_skill).sort((a, b) =>
      (SKILL_LABELS[a] ?? a).localeCompare(SKILL_LABELS[b] ?? b)
    );
  }, [summary.per_skill]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  function SortIndicator({ col }: { col: SortKey }) {
    if (sortKey !== col) return <span className="text-neutral-300 ml-1">&#8597;</span>;
    return <span className="ml-1">{sortAsc ? "↑" : "↓"}</span>;
  }

  return (
    <div id="diff-drilldown-table">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-neutral-400 uppercase tracking-wide">Skill</label>
          <select
            id="diff-filter-skill"
            value={skillFilter}
            onChange={(e) => {
              setSkillFilter(e.target.value);
              setVisibleCount(VISIBLE_CAP);
            }}
            className="text-xs rounded border border-[#d9d0c9] px-2 py-1 bg-white"
          >
            <option value="">All skills</option>
            {skillOptions.map((sk) => (
              <option key={sk} value={sk}>
                {SKILL_LABELS[sk] ?? sk}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-neutral-400 uppercase tracking-wide">Change type</label>
          <div
            id="diff-filter-change-type"
            className="inline-flex rounded border border-[#d9d0c9] overflow-hidden"
          >
            {CHANGE_TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={changeTypeFilter === opt.value}
                onClick={() => {
                  setChangeTypeFilter(opt.value);
                  setVisibleCount(VISIBLE_CAP);
                }}
                className={cn(
                  "px-2.5 py-1 text-[11px] font-medium transition-colors",
                  changeTypeFilter === opt.value
                    ? "bg-[#0e0907] text-white"
                    : "bg-white text-neutral-600 hover:bg-neutral-50"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-neutral-400 uppercase tracking-wide">Player</label>
          <input
            id="diff-filter-player"
            type="text"
            value={playerQuery}
            onChange={(e) => {
              setPlayerQuery(e.target.value);
              setVisibleCount(VISIBLE_CAP);
            }}
            placeholder="name contains…"
            className="text-xs rounded border border-[#d9d0c9] px-2 py-1 w-44"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-auto max-h-[500px] rounded-[6px] border border-[#d9d0c9]">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-[#fef9f5] border-b border-[#d9d0c9] z-10">
            <tr>
              <th
                scope="col"
                className="text-left px-3 py-2 font-semibold text-neutral-600"
              >
                Player
              </th>
              <th
                scope="col"
                className="text-left px-3 py-2 font-semibold text-neutral-600 cursor-pointer hover:text-[#0e0907]"
                onClick={() => toggleSort("season")}
              >
                Season
                <SortIndicator col="season" />
              </th>
              <th
                scope="col"
                className="text-left px-3 py-2 font-semibold text-neutral-600"
              >
                Source
              </th>
              <th
                scope="col"
                className="text-left px-3 py-2 font-semibold text-neutral-600 cursor-pointer hover:text-[#0e0907]"
                onClick={() => toggleSort("skill_name")}
              >
                Skill
                <SortIndicator col="skill_name" />
              </th>
              <th scope="col" className="text-left px-3 py-2 font-semibold text-neutral-600">
                Tier Change
              </th>
              <th
                scope="col"
                className="text-left px-3 py-2 font-semibold text-neutral-600 cursor-pointer hover:text-[#0e0907]"
                onClick={() => toggleSort("change_type")}
              >
                Change
                <SortIndicator col="change_type" />
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-8 text-center text-sm text-neutral-400"
                >
                  No changes match the current filters.
                </td>
              </tr>
            )}
            {visibleRows.map((row, idx) => (
              <tr
                key={`${row.player_id}-${row.skill_name}-${row.season}-${row.source}`}
                id={`diff-row-${row.player_id}-${row.skill_name}`}
                className={cn(
                  "border-b border-[#d9d0c9] last:border-b-0",
                  idx % 2 === 1 && "bg-[#fef9f5]"
                )}
              >
                <td className="px-3 py-2 text-neutral-700 max-w-[200px] truncate">
                  {row.player_name ?? (
                    <span className="font-mono text-[11px] text-neutral-400">{row.player_id}</span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-neutral-600">
                  {row.season}
                </td>
                <td className="px-3 py-2 text-neutral-500">{row.source}</td>
                <td className="px-3 py-2 text-neutral-700">
                  {SKILL_LABELS[row.skill_name] ?? row.skill_name}
                </td>
                <td className="px-3 py-2">
                  <DiffTierDelta oldTier={row.old_tier} newTier={row.new_tier} />
                </td>
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 font-medium",
                      DIFF_CHANGE_TEXT_CLASSES[row.change_type as DiffChangeType]
                    )}
                  >
                    <span aria-hidden="true">{DIFF_CHANGE_LABEL[row.change_type as DiffChangeType]?.glyph}</span>
                    {DIFF_CHANGE_LABEL[row.change_type as DiffChangeType]?.label}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Show more footer */}
      {hasMore && (
        <div className="mt-2 px-3 py-2 text-xs text-neutral-500">
          Showing {visibleCount} of {filteredAndSorted.length} matching changes. Narrow with a filter, or{" "}
          <button
            id="diff-show-more-btn"
            type="button"
            onClick={() => setVisibleCount((n) => n + VISIBLE_CAP)}
            className="text-[#0e0907] underline hover:text-[#fe6d34]"
          >
            Show {VISIBLE_CAP} more
          </button>
        </div>
      )}
    </div>
  );
}
