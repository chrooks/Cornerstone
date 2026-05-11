/**
 * useRosterSlots — Domain hook for managing the 8-slot roster lineup.
 *
 * Owns all slot state, selection logic, URL synchronization, and interaction
 * handlers (click, remove, drop, swap). Pure roster semantics — no layout or
 * salary concerns.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MAX_ROSTER_SLOTS } from "@/lib/builder-config";
import { readSlotsFromParams, buildSlotsParams } from "@/lib/roster-utils";
import type { PlayerWithSkills } from "@/lib/types";

export interface UseRosterSlotsReturn {
  /** Current 8-slot lineup (null = empty slot). */
  allSlots: (PlayerWithSkills | null)[];
  /** Currently selected slot (1-based), or null if none selected. */
  selectedSlot: number | null;
  /** Set of player IDs currently occupying a slot. */
  rosterPlayerIds: Set<string>;

  // Actions
  handleSelectLegend: (legend: PlayerWithSkills) => void;
  handleSlotClick: (slotIndex: number) => void;
  handleRemoveSlot: (slotIndex: number) => void;
  handlePlayerClick: (player: PlayerWithSkills) => void;
  handleDropPlayer: (slotIndex: number, player: PlayerWithSkills) => void;
  handleSwapSlots: (fromSlot: number, toSlot: number) => void;
}

/**
 * Manages roster slot state, selection, and URL synchronization.
 *
 * @param cornerstoneId - UUID of the selected cornerstone legend (from URL)
 * @param legendRows - All legend PlayerWithSkills entries
 * @param activeRows - All non-legend PlayerWithSkills entries
 */
export function useRosterSlots(
  cornerstoneId: string | null,
  legendRows: PlayerWithSkills[],
  activeRows: PlayerWithSkills[],
): UseRosterSlotsReturn {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // ── Flat 8-slot lineup state ────────────────────────────────────────────
  const [allSlots, setAllSlots] = useState<(PlayerWithSkills | null)[]>(
    Array(MAX_ROSTER_SLOTS).fill(null),
  );

  // ── Currently selected slot (1-based). null = no active selection. ──────
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);

  // Hydrate slot state from URL once player/legend data loads
  useEffect(() => {
    if (legendRows.length === 0) return;
    const allPlayerMap = new Map<string, PlayerWithSkills>([
      ...legendRows.map((p): [string, PlayerWithSkills] => [p.id, p]),
      ...activeRows.map((p): [string, PlayerWithSkills] => [p.id, p]),
    ]);
    const params = new URLSearchParams(searchParams.toString());
    setAllSlots(readSlotsFromParams(params, cornerstoneId, allPlayerMap));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legendRows, activeRows]);

  // ── URL sync helper ─────────────────────────────────────────────────────
  const syncUrl = useCallback(
    (newCornerstoneId: string | null, newSlots: (PlayerWithSkills | null)[]) => {
      const params = buildSlotsParams(newCornerstoneId, newSlots);
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [pathname, router],
  );

  // ── Legend selection ─────────────────────────────────────────────────────
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

  // ── Fill a slot with a player ───────────────────────────────────────────
  const fillSlot = useCallback(
    (slotIndex: number, player: PlayerWithSkills) => {
      // Refuse to overwrite the cornerstone legend slot
      if (allSlots[slotIndex - 1]?.id === cornerstoneId) return;
      const newSlots = allSlots.map((p, i) => (i === slotIndex - 1 ? player : p));
      setAllSlots(newSlots);
      setSelectedSlot(null);
      syncUrl(cornerstoneId, newSlots);
    },
    [allSlots, cornerstoneId, syncUrl],
  );

  // ── Slot click — select an empty placement target or clear targeting ───
  const handleSlotClick = useCallback(
    (slotIndex: number) => {
      // Cornerstone slot is not clickable
      if (allSlots[slotIndex - 1]?.id === cornerstoneId) return;

      // Filled slots are inspected by the caller; movement happens by drag-drop.
      if (allSlots[slotIndex - 1] !== null) {
        setSelectedSlot(null);
        return;
      }

      // Clicking already-selected empty slot deselects it.
      if (selectedSlot === slotIndex) {
        setSelectedSlot(null);
        return;
      }

      setSelectedSlot(slotIndex);
    },
    [selectedSlot, allSlots, cornerstoneId],
  );

  // ── Remove slot occupant ────────────────────────────────────────────────
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

  // ── Player click from picker ────────────────────────────────────────────
  const handlePlayerClick = useCallback(
    (player: PlayerWithSkills) => {
      // Use selected slot if available; otherwise find first empty
      if (selectedSlot != null && allSlots[selectedSlot - 1]?.id !== cornerstoneId) {
        fillSlot(selectedSlot, player);
        return;
      }
      const firstFreeIdx = allSlots.findIndex((p) => p === null);
      if (firstFreeIdx !== -1) {
        fillSlot(firstFreeIdx + 1, player);
      }
    },
    [selectedSlot, allSlots, cornerstoneId, fillSlot],
  );

  // ── Drop player onto a slot ─────────────────────────────────────────────
  const handleDropPlayer = useCallback(
    (slotIndex: number, player: PlayerWithSkills) => {
      if (allSlots[slotIndex - 1]?.id === cornerstoneId) return;
      fillSlot(slotIndex, player);
    },
    [allSlots, cornerstoneId, fillSlot],
  );

  // ── Swap two slots via drag-drop ────────────────────────────────────────
  const handleSwapSlots = useCallback(
    (fromSlot: number, toSlot: number) => {
      // Block swaps involving the cornerstone slot
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

  // ── Derived: set of player IDs on the roster ────────────────────────────
  const rosterPlayerIds = useMemo(
    () => new Set(allSlots.filter(Boolean).map((p) => p!.id)),
    [allSlots],
  );

  return {
    allSlots,
    selectedSlot,
    rosterPlayerIds,
    handleSelectLegend,
    handleSlotClick,
    handleRemoveSlot,
    handlePlayerClick,
    handleDropPlayer,
    handleSwapSlots,
  };
}
