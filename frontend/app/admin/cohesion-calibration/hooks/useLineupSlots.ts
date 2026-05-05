/**
 * useLineupSlots — Manages lineup slot state, hydration, localStorage persistence, and swap logic.
 */

import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { fetchPlayerComposites } from "@/lib/api";
import { MAX_ROSTER_SLOTS } from "@/lib/builder-config";
import type { Player } from "@/lib/types";
import type { LineupSlot } from "../types";
import { emptyLineupSlot } from "../components/LineupTester";

const LINEUP_STORAGE_KEY = "cohesion-calibration-lineup-player-ids";

const EMPTY_LINEUP: LineupSlot[] = Array.from({ length: MAX_ROSTER_SLOTS }, () => emptyLineupSlot());

export function useLineupSlots() {
  const [lineupSlots, setLineupSlots] = useState<LineupSlot[]>(EMPTY_LINEUP);
  const [swapSourceIndex, setSwapSourceIndex] = useState<number | null>(null);

  /** Build a fresh lineup slot from a player id by fetching composite data. */
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

  /** Set a player into a lineup slot and fetch their composites. */
  const handleSlotSelect = useCallback(async (index: number, player: Player) => {
    setSwapSourceIndex(null);
    if (lineupSlots.some((slot, slotIndex) => slotIndex !== index && slot.player?.id === player.id)) {
      toast.error("Player already in rotation");
      return;
    }
    const hydratedSlot = await hydrateLineupSlot(player);
    if (hydratedSlot) {
      setLineupSlots((prev) =>
        prev.map((slot, i) => i === index ? hydratedSlot : slot),
      );
    } else {
      toast.error("Failed to load player data");
    }
  }, [hydrateLineupSlot, lineupSlots]);

  /** Put an existing slot back into search mode without clearing it. */
  const handleSlotReplace = useCallback((index: number) => {
    setSwapSourceIndex(null);
    setLineupSlots((prev) =>
      prev.map((slot, i) => i === index ? { ...slot, replacing: true } : slot),
    );
  }, []);

  /** Remove one player from the lineup. */
  const handleSlotRemove = useCallback((index: number) => {
    setSwapSourceIndex(null);
    setLineupSlots((prev) =>
      prev.map((slot, i) => (i === index ? emptyLineupSlot() : slot)),
    );
  }, []);

  /** Swap two rotation slots after the user enters swap mode. */
  const handleSwapTarget = useCallback((targetIndex: number) => {
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
  }, [swapSourceIndex]);

  /** Fill the rotation from a list of hydrated slots (used by team fill and history load). */
  const fillSlots = useCallback((slots: LineupSlot[]) => {
    setLineupSlots([
      ...slots,
      ...Array.from({ length: Math.max(0, MAX_ROSTER_SLOTS - slots.length) }, () => emptyLineupSlot()),
    ].slice(0, MAX_ROSTER_SLOTS));
    setSwapSourceIndex(null);
  }, []);

  // --- localStorage persistence ---

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

  return {
    lineupSlots,
    swapSourceIndex,
    setSwapSourceIndex,
    hydrateLineupSlot,
    handleSlotSelect,
    handleSlotReplace,
    handleSlotRemove,
    handleSwapTarget,
    fillSlots,
  };
}
