"use client";

/**
 * RotationSlots.tsx — Row of 8 player headshot slots for the Team Builder.
 *
 * All 8 slots hold PlayerWithSkills objects (legend or active player).
 * The cornerstone legend is identified by cornerstoneId and receives a star badge.
 * Clicking an empty slot enters selection mode (highlighted ring).
 * Clicking a filled slot while another is selected swaps the two occupants.
 * Each filled slot has an ✕ remove button.
 * Supports HTML5 drag-and-drop: players dragged from the picker panel can be
 * dropped onto any non-legend slot; filled slots can be dragged onto other slots
 * to reorder (including the legend slot).
 */

import { cn } from "@/lib/utils";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { MAX_ROSTER_SLOTS } from "@/lib/builder-config";
import type { PlayerWithSkills } from "@/lib/types";

interface RotationSlotsProps {
  /** All 8 slots (index 0 = slot 1). Each entry is a player, legend, or null. */
  allSlots: (PlayerWithSkills | null)[];
  /** ID of the cornerstone legend — the matching slot shows the star badge. */
  cornerstoneId: string | null;
  /** Index of the currently selected slot (1-based). null = no selection. */
  selectedSlot: number | null;
  onSlotClick: (slotIndex: number) => void;
  onRemoveSlot: (slotIndex: number) => void;
  /** Called when a player is dropped onto a slot from the picker panel. */
  onDropPlayer: (slotIndex: number, player: PlayerWithSkills) => void;
  /** Called when a filled slot is dragged onto another slot — swaps the two occupants. */
  onSwapSlots?: (fromSlot: number, toSlot: number) => void;
  /** Called on headshot mouseenter — passes slot index (1-based) and salary for gauge highlight. */
  onSlotHover?: (slotIndex: number, salary: number | null) => void;
  /** Called on headshot mouseleave — clears gauge preview. */
  onSlotHoverEnd?: () => void;
}

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
  // Normalize to exactly MAX_ROSTER_SLOTS entries
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
    <div id="builder-rotation-slots" className="flex gap-2 overflow-x-auto pb-1 justify-center">
      {Array.from({ length: MAX_ROSTER_SLOTS }, (_, i) => {
        const slotIndex = i + 1; // 1-based
        const occupant = slots[i] ?? null;
        const isSelected = selectedSlot === slotIndex;
        const isEmpty = !occupant;
        const isCornerstone = !isEmpty && occupant!.id === cornerstoneId;

        return (
          <div
            key={slotIndex}
            id={`builder-slot-${slotIndex}`}
            className="flex-shrink-0 flex flex-col items-center gap-1"
            style={{ width: 64 }}
          >
            {/* Slot number label */}
            <span className="text-[10px] text-muted-foreground font-medium">{slotIndex}</span>

            {/* Slot button — all filled slots are draggable (legend included) */}
            <div
              role="button"
              tabIndex={0}
              aria-label={isEmpty ? `Slot ${slotIndex}: empty` : `Slot ${slotIndex}: occupied`}
              draggable={!isEmpty}
              onDragStart={!isEmpty ? (e) => {
                // Tag drag as originating from a slot so drop handler routes to swap
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
                // Pass null for the legend's salary — BuilderPage substitutes LEGEND_SALARY
                const salary = isCornerstone ? null : (occupant!.salary ?? null);
                onSlotHover(slotIndex, salary);
              } : undefined}
              onMouseLeave={!isEmpty ? onSlotHoverEnd : undefined}
              className={cn(
                "relative w-14 h-14 rounded-lg overflow-hidden cursor-pointer transition-all",
                "border-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSelected && isEmpty && "border-blue-500 ring-2 ring-blue-400/50 animate-pulse",
                isSelected && !isEmpty && "border-blue-500 ring-2 ring-blue-400/50",
                !isSelected && isEmpty && "border-dashed border-border hover:border-foreground/30",
                !isSelected && !isEmpty && "border-border hover:border-foreground/20",
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

            {/* Name label + remove button */}
            <div className="flex flex-col items-center gap-0.5 w-full">
              {!isEmpty && (
                <>
                  <p
                    id={`builder-slot-${slotIndex}-name`}
                    className="text-[9px] text-muted-foreground text-center leading-tight truncate w-full text-center"
                    title={occupant!.name}
                  >
                    {occupant!.name.split(" ").pop()}
                  </p>
                  <button
                    id={`builder-slot-${slotIndex}-remove`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveSlot(slotIndex);
                    }}
                    className="text-[9px] text-muted-foreground/60 hover:text-destructive transition-colors"
                    aria-label={`Remove player from slot ${slotIndex}`}
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
