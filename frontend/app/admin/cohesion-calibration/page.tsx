"use client";

/**
 * Cohesion Calibration Page — Admin tool for inspecting and tuning the cohesion engine.
 *
 * Three-panel layout (mirrors existing /admin/calibration pattern):
 *   Left (~380px):  PlayerCompositePanel — search + composite bars + bell curve overlay
 *   Center (flex):  Tabbed — "Bell Curves" | "Lineup Tester" | "Weights"
 *   Right (~320px): ResultsPanel — test history with before/after comparison
 *
 * All state lifted to page level. No global stores.
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import { Toaster, toast } from "sonner";
import { cn } from "@/lib/utils";
import { PlayerSearchCombobox } from "@/components/PlayerSearchCombobox";
import {
  DEFAULT_COHESION_WEIGHTS,
  normalizeCohesionExplanationWeights,
} from "@/lib/cohesion-weights";
import type { CohesionExplanationWeights } from "@/lib/cohesion-weights";
import {
  fetchPlayerComposites,
  fetchBellCurve,
  listPlayersWithSkills,
  evaluateLineup,
  evaluateRotation,
  fetchCohesionWeights,
} from "@/lib/api";
import { MAX_ROSTER_SLOTS } from "@/lib/builder-config";
import type { Player, PlayerWithSkills } from "@/lib/types";
import type { PlayerCompositeData, BellCurveData, LineupTestResult, LineupSlot, CenterTab } from "./types";
import { WeightsEditor } from "./components/WeightsEditor";
import { ResultsPanel } from "./components/ResultsPanel";
import { CompositeBars, PlayerSkillsPanel } from "./components/PlayerInspection";
import { LineupTester, emptyLineupSlot } from "./components/LineupTester";
import { BellCurveChart } from "./components/BellCurveCharts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CENTER_TABS: { key: CenterTab; label: string }[] = [
  { key: "lineup", label: "Lineup Tester" },
  { key: "bell_curves", label: "Bell Curves" },
  { key: "weights", label: "Weights" },
];

const LINEUP_STORAGE_KEY = "cohesion-calibration-lineup-player-ids";
const TEST_HISTORY_STORAGE_KEY = "cohesion-calibration-test-history";

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

const EMPTY_LINEUP: LineupSlot[] = Array.from({ length: MAX_ROSTER_SLOTS }, () => emptyLineupSlot());

function resultFromStorage(value: unknown): LineupTestResult | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<LineupTestResult>;
  if (
    typeof candidate.id !== "string"
    || typeof candidate.timestamp !== "number"
    || !Array.isArray(candidate.playerIds)
    || !Array.isArray(candidate.playerNames)
    || typeof candidate.cohesion_score !== "number"
    || !candidate.subscores
    || typeof candidate.subscores !== "object"
    || !Array.isArray(candidate.synergies_applied)
    || !candidate.accentuation
    || typeof candidate.accentuation !== "object"
  ) {
    return null;
  }

  return {
    id: candidate.id,
    timestamp: candidate.timestamp,
    playerIds: candidate.playerIds.map((id) => String(id)).slice(0, MAX_ROSTER_SLOTS),
    playerNames: candidate.playerNames.map((name) => String(name)).slice(0, MAX_ROSTER_SLOTS),
    cohesion_score: candidate.cohesion_score,
    mode: candidate.mode === "rotation" ? "rotation" : "lineup",
    subscores: candidate.subscores as Record<string, number>,
    synergies_applied: candidate.synergies_applied.map((id) => String(id)),
    archetype_labels: candidate.archetype_labels,
    archetype_details: candidate.archetype_details,
    accentuation: candidate.accentuation as LineupTestResult["accentuation"],
    accentuation_details: candidate.accentuation_details,
    boosted_bell_curves: candidate.boosted_bell_curves,
    rp_pd_boosts: candidate.rp_pd_boosts,
    star_rating: candidate.star_rating,
    star_rating_breakdown: candidate.star_rating_breakdown,
    theoretical_best_starting_rating: candidate.theoretical_best_starting_rating,
    theoretical_best_starting_breakdown: candidate.theoretical_best_starting_breakdown,
    lineup_summary: candidate.lineup_summary,
    lineup_combinations: candidate.lineup_combinations,
    player_composites: candidate.player_composites,
    selectedCombinationIndex: candidate.selectedCombinationIndex,
  };
}

export default function CohesionCalibrationPage() {
  // --- Left panel state ---
  const [selectedComposites, setSelectedComposites] = useState<PlayerCompositeData | null>(null);
  const [loadingComposites, setLoadingComposites] = useState(false);

  // --- Bell curve overlay state ---
  const [overlayPlayers, setOverlayPlayers] = useState<BellCurveData[]>([]);

  // --- Center tab state ---
  const [centerTab, setCenterTab] = useState<CenterTab>("lineup");

  // --- Lineup tester state ---
  const [lineupSlots, setLineupSlots] = useState<LineupSlot[]>(EMPTY_LINEUP);
  const [evaluatingLineup, setEvaluatingLineup] = useState(false);
  const [teamFillPlayers, setTeamFillPlayers] = useState<PlayerWithSkills[]>([]);
  const [teamFillLoading, setTeamFillLoading] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState("");
  const [swapSourceIndex, setSwapSourceIndex] = useState<number | null>(null);

  // --- Results state ---
  const [testHistory, setTestHistory] = useState<LineupTestResult[]>([]);
  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const [historyStorageLoaded, setHistoryStorageLoaded] = useState(false);

  // --- Cohesion weights state ---
  const [cohesionWeights, setCohesionWeights] = useState<CohesionExplanationWeights>(DEFAULT_COHESION_WEIGHTS);

  // --- Derived ---
  const latestResult = activeResultId
    ? testHistory.find((result) => result.id === activeResultId) ?? null
    : null;
  const teamOptions = useMemo(
    () => Array.from(new Set(
      teamFillPlayers
        .filter((player) => !player.is_legend && player.team)
        .map((player) => player.team as string),
    )).sort((a, b) => a.localeCompare(b)),
    [teamFillPlayers],
  );

  // --- Handlers ---

  /** Build a fresh lineup slot from persisted player id metadata. */
  const hydrateLineupSlot = useCallback(async (player: Player): Promise<LineupSlot | null> => {
    const res = await fetchPlayerComposites(player.id);
    if (!res.success || !res.data) return null;

    const compositeData = res.data;
    const hydratedPlayer = {
      ...player,
      id: compositeData.player_id,
      name: compositeData.name,
    };

    return {
      player: hydratedPlayer,
      skills: compositeData.skills,
      rawComposites: compositeData.composites_raw,
      normalizedComposites: compositeData.composites_normalized,
      bellCurve: compositeData.bell_curve,
      height: compositeData.height,
      replacing: false,
    };
  }, []);

  /** Load backend engine weights so explanation math mirrors weights.py and runtime overrides. */
  const loadCohesionWeights = useCallback(async () => {
    const res = await fetchCohesionWeights();
    if (res.success) {
      setCohesionWeights(normalizeCohesionExplanationWeights(res.data));
    } else {
      toast.error(res.error ?? "Failed to load cohesion weights");
    }
  }, []);

  useEffect(() => {
    loadCohesionWeights();
  }, [loadCohesionWeights]);

  /** Load active player rows for team-fill shortcuts. */
  useEffect(() => {
    let cancelled = false;

    listPlayersWithSkills()
      .then((res) => {
        if (cancelled) return;
        if (res.success && res.data) {
          setTeamFillPlayers(res.data.filter((player) => !player.is_legend));
        } else {
          toast.error(res.error ?? "Failed to load team list");
        }
      })
      .catch(() => {
        if (!cancelled) toast.error("Failed to load team list");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /** Restore persisted evaluation history for the right sidebar. */
  useEffect(() => {
    if (typeof window === "undefined") {
      setHistoryStorageLoaded(true);
      return;
    }
    const saved = window.localStorage.getItem(TEST_HISTORY_STORAGE_KEY);
    if (!saved) {
      setHistoryStorageLoaded(true);
      return;
    }

    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        setTestHistory(parsed.map(resultFromStorage).filter((result): result is LineupTestResult => result !== null).slice(0, 20));
      }
    } catch {
      window.localStorage.removeItem(TEST_HISTORY_STORAGE_KEY);
    } finally {
      setHistoryStorageLoaded(true);
    }
  }, []);

  /** Restore persisted lineup ids and refetch fresh composite data on load. */
  useEffect(() => {
    let cancelled = false;

    const restoreLineup = async () => {
      if (typeof window === "undefined") return;
      const saved = window.localStorage.getItem(LINEUP_STORAGE_KEY);
      if (!saved) return;

      let playerIds: Array<string | null>;
      try {
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed)) return;
        playerIds = parsed.slice(0, MAX_ROSTER_SLOTS).map((id) => (id ? String(id) : null));
      } catch {
        return;
      }

      const restored = await Promise.all(playerIds.map(async (playerId) => {
        if (!playerId) return emptyLineupSlot();
        const hydratedSlot = await hydrateLineupSlot({
          id: playerId,
          nba_api_id: 0,
          name: "",
          team: null,
          position: null,
          age: null,
          games_played: null,
          minutes_per_game: null,
          season: "",
        });
        return hydratedSlot ?? emptyLineupSlot();
      }));

      if (cancelled) return;
      setLineupSlots([
        ...restored,
        ...Array.from({ length: Math.max(0, MAX_ROSTER_SLOTS - restored.length) }, () => emptyLineupSlot()),
      ].slice(0, MAX_ROSTER_SLOTS));
    };

    restoreLineup();

    return () => {
      cancelled = true;
    };
  }, [hydrateLineupSlot]);

  /** Persist selected player ids only; composites are refetched fresh on reload. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const playerIds = lineupSlots.map((slot) => slot.player?.id ?? null);

    if (playerIds.every((id) => id === null)) {
      window.localStorage.removeItem(LINEUP_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(LINEUP_STORAGE_KEY, JSON.stringify(playerIds));
  }, [lineupSlots]);

  /** Persist evaluated lineup history so the sidebar survives refreshes. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!historyStorageLoaded) return;

    if (testHistory.length === 0) {
      window.localStorage.removeItem(TEST_HISTORY_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(TEST_HISTORY_STORAGE_KEY, JSON.stringify(testHistory.slice(0, 20)));
  }, [historyStorageLoaded, testHistory]);

  /** Fetch composites when a player is selected in the left panel search. */
  const handlePlayerSelect = useCallback(async (player: Player) => {
    setLoadingComposites(true);
    const res = await fetchPlayerComposites(player.id);
    if (res.success && res.data) {
      setSelectedComposites(res.data);
    } else {
      toast.error(res.error ?? "Failed to load composites");
      setSelectedComposites(null);
    }
    setLoadingComposites(false);
  }, []);

  /** Add a player's bell curve to the overlay chart. */
  const handleAddToBellCurve = useCallback(async () => {
    if (!selectedComposites) return;
    // Don't add duplicates
    if (overlayPlayers.some((p) => p.player_id === selectedComposites.player_id)) {
      toast.error("Player already on chart");
      return;
    }
    const res = await fetchBellCurve(selectedComposites.player_id);
    if (res.success && res.data) {
      const curveData = res.data;
      setOverlayPlayers((prev) => [...prev, curveData]);
      // Auto-switch to bell curves tab
      setCenterTab("bell_curves");
    } else {
      toast.error(res.error ?? "Failed to load bell curve");
    }
  }, [selectedComposites, overlayPlayers]);

  /** Remove a player from the bell curve overlay. */
  const handleRemoveBellCurvePlayer = useCallback((playerId: string) => {
    setOverlayPlayers((prev) => prev.filter((p) => p.player_id !== playerId));
  }, []);

  /** Re-fetch all overlay players' bell curves after weight/constant changes. */
  const [refreshingCurves, setRefreshingCurves] = useState(false);
  const handleRefreshBellCurves = useCallback(async () => {
    if (overlayPlayers.length === 0) return;
    setRefreshingCurves(true);
    try {
      // Fetch all curves in parallel
      const results = await Promise.all(
        overlayPlayers.map((p) => fetchBellCurve(p.player_id))
      );
      // Replace overlay with fresh data, keeping only successful fetches
      const refreshed: BellCurveData[] = [];
      for (const res of results) {
        if (res.success && res.data) refreshed.push(res.data);
      }
      setOverlayPlayers(refreshed);
    } finally {
      setRefreshingCurves(false);
    }
  }, [overlayPlayers]);

  /** Set a player into a lineup slot and fetch their skills. */
  const handleLineupSlotSelect = useCallback(async (index: number, player: Player) => {
    setSwapSourceIndex(null);
    if (lineupSlots.some((slot, slotIndex) => slotIndex !== index && slot.player?.id === player.id)) {
      toast.error("Player already in rotation");
      return;
    }
    const hydratedSlot = await hydrateLineupSlot(player);
    if (hydratedSlot) {
      setLineupSlots((prev) =>
        prev.map((slot, i) =>
          i === index
            ? hydratedSlot
            : slot,
        ),
      );
      setActiveResultId(null);
    } else {
      toast.error("Failed to load player data");
    }
  }, [hydrateLineupSlot, lineupSlots]);

  /** Put an existing slot back into search mode without clearing it yet. */
  const handleLineupSlotReplace = useCallback((index: number) => {
    setSwapSourceIndex(null);
    setLineupSlots((prev) =>
      prev.map((slot, i) =>
        i === index ? { ...slot, replacing: true } : slot,
      ),
    );
    setActiveResultId(null);
  }, []);

  /** Remove one player from the lineup and clear the active result preview. */
  const handleLineupSlotRemove = useCallback((index: number) => {
    setSwapSourceIndex(null);
    setLineupSlots((prev) =>
      prev.map((slot, i) => (i === index ? emptyLineupSlot() : slot)),
    );
    setActiveResultId(null);
  }, []);

  /** Swap two rotation slots after the user enters swap mode. */
  const handleLineupSlotSwapTarget = useCallback((targetIndex: number) => {
    if (swapSourceIndex === null) return;
    if (swapSourceIndex === targetIndex) {
      setSwapSourceIndex(null);
      return;
    }
    setLineupSlots((prev) => {
      const next = [...prev];
      const source = next[swapSourceIndex];
      next[swapSourceIndex] = next[targetIndex];
      next[targetIndex] = source;
      return next;
    });
    setSwapSourceIndex(null);
    setActiveResultId(null);
  }, [swapSourceIndex]);

  /** Fill the rotation with the selected team's top active players by minutes per game. */
  const handleFillTeamRotation = useCallback(async () => {
    if (!selectedTeam) return;

    const topPlayers = teamFillPlayers
      .filter((player) => !player.is_legend && player.team === selectedTeam)
      .sort((a, b) => (b.minutes_per_game ?? 0) - (a.minutes_per_game ?? 0))
      .slice(0, MAX_ROSTER_SLOTS);

    if (topPlayers.length < 5) {
      toast.error(`${selectedTeam} has fewer than 5 active players available`);
      return;
    }

    setTeamFillLoading(true);
    const hydratedSlots = await Promise.all(
      topPlayers.map(async (player) => {
        const hydratedSlot = await hydrateLineupSlot({
          id: player.id,
          nba_api_id: player.nba_api_id ?? 0,
          name: player.name,
          team: player.team,
          position: player.position,
          age: player.age,
          games_played: player.games_played,
          minutes_per_game: player.minutes_per_game,
          season: player.season,
          is_legend: player.is_legend,
        });
        return hydratedSlot ?? emptyLineupSlot();
      }),
    );
    setLineupSlots([
      ...hydratedSlots,
      ...Array.from({ length: Math.max(0, MAX_ROSTER_SLOTS - hydratedSlots.length) }, () => emptyLineupSlot()),
    ].slice(0, MAX_ROSTER_SLOTS));
    setSwapSourceIndex(null);
    setActiveResultId(null);
    setTeamFillLoading(false);
    toast.success(`Filled ${selectedTeam} top ${hydratedSlots.filter((slot) => slot.player).length} by MPG`);
  }, [hydrateLineupSlot, selectedTeam, teamFillPlayers]);

  /** Rehydrate a saved history item into the lineup tester with fresh composite data. */
  const handleLoadTestHistoryLineup = useCallback(async (result: LineupTestResult) => {
    const restored = await Promise.all(result.playerIds.slice(0, MAX_ROSTER_SLOTS).map(async (playerId, index) => {
      const hydratedSlot = await hydrateLineupSlot({
        id: playerId,
        nba_api_id: 0,
        name: result.playerNames[index] ?? "",
        team: null,
        position: null,
        age: null,
        games_played: null,
        minutes_per_game: null,
        season: "",
      });
      return hydratedSlot ?? emptyLineupSlot();
    }));

    setLineupSlots([
      ...restored,
      ...Array.from({ length: Math.max(0, MAX_ROSTER_SLOTS - restored.length) }, () => emptyLineupSlot()),
    ].slice(0, MAX_ROSTER_SLOTS));
    setActiveResultId(null);
    setCenterTab("lineup");
    toast.success("Lineup loaded");
  }, [hydrateLineupSlot]);

  /** Evaluate the current selected players as a single lineup or full rotation. */
  const handleEvaluateLineup = useCallback(async () => {
    const selectedSlots = lineupSlots.filter((slot) => slot.player !== null);
    if (selectedSlots.length < 5) return;

    setEvaluatingLineup(true);
    const players = selectedSlots.map((slot, index) => ({
      id: slot.player?.id,
      name: slot.player?.name ?? "",
      slot: index + 1,
      height: slot.height,
      skills: slot.skills,
    }));

    if (selectedSlots.length === 5) {
      const res = await evaluateLineup(players);
      if (!res.success || !res.data) {
        toast.error(res.error ?? "Evaluation failed");
        setEvaluatingLineup(false);
        return;
      }
      const result: LineupTestResult = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        playerIds: selectedSlots.map((s) => s.player?.id ?? ""),
        playerNames: selectedSlots.map((s) => s.player?.name ?? "?"),
        mode: "lineup",
        cohesion_score: res.data.cohesion_score,
        subscores: res.data.subscores,
        synergies_applied: res.data.synergies_applied,
        archetype_labels: res.data.archetype_labels,
        archetype_details: res.data.archetype_details,
        accentuation: res.data.accentuation,
        accentuation_details: res.data.accentuation_details,
        boosted_bell_curves: res.data.boosted_bell_curves,
        rp_pd_boosts: res.data.rp_pd_boosts,
        selectedCombinationIndex: 0,
      };
      setTestHistory((prev) => [result, ...prev].slice(0, 20));
      setActiveResultId(result.id);
      toast.success(`Cohesion: ${res.data.cohesion_score.toFixed(2)}`);
      setEvaluatingLineup(false);
      return;
    }

    const res = await evaluateRotation(players);
    if (!res.success || !res.data) {
      toast.error(res.error ?? "Evaluation failed");
      setEvaluatingLineup(false);
      return;
    }

    const selectedCombinationIndex = Math.max(
      0,
      res.data.lineup_combinations.findIndex((lineup) => lineup.is_starting_lineup),
    );
    const selectedCombination = res.data.lineup_combinations[selectedCombinationIndex] ?? res.data.lineup_combinations[0];
    const result: LineupTestResult = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      playerIds: selectedSlots.map((s) => s.player?.id ?? ""),
      playerNames: selectedSlots.map((s) => s.player?.name ?? "?"),
      mode: "rotation",
      cohesion_score: res.data.star_rating,
      subscores: selectedCombination.subscores,
      synergies_applied: selectedCombination.synergies_applied,
      archetype_labels: selectedCombination.archetype_labels,
      archetype_details: selectedCombination.archetype_details,
      accentuation: selectedCombination.accentuation,
      accentuation_details: selectedCombination.accentuation_details,
      boosted_bell_curves: selectedCombination.boosted_bell_curves,
      rp_pd_boosts: selectedCombination.rp_pd_boosts,
      star_rating: res.data.star_rating,
      star_rating_breakdown: res.data.star_rating_breakdown,
      theoretical_best_starting_rating: res.data.theoretical_best_starting_rating,
      theoretical_best_starting_breakdown: res.data.theoretical_best_starting_breakdown,
      lineup_summary: res.data.lineup_summary,
      lineup_combinations: res.data.lineup_combinations,
      player_composites: res.data.player_composites,
      selectedCombinationIndex,
    };
    setTestHistory((prev) => [result, ...prev].slice(0, 20));
    setActiveResultId(result.id);
    toast.success(`Rotation: ${res.data.star_rating.toFixed(2)}`);
    setEvaluatingLineup(false);
  }, [lineupSlots]);

  /** Notify results panel when weights change (for before/after comparison). */
  const handleWeightsUpdated = useCallback(() => {
    // Refresh explanation weights after runtime overrides are saved or reset.
    loadCohesionWeights();
  }, [loadCohesionWeights]);

  // --- Tab data (module-level constant, no memo needed) ---

  return (
    <>
      <Toaster position="bottom-right" richColors closeButton toastOptions={{ duration: 4000 }} />

      <div className="flex flex-col h-[calc(100vh-3rem)] overflow-hidden bg-background">
        {/* Header bar */}
        <header id="cohesion-cal-header" className="flex-shrink-0 flex items-center justify-between px-6 py-3 border-b border-border bg-background z-10">
          <div className="flex items-center gap-3">
            <a
              id="cohesion-cal-back-link"
              href="/admin"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              ← Cornerstone
            </a>
            <span className="text-muted-foreground/30">/</span>
            <h1 id="cohesion-cal-title" className="text-sm font-semibold text-foreground">
              Cohesion Calibration
            </h1>
          </div>
        </header>

        {/* Three-panel layout */}
        <div id="cohesion-cal-panels" className="flex-1 overflow-hidden flex">

          {/* ── Left panel: Player Composites (~380px) ────────────────── */}
          <div
            id="cohesion-cal-left-panel"
            className="w-[380px] flex-shrink-0 border-r border-border overflow-y-auto p-4 space-y-4"
          >
            {/* Player search */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Player Search
              </p>
              <PlayerSearchCombobox onSelect={handlePlayerSelect} placeholder="Search players…" includeLegends />
            </div>

            {/* Loading state */}
            {loadingComposites && (
              <div className="flex items-center justify-center py-8">
                <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
              </div>
            )}

            {/* Composite bars */}
            {selectedComposites && !loadingComposites && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-foreground">{selectedComposites.name}</p>
                  <span className="text-[10px] text-muted-foreground">{selectedComposites.height ?? "—"}</span>
                </div>

                <CompositeBars composites={selectedComposites.composites_normalized} />
                <PlayerSkillsPanel idPrefix="cohesion-cal-selected-player" skills={selectedComposites.skills} />

                {/* Action buttons */}
                <div className="flex gap-2">
                  <button
                    id="cohesion-cal-add-bellcurve-btn"
                    type="button"
                    onClick={handleAddToBellCurve}
                    className="flex-1 text-[10px] font-medium py-1.5 rounded-md border border-border hover:bg-muted text-muted-foreground transition-colors cursor-pointer"
                  >
                    Add to Bell Curve
                  </button>
                  <button
                    id="cohesion-cal-set-lineup-btn"
                    type="button"
                    onClick={() => {
                      // Fill next empty lineup slot
                      const emptyIdx = lineupSlots.findIndex((s) => s.player === null);
                      if (emptyIdx >= 0 && selectedComposites) {
                        const minimalPlayer: Player = {
                          id: selectedComposites.player_id,
                          nba_api_id: 0,
                          name: selectedComposites.name,
                          team: null,
                          position: null,
                          age: null,
                          games_played: null,
                          minutes_per_game: null,
                          season: "",
                        };
                        handleLineupSlotSelect(emptyIdx, minimalPlayer);
                        setCenterTab("lineup");
                      } else {
                        toast.error("All rotation slots filled");
                      }
                    }}
                    className="flex-1 text-[10px] font-medium py-1.5 rounded-md border border-border hover:bg-muted text-muted-foreground transition-colors cursor-pointer"
                  >
                    Set in Rotation
                  </button>
                </div>

                {/* Bell curve params summary */}
                <div className="text-[9px] text-muted-foreground/60 space-y-0.5">
                  <p>
                    Bell: amp={selectedComposites.bell_curve.amplitude.toFixed(1)},
                    peak={selectedComposites.bell_curve.peak}in,
                    range=[{selectedComposites.bell_curve.range_down},{selectedComposites.bell_curve.range_up}]
                  </p>
                </div>
              </div>
            )}

            {/* Empty state */}
            {!selectedComposites && !loadingComposites && (
              <div className="text-xs text-muted-foreground/40 text-center py-8">
                Search a player to view composites
              </div>
            )}
          </div>

          {/* ── Center panel: Tabbed ──────────────────────────────────── */}
          <div id="cohesion-cal-center-panel" className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {/* Tab bar */}
            <div id="cohesion-cal-tab-bar" className="flex-shrink-0 flex border-b border-border bg-background">
              {CENTER_TABS.map((tab) => (
                <button
                  key={tab.key}
                  id={`cohesion-cal-tab-${tab.key}`}
                  type="button"
                  onClick={() => setCenterTab(tab.key)}
                  className={cn(
                    "px-4 py-2.5 text-xs font-medium transition-colors cursor-pointer border-b-2",
                    centerTab === tab.key
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              {centerTab === "bell_curves" && (
                <BellCurveChart overlayPlayers={overlayPlayers} onRemovePlayer={handleRemoveBellCurvePlayer} onRefresh={handleRefreshBellCurves} refreshing={refreshingCurves} />
              )}
              {centerTab === "lineup" && (
                <LineupTester
                  lineupSlots={lineupSlots}
                  weights={cohesionWeights}
                  teamOptions={teamOptions}
                  selectedTeam={selectedTeam}
                  teamFillLoading={teamFillLoading}
                  onSlotSelect={handleLineupSlotSelect}
                  onSlotRemove={handleLineupSlotRemove}
                  onSlotReplace={handleLineupSlotReplace}
                  swapSourceIndex={swapSourceIndex}
                  onSwapStart={setSwapSourceIndex}
                  onSwapTarget={handleLineupSlotSwapTarget}
                  onSwapCancel={() => setSwapSourceIndex(null)}
                  onTeamChange={setSelectedTeam}
                  onFillTeam={handleFillTeamRotation}
                  onEvaluate={handleEvaluateLineup}
                  evaluating={evaluatingLineup}
                  latestResult={latestResult}
                />
              )}
              {centerTab === "weights" && (
                <WeightsEditor onWeightsUpdated={handleWeightsUpdated} />
              )}
            </div>
          </div>

          {/* ── Right panel: Results (~320px) ─────────────────────────── */}
          <div
            id="cohesion-cal-right-panel"
            className="w-[320px] flex-shrink-0 border-l border-border overflow-hidden flex flex-col"
          >
            <div className="flex-shrink-0 px-4 py-3 border-b border-border">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Test History ({testHistory.length})
              </p>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              <ResultsPanel testHistory={testHistory} onLoadLineup={handleLoadTestHistoryLineup} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
