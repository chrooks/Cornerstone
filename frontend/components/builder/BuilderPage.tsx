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

import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { listPlayersWithSkills, getLegend } from "@/lib/api";
import { SALARY_CAP, LEGEND_SALARY, MAX_ROSTER_SLOTS } from "@/lib/builder-config";
import { useAdminStatus } from "@/lib/hooks/useAdminStatus";
import { LegendPickerGrid } from "./LegendPickerGrid";
import { SalaryGauge } from "./SalaryGauge";
import { CourtLineup } from "./CourtLineup";
import { SkillGrid } from "./SkillGrid";
import { AssistantGmNotes } from "./AssistantGmNotes";
import { ScoringBreakdown } from "./ScoringBreakdown";
import { HeightCoverageChart } from "./HeightCoverageChart";
import { CohesionDebugPanel } from "./CohesionDebugPanel";
import { PlayerPickerPanel } from "./PlayerPickerPanel";
import type { SuggestionFilter } from "@/lib/noteFilters";
import type { CohesionRosterEvaluation, LegendDetail, PlayerWithSkills, RosterEvaluation } from "@/lib/types";
import { isCohesionEvaluation } from "@/lib/cohesionHelpers";

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

/** Navigates to the final evaluation page for the current roster. */
function EvaluateButton({ disabled, href }: { disabled?: boolean; href: string }) {
  const router = useRouter();
  return (
    <button
      id="builder-save-btn"
      type="button"
      onClick={() => router.push(href)}
      disabled={disabled}
      title={disabled ? "Fill all 8 slots to evaluate" : undefined}
      className="text-sm font-medium rounded-md border border-border px-3 py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-muted"
    >
      Evaluate Roster
    </button>
  );
}

