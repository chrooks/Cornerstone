"use client";

/**
 * BuilderPage.tsx — Top-level orchestrator for the /builder route.
 *
 * Two modes driven by URL params:
 *   - Picker mode  (no ?cornerstone= param): shows LegendPickerGrid
 *   - Builder mode (?cornerstone=<id>):       shows split-panel layout
 *
 * Data strategy: single fetch of GET /api/players/bulk?include_legends=true.
 * Split on is_legend: legend rows → picker, active rows → player picker panel.
 * Since PlayerWithSkills.id for legend rows IS the legend UUID, the same ID
 * is used for the cornerstone URL param and for GET /api/legends/<id>.
 *
 * Roster URL encoding (new format):
 *   ?cornerstone=<legend_uuid>    — identifies the cornerstone legend
 *   ?s1=<player_id>               — slot 1 occupant
 *   ...
 *   ?s8=<player_id>               — slot 8 occupant
 *
 * Legacy format (s2..s8 only, cornerstone implicitly in slot 1) is still
 * read correctly for backward-compatible saved URLs.
 *
 * All 8 slots are stored in a flat allSlots[8] array. The cornerstone legend
 * is identified by cornerstoneId and can occupy any position in the lineup.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { listPlayersWithSkills, getLegend } from "@/lib/api";
import { SALARY_CAP, LEGEND_SALARY, MAX_ROSTER_SLOTS } from "@/lib/builder-config";
import { LegendPickerGrid } from "./LegendPickerGrid";
import { SalaryGauge } from "./SalaryGauge";
import { RotationSlots } from "./RotationSlots";
import { SkillGrid } from "./SkillGrid";
import { AssistantGmNotes } from "./AssistantGmNotes";
import { PlayerPickerPanel } from "./PlayerPickerPanel";
import type { LegendDetail, PlayerWithSkills } from "@/lib/types";

// ---------------------------------------------------------------------------
// URL param helpers
// ---------------------------------------------------------------------------

/**
 * Reads all 8 slot positions from URL params.
 * Supports two formats:
 *   New:    s1..s8 encode all slot positions (cornerstone at its actual slot)
 *   Legacy: cornerstone always in slot 1, s2..s8 for the player slots
 */
function readAllSlotsFromParams(
  params: URLSearchParams,
  cornerstoneId: string | null,
  allPlayerMap: Map<string, PlayerWithSkills>,
): (PlayerWithSkills | null)[] {
  const slots: (PlayerWithSkills | null)[] = Array(MAX_ROSTER_SLOTS).fill(null);

  if (params.has("s1")) {
    // New format: all 8 slots explicitly encoded as s1..s8
    for (let i = 1; i <= MAX_ROSTER_SLOTS; i++) {
      const id = params.get(`s${i}`);
      if (id) slots[i - 1] = allPlayerMap.get(id) ?? null;
    }
  } else {
    // Legacy format: cornerstone implicit in slot 1, players in s2..s8
    if (cornerstoneId) slots[0] = allPlayerMap.get(cornerstoneId) ?? null;
    for (let i = 2; i <= MAX_ROSTER_SLOTS; i++) {
      const id = params.get(`s${i}`);
      if (id) slots[i - 1] = allPlayerMap.get(id) ?? null;
    }
  }

  return slots;
}

/** Serializes the full 8-slot lineup to URL params (new s1..s8 format). */
function buildAllSlotsParams(
  cornerstoneId: string | null,
  allSlots: (PlayerWithSkills | null)[],
): URLSearchParams {
  const params = new URLSearchParams();
  if (cornerstoneId) params.set("cornerstone", cornerstoneId);
  allSlots.forEach((p, i) => {
    if (p) params.set(`s${i + 1}`, p.id);
  });
  return params;
}

// ---------------------------------------------------------------------------
// BuilderPage
// ---------------------------------------------------------------------------

