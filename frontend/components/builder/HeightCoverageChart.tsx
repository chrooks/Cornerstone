"use client";

/**
 * HeightCoverageChart.tsx — Visual guard-range coverage chart for the debug panel.
 *
 * Shows a horizontal bar for each player spanning their height-guard range
 * (height ± VD-tier offset) over the 6'0"–7'2" target window.
 * A coverage strip at the top highlights uncovered holes in red.
 *
 * Each cell in the chart represents one inch of height.
 */

import { cn } from "@/lib/utils";
import type { HeightCoverageData } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert inches to a readable feet-inches label (e.g. 76 → "6'4\"") */
function inToLabel(inches: number): string {
  const ft = Math.floor(inches / 12);
  const inch = inches % 12;
  return `${ft}'${inch}"`;
}

/** Tailwind color classes per VD tier */
function tierBarColor(tier: string): string {
  switch (tier) {
    case "All-Time Great": return "bg-amber-400";
    case "Elite":          return "bg-violet-500";
    case "Proficient":     return "bg-blue-500";
    case "Capable":        return "bg-sky-400";
    default:               return "bg-slate-500";
  }
}

/** Tailwind text badge classes per VD tier */
function tierBadgeClass(tier: string): string {
  switch (tier) {
    case "All-Time Great": return "text-amber-400";
    case "Elite":          return "text-violet-400";
    case "Proficient":     return "text-blue-400";
    case "Capable":        return "text-sky-400";
    default:               return "text-slate-500";
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface CoverageStripProps {
  targetLow: number;
  targetHigh: number;
  holes: Set<number>;
}

/**
 * A single-row heat strip showing each inch as green (covered) or red (hole).
 * Labels every other major inch to avoid crowding (6'0", 6'2", etc.).
 */
function CoverageStrip({ targetLow, targetHigh, holes }: CoverageStripProps) {
  const inches = Array.from({ length: targetHigh - targetLow + 1 }, (_, i) => targetLow + i);

  return (
    <div id="hcc-coverage-strip" className="flex flex-col gap-0.5">
      {/* Label row — every 2 inches */}
      <div className="flex" style={{ gap: 0 }}>
        {inches.map((inch) => (
          <div
            key={inch}
            className="flex-1 text-center"
            style={{ minWidth: 0 }}
          >
            {inch % 2 === 0 && (
              <span className="text-[8px] text-muted-foreground/60 font-mono leading-none">
                {inToLabel(inch)}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Color cells */}
      <div className="flex h-3 rounded overflow-hidden">
        {inches.map((inch) => (
          <div
            key={inch}
            id={`hcc-strip-${inch}`}
            className={cn(
              "flex-1",
              holes.has(inch) ? "bg-red-500/70" : "bg-green-500/70",
            )}
            title={`${inToLabel(inch)} — ${holes.has(inch) ? "uncovered" : "covered"}`}
          />
        ))}
      </div>
    </div>
  );
}

interface PlayerRowProps {
  name: string;
  isCornerstone: boolean;
  heightStr: string | null;
  vdTier: string;
  /** Perimeter disruptor tier — extends the lower bound when Proficient+ */
  pdTier: string;
  rangeLow: number | null;
  rangeHigh: number | null;
  targetLow: number;
  targetHigh: number;
}

/**
 * One player row: name + tier badge on the left, range bar on the right.
 * The bar is positioned proportionally within [targetLow, targetHigh].
 */
/** Inches added to the lower bound by perimeter_disruptor tier */
const PD_LOW_BONUS: Record<string, number> = {
  "None": 0, "Capable": 0, "Proficient": 1, "Elite": 2, "All-Time Great": 4,
};

function PlayerRow({
  name,
  isCornerstone,
  heightStr,
  vdTier,
  pdTier,
  rangeLow,
  rangeHigh,
  targetLow,
  targetHigh,
}: PlayerRowProps) {
  const totalInches = targetHigh - targetLow + 1;

  // Clamp range to the target window for display
  const clampedLow  = rangeLow  != null ? Math.max(rangeLow,  targetLow)  : null;
  const clampedHigh = rangeHigh != null ? Math.min(rangeHigh, targetHigh) : null;

  // CSS % offsets within the bar
  const leftPct  = clampedLow  != null ? ((clampedLow  - targetLow) / totalInches) * 100 : null;
  const widthPct = clampedLow  != null && clampedHigh != null
    ? ((clampedHigh - clampedLow + 1) / totalInches) * 100
    : 0;

  const lastName = name.split(" ").pop() ?? name;
  const pdBonus = PD_LOW_BONUS[pdTier] ?? 0;
  const hasPdBonus = pdBonus > 0;

  // Tooltip: show range breakdown including PD contribution
  const rangeLabel = rangeLow != null && rangeHigh != null
    ? `${inToLabel(rangeLow)}–${inToLabel(rangeHigh)}${hasPdBonus ? ` (+${pdBonus}" from PD ${pdTier})` : ""}`
    : "no height";

  return (
    <div id={`hcc-player-${name.replace(/\s+/g, "-").toLowerCase()}`} className="flex items-center gap-2">
      {/* Label */}
      <div className="w-28 flex-shrink-0 flex flex-col">
        <span className="text-[9px] text-foreground truncate font-medium">
          {lastName}
          {isCornerstone && (
            <span className="ml-1 text-amber-400 text-[8px]">★</span>
          )}
        </span>
        <span className={cn("text-[8px] font-mono", tierBadgeClass(vdTier))}>
          {heightStr ?? "—"} · {vdTier === "None" ? "No VD" : vdTier}
          {/* Show PD tier when it adds range */}
          {hasPdBonus && (
            <span className="text-orange-400 ml-1">+PD</span>
          )}
        </span>
      </div>

      {/* Bar */}
      <div className="relative flex-1 h-4 bg-muted/40 rounded overflow-hidden" title={rangeLabel}>
        {leftPct != null && widthPct > 0 ? (
          <div
            className={cn("absolute top-0 h-full rounded opacity-80", tierBarColor(vdTier))}
            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
          />
        ) : (
          <span className="absolute inset-0 flex items-center pl-1.5 text-[8px] text-muted-foreground/50">
            no height
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HeightCoverageChart
// ---------------------------------------------------------------------------

interface HeightCoverageChartProps {
  data: HeightCoverageData;
}

export function HeightCoverageChart({ data }: HeightCoverageChartProps) {
  const { players, target_low, target_high, holes, full_coverage } = data;
  const holeSet = new Set(holes);

  return (
    <div id="height-coverage-chart" className="flex flex-col gap-2 p-3 rounded border border-border/50 bg-muted/10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span id="hcc-title" className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest">
          Height Coverage ({inToLabel(target_low)}–{inToLabel(target_high)})
        </span>
        <span
          id="hcc-status"
          className={cn(
            "text-[9px] font-mono font-bold",
            full_coverage ? "text-green-400" : "text-red-400",
          )}
        >
          {full_coverage ? "Full Coverage" : `${holes.length} hole${holes.length !== 1 ? "s" : ""}`}
        </span>
      </div>

      {/* Coverage heat strip */}
      <CoverageStrip
        targetLow={target_low}
        targetHigh={target_high}
        holes={holeSet}
      />

      {/* Divider */}
      <div className="border-t border-border/30" />

      {/* Player rows */}
      <div id="hcc-player-rows" className="flex flex-col gap-1.5">
        {players.map((p) => (
          <PlayerRow
            key={p.name}
            name={p.name}
            isCornerstone={p.is_cornerstone}
            heightStr={p.height_str}
            vdTier={p.vd_tier}
            pdTier={p.pd_tier}
            rangeLow={p.range_low}
            rangeHigh={p.range_high}
            targetLow={target_low}
            targetHigh={target_high}
          />
        ))}
      </div>
    </div>
  );
}
