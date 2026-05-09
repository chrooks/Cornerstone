"use client";

/**
 * CourtStrip.tsx — Full-width horizontal Rotation strip for the Build page.
 *
 * Two rows:
 *   1. SalaryCap gauge (full width)
 *   2. Centered slot row: starters [1-5] | divider | bench [6-9]
 *
 * Always compact single row. No arc layout (reserved for Eval page).
 * Subtle vertical divider between slot 5 and slot 6 marks the
 * Starting Lineup / bench boundary.
 */

import { cn } from "@/lib/utils";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { SalaryGauge } from "./SalaryGauge";
import { SALARY_CAP, MAX_ROSTER_SLOTS } from "@/lib/builder-config";
import type { PlayerWithSkills } from "@/lib/types";

// ---------------------------------------------------------------------------
// Tier configuration — ring color per slot tier
// ---------------------------------------------------------------------------

interface TierConfig {
  ring: string;
  soft: string;
  fg: string;
}

function getSlotTier(slot: number): TierConfig {
  if (slot === 1) return { ring: "#e6b03a", soft: "#fbe9bd", fg: "#8a6710" };
  if (slot <= 5)  return { ring: "#2d4f6f", soft: "#d4e9f4", fg: "#2d4f6f" };
  return            { ring: "#9a938a", soft: "#e9e4dc", fg: "#6b645b" };
}

// ---------------------------------------------------------------------------
// Slot sizes
// ---------------------------------------------------------------------------

const SLOT_SIZE = 56;
const CORNERSTONE_SIZE = 68;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CourtStripProps {
  allSlots: (PlayerWithSkills | null)[];
  cornerstoneId: string | null;
  focusedPlayerName: string | null;
  /* Salary props for the integrated SalaryGauge */
  usedSalary: number;
  highlightRange: { startFrac: number; endFrac: number } | null;
  pickerHoveredSalary: number | null;
  onSalaryCapFilterClick: (max: number) => void;
  /* Slot interaction handlers */
  onSlotClick: (slotIndex: number) => void;
  onRemoveSlot: (slotIndex: number) => void;
  onDropPlayer: (slotIndex: number, player: PlayerWithSkills) => void;
  onSwapSlots?: (fromSlot: number, toSlot: number) => void;
  onSlotHover?: (slotIndex: number) => void;
  onSlotHoverEnd?: () => void;
}

// ---------------------------------------------------------------------------
// SlotCircle — individual slot in the strip
// ---------------------------------------------------------------------------

