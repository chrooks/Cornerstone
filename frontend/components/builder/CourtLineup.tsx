"use client";

/**
 * CourtLineup.tsx — On-court hierarchical lineup visualization.
 *
 * Replaces the flat RotationSlots with a spatial court layout matching the
 * Claude Design handoff ("Cornerstone Builder.html"):
 *   - Slots 1-5 in a [4][2][1][3][5] arc, cornerstone centered + largest
 *   - Circular player cards with tier-colored ring borders
 *   - Slots 6-9 in a centered bench row below
 *
 * Tier color language:
 *   Slot 1 (Cornerstone) — Gold ring (#e6b03a)
 *   Slot 2 (Co-Star)     — Sky blue ring (#6fb3d9)
 *   Slots 3-5 (Starters) — Navy ring (#2d4f6f)
 *   Slots 6-9 (Bench)    — Stone ring (#9a938a)
 *
 * Preserves all drag-drop, click, hover, and remove interactions.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { MAX_ROSTER_SLOTS } from "@/lib/builder-config";
import type { PlayerWithSkills } from "@/lib/types";

// ---------------------------------------------------------------------------
// Tier configuration — ring color, soft background, text color per slot tier
// ---------------------------------------------------------------------------

interface TierConfig {
  ring: string;
  soft: string;
  fg: string;
}

function getSlotTier(slot: number): TierConfig {
  if (slot === 1) return { ring: "#e6b03a", soft: "#fbe9bd", fg: "#8a6710" };
  if (slot === 2) return { ring: "#6fb3d9", soft: "#d4e9f4", fg: "#2a6a92" };
  if (slot <= 5)  return { ring: "#2d4f6f", soft: "#c9d5e1", fg: "#2d4f6f" };
  return            { ring: "#9a938a", soft: "#e9e4dc", fg: "#6b645b" };
}

// ---------------------------------------------------------------------------
// Court layout constants
// ---------------------------------------------------------------------------

/** Render order for the starting 5: [4][2][1][3][5] places cornerstone center */
const COURT_ORDER = [4, 2, 1, 3, 5];

/** Circular card diameter (px) per starting slot */
const COURT_SIZES: Record<number, number> = { 1: 80, 2: 64, 3: 64, 4: 52, 5: 52 };

/** Vertical lift (-translateY) to create the court arc effect */
const COURT_LIFT: Record<number, number> = { 1: 0, 2: 8, 3: 8, 4: 16, 5: 16 };

/** Bench card diameter */
const BENCH_SIZE = 40;

/** Compact row card diameter — slightly larger for the cornerstone slot. */
const COMPACT_ROW_SIZE = 48;
const COMPACT_ROW_CORNERSTONE_SIZE = 64;

/** Switch to a single-row roster when the panel gets too cramped for the court layout. */
const COMPACT_LAYOUT_MIN_WIDTH = 760;
const COMPACT_LAYOUT_MIN_HEIGHT = 260;

// ---------------------------------------------------------------------------
// Props — same interaction surface as RotationSlots
// ---------------------------------------------------------------------------

interface CourtLineupProps {
  allSlots: (PlayerWithSkills | null)[];
  cornerstoneId: string | null;
  selectedSlot: number | null;
  onSlotClick: (slotIndex: number) => void;
  onRemoveSlot: (slotIndex: number) => void;
  onDropPlayer: (slotIndex: number, player: PlayerWithSkills) => void;
  onSwapSlots?: (fromSlot: number, toSlot: number) => void;
  onSlotHover?: (slotIndex: number, salary: number | null) => void;
  onSlotHoverEnd?: () => void;
}

// ---------------------------------------------------------------------------
// SlotCircle — circular player card with tier ring, chip, and name label
// ---------------------------------------------------------------------------

