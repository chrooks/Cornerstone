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

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { SalaryGauge } from "./SalaryGauge";
import { DEFAULT_SALARY_CAP, DEFAULT_MAX_ROSTER_SLOTS } from "@/lib/builder-config";
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
const SLOT_DRAG_THRESHOLD_PX = 6;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CourtStripProps {
  allSlots: (PlayerWithSkills | null)[];
  cornerstoneId: string | null;
  focusedPlayerName: string | null;
  /* Salary props for the integrated SalaryGauge */
  usedSalary: number;
  salaryCap?: number | null;
  maxRosterSlots?: number;
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
  onSlotContextMenu?: (slotIndex: number) => void;
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
  isDragging,
  onClick,
  onRemove,
  onPointerDown,
  onDragOver,
  onDrop,
  onContextMenu,
  onMouseEnter,
  onMouseLeave,
}: {
  slotIndex: number;
  occupant: PlayerWithSkills | null;
  size: number;
  isCornerstone: boolean;
  isFocused: boolean;
  isDragging: boolean;
  onClick: () => void;
  onRemove: () => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
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
      data-builder-slot-index={slotIndex}
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
      draggable={false}
      onPointerDown={onPointerDown}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        "flex flex-col items-start gap-0 select-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md",
        isDragging ? "cursor-grabbing" : !isEmpty && !isCornerstone ? "cursor-grab" : "cursor-pointer",
      )}
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

        {/* Cornerstone removal is destructive (clears the Build) — BuilderPage gates it behind a confirm (#91) */}
        {!isEmpty && (
          <button
            id={`builder-slot-${slotIndex}-remove`}
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
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
  salaryCap = DEFAULT_SALARY_CAP,
  maxRosterSlots = DEFAULT_MAX_ROSTER_SLOTS,
  highlightRange,
  pickerHoveredSalary,
  onSalaryCapFilterClick,
  onSlotClick,
  onRemoveSlot,
  onDropPlayer,
  onSwapSlots,
  onSlotHover,
  onSlotHoverEnd,
  onSlotContextMenu,
}: CourtStripProps) {
  const slots = allSlots.slice(0, maxRosterSlots);
  const filledCount = slots.filter(Boolean).length;
  const slotDragRef = useRef<{
    sourceSlot: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const [draggingSlot, setDraggingSlot] = useState<number | null>(null);

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

  function handleSlotPointerDown(e: React.PointerEvent, sourceSlot: number) {
    if (e.button !== 0 || !onSwapSlots) return;

    slotDragRef.current = {
      sourceSlot,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const drag = slotDragRef.current;
      if (!drag) return;

      const moved =
        Math.hypot(moveEvent.clientX - drag.startX, moveEvent.clientY - drag.startY) >=
        SLOT_DRAG_THRESHOLD_PX;

      if (!drag.active && moved) {
        drag.active = true;
        setDraggingSlot(drag.sourceSlot);
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
      }

      if (drag.active) moveEvent.preventDefault();
    };

    const finishPointerDrag = (upEvent: PointerEvent) => {
      const drag = slotDragRef.current;
      if (drag?.active) {
        const target = document
          .elementFromPoint(upEvent.clientX, upEvent.clientY)
          ?.closest<HTMLElement>("[data-builder-slot-index]");
        const targetSlot = Number(target?.dataset.builderSlotIndex);

        if (Number.isFinite(targetSlot) && targetSlot !== drag.sourceSlot) {
          onSwapSlots(drag.sourceSlot, targetSlot);
        }

        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }

      slotDragRef.current = null;
      setDraggingSlot(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishPointerDrag);
      window.removeEventListener("pointercancel", cancelPointerDrag);
    };

    const cancelPointerDrag = () => {
      slotDragRef.current = null;
      setDraggingSlot(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishPointerDrag);
      window.removeEventListener("pointercancel", cancelPointerDrag);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishPointerDrag);
    window.addEventListener("pointercancel", cancelPointerDrag);
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
        size={slot === 1 && cornerstoneId ? CORNERSTONE_SIZE : SLOT_SIZE}
        isCornerstone={isCornerstone}
        isFocused={isFocused}
        isDragging={draggingSlot === slot}
        onClick={() => {
          if (suppressClickRef.current) return;
          onSlotClick(slot);
        }}
        onRemove={() => onRemoveSlot(slot)}
        onPointerDown={occupant && !isCornerstone ? (e) => handleSlotPointerDown(e, slot) : undefined}
        onDragOver={handleDragOver}
        onDrop={(e) => handleDrop(e, slot)}
        onContextMenu={occupant ? (event) => {
          event.preventDefault();
          onSlotContextMenu?.(slot);
        } : undefined}
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
      {/* Row 1: SalaryCap gauge (hidden when uncapped) */}
      {salaryCap != null && (
      <div className="border-b border-[#d9d0c9]/50 px-3 pb-2 pt-3 sm:px-5 sm:pb-1.5">
        <SalaryGauge
          usedSalary={usedSalary}
          cap={salaryCap}
          highlightRange={highlightRange}
          previewSalary={pickerHoveredSalary}
          onRemainingClick={(max) => onSalaryCapFilterClick(max)}
        />
      </div>
      )}

      {/* Row 2: Centered slot row with starter/bench divider */}
      <div id="builder-court-strip-scroll" className="overflow-x-auto [scrollbar-color:rgba(14,9,7,0.18)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-sm [&::-webkit-scrollbar-thumb]:bg-[#0e0907]/15">
        <div id="builder-court-strip-row" className="flex w-max min-w-full items-center justify-start px-3 py-3 sm:justify-center sm:px-6">
          {/* Left label */}
          <div className="mr-3 flex shrink-0 flex-col items-start sm:mr-4">
            <span className="text-[0.5625rem] font-semibold uppercase tracking-[1.5px] text-[#9a938a]">
              {maxRosterSlots <= 5 ? "Lineup" : maxRosterSlots <= 9 ? "Rotation" : "Roster"}
            </span>
            <span className="font-mono text-[0.625rem] tabular-nums text-[#0e0907]/35">
              {filledCount} / {maxRosterSlots}
            </span>
          </div>

          {/* Starter slots (1-5) */}
          <div id="builder-court-strip-starters" className="flex items-start gap-2 sm:gap-3">
            {Array.from({ length: Math.min(maxRosterSlots, 5) }, (_, i) => i + 1).map(renderSlot)}
          </div>

          {/* Bench slots (6+) — only when maxRosterSlots > 5 */}
          {maxRosterSlots > 5 && (
            <>
              {/* Starter/bench divider */}
              <div id="builder-court-strip-bench-divider" className="mx-3 flex self-stretch flex-col items-center sm:mx-4">
                <div className="w-px flex-1 bg-[#d9d0c9]" />
                <span className="py-1 text-[0.5rem] font-semibold uppercase tracking-[1px] text-[#9a938a]">
                  Bench
                </span>
                <div className="w-px flex-1 bg-[#d9d0c9]" />
              </div>

              <div id="builder-court-strip-bench" className="flex items-start gap-2 sm:gap-3">
                {Array.from({ length: maxRosterSlots - 5 }, (_, i) => i + 6).map(renderSlot)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
