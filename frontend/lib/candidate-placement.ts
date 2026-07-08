import type { PlayerWithSkills } from "@/lib/types";

/**
 * Candidate placement (#92) — the single source of truth for which slot a
 * picker candidate lands in. useRosterSlots' click handler and the eval-impact
 * hover preview both route through here so the preview simulates exactly the
 * roster the click would produce (ADR 0005: preview matches committed eval,
 * placement included).
 */

interface PlacementContext {
  /** Currently selected slot (1-based), or null. */
  selectedSlot: number | null;
  cornerstoneId: string | null;
}

/** The 1-based slot a candidate would fill, or null when it cannot land. */
export function targetSlotForCandidate(
  allSlots: (PlayerWithSkills | null)[],
  { selectedSlot, cornerstoneId }: PlacementContext,
): number | null {
  if (selectedSlot != null && allSlots[selectedSlot - 1]?.id !== cornerstoneId) {
    return selectedSlot;
  }
  const firstFreeIdx = allSlots.findIndex((player) => player === null);
  return firstFreeIdx === -1 ? null : firstFreeIdx + 1;
}

/** The roster as it would look after the click, or null when nothing would change. */
export function placeCandidate(
  allSlots: (PlayerWithSkills | null)[],
  player: PlayerWithSkills,
  context: PlacementContext,
): (PlayerWithSkills | null)[] | null {
  if (allSlots.some((slotPlayer) => slotPlayer?.id === player.id)) return null;
  const target = targetSlotForCandidate(allSlots, context);
  if (target == null) return null;
  return allSlots.map((slotPlayer, index) => (index === target - 1 ? player : slotPlayer));
}