interface SlotCircleProps {
  slotIndex: number;
  occupant: PlayerWithSkills | null;
  size: number;
  isCornerstone: boolean;
  isSelected: boolean;
  onClick: () => void;
  onRemove: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

function SlotCircle({
  slotIndex,
  occupant,
  size,
  isCornerstone,
  isSelected,
  onClick,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  onMouseEnter,
  onMouseLeave,
}: SlotCircleProps) {
  const tier = getSlotTier(slotIndex);
  const isEmpty = !occupant;
  const ringWidth = slotIndex === 1 ? 3 : 2;

  // Split name for first/last name display
  const name = occupant?.name ?? "";
  const parts = name.split(" ");
  const firstName = parts[0] ?? "";
  const lastName = parts.slice(1).join(" ");

  return (
    <div
      id={`builder-slot-${slotIndex}`}
      role="button"
      tabIndex={isCornerstone ? -1 : 0}
      aria-label={
        isEmpty
          ? `Slot ${slotIndex}: empty — click to select`
          : isCornerstone
            ? `Slot ${slotIndex}: ${name} (cornerstone, locked)`
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
      className={cn(
        "flex flex-col items-center gap-1 cursor-pointer select-none outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-full",
      )}
    >
      {/* Slot number chip — colored by tier */}
      <div
        id={`builder-slot-${slotIndex}-chip`}
        className="text-[10px] font-bold tracking-wider rounded-full px-2 leading-4"
        style={{
          color: tier.fg,
          background: tier.soft,
          border: `1px solid ${tier.ring}`,
        }}
      >
        {String(slotIndex).padStart(2, "0")}
      </div>

      {/* Circular card — ring border + headshot or empty state */}
      <div className="relative" style={{ width: size, height: size }}>
        {isEmpty ? (
          /* Empty slot — dashed ring with "+" */
          <div
            id={`builder-slot-${slotIndex}-empty`}
            className={cn(
              "w-full h-full rounded-full flex items-center justify-center text-xl font-light transition-all",
              isSelected && "ring-2 ring-blue-400/50",
            )}
            style={{
              border: `1.5px dashed ${tier.ring}`,
              background: "#fbfaf7",
              color: "#9a938a",
            }}
          >
            +
          </div>
        ) : (
          /* Filled slot — headshot clipped to circle inside tier ring */
          <div
            className={cn(
              "w-full h-full rounded-full overflow-hidden bg-white transition-transform duration-150",
              isSelected && "-translate-y-0.5",
            )}
            style={{
              boxShadow: `0 0 0 ${ringWidth}px ${tier.ring}, 0 4px 14px rgba(30,24,18,.08)`,
            }}
          >
            <PlayerHeadshot
              nba_api_id={occupant.nba_api_id}
              size={size}
              name={occupant.name}
              className="!rounded-full"
            />
          </div>
        )}

        {/* Selection dashed outline */}
        {isSelected && !isEmpty && (
          <div
            className="absolute rounded-full pointer-events-none"
            style={{ inset: -5, border: `2px dashed ${tier.ring}` }}
          />
        )}

        {/* Cornerstone star badge */}
        {isCornerstone && (
          <span
            id={`builder-slot-${slotIndex}-legend-badge`}
            className="absolute -top-0.5 -right-0.5 bg-amber-400/90 text-white text-[8px] font-bold w-5 h-5 rounded-full flex items-center justify-center shadow-sm"
          >
            ★
          </span>
        )}
      </div>

      {/* Name + position label below the circle */}
      <div className="text-center leading-none" style={{ maxWidth: size + 20 }}>
        {isEmpty ? (
          <div className="text-[10px] font-medium tracking-wider" style={{ color: "#9a938a" }}>
            OPEN
          </div>
        ) : (
          <>
            <div className="text-[10px] text-muted-foreground leading-snug">{firstName}</div>
            <div className="text-[11px] font-semibold text-foreground truncate leading-snug">{lastName}</div>
            <div className="flex items-center justify-center gap-0.5">
              <span className="text-[9px] font-semibold tracking-wider text-muted-foreground/60">
                {occupant.position ?? "—"}
              </span>
              {/* Remove button — not shown for cornerstone (locked) */}
              {!isCornerstone && (
                <button
                  id={`builder-slot-${slotIndex}-remove`}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onRemove(); }}
                  className="text-[8px] text-muted-foreground/40 hover:text-destructive transition-colors"
                  aria-label={`Remove ${name} from slot ${slotIndex}`}
                >
                  ✕
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CourtLineup — main export
// ---------------------------------------------------------------------------

export function CourtLineup({
  allSlots,
  cornerstoneId,
  selectedSlot,
  onSlotClick,
  onRemoveSlot,
  onDropPlayer,
  onSwapSlots,
  onSlotHover,
  onSlotHoverEnd,
}: CourtLineupProps) {
  const slots = allSlots.slice(0, MAX_ROSTER_SLOTS);
  const layoutRef = useRef<HTMLDivElement>(null);
  const [layoutSize, setLayoutSize] = useState({ width: 0, height: 0 });

  // -- Shared drag handlers --

  useEffect(() => {
    const node = layoutRef.current;
    if (!node) return;

    const updateLayoutSize = () => {
      setLayoutSize({
        width: node.clientWidth,
        height: node.clientHeight,
      });
    };

    updateLayoutSize();

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setLayoutSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  function handleDrop(e: React.DragEvent, targetSlotIndex: number) {
    e.preventDefault();
    const sourceSlotRaw = e.dataTransfer.getData("application/builder-slot");
    const playerRaw = e.dataTransfer.getData("application/builder-player");

    // Slot-to-slot swap
    if (sourceSlotRaw) {
      const sourceSlotIndex = parseInt(sourceSlotRaw, 10);
      if (!isNaN(sourceSlotIndex) && sourceSlotIndex !== targetSlotIndex) {
        onSwapSlots?.(sourceSlotIndex, targetSlotIndex);
      }
      return;
    }

    // Player drop from picker panel
    if (playerRaw) {
      try {
        const player = JSON.parse(playerRaw) as PlayerWithSkills;
        onDropPlayer(targetSlotIndex, player);
      } catch { /* malformed drag data — ignore */ }
    }
  }

  /** Creates a dragStart handler that tags the drag with slot index + player data */
  function makeDragStart(slotIndex: number, occupant: PlayerWithSkills) {
    return (e: React.DragEvent) => {
      e.dataTransfer.setData("application/builder-slot", String(slotIndex));
      e.dataTransfer.setData("application/builder-player", JSON.stringify(occupant));
      e.dataTransfer.effectAllowed = "move";
    };
  }

  /** Creates a mouseEnter handler that reports hovered slot salary to the parent gauge */
  function makeHoverEnter(slotIndex: number, occupant: PlayerWithSkills | null, isCornerstone: boolean) {
    if (!occupant || !onSlotHover) return undefined;
    return () => {
      const salary = isCornerstone ? null : (occupant.salary ?? null);
      onSlotHover(slotIndex, salary);
    };
  }

  // -- Derived data --

  const benchSlots = Array.from({ length: MAX_ROSTER_SLOTS - 5 }, (_, i) => i + 6);
  const benchFilled = benchSlots.filter((s) => slots[s - 1] != null).length;
  const compactSlots = Array.from({ length: MAX_ROSTER_SLOTS }, (_, i) => i + 1);
  const useCompactRowLayout =
    layoutSize.width > 0 &&
    (layoutSize.width < COMPACT_LAYOUT_MIN_WIDTH || layoutSize.height < COMPACT_LAYOUT_MIN_HEIGHT);

  // -- Shared slot renderer (used by both court and bench) --

  function renderSlot(slotIndex: number, size: number) {
    const occupant = slots[slotIndex - 1] ?? null;
    const isCornerstone = !!occupant && occupant.id === cornerstoneId;
    const isSelected = selectedSlot === slotIndex;

    return (
      <SlotCircle
        key={slotIndex}
        slotIndex={slotIndex}
        occupant={occupant}
        size={size}
        isCornerstone={isCornerstone}
        isSelected={isSelected}
        onClick={() => onSlotClick(slotIndex)}
        onRemove={() => onRemoveSlot(slotIndex)}
        onDragStart={occupant && !isCornerstone ? makeDragStart(slotIndex, occupant) : undefined}
        onDragOver={handleDragOver}
        onDrop={(e) => handleDrop(e, slotIndex)}
        onMouseEnter={makeHoverEnter(slotIndex, occupant, isCornerstone)}
        onMouseLeave={occupant ? onSlotHoverEnd : undefined}
      />
    );
  }

  if (useCompactRowLayout) {
    return (
      <div
        id="builder-court-lineup"
        ref={layoutRef}
        className="h-full min-h-0"
      >
        <div
          id="builder-compact-lineup"
          className="flex h-full min-h-0 flex-col"
          style={{
            background: "linear-gradient(180deg, #fbfaf7 0%, #f5f1e8 100%)",
          }}
        >
          <div
            id="builder-compact-lineup-label"
            className="flex items-center gap-2 px-4 pt-3 text-[10px] font-semibold tracking-[1.5px]"
            style={{ color: "#9a938a" }}
          >
            <span>ROTATION</span>
            <div className="h-px flex-1" style={{ background: "#e9e4dc" }} />
            <span>{slots.filter(Boolean).length} of {MAX_ROSTER_SLOTS} filled</span>
          </div>

          <div id="builder-compact-lineup-scroll" className="min-h-0 flex-1 overflow-x-auto px-4 pb-4 pt-3">
            <div className="flex w-max min-w-full items-start justify-between gap-3">
              {compactSlots.map((slot) => (
                <div key={slot} className="flex-shrink-0">
                  {renderSlot(slot, slot === 1 ? COMPACT_ROW_CORNERSTONE_SIZE : COMPACT_ROW_SIZE)}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id="builder-court-lineup" ref={layoutRef} className="h-full min-h-0">
      {/* ── Starting 5 — arc layout [4][2][1][3][5] ── */}
      <div
        id="builder-court-arc"
        className="relative flex items-end justify-center gap-3 px-4 pt-3 pb-2"
        style={{
          background: "linear-gradient(180deg, #fbfaf7 0%, #f5f1e8 100%)",
          borderBottom: "1px solid #e9e4dc",
        }}
      >
        {/* Faint court arc decoration */}
        <svg
          id="builder-court-arc-svg"
          width="100%"
          height="90"
          viewBox="0 0 600 90"
          preserveAspectRatio="none"
          className="absolute bottom-0 left-0 right-0 opacity-40 pointer-events-none"
          aria-hidden="true"
        >
          <path d="M 0 90 Q 300 20 600 90" fill="none" stroke="#d8d1c5" strokeWidth="1" strokeDasharray="3 4" />
        </svg>

        {/* Starter slots rendered in court order with size hierarchy and vertical offsets */}
        {COURT_ORDER.map((slot) => (
          <div
            key={slot}
            className="relative"
            style={{
              transform: `translateY(-${COURT_LIFT[slot] ?? 0}px)`,
              zIndex: 10 - Math.abs(slot - 1),
            }}
          >
            {renderSlot(slot, COURT_SIZES[slot] ?? 80)}
          </div>
        ))}
      </div>

      {/* ── Bench — slots 6-9 centered ── */}
      <div id="builder-bench-row" className="px-4 py-2 flex flex-col gap-1.5">
        {/* Label with divider line */}
        <div
          id="builder-bench-label"
          className="flex items-center gap-2.5 text-[10px] tracking-[1.5px] font-semibold"
          style={{ color: "#9a938a" }}
        >
          <span>BENCH</span>
          <div className="flex-1 h-px" style={{ background: "#e9e4dc" }} />
          <span>{benchFilled} of {benchSlots.length} filled</span>
        </div>

        {/* Bench slot circles — centered */}
        <div className="flex gap-3.5 items-start justify-center flex-wrap">
          {benchSlots.map((slot) => renderSlot(slot, BENCH_SIZE))}
        </div>
      </div>
    </div>
  );
}
