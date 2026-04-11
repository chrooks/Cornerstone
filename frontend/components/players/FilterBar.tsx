"use client";

/**
 * FilterBar.tsx — Filter UI for the /players explorer.
 *
 * Adapted from tectonic-tools/src/components/FilterInput.tsx (same author).
 * Uses @dnd-kit for drag-to-reorder filter pills. Each pill shows:
 *   [×] [NOT] [AND|OR connector] [label: value] ← drag handle
 *
 * Skill filters render two dropdowns (skill name + min tier) that encode
 * their combined value as "skill_name|tier_option".
 */

import { useState } from "react";
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import {
  type PlayerFilterType,
  type ActiveFilter,
  type FilterConnector,
  type FilterEntry,
  type ParenMarker,
  isParenMarker,
  AVAILABLE_FILTERS,
  SKILL_LABELS,
  MAX_ACTIVE_FILTERS,
} from "./playerFilters";
import type { PlayerWithSkills } from "@/lib/types";

// ---------------------------------------------------------------------------
// SortableFilterPill — a single draggable active-filter pill
// ---------------------------------------------------------------------------

function SortableFilterPill({
  entry,
  index,
  onRemove,
  onToggleConnector,
  onToggleNegated,
}: {
  entry: ActiveFilter;
  index: number;
  onRemove: () => void;
  onToggleConnector: () => void;
  onToggleNegated: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: entry.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Format the displayed value: for skill_tier entries decode the "skill|tier" encoding
  let displayValue = entry.value;
  if (entry.filter.inputMethod === "skill_tier") {
    const sep = entry.value.indexOf("|");
    if (sep !== -1) {
      const skillName = entry.value.slice(0, sep);
      const tierOption = entry.value.slice(sep + 1);
      displayValue = `${SKILL_LABELS[skillName] ?? skillName}: ${tierOption}`;
    }
  } else {
    displayValue = `"${entry.value}"`;
  }

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-1">
      {/* Connector badge between pills — not shown before the first pill */}
      {index > 0 && (
        <button
          type="button"
          onClick={onToggleConnector}
          title="Click to toggle AND / OR"
          className={cn(
            "px-2 py-0.5 rounded text-[10px] font-bold border cursor-pointer text-white select-none",
            entry.connector === "AND"
              ? "bg-blue-700 border-blue-500 hover:bg-blue-600"
              : "bg-orange-600 border-orange-400 hover:bg-orange-500",
          )}
        >
          {entry.connector}
        </button>
      )}

      {/* Pill body */}
      <div
        className={cn(
          "flex items-center gap-0.5 pl-1 pr-2 py-1 rounded-full border select-none text-xs font-medium",
          entry.negated
            ? "bg-red-50 border-red-200 text-red-800"
            : "bg-muted border-border text-foreground",
        )}
      >
        {/* Remove button — stopPropagation prevents drag-kit from intercepting click */}
        <span
          className="mr-0.5 px-1.5 py-0.5 rounded-full border border-border bg-background cursor-pointer hover:bg-destructive hover:text-destructive-foreground transition-colors"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onRemove}
          title="Remove filter"
        >
          ×
        </span>

        {/* NOT toggle */}
        <span
          className={cn(
            "mr-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold border cursor-pointer transition-colors",
            entry.negated
              ? "bg-red-600 border-red-400 text-white hover:bg-red-500"
              : "bg-muted border-border text-muted-foreground hover:text-foreground",
          )}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onToggleNegated}
          title="Toggle NOT"
        >
          NOT
        </span>

        {/* Drag handle — only this part initiates drag */}
        <span
          className="cursor-grab active:cursor-grabbing px-1"
          {...attributes}
          {...listeners}
          title="Drag to reorder"
        >
          {entry.filter.label}:{" "}
          <span className="font-normal text-muted-foreground">{displayValue}</span>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SortableParenPill — a draggable parenthesis marker
// ---------------------------------------------------------------------------

