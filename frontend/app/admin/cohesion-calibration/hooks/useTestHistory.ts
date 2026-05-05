/**
 * useTestHistory — Manages evaluation test history with localStorage persistence.
 *
 * Handles loading, saving, and adding results to the sidebar history panel.
 */

import { useState, useEffect, useCallback } from "react";
import { MAX_ROSTER_SLOTS } from "@/lib/builder-config";
import type { LineupTestResult } from "../types";

const TEST_HISTORY_STORAGE_KEY = "cohesion-calibration-test-history";

/** Validate and reconstruct a LineupTestResult from localStorage JSON. */
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

export function useTestHistory() {
  const [testHistory, setTestHistory] = useState<LineupTestResult[]>([]);
  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const [historyStorageLoaded, setHistoryStorageLoaded] = useState(false);

  // Derived: currently selected result from history
  const latestResult = activeResultId
    ? testHistory.find((result) => result.id === activeResultId) ?? null
    : null;

  /** Add a result to history and set it as active. */
  const addResult = useCallback((result: LineupTestResult) => {
    setTestHistory((prev) => [result, ...prev].slice(0, 20));
    setActiveResultId(result.id);
  }, []);

  /** Restore persisted evaluation history from localStorage. */
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

  /** Persist history to localStorage whenever it changes. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!historyStorageLoaded) return;

    if (testHistory.length === 0) {
      window.localStorage.removeItem(TEST_HISTORY_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(TEST_HISTORY_STORAGE_KEY, JSON.stringify(testHistory.slice(0, 20)));
  }, [historyStorageLoaded, testHistory]);

  return {
    testHistory,
    activeResultId,
    setActiveResultId,
    latestResult,
    addResult,
  };
}
