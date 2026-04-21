"use client";

/**
 * RotationSlots.tsx — Row of 8 player headshot slots for the Team Builder.
 *
 * Slots are grouped visually into three tiers that map to their slot weights:
 *   CO-STAR  (slot 1, weight 1.0)
 *   STARTERS (slots 2–5, weights 0.9 → 0.6)
 *   BENCH    (slots 6–8, weights 0.5 → 0.2)
 *
 * Each slot shows a proportional weight bar under its number so users
 * immediately understand that reordering players changes their score impact.
 *
 * The cornerstone legend position is locked — it cannot be swapped or
 * dragged to another slot. All other filled slots are draggable.
 */

import { cn } from "@/lib/utils";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { MAX_ROSTER_SLOTS } from "@/lib/builder-config";
import type { PlayerWithSkills } from "@/lib/types";

// ---------------------------------------------------------------------------
// Slot weight display values — mirrors backend weights.py SLOT_WEIGHTS.
// Slot 1 holds the cornerstone legend (backend slot 0, weight 0 = context only).
// Supporting players start at slot 2 (backend slot 2, weight 0.9).
// Backend slot 1 is skipped because the legend always occupies allSlots[0].
// ---------------------------------------------------------------------------
const SLOT_WEIGHTS_DISPLAY: Record<number, number | "cornerstone"> = {
  1: "cornerstone", // legend — context only, not aggregated into scores
  2: 0.9,
  3: 0.75,
  4: 0.7,
  5: 0.6,
  6: 0.5,
  7: 0.4,
  8: 0.2,
  9: 0.1,
};

// ---------------------------------------------------------------------------
// Slot groups — four tiers matching the role hierarchy.
// ---------------------------------------------------------------------------
interface SlotGroup {
  label: string;
  slots: number[];
  labelColor: string;
  barColor: string;
}

