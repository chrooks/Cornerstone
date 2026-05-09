"use client";

/**
 * SortControls.tsx — Multi-key sort UI for the /players explorer.
 *
 * Supports up to MAX_SORT_KEYS active sort keys (primary, secondary, tertiary).
 * Each key shows the field name, a direction toggle (▲/▼), and a remove button.
 * "Add sort" opens a dropdown of sortable fields.
 */

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ALL_SKILL_NAMES, SKILL_LABELS } from "./playerFilters";

// ---------------------------------------------------------------------------
// Developer-configurable constant
// ---------------------------------------------------------------------------

/** Maximum number of simultaneous sort keys. */
const MAX_SORT_KEYS = 3;

// ---------------------------------------------------------------------------
// Sort key type
// ---------------------------------------------------------------------------

export interface SortKey {
  field: string;
  direction: "asc" | "desc";
}

// ---------------------------------------------------------------------------
// Available sortable fields
// ---------------------------------------------------------------------------

/** Human-readable label for each sortable field. */
const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  team: "Team",
  position: "Position",
  age: "Age",
  height: "Height",
  weight: "Weight",
  salary: "Salary",
  games_played: "Games Played",
  minutes_per_game: "MPG",
  peak_year: "Peak Year",
  capable_plus_count:    "Capable+ Count",
  proficient_plus_count: "Proficient+ Count",
  elite_plus_count:      "Elite+ Count",
  alltime_plus_count:    "All-Time Great+ Count",
  // Skill fields are added dynamically below
  ...Object.fromEntries(ALL_SKILL_NAMES.map((s) => [s, SKILL_LABELS[s] ?? s])),
};

/** Ordered list of all sortable field keys for the dropdown. */
const SORT_FIELD_OPTIONS: string[] = [
  "name",
  "team",
  "position",
  "age",
  "height",
  "weight",
  "salary",
  "games_played",
  "minutes_per_game",
  "peak_year",
  "capable_plus_count",
  "proficient_plus_count",
  "elite_plus_count",
  "alltime_plus_count",
  ...ALL_SKILL_NAMES,
];

// ---------------------------------------------------------------------------
// SortControls component
// ---------------------------------------------------------------------------

interface SortControlsProps {
  sortKeys: SortKey[];
  onSortKeysChange: (keys: SortKey[]) => void;
  /** When provided, sort options are limited to visible (non-hidden) columns. */
  hiddenColumns?: Set<string>;
}

export function SortControls({ sortKeys, onSortKeysChange, hiddenColumns }: SortControlsProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const activeFieldSet = new Set(sortKeys.map((k) => k.field));
  const atMax = sortKeys.length >= MAX_SORT_KEYS;

  // Only offer sort options for visible columns
  const availableFields = hiddenColumns
    ? SORT_FIELD_OPTIONS.filter((f) => !hiddenColumns.has(f))
    : SORT_FIELD_OPTIONS;

  // Add a new sort key
  const addSortKey = (field: string) => {
    if (atMax || activeFieldSet.has(field)) return;
    onSortKeysChange([...sortKeys, { field, direction: "desc" }]);
    setDropdownOpen(false);
  };

  // Remove a sort key by index
  const removeSortKey = (index: number) => {
    onSortKeysChange(sortKeys.filter((_, i) => i !== index));
  };

  // Toggle direction for a sort key
  const toggleDirection = (index: number) => {
    onSortKeysChange(
      sortKeys.map((k, i) =>
        i === index ? { ...k, direction: k.direction === "asc" ? "desc" : "asc" } : k,
      ),
    );
  };

  return (
    <div id="sort-controls" className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">Sort:</span>

      {/* Active sort key chips */}
      {sortKeys.map((key, index) => (
        <div
          key={key.field}
          className="flex items-center gap-1 rounded-sm border border-border bg-muted px-2 py-1 text-xs font-medium"
        >
          {/* Order indicator */}
          {sortKeys.length > 1 && (
            <span className="text-[10px] text-muted-foreground mr-0.5">
              {index + 1}.
            </span>
          )}
          {/* Field label */}
          <span>{FIELD_LABELS[key.field] ?? key.field}</span>
          {/* Direction toggle */}
          <button
            type="button"
            onClick={() => toggleDirection(index)}
            title="Toggle sort direction"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {key.direction === "asc" ? "▲" : "▼"}
          </button>
          {/* Remove button */}
          <button
            type="button"
            onClick={() => removeSortKey(index)}
            title="Remove sort key"
            className="text-muted-foreground hover:text-destructive transition-colors"
          >
            ×
          </button>
        </div>
      ))}

      {/* Add sort dropdown — hidden when at max */}
      {!atMax && (
        <div ref={dropdownRef} className="relative">
          <button
            id="sort-add-btn"
            type="button"
            onClick={() => setDropdownOpen((v) => !v)}
            className="flex items-center gap-1 text-xs rounded border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground px-2 py-1 transition-colors"
          >
            + Add sort
          </button>

          {dropdownOpen && (
            <div id="sort-dropdown" className="absolute top-full left-0 mt-1 z-50 w-52 max-h-60 overflow-y-auto rounded-md border border-border bg-background shadow-md">
              {availableFields.filter((f) => !activeFieldSet.has(f)).map((field) => (
                <button
                  key={field}
                  type="button"
                  onClick={() => addSortKey(field)}
                  className={cn(
                    "w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors",
                    // Group divider between meta fields and skill fields
                    field === ALL_SKILL_NAMES[0] ? "border-t border-border mt-1 pt-2" : "",
                  )}
                >
                  {FIELD_LABELS[field] ?? field}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Clear sorts */}
      {sortKeys.length > 0 && (
        <button
          id="sort-clear-btn"
          type="button"
          onClick={() => onSortKeysChange([])}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Clear sorts
        </button>
      )}
    </div>
  );
}