function SortableParenPill({
  entry,
  index,
  onRemove,
  onToggleConnector,
}: {
  entry: ParenMarker;
  index: number;
  onRemove: () => void;
  onToggleConnector: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: entry.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-1">
      {/* Show connector only before "(" — ")" connects to nothing */}
      {index > 0 && entry.paren === "(" && (
        <button
          type="button"
          onClick={onToggleConnector}
          title="Click to toggle AND / OR"
          className={cn(
            "px-2 py-0.5 rounded text-[10px] font-bold border cursor-pointer text-white select-none",
            entry.connector === "AND"
              ? "bg-blue-700 border-blue-500 hover:bg-blue-600"
              : "bg-orange-600 border-orange-400 hover:bg-orange-500",
          )}
        >
          {entry.connector}
        </button>
      )}
      <div className="flex items-center gap-0.5 pl-1 pr-2 py-1 rounded-full bg-violet-100 border border-violet-300 text-violet-800 text-xs font-bold select-none">
        <span
          className="mr-0.5 px-1.5 py-0.5 rounded-full border border-violet-300 bg-background cursor-pointer hover:bg-destructive hover:text-destructive-foreground transition-colors"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onRemove}
          title="Remove parenthesis"
        >
          ×
        </span>
        <span
          className="cursor-grab active:cursor-grabbing px-1"
          {...attributes}
          {...listeners}
          title="Drag to reorder"
        >
          {entry.paren}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FilterBar — the main exported component
// ---------------------------------------------------------------------------

interface FilterBarProps {
  /** All loaded players — used to derive dynamic select options (e.g. team names). */
  players: PlayerWithSkills[];
  filters: FilterEntry[];
  nextConnector: FilterConnector;
  onAddFilter: (filter: PlayerFilterType, value: string) => void;
  onRemoveFilter: (index: number) => void;
  onToggleConnector: (index: number) => void;
  onToggleNegated: (index: number) => void;
  onReorderFilters: (oldIndex: number, newIndex: number) => void;
  onSetNextConnector: (c: FilterConnector) => void;
  onClearFilters: () => void;
  onAddParens: () => void;
}

export function FilterBar({
  players,
  filters,
  nextConnector,
  onAddFilter,
  onRemoveFilter,
  onToggleConnector,
  onToggleNegated,
  onReorderFilters,
  onSetNextConnector,
  onClearFilters,
  onAddParens,
}: FilterBarProps) {
  const [currentFilter, setCurrentFilter] = useState<PlayerFilterType>(AVAILABLE_FILTERS[0]);
  // Text/number value for non-skill-tier filters
  const [localValue, setLocalValue] = useState("");
  // Two-part values for skill_tier filters
  const [skillName, setSkillName] = useState<string>("spot_up_shooter");
  const [tierOption, setTierOption] = useState<string>("Elite or higher");

  // Configure dnd-kit pointer sensor — stops propagation so remove/NOT buttons still work
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const atMax = filters.length >= MAX_ACTIVE_FILTERS;

  const handleAdd = () => {
    if (atMax) return;

    if (currentFilter.inputMethod === "skill_tier") {
      // Encode as "skill_name|tier_option"
      const value = `${skillName}|${tierOption}`;
      onAddFilter(currentFilter, value);
    } else {
      if (!localValue.trim()) return;
      onAddFilter(currentFilter, localValue.trim());
      setLocalValue("");
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = filters.findIndex((f) => f.id === active.id);
    const newIndex = filters.findIndex((f) => f.id === over.id);
    if (oldIndex !== -1 && newIndex !== -1) {
      onReorderFilters(oldIndex, newIndex);
    }
  };

  // Resolve inputValues — may be a static array or a function of the player list
  const resolvedInputValues =
    currentFilter.inputMethod === "select"
      ? typeof currentFilter.inputValues === "function"
        ? currentFilter.inputValues(players)
        : currentFilter.inputValues
      : [];

  return (
    <div id="filter-bar" className="w-full rounded-lg border border-border bg-muted/30 p-3 space-y-2">
      {/* ── Top row: filter controls ── */}
      <div id="filter-controls-row" className="flex flex-wrap items-center gap-2">
        {/* Filter type selector */}
        <select
          id="filter-type-select"
          className="text-sm rounded border border-input bg-background px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          value={currentFilter.label}
          onChange={(e) => {
            const selected = AVAILABLE_FILTERS.find((f) => f.label === e.target.value);
            if (selected) {
              setCurrentFilter(selected);
              setLocalValue("");
            }
          }}
        >
          {AVAILABLE_FILTERS.map((f) => (
            <option key={f.label} value={f.label}>
              {f.label}
            </option>
          ))}
        </select>

        {/* Value input — varies by inputMethod */}
        {currentFilter.inputMethod === "skill_tier" ? (
          <>
            {/* Skill name dropdown */}
            <select
              id="filter-skill-name-select"
              className="text-sm rounded border border-input bg-background px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              value={skillName}
              onChange={(e) => setSkillName(e.target.value)}
            >
              {currentFilter.skillNames.map((s) => (
                <option key={s} value={s}>
                  {SKILL_LABELS[s] ?? s}
                </option>
              ))}
            </select>
            {/* Tier minimum dropdown */}
            <select
              id="filter-tier-option-select"
              className="text-sm rounded border border-input bg-background px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              value={tierOption}
              onChange={(e) => setTierOption(e.target.value)}
            >
              {currentFilter.tierOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </>
        ) : currentFilter.inputMethod === "select" ? (
          <select
            id="filter-value-select"
            className="text-sm rounded border border-input bg-background px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
          >
            <option value="">Value…</option>
            {resolvedInputValues.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        ) : (
          <input
            id="filter-value-input"
            type="text"
            className="text-sm rounded border border-input bg-background px-2 py-1.5 text-foreground w-28 focus:outline-none focus:ring-1 focus:ring-ring"
            value={localValue}
            placeholder="Value…"
            onChange={(e) => setLocalValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          />
        )}

        {/* AND/OR toggle — only shown when at least one filter is already active */}
        {filters.length > 0 && (
          <button
            id="filter-connector-toggle"
            type="button"
            onClick={() => onSetNextConnector(nextConnector === "AND" ? "OR" : "AND")}
            title="Toggle AND / OR for the next filter"
            className={cn(
              "px-3 py-1.5 rounded text-xs font-bold border text-white transition-colors",
              nextConnector === "AND"
                ? "bg-blue-700 border-blue-500 hover:bg-blue-600"
                : "bg-orange-600 border-orange-400 hover:bg-orange-500",
            )}
          >
            {nextConnector}
          </button>
        )}

        {/* Add filter button */}
        <button
          id="filter-add-btn"
          type="button"
          onClick={handleAdd}
          disabled={atMax}
          title={atMax ? `Maximum ${MAX_ACTIVE_FILTERS} filters reached` : "Add filter"}
          className="px-3 py-1.5 rounded text-xs font-medium bg-foreground text-background hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          Add Filter
        </button>

        {/* Parenthesis inserter */}
        <button
          id="filter-add-parens-btn"
          type="button"
          onClick={onAddParens}
          disabled={atMax}
          title="Insert a ( ) pair — drag to reposition"
          className="px-3 py-1.5 rounded text-xs font-bold border border-violet-300 bg-violet-100 text-violet-800 hover:bg-violet-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          ( )
        </button>

        {/* Clear all */}
        <button
          id="filter-clear-btn"
          type="button"
          onClick={onClearFilters}
          disabled={filters.length === 0}
          className="px-3 py-1.5 rounded text-xs font-medium border border-input text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Clear All
        </button>

        {/* Filter count indicator */}
        {filters.length > 0 && (
          <span id="filter-count" className="text-[10px] text-muted-foreground">
            {filters.length}/{MAX_ACTIVE_FILTERS} filters
          </span>
        )}
      </div>

      {/* ── Active filter pills row ── */}
      {filters.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={filters.map((f) => f.id)} strategy={horizontalListSortingStrategy}>
            <div id="filter-pills-row" className="flex flex-wrap gap-2 items-center min-h-[2rem]">
              {filters.map((entry, index) =>
                isParenMarker(entry) ? (
                  <SortableParenPill
                    key={entry.id}
                    entry={entry}
                    index={index}
                    onRemove={() => onRemoveFilter(index)}
                    onToggleConnector={() => onToggleConnector(index)}
                  />
                ) : (
                  <SortableFilterPill
                    key={entry.id}
                    entry={entry}
                    index={index}
                    onRemove={() => onRemoveFilter(index)}
                    onToggleConnector={() => onToggleConnector(index)}
                    onToggleNegated={() => onToggleNegated(index)}
                  />
                ),
              )}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