const SLOT_GROUPS: SlotGroup[] = [
  {
    label: "Cornerstone",
    slots: [1],
    labelColor: "text-amber-400",
    barColor: "bg-amber-400",
  },
  {
    label: "Co-Star",
    slots: [2],
    labelColor: "text-sky-400",
    barColor: "bg-sky-400",
  },
  {
    label: "Starters",
    slots: [3, 4, 5],
    labelColor: "text-blue-400/80",
    barColor: "bg-blue-400/70",
  },
  {
    label: "Bench",
    slots: [6, 7, 8, 9],
    labelColor: "text-muted-foreground/60",
    barColor: "bg-muted-foreground/40",
  },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RotationSlotsProps {
  /** All 8 slots (index 0 = slot 1). Each entry is a player, legend, or null. */
  allSlots: (PlayerWithSkills | null)[];
  /** ID of the cornerstone legend — the matching slot shows the star badge and is locked. */
  cornerstoneId: string | null;
  /** Index of the currently selected slot (1-based). null = no selection. */
  selectedSlot: number | null;
  onSlotClick: (slotIndex: number) => void;
  onRemoveSlot: (slotIndex: number) => void;
  /** Called when a player is dropped onto a slot from the picker panel. */
  onDropPlayer: (slotIndex: number, player: PlayerWithSkills) => void;
  /** Called when a filled slot is dragged onto another slot — swaps the two occupants. */
  onSwapSlots?: (fromSlot: number, toSlot: number) => void;
  /** Called on headshot mouseenter — passes slot index (1-based) for gauge highlight. */
  onSlotHover?: (slotIndex: number, salary: number | null) => void;
  /** Called on headshot mouseleave — clears gauge preview. */
  onSlotHoverEnd?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RotationSlots({
  allSlots,
  cornerstoneId,
  selectedSlot,
  onSlotClick,
  onRemoveSlot,
  onDropPlayer,
  onSwapSlots,
  onSlotHover,
  onSlotHoverEnd,
}: RotationSlotsProps) {
  const slots = allSlots.slice(0, MAX_ROSTER_SLOTS);

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  function handleDrop(e: React.DragEvent, targetSlotIndex: number) {
    e.preventDefault();
    const sourceSlotRaw = e.dataTransfer.getData("application/builder-slot");
    const playerRaw = e.dataTransfer.getData("application/builder-player");

    if (sourceSlotRaw) {
      // Drag from a slot → swap the two slots
      const sourceSlotIndex = parseInt(sourceSlotRaw, 10);
      if (!isNaN(sourceSlotIndex) && sourceSlotIndex !== targetSlotIndex) {
        onSwapSlots?.(sourceSlotIndex, targetSlotIndex);
      }
      return;
    }

    if (playerRaw) {
      try {
        const player = JSON.parse(playerRaw) as PlayerWithSkills;
        onDropPlayer(targetSlotIndex, player);
      } catch {
        // Malformed drag data — ignore
      }
    }
  }

  return (
    <div
      id="builder-rotation-slots"
      className="flex gap-3 overflow-x-auto pb-1 justify-center items-end"
    >
      {SLOT_GROUPS.map((group, groupIdx) => (
        <div key={group.label} className="flex gap-0">
          {/* Inter-group divider (not before the first group) */}
          {groupIdx > 0 && (
            <div className="flex items-center mx-1.5 self-stretch">
              <div className="w-px h-full bg-border/50 rounded-full" />
            </div>
          )}

          {/* Group column */}
          <div className="flex flex-col gap-1">
            {/* Tier label */}
            <span
              className={cn(
                "text-[9px] font-semibold uppercase tracking-widest text-center select-none",
                group.labelColor,
              )}
            >
              {group.label}
            </span>

            {/* Slot cards */}
            <div className="flex gap-2">
              {group.slots.map((slotIndex) => {
                const occupant = slots[slotIndex - 1] ?? null;
                const isSelected = selectedSlot === slotIndex;
                const isEmpty = !occupant;
                const isCornerstone = !isEmpty && occupant!.id === cornerstoneId;
                const weight = SLOT_WEIGHTS_DISPLAY[slotIndex] ?? 0.1;

                return (
                  <div
                    key={slotIndex}
                    id={`builder-slot-${slotIndex}`}
                    className="flex-shrink-0 flex flex-col items-center gap-1"
                    style={{ width: 64 }}
                  >
                    {/* Slot number + proportional weight bar */}
                    <div className="flex flex-col items-center gap-0.5 w-full">
                      <span className="text-[10px] text-muted-foreground font-medium">
                        {slotIndex}
                      </span>
                      {weight === "cornerstone" ? (
                        /* Cornerstone slot: full-width amber bar marked as context-only */
                        <div
                          className="w-full h-[3px] rounded-full bg-amber-400/60"
                          title="Cornerstone — context only (not aggregated into scores)"
                        />
                      ) : (
                        /* Supporting slot: proportional weight bar */
                        <div
                          className="w-full h-[3px] rounded-full bg-muted/40 overflow-hidden"
                          title={`Slot weight: ${Math.round(weight * 100)}%`}
                        >
                          <div
                            className={cn("h-full rounded-full", group.barColor)}
                            style={{ width: `${weight * 100}%` }}
                          />
                        </div>
                      )}
                    </div>

                    {/* Slot button — cornerstone is locked (no drag); other filled slots are draggable */}
                    <div
                      role="button"
                      tabIndex={isCornerstone ? -1 : 0}
                      aria-label={
                        isEmpty
                          ? `Slot ${slotIndex}: empty`
                          : isCornerstone
                          ? `Slot ${slotIndex}: cornerstone (locked)`
                          : `Slot ${slotIndex}: occupied`
                      }
                      draggable={!isEmpty && !isCornerstone}
                      onDragStart={!isEmpty && !isCornerstone ? (e) => {
                        e.dataTransfer.setData("application/builder-slot", String(slotIndex));
                        e.dataTransfer.setData("application/builder-player", JSON.stringify(occupant));
                        e.dataTransfer.effectAllowed = "move";
                      } : undefined}
                      onClick={() => onSlotClick(slotIndex)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") onSlotClick(slotIndex);
                      }}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, slotIndex)}
                      onMouseEnter={!isEmpty && onSlotHover ? () => {
                        const salary = isCornerstone ? null : (occupant!.salary ?? null);
                        onSlotHover(slotIndex, salary);
                      } : undefined}
                      onMouseLeave={!isEmpty ? onSlotHoverEnd : undefined}
                      className={cn(
                        "relative w-14 h-14 rounded-lg overflow-hidden transition-all",
                        "border-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        // Cornerstone: amber border, no hover interaction indicator
                        isCornerstone && "border-amber-500/60 cursor-default",
                        // Selected empty — blue pulse
                        isSelected && isEmpty && "border-blue-500 ring-2 ring-blue-400/50 animate-pulse cursor-pointer",
                        // Selected filled
                        isSelected && !isEmpty && !isCornerstone && "border-blue-500 ring-2 ring-blue-400/50 cursor-pointer",
                        // Unselected empty
                        !isSelected && isEmpty && "border-dashed border-border hover:border-foreground/30 cursor-pointer",
                        // Unselected filled (non-cornerstone)
                        !isSelected && !isEmpty && !isCornerstone && "border-border hover:border-foreground/20 cursor-pointer",
                      )}
                    >
                      {isEmpty ? (
                        /* Empty slot: plus icon */
                        <div className="w-full h-full flex items-center justify-center bg-muted/40">
                          <span className="text-xl text-muted-foreground/40 select-none">+</span>
                        </div>
                      ) : (
                        /* Filled slot: headshot */
                        <PlayerHeadshot
                          nba_api_id={occupant!.nba_api_id}
                          size={56}
                          name={occupant!.name}
                        />
                      )}

                      {/* Cornerstone star badge */}
                      {isCornerstone && (
                        <span
                          id={`builder-slot-${slotIndex}-legend-badge`}
                          className="absolute top-0 left-0 bg-amber-400/90 text-white text-[8px] font-bold px-1 py-0.5 rounded-br"
                        >
                          ★
                        </span>
                      )}
                    </div>

                    {/* Name label + remove button — always rendered to keep row height stable */}
                    <div className="flex flex-col items-center gap-0.5 w-full">
                      <p
                        id={`builder-slot-${slotIndex}-name`}
                        className={cn(
                          "text-[9px] text-muted-foreground text-center leading-tight truncate w-full",
                          isEmpty && "invisible",
                        )}
                        title={!isEmpty ? occupant!.name : undefined}
                      >
                        {!isEmpty ? occupant!.name.split(" ").pop() : "\u00A0"}
                      </p>
                      <button
                        id={`builder-slot-${slotIndex}-remove`}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isEmpty) onRemoveSlot(slotIndex);
                        }}
                        className={cn(
                          "text-[9px] text-muted-foreground/60 hover:text-destructive transition-colors",
                          isEmpty && "invisible pointer-events-none",
                        )}
                        aria-label={`Remove player from slot ${slotIndex}`}
                        tabIndex={isEmpty ? -1 : 0}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