/** Copies the current page URL to the clipboard. Shows "Copied!" briefly. */
function SaveButton({ disabled }: { disabled?: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleSave = useCallback(async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  return (
    <button
      id="builder-save-btn"
      type="button"
      onClick={handleSave}
      disabled={disabled}
      title={disabled ? "Fill all 8 slots to save" : undefined}
      className="text-sm font-medium rounded-md border border-border px-3 py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-muted"
    >
      {copied ? "✓ Copied!" : "Save"}
    </button>
  );
}

export function BuilderPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // ── All players + legends (single fetch) ─────────────────────────────────
  const [legendRows, setLegendRows] = useState<PlayerWithSkills[]>([]);
  const [activeRows, setActiveRows] = useState<PlayerWithSkills[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  /** Full legend profile (skills) for the selected cornerstone. */
  const [legendDetail, setLegendDetail] = useState<LegendDetail | null>(null);

  useEffect(() => {
    setDataLoading(true);
    listPlayersWithSkills()
      .then((res) => {
        if (res.success && res.data) {
          // listPlayersWithSkills includes legends via include_legends=true (set in api.ts)
          setLegendRows(res.data.filter((p) => p.is_legend === true));
          setActiveRows(res.data.filter((p) => !p.is_legend));
        } else {
          setDataError(res.error ?? "Failed to load data");
        }
      })
      .catch(() => setDataError("Failed to load data"))
      .finally(() => setDataLoading(false));
  }, []);

  // ── Cornerstone — derived from URL + legend rows (used for mode-switching) ─
  const cornerstoneId = searchParams.get("cornerstone");
  const cornerstone = useMemo(
    () => legendRows.find((l) => l.id === cornerstoneId) ?? null,
    [legendRows, cornerstoneId],
  );

  // ── Flat 8-slot lineup — each element is a player, legend, or null ────────
  const [allSlots, setAllSlots] = useState<(PlayerWithSkills | null)[]>(
    Array(MAX_ROSTER_SLOTS).fill(null),
  );

  // Hydrate slot state from URL once player/legend data loads.
  // Requires legendRows to be loaded so the cornerstone can be placed.
  useEffect(() => {
    if (legendRows.length === 0) return;
    const allPlayerMap = new Map<string, PlayerWithSkills>([
      ...legendRows.map((p): [string, PlayerWithSkills] => [p.id, p]),
      ...activeRows.map((p): [string, PlayerWithSkills] => [p.id, p]),
    ]);
    const params = new URLSearchParams(searchParams.toString());
    setAllSlots(readAllSlotsFromParams(params, cornerstoneId, allPlayerMap));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legendRows, activeRows]);

  // ── Fetch full legend profile when cornerstone changes ────────────────────
  useEffect(() => {
    if (!cornerstoneId) {
      setLegendDetail(null);
      return;
    }
    getLegend(cornerstoneId)
      .then((res) => {
        if (res.success && res.data) setLegendDetail(res.data);
      })
      .catch(() => {/* grid shows — for missing profile */});
  }, [cornerstoneId]);

  // ── Currently selected slot (1-based). null = no active selection. ────────
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);

  // ── URL sync ──────────────────────────────────────────────────────────────
  const syncUrl = useCallback(
    (newCornerstoneId: string | null, newSlots: (PlayerWithSkills | null)[]) => {
      const params = buildAllSlotsParams(newCornerstoneId, newSlots);
      const qs = params.toString();
      router.replace(`/builder${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router],
  );

  // ── Legend selection ──────────────────────────────────────────────────────
  const handleSelectLegend = useCallback(
    (legend: PlayerWithSkills) => {
      // Place legend in slot 1, clear all other slots
      const newSlots = Array<PlayerWithSkills | null>(MAX_ROSTER_SLOTS).fill(null);
      newSlots[0] = legend;
      setAllSlots(newSlots);
      setSelectedSlot(null);
      syncUrl(legend.id, newSlots);
    },
    [syncUrl],
  );

  // ── Slot interactions ─────────────────────────────────────────────────────

  /**
   * Fill a slot with a player from the picker panel.
   * Refuses to overwrite the cornerstone legend slot — the legend must be
   * repositioned by swapping, not replaced from the picker.
   */
  const fillSlot = useCallback(
    (slotIndex: number, player: PlayerWithSkills) => {
      if (allSlots[slotIndex - 1]?.id === cornerstoneId) return;
      const newSlots = allSlots.map((p, i) => (i === slotIndex - 1 ? player : p));
      setAllSlots(newSlots);
      setSelectedSlot(null);
      syncUrl(cornerstoneId, newSlots);
    },
    [allSlots, cornerstoneId, syncUrl],
  );

  const handleSlotClick = useCallback(
    (slotIndex: number) => {
      // Clicking the already-selected slot deselects it
      if (selectedSlot === slotIndex) {
        setSelectedSlot(null);
        return;
      }

      // If a slot is already selected and we click a different filled slot → swap.
      // The legend can be swapped just like any other filled slot.
      if (
        selectedSlot !== null &&
        allSlots[selectedSlot - 1] !== null &&
        allSlots[slotIndex - 1] !== null
      ) {
        const newSlots = [...allSlots];
        [newSlots[selectedSlot - 1], newSlots[slotIndex - 1]] = [
          newSlots[slotIndex - 1],
          newSlots[selectedSlot - 1],
        ];
        setAllSlots(newSlots);
        setSelectedSlot(null);
        syncUrl(cornerstoneId, newSlots);
        return;
      }

      setSelectedSlot(slotIndex);
    },
    [selectedSlot, allSlots, cornerstoneId, syncUrl],
  );

  const handleRemoveSlot = useCallback(
    (slotIndex: number) => {
      const occupant = allSlots[slotIndex - 1];
      if (occupant?.id === cornerstoneId) {
        // Removing the legend → return to picker mode
        const cleared = Array<PlayerWithSkills | null>(MAX_ROSTER_SLOTS).fill(null);
        setAllSlots(cleared);
        setSelectedSlot(null);
        syncUrl(null, cleared);
      } else {
        const newSlots = allSlots.map((p, i) => (i === slotIndex - 1 ? null : p));
        setAllSlots(newSlots);
        setSelectedSlot(null);
        syncUrl(cornerstoneId, newSlots);
      }
    },
    [allSlots, cornerstoneId, syncUrl],
  );

  const handlePlayerClick = useCallback(
    (player: PlayerWithSkills) => {
      // Use the selected slot if it isn't occupied by the legend; otherwise find the first empty slot
      if (selectedSlot != null && allSlots[selectedSlot - 1]?.id !== cornerstoneId) {
        fillSlot(selectedSlot, player);
        return;
      }
      const firstFreeIdx = allSlots.findIndex((p) => p === null);
      if (firstFreeIdx !== -1) {
        fillSlot(firstFreeIdx + 1, player); // +1 converts 0-based index to 1-based slot
      }
    },
    [selectedSlot, allSlots, cornerstoneId, fillSlot],
  );

  const handleDropPlayer = useCallback(
    (slotIndex: number, player: PlayerWithSkills) => {
      // Can't drop a picker player onto the legend slot — use swap to reorder the legend
      if (allSlots[slotIndex - 1]?.id === cornerstoneId) return;
      fillSlot(slotIndex, player);
    },
    [allSlots, cornerstoneId, fillSlot],
  );

  /** Swaps two slots. No restrictions — legend can be swapped with any slot. */
  const handleSwapSlots = useCallback(
    (fromSlot: number, toSlot: number) => {
      const newSlots = [...allSlots];
      [newSlots[fromSlot - 1], newSlots[toSlot - 1]] = [
        newSlots[toSlot - 1],
        newSlots[fromSlot - 1],
      ];
      setAllSlots(newSlots);
      setSelectedSlot(null);
      syncUrl(cornerstoneId, newSlots);
    },
    [allSlots, cornerstoneId, syncUrl],
  );

  // ── Derived salary ────────────────────────────────────────────────────────
  const usedSalary = useMemo(() => {
    return allSlots.reduce((sum, p) => {
      if (!p) return sum;
      // The cornerstone legend has a fixed cap cost regardless of their market salary
      if (p.id === cornerstoneId) return sum + LEGEND_SALARY;
      return sum + (p.salary ?? 0);
    }, 0);
  }, [allSlots, cornerstoneId]);

  const rosterPlayerIds = useMemo(
    () => new Set(allSlots.filter(Boolean).map((p) => p!.id)),
    [allSlots],
  );

  // ── Salary cap filter for player picker ──────────────────────────────────
  const [salaryCapFilter, setSalaryCapFilter] = useState<number | null>(null);

  // ── Hovered rotation slot — used to highlight that player's bar slice ────
  const [hoveredSlotIndex, setHoveredSlotIndex] = useState<number | null>(null);

  // ── Hovered picker player — used to show cap impact preview in gauge ──────
  const [pickerHoveredSalary, setPickerHoveredSalary] = useState<number | null>(null);

  /**
   * Compute the highlight range for the hovered slot as fractions of the salary cap.
   * Salaries are ordered by actual slot position (the legend uses LEGEND_SALARY
   * wherever it sits in the lineup).
   */
  const highlightRange = useMemo((): { startFrac: number; endFrac: number } | null => {
    if (hoveredSlotIndex === null) return null;

    const orderedSalaries = allSlots.map((p) => {
      if (!p) return 0;
      if (p.id === cornerstoneId) return LEGEND_SALARY;
      return p.salary ?? 0;
    });

    const idx = hoveredSlotIndex - 1; // 1-based slot → 0-based index
    const slotSalary = orderedSalaries[idx] ?? 0;
    if (slotSalary === 0) return null;

    const startDollars = orderedSalaries.slice(0, idx).reduce((a, b) => a + b, 0);
    const endDollars = startDollars + slotSalary;

    return { startFrac: startDollars / SALARY_CAP, endFrac: endDollars / SALARY_CAP };
  }, [hoveredSlotIndex, allSlots, cornerstoneId]);


  // ── Mobile player picker toggle ────────────────────────────────────────────
  const [pickerOpen, setPickerOpen] = useState(false);

  // ── Left panel tab ────────────────────────────────────────────────────────
  const [leftTab, setLeftTab] = useState<"skills" | "notes">("skills");

  // ── Loading / error ───────────────────────────────────────────────────────
  if (dataLoading) {
    return (
      <div id="builder-loading" className="max-w-screen-2xl mx-auto px-4 py-8 space-y-4 animate-pulse">
        <div className="h-8 w-48 bg-muted rounded" />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-40 bg-muted rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (dataError) {
    return (
      <div id="builder-error" className="max-w-screen-2xl mx-auto px-4 py-8">
        <p className="text-destructive text-sm">{dataError}</p>
      </div>
    );
  }

  // ── Picker mode ───────────────────────────────────────────────────────────
  if (!cornerstoneId || !cornerstone) {
    return (
      <main id="builder-picker-page" className="max-w-screen-2xl mx-auto px-4 py-6 space-y-4">
        <div id="builder-picker-header">
          <h1 id="builder-picker-title" className="text-xl font-bold text-foreground">
            Pick Your Cornerstone
          </h1>
          <p id="builder-picker-subtitle" className="text-sm text-muted-foreground mt-1">
            Select an all-time great to anchor your 8-man rotation.
          </p>
        </div>
        <LegendPickerGrid legends={legendRows} onSelectLegend={handleSelectLegend} />
      </main>
    );
  }

  // ── Builder mode ──────────────────────────────────────────────────────────

  return (
    <main id="builder-page" className="max-w-screen-2xl mx-auto px-4 py-4 h-[calc(100vh-3rem)] flex flex-col">
      {/* Header — back btn left, title absolutely centered, mobile toggle right */}
      <div id="builder-header" className="relative flex items-center mb-3 flex-shrink-0">
        <button
          id="builder-back-btn"
          type="button"
          onClick={() => {
            const cleared = Array<PlayerWithSkills | null>(MAX_ROSTER_SLOTS).fill(null);
            setAllSlots(cleared);
            setSelectedSlot(null);
            syncUrl(null, cleared);
          }}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          ← Change legend
        </button>
        <h1 id="builder-title" className="absolute left-1/2 -translate-x-1/2 text-lg font-bold text-foreground whitespace-nowrap pointer-events-none">
          <span className="text-amber-500 mr-1">★</span>
          {cornerstone.peak_year != null && (
            <span className="mr-1">{cornerstone.peak_year}</span>
          )}
          {cornerstone.name} Rotation
        </h1>
        {/* Right side of header: Save button + mobile picker toggle */}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <SaveButton disabled={allSlots.some((p) => p === null)} />
          <button
            id="builder-picker-toggle-btn"
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="lg:hidden text-sm font-medium rounded-md border border-border px-3 py-1.5 hover:bg-muted transition-colors"
          >
            {pickerOpen ? "✕ Close" : "+ Players"}
          </button>
        </div>
      </div>

      {/* 60/40 split */}
      <div id="builder-split" className="flex-1 flex flex-col lg:flex-row gap-4 min-h-0">

        {/* ── Left panel: builder ──────────────────────────────────────────── */}
        <div id="builder-left-panel" className="flex flex-col gap-3 lg:w-[60%] min-w-0 overflow-hidden">

          {/* Salary gauge */}
          <div className="flex-shrink-0">
            <SalaryGauge
              usedSalary={usedSalary}
              cap={SALARY_CAP}
              highlightRange={highlightRange}
              previewSalary={pickerHoveredSalary}
              onRemainingClick={(max) => setSalaryCapFilter(max)}
            />
          </div>

          {/* Rotation slots */}
          <div className="flex-shrink-0">
            <RotationSlots
              allSlots={allSlots}
              cornerstoneId={cornerstoneId}
              selectedSlot={selectedSlot}
              onSlotClick={handleSlotClick}
              onRemoveSlot={handleRemoveSlot}
              onDropPlayer={handleDropPlayer}
              onSwapSlots={handleSwapSlots}
              onSlotHover={(slotIndex) => setHoveredSlotIndex(slotIndex)}
              onSlotHoverEnd={() => setHoveredSlotIndex(null)}
            />
          </div>

          {/* Skill grid / GM Notes — tabbed to share space */}
          <div id="builder-grid-area" className="flex flex-col min-h-0 flex-1 overflow-hidden border border-border rounded-lg">
            {/* Tab bar */}
            <div id="builder-left-tabs" className="flex border-b border-border flex-shrink-0">
              <button
                id="builder-tab-skills"
                type="button"
                onClick={() => setLeftTab("skills")}
                className={cn(
                  "px-4 py-2 text-xs font-medium transition-colors",
                  leftTab === "skills"
                    ? "border-b-2 border-foreground text-foreground -mb-px"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Skills
              </button>
              <button
                id="builder-tab-notes"
                type="button"
                onClick={() => setLeftTab("notes")}
                className={cn(
                  "px-4 py-2 text-xs font-medium transition-colors",
                  leftTab === "notes"
                    ? "border-b-2 border-foreground text-foreground -mb-px"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                GM Notes
              </button>
            </div>

            {/* Tab panels */}
            {leftTab === "skills" && (
              <div id="builder-skill-grid-wrapper" className="flex-1 min-h-0 overflow-hidden">
                <SkillGrid
                  allSlots={allSlots}
                  cornerstoneId={cornerstoneId}
                  legendProfile={legendDetail?.profile ?? null}
                  hideEmptyColumns
                />
              </div>
            )}
            {leftTab === "notes" && (
              <div id="builder-gm-notes-wrapper" className="flex-1 min-h-0 overflow-y-auto p-3">
                <AssistantGmNotes />
              </div>
            )}
          </div>
        </div>

        {/* ── Right panel: player picker ───────────────────────────────────── */}
        <div
          id="builder-right-panel"
          className={cn(
            "flex-col lg:w-[50%] min-w-0 border border-border rounded-lg p-3 overflow-hidden",
            "lg:flex",
            pickerOpen ? "flex" : "hidden",
          )}
        >
          <PlayerPickerPanel
            players={activeRows}
            loading={false}
            error={null}
            remainingSalary={SALARY_CAP - usedSalary}
            salaryFilterTrigger={salaryCapFilter}
            onSalaryFilterInjected={() => setSalaryCapFilter(null)}
            rosterPlayerIds={rosterPlayerIds}
            selectedSlot={selectedSlot}
            onPlayerClick={handlePlayerClick}
            onPlayerHover={(salary) => setPickerHoveredSalary(salary)}
            onPlayerHoverEnd={() => setPickerHoveredSalary(null)}
          />
        </div>
      </div>
    </main>
  );
}