export function BuilderPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isAdmin } = useAdminStatus();

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
      // Cornerstone slot is not clickable — its position is fixed
      if (allSlots[slotIndex - 1]?.id === cornerstoneId) return;

      // Clicking the already-selected slot deselects it
      if (selectedSlot === slotIndex) {
        setSelectedSlot(null);
        return;
      }

      // With a slot already selected, click-on-another-slot performs a swap:
      //   filled ↔ filled → swap the two players' positions
      //   filled ↔ empty  → move the player into the empty slot (source becomes empty)
      // Cornerstone endpoints are already blocked above, so the cornerstone can
      // never end up empty via this path.
      if (
        selectedSlot !== null &&
        // Require at least one non-empty endpoint — empty↔empty is a no-op
        (allSlots[selectedSlot - 1] !== null || allSlots[slotIndex - 1] !== null)
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

  /** Swaps two slots. Cornerstone position is locked — swap is blocked if either slot holds the cornerstone. */
  const handleSwapSlots = useCallback(
    (fromSlot: number, toSlot: number) => {
      // Block drag-drop swaps involving the cornerstone slot
      if (
        allSlots[fromSlot - 1]?.id === cornerstoneId ||
        allSlots[toSlot - 1]?.id === cornerstoneId
      ) return;
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
  // ── Hovered court-lineup player — cross-highlights the same player in the picker list ──
  const [hoveredCourtPlayerId, setHoveredCourtPlayerId] = useState<string | null>(null);

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
  const [isWideBuilderLayout, setIsWideBuilderLayout] = useState(false);

  // ── Suggestion-driven skill filter for player picker ────────────────────
  // When a GM Notes suggestion is clicked, we push a {skill, tier} filter into
  // the player picker via a trigger pattern (parallel to salaryCapFilter) and
  // briefly flash the right panel so the user can see where the action landed.
  const [suggestionFilterTrigger, setSuggestionFilterTrigger] = useState<SuggestionFilter | null>(null);
  const [pickerFlashKey, setPickerFlashKey] = useState(0);
  const [pickerFlashing, setPickerFlashing] = useState(false);

  // Activate a brief orange ring on the picker whenever pickerFlashKey changes
  useEffect(() => {
    if (pickerFlashKey === 0) return;
    setPickerFlashing(true);
    const t = setTimeout(() => setPickerFlashing(false), 900);
    return () => clearTimeout(t);
  }, [pickerFlashKey]);

  // Handler passed to AssistantGmNotes → NotesList → SwsColumn. Pushes the
  // suggestion filter into the picker and triggers the visual flash.
  const handleSuggestionFilter = useCallback(
    (filter: SuggestionFilter) => {
      setSuggestionFilterTrigger(filter);
      setPickerFlashKey((k) => k + 1);
      // Ensure the picker is visible on mobile where it may be hidden behind a toggle
      setPickerOpen(true);
    },
    [],
  );

  // ── Resizable right panel ────────────────────────────────────────────────
  // Width stored as fraction of the split container (0.0–1.0). Default ~27% (≈340px of ~1260px).
  // Dragging the handle resizes between 20% and 55%.
  const [rightPanelFrac, setRightPanelFrac] = useState(0.27);
  const splitRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const isVerticalDraggingRef = useRef(false);
  const DEFAULT_TOP_PANEL_FRAC = 0.42;
  const MIN_TOP_PANEL_FRAC = 0.28;
  const [topPanelFrac, setTopPanelFrac] = useState(DEFAULT_TOP_PANEL_FRAC);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const syncLayoutMode = () => setIsWideBuilderLayout(mediaQuery.matches);

    syncLayoutMode();
    mediaQuery.addEventListener("change", syncLayoutMode);
    return () => mediaQuery.removeEventListener("change", syncLayoutMode);
  }, []);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    const startX = e.clientX;
    const startFrac = rightPanelFrac;

    const onMove = (moveEvent: MouseEvent) => {
      if (!splitRef.current || !isDraggingRef.current) return;
      const containerWidth = splitRef.current.getBoundingClientRect().width;
      // Delta is inverted: dragging left grows the right panel
      const dx = moveEvent.clientX - startX;
      const deltaFrac = dx / containerWidth;
      // Right panel grows when handle moves left (subtract delta)
      const newFrac = Math.max(0.20, Math.min(0.55, startFrac - deltaFrac));
      setRightPanelFrac(newFrac);
    };

    const onUp = () => {
      isDraggingRef.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [rightPanelFrac]);

  const handleVerticalResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isVerticalDraggingRef.current = true;
    const startY = e.clientY;
    const startFrac = topPanelFrac;

    const onMove = (moveEvent: MouseEvent) => {
      if (!leftPanelRef.current || !isVerticalDraggingRef.current) return;
      const containerHeight = leftPanelRef.current.getBoundingClientRect().height;
      const dy = moveEvent.clientY - startY;
      const deltaFrac = dy / containerHeight;
      const newFrac = Math.max(
        MIN_TOP_PANEL_FRAC,
        Math.min(DEFAULT_TOP_PANEL_FRAC, startFrac + deltaFrac),
      );
      setTopPanelFrac(newFrac);
    };

    const onUp = () => {
      isVerticalDraggingRef.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, [topPanelFrac]);

  // ── Left panel tab ────────────────────────────────────────────────────────
  // Default to "notes" — design intent: GM Notes are the primary feedback surface
  const [leftTab, setLeftTab] = useState<"skills" | "notes" | "debug">("notes");

  // ── Latest evaluation — lifted from AssistantGmNotes for the Debug tab ────
  const [latestEval, setLatestEval] = useState<RosterEvaluation | CohesionRosterEvaluation | null>(null);

  // ── Scroll position preservation across tab switches ──────────────────────
  // Each scrollable panel gets a ref; positions are cached in a stable ref object.
  const notesScrollRef = useRef<HTMLDivElement>(null);
  const debugScrollRef = useRef<HTMLDivElement>(null);
  const savedScrollPos = useRef<Record<"notes" | "debug", number>>({ notes: 0, debug: 0 });

  // Fires synchronously after DOM mutations but before paint — restores the
  // previously saved scroll position for the newly-active tab so there's no
  // visible jump. The inactive panels gain `hidden` (display:none) which clears
  // their scroll, so we must restore it here on every tab activation.
  useLayoutEffect(() => {
    if (leftTab === "notes" && notesScrollRef.current) {
      notesScrollRef.current.scrollTop = savedScrollPos.current.notes;
    } else if (leftTab === "debug" && debugScrollRef.current) {
      debugScrollRef.current.scrollTop = savedScrollPos.current.debug;
    }
  }, [leftTab]);

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
        {/* Right side of header: Evaluate button + mobile picker toggle */}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <EvaluateButton
            disabled={allSlots.some((p) => p === null)}
            href={`/builder/evaluate?${searchParams.toString()}`}
          />
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

      {/* Resizable split — left (builder) + drag handle + right (player picker) */}
      <div id="builder-split" ref={splitRef} className="flex-1 flex flex-col lg:flex-row min-h-0">

        {/* ── Left panel: builder ──────────────────────────────────────────── */}
        <div
          id="builder-left-panel"
          ref={leftPanelRef}
          className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden pr-0 lg:pr-1"
        >

          {/* Roster card — salary bar + court lineup + bench */}
          <div
            id="builder-roster-card"
            className={cn(
              "bg-card border border-border rounded-xl shadow-sm overflow-hidden flex flex-col min-h-0",
              isWideBuilderLayout ? "flex-[0_1_auto]" : "flex-shrink-0 mb-3",
            )}
            style={isWideBuilderLayout ? { flex: `${topPanelFrac} 1 0%` } : undefined}
          >
            {/* Salary gauge inside the card */}
            <div className="px-5 pt-3 pb-2">
              <SalaryGauge
                usedSalary={usedSalary}
                cap={SALARY_CAP}
                highlightRange={highlightRange}
                previewSalary={pickerHoveredSalary}
                onRemainingClick={(max) => setSalaryCapFilter(max)}
              />
            </div>

            {/* Court lineup — arc starters + bench row */}
            <div id="builder-roster-lineup-wrapper" className="flex-1 min-h-0">
              <CourtLineup
                allSlots={allSlots}
                cornerstoneId={cornerstoneId}
                selectedSlot={selectedSlot}
                onSlotClick={handleSlotClick}
                onRemoveSlot={handleRemoveSlot}
                onDropPlayer={handleDropPlayer}
                onSwapSlots={handleSwapSlots}
                onSlotHover={(slotIndex) => {
                  setHoveredSlotIndex(slotIndex);
                  // Lift the slot's player id so the picker can cross-highlight
                  const occupant = allSlots[slotIndex - 1];
                  setHoveredCourtPlayerId(occupant?.id ?? null);
                }}
                onSlotHoverEnd={() => {
                  setHoveredSlotIndex(null);
                  setHoveredCourtPlayerId(null);
                }}
              />
            </div>
          </div>

          <div
            id="builder-vertical-resize-handle"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize roster and notes panels"
            onMouseDown={handleVerticalResizeStart}
            className={cn(
              "hidden lg:flex items-center justify-center flex-shrink-0 cursor-row-resize group",
              "h-3 hover:h-4 transition-[height]",
            )}
          >
            <div className="h-px w-16 rounded-full bg-border group-hover:bg-foreground/30 transition-colors" />
          </div>

          {/* Skill grid / GM Notes — tabbed to share space */}
          <div
            id="builder-grid-area"
            className={cn(
              "flex flex-col min-h-0 overflow-hidden border border-border rounded-lg",
              !isWideBuilderLayout && "flex-1",
            )}
            style={isWideBuilderLayout ? { flex: `${1 - topPanelFrac} 1 0%` } : undefined}
          >
            {/* Tab bar */}
            <div id="builder-left-tabs" className="flex border-b border-border flex-shrink-0">
              {/* GM Notes tab first — primary feedback surface per design */}
              <button
                id="builder-tab-notes"
                type="button"
                onClick={() => setLeftTab("notes")}
                className={cn(
                  "px-4 py-2 text-xs font-medium transition-colors",
                  leftTab === "notes"
                    ? "border-b-2 border-amber-500 text-foreground -mb-px"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                GM Notes
              </button>
              <button
                id="builder-tab-skills"
                type="button"
                onClick={() => setLeftTab("skills")}
                className={cn(
                  "px-4 py-2 text-xs font-medium transition-colors",
                  leftTab === "skills"
                    ? "border-b-2 border-primary text-foreground -mb-px"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Skills
              </button>
              {/* Debug tab — admin only */}
              {isAdmin && (
                <button
                  id="builder-tab-debug"
                  type="button"
                  onClick={() => setLeftTab("debug")}
                  className={cn(
                    "px-4 py-2 text-xs font-medium transition-colors",
                    leftTab === "debug"
                      ? "border-b-2 border-violet-500 text-violet-400 -mb-px"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Debug
                </button>
              )}
            </div>

            {/* Tab panels — all three are always mounted so scroll positions are
                preserved when switching tabs. Inactive panels get `hidden`
                (display:none), and useLayoutEffect restores scrollTop after each
                tab activation to prevent a visible scroll-to-top flash. */}

            {/* Skills panel */}
            <div
              id="builder-skill-grid-wrapper"
              className={cn("flex-1 min-h-0 overflow-hidden", leftTab !== "skills" && "hidden")}
            >
              <SkillGrid
                allSlots={allSlots}
                cornerstoneId={cornerstoneId}
                legendProfile={legendDetail?.profile ?? null}
                hideEmptyColumns
              />
            </div>

            {/* GM Notes panel */}
            <div
              id="builder-gm-notes-wrapper"
              ref={notesScrollRef}
              onScroll={() => {
                // Cache scroll position so useLayoutEffect can restore it on re-activation
                savedScrollPos.current.notes = notesScrollRef.current?.scrollTop ?? 0;
              }}
              className={cn(
                "flex-1 min-h-0 overflow-y-auto p-3 flex flex-col",
                leftTab !== "notes" && "hidden",
              )}
            >
              <AssistantGmNotes
                allSlots={allSlots}
                legendDetail={legendDetail}
                isAdmin={isAdmin}
                onEvaluation={setLatestEval}
                onSuggestionFilter={handleSuggestionFilter}
              />
            </div>

            {/* Debug panel — admin only; shows scoring pipeline breakdown */}
            {isAdmin && (
              <div
                id="builder-debug-wrapper"
                ref={debugScrollRef}
                onScroll={() => {
                  savedScrollPos.current.debug = debugScrollRef.current?.scrollTop ?? 0;
                }}
                className={cn(
                  "flex-1 min-h-0 overflow-y-auto p-3",
                  leftTab !== "debug" && "hidden",
                )}
              >
                {/* Debug panel — branch on engine type */}
                {latestEval && isCohesionEvaluation(latestEval) && (
                  <CohesionDebugPanel evaluation={latestEval} />
                )}
                {latestEval && !isCohesionEvaluation(latestEval) && (
                  <>
                    <ScoringBreakdown
                      playerTraces={latestEval.player_traces ?? null}
                      aggregateTraces={latestEval.aggregate_traces ?? null}
                    />
                    {/* Height coverage chart — always shown when eval data exists */}
                    {latestEval.height_coverage && (
                      <div className="mt-4">
                        <HeightCoverageChart data={latestEval.height_coverage} />
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Drag handle — resizes right panel ───────────────────────────── */}
        <div
          id="builder-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize player panel"
          onMouseDown={handleResizeStart}
          className={cn(
            "hidden lg:flex items-center justify-center flex-shrink-0 cursor-col-resize group",
            "w-3 hover:w-4 transition-[width]",
          )}
        >
          <div className="w-px h-12 rounded-full bg-border group-hover:bg-foreground/30 transition-colors" />
        </div>

        {/* ── Right panel: player picker — resizable via drag handle ─────── */}
        <div
          id="builder-right-panel"
          className={cn(
            "flex-col min-w-0 border rounded-lg p-3 overflow-hidden lg:flex-shrink-0 transition-[box-shadow,border-color] duration-300",
            "lg:flex",
            pickerOpen ? "flex" : "hidden",
            // Brief orange glow when a GM Notes suggestion pushes a filter in
            pickerFlashing
              ? "border-orange-400 ring-2 ring-orange-400/60 shadow-[0_0_16px_rgba(251,146,60,0.35)]"
              : "border-border",
          )}
          style={{ width: `${Math.round(rightPanelFrac * 100)}%` }}
        >
          <PlayerPickerPanel
            players={activeRows}
            loading={false}
            error={null}
            remainingSalary={SALARY_CAP - usedSalary}
            salaryFilterTrigger={salaryCapFilter}
            onSalaryFilterInjected={() => setSalaryCapFilter(null)}
            skillFilterTrigger={suggestionFilterTrigger}
            onSkillFilterInjected={() => setSuggestionFilterTrigger(null)}
            rosterPlayerIds={rosterPlayerIds}
            selectedSlot={selectedSlot}
            onPlayerClick={handlePlayerClick}
            onPlayerHover={(salary) => setPickerHoveredSalary(salary)}
            onPlayerHoverEnd={() => setPickerHoveredSalary(null)}
            highlightedPlayerId={hoveredCourtPlayerId}
          />
        </div>
      </div>
    </main>
  );
}