function SlotCircle({
  slotIndex,
  occupant,
  size,
  isCornerstone,
  isFocused,
  onClick,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  onMouseEnter,
  onMouseLeave,
}: {
  slotIndex: number;
  occupant: PlayerWithSkills | null;
  size: number;
  isCornerstone: boolean;
  isFocused: boolean;
  onClick: () => void;
  onRemove: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const tier = getSlotTier(slotIndex);
  const isEmpty = !occupant;
  const ringWidth = isCornerstone ? 3 : 2;

  const name = occupant?.name ?? "";
  const parts = name.split(" ");
  const lastName = parts.slice(1).join(" ") || parts[0] || "";

  return (
    <div
      id={`builder-slot-${slotIndex}`}
      role="button"
      tabIndex={isCornerstone ? -1 : 0}
      aria-label={
        isEmpty
          ? `Slot ${slotIndex}: empty`
          : isCornerstone
            ? `Slot ${slotIndex}: ${name} (cornerstone)`
            : `Slot ${slotIndex}: ${name}`
      }
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
      draggable={!isEmpty && !isCornerstone}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="flex flex-col items-start gap-0 cursor-pointer select-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md"
    >
      {/* Slot number chip */}
      <div id={`builder-slot-${slotIndex}-tab`} className="flex justify-start" style={{ width: size }}>
        <div
          className="text-[0.5625rem] font-bold tracking-wider rounded-none px-1.5 leading-4"
          style={{ color: tier.fg, background: tier.soft, border: `1px solid ${tier.ring}` }}
        >
          {String(slotIndex).padStart(2, "0")}
        </div>
      </div>

      {/* Circle */}
      <div className="relative" style={{ width: size, height: size }}>
        {isEmpty ? (
          <div
            className="w-full h-full rounded-none flex items-center justify-center text-lg font-light"
            style={{ border: `1.5px dashed ${tier.ring}`, background: "#fbfaf7", color: "#9a938a" }}
          >
            +
          </div>
        ) : (
          <div
            className={cn(
              "w-full h-full rounded-none overflow-hidden bg-white transition-all duration-150",
              isFocused && "scale-105",
            )}
            style={{
              boxShadow: isFocused
                ? `0 0 0 ${ringWidth}px ${tier.ring}, 0 0 0 ${ringWidth + 3}px #ffa05c`
                : `0 0 0 ${ringWidth}px ${tier.ring}`,
            }}
          >
            <PlayerHeadshot nba_api_id={occupant.nba_api_id} size={size} name={occupant.name} className="!rounded-none" />
          </div>
        )}

        {isCornerstone && (
          <span className="absolute -top-1 -right-1 bg-[#ffa05c] text-[#0e0907] text-[8px] font-bold w-4 h-4 rounded-sm flex items-center justify-center">
            ★
          </span>
        )}

        {!isEmpty && !isCornerstone && (
          <button
            id={`builder-slot-${slotIndex}-remove`}
            type="button"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="absolute -right-2 -bottom-2 flex h-5 w-5 items-center justify-center rounded-sm border border-[#d9d0c9] bg-[#f7f7f7] text-[11px] font-semibold text-[#0e0907]/65 transition-colors hover:border-[#e53e3e] hover:bg-[#e53e3e] hover:text-[#f8f3f1]"
            aria-label={`Remove ${name}`}
          >
            ×
          </button>
        )}
      </div>

      {/* Name label */}
      <div className="text-center leading-none self-center mt-2" style={{ maxWidth: size + 20 }}>
        {isEmpty ? (
          <div className="text-[0.5625rem] font-medium tracking-wider" style={{ color: "#9a938a" }}>OPEN</div>
        ) : (
          <div className="flex flex-col items-center">
            <div className="text-[0.625rem] font-semibold text-[#0e0907] truncate max-w-[72px]">{lastName}</div>
            <div className="flex items-center gap-0.5">
              <span className="text-[0.5rem] font-semibold mt-1 tracking-wider text-[#0e0907]/35">
                {occupant.position ?? "—"}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CourtStrip — main export
// ---------------------------------------------------------------------------

export function CourtStrip({
  allSlots,
  cornerstoneId,
  focusedPlayerName,
  usedSalary,
  highlightRange,
  pickerHoveredSalary,
  onSalaryCapFilterClick,
  onSlotClick,
  onRemoveSlot,
  onDropPlayer,
  onSwapSlots,
  onSlotHover,
  onSlotHoverEnd,
}: CourtStripProps) {
  const slots = allSlots.slice(0, MAX_ROSTER_SLOTS);
  const filledCount = slots.filter(Boolean).length;

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  function handleDrop(e: React.DragEvent, targetSlotIndex: number) {
    e.preventDefault();
    const sourceSlotRaw = e.dataTransfer.getData("application/builder-slot");
    const playerRaw = e.dataTransfer.getData("application/builder-player");

    if (sourceSlotRaw) {
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
      } catch { /* malformed drag data */ }
    }
  }

  function makeDragStart(slotIndex: number, occupant: PlayerWithSkills) {
    return (e: React.DragEvent) => {
      e.dataTransfer.setData("application/builder-slot", String(slotIndex));
      e.dataTransfer.setData("application/builder-player", JSON.stringify(occupant));
      e.dataTransfer.effectAllowed = "move";
    };
  }

  function renderSlot(slot: number) {
    const occupant = slots[slot - 1] ?? null;
    const isCornerstone = !!occupant && occupant.id === cornerstoneId;
    const isFocused = !!occupant && occupant.name === focusedPlayerName;
    return (
      <SlotCircle
        key={slot}
        slotIndex={slot}
        occupant={occupant}
        size={slot === 1 ? CORNERSTONE_SIZE : SLOT_SIZE}
        isCornerstone={isCornerstone}
        isFocused={isFocused}
        onClick={() => onSlotClick(slot)}
        onRemove={() => onRemoveSlot(slot)}
        onDragStart={occupant && !isCornerstone ? makeDragStart(slot, occupant) : undefined}
        onDragOver={handleDragOver}
        onDrop={(e) => handleDrop(e, slot)}
        onMouseEnter={onSlotHover ? () => onSlotHover(slot) : undefined}
        onMouseLeave={onSlotHoverEnd}
      />
    );
  }

  return (
    <div
      id="builder-court-strip"
      className="border border-[#d9d0c9] bg-[#f7f7f7] rounded-lg overflow-hidden"
    >
      {/* Row 1: SalaryCap gauge — full width with hover preview */}
      <div className="px-5 pt-3 pb-1.5 border-b border-[#d9d0c9]/50">
        <SalaryGauge
          usedSalary={usedSalary}
          cap={SALARY_CAP}
          highlightRange={highlightRange}
          previewSalary={pickerHoveredSalary}
          onRemainingClick={(max) => onSalaryCapFilterClick(max)}
        />
      </div>

      {/* Row 2: Centered slot row with starter/bench divider */}
      <div className="px-6 py-3 flex items-center justify-center">
        {/* Left label */}
        <div className="flex flex-col items-start mr-4 shrink-0">
          <span className="text-[0.5625rem] font-semibold tracking-[1.5px] uppercase text-[#9a938a]">
            Rotation
          </span>
          <span className="font-mono text-[0.625rem] tabular-nums text-[#0e0907]/35">
            {filledCount} / {MAX_ROSTER_SLOTS}
          </span>
        </div>

        {/* Starter slots (1-5) — wider gaps */}
        <div className="flex items-start gap-3">
          {[1, 2, 3, 4, 5].map(renderSlot)}
        </div>

        {/* Starter/bench divider */}
        <div className="flex flex-col items-center mx-4 self-stretch">
          <div className="flex-1 w-px bg-[#d9d0c9]" />
          <span className="text-[0.5rem] font-semibold tracking-[1px] uppercase text-[#9a938a] py-1">
            Bench
          </span>
          <div className="flex-1 w-px bg-[#d9d0c9]" />
        </div>

        {/* Bench slots (6-9) — wider gaps */}
        <div className="flex items-start gap-3">
          {[6, 7, 8, 9].map(renderSlot)}
        </div>
      </div>
    </div>
  );
}
