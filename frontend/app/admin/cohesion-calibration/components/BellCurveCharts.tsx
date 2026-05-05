/**
 * BellCurveCharts — SVG bell curve visualizations for the cohesion calibration page.
 *
 * BellCurveChart: Full-size overlay chart for comparing individual player defensive curves.
 * LineupBellCurveChart: Compact chart showing the current lineup's stacked defensive coverage.
 */

"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  PLAYER_COLORS,
  BELL_MIN_IN,
  BELL_MAX_IN,
} from "@/lib/cohesion-constants";
// subscoreColor not used here — defensive coverage display is purely numeric
import { bellValueAtHeight } from "@/lib/cohesion-bell-curve";
import { defensiveCoverageSubscoreFromRaw } from "@/lib/cohesion-weights";
import type { CohesionExplanationWeights } from "@/lib/cohesion-weights";
import type { PlayerCompositeData, BellCurveData, RpPdBoostInfo, LineupSlot } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple arithmetic mean, returns 0 for empty arrays. */
function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// ---------------------------------------------------------------------------
// BellCurveChart — full-size player overlay
// ---------------------------------------------------------------------------

interface BellCurveChartProps {
  overlayPlayers: BellCurveData[];
  onRemovePlayer: (playerId: string) => void;
  /** Re-fetch all overlay players' bell curves (e.g., after weight changes). */
  onRefresh?: () => void;
  refreshing?: boolean;
}

/** SVG bell curve overlay chart — one line per player. */
export function BellCurveChart({ overlayPlayers, onRemovePlayer, onRefresh, refreshing }: BellCurveChartProps) {
  // Chart dimensions
  const width = 600;
  const height = 300;
  const padX = 40;
  const padY = 30;
  const chartW = width - padX * 2;
  const chartH = height - padY * 2;
  const yMax = 4.0;

  // Coordinate transforms
  const toX = (inches: number) => padX + ((inches - BELL_MIN_IN) / (BELL_MAX_IN - BELL_MIN_IN)) * chartW;
  const toY = (value: number) => padY + chartH - (Math.min(value, yMax) / yMax) * chartH;

  // X-axis tick labels — every 2 inches
  const ticks = Array.from({ length: Math.floor((BELL_MAX_IN - BELL_MIN_IN) / 2) + 1 }, (_, i) => BELL_MIN_IN + i * 2);

  return (
    <div id="cohesion-cal-bellcurve-chart">
      {/* Refresh button — always visible so curves can be refreshed after weight changes */}
      {onRefresh && (
        <div className="flex justify-end mb-1">
          <button
            id="cohesion-cal-bellcurve-refresh"
            type="button"
            onClick={onRefresh}
            disabled={refreshing || overlayPlayers.length === 0}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title="Re-fetch all bell curves (after weight changes)"
          >
            {refreshing ? "Refreshing…" : "Refresh curves"}
          </button>
        </div>
      )}
      <svg
        width={width}
        height={height}
        className="w-full"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Defensive bell curve coverage overlay for selected players"
      >
        {/* Y-axis grid lines + labels at 1, 2, 3, 4 */}
        {[1, 2, 3, 4].map((v) => (
          <g key={v}>
            <line x1={padX} y1={toY(v)} x2={width - padX} y2={toY(v)} stroke="currentColor" strokeOpacity={0.08} />
            <text x={padX - 6} y={toY(v) + 3} textAnchor="end" className="fill-muted-foreground" fontSize={9}>
              {v}
            </text>
            {/* Tier labels on right side */}
            <text x={width - padX + 6} y={toY(v) + 3} textAnchor="start" className="fill-muted-foreground/40" fontSize={8}>
              {v === 1 ? "Cap" : v === 2 ? "Prof" : v === 3 ? "Elite" : "ATG"}
            </text>
          </g>
        ))}

        {/* X-axis labels */}
        {ticks.map((h) => {
          const ft = Math.floor(h / 12);
          const inch = h % 12;
          return (
            <text key={h} x={toX(h)} y={height - 8} textAnchor="middle" className="fill-muted-foreground" fontSize={8}>
              {`${ft}'${inch}"`}
            </text>
          );
        })}

        {/* Player curve paths */}
        {overlayPlayers.map((player, idx) => {
          const color = PLAYER_COLORS[idx % PLAYER_COLORS.length];
          const d = player.curve
            .map((pt, i) => `${i === 0 ? "M" : "L"} ${toX(pt.height).toFixed(1)} ${toY(pt.value).toFixed(1)}`)
            .join(" ");
          return <path key={player.player_id} d={d} fill="none" stroke={color} strokeWidth={2} strokeOpacity={0.85} />;
        })}

        {/* Empty state message */}
        {overlayPlayers.length === 0 && (
          <text x={width / 2} y={height / 2} textAnchor="middle" className="fill-muted-foreground/50" fontSize={12}>
            Search a player and click &quot;Add to Bell Curve&quot;
          </text>
        )}
      </svg>

      {/* Player legend with remove buttons */}
      {overlayPlayers.length > 0 && (
        <div id="cohesion-cal-bellcurve-legend" className="flex flex-wrap items-center gap-2 mt-2">
          {overlayPlayers.map((player, idx) => (
            <button
              key={player.player_id}
              type="button"
              onClick={() => onRemovePlayer(player.player_id)}
              className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer group"
              title={`Remove ${player.name}`}
            >
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: PLAYER_COLORS[idx % PLAYER_COLORS.length] }}
              />
              <span className="group-hover:line-through">{player.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LineupBellCurveChart — compact lineup stacked coverage
// ---------------------------------------------------------------------------

/** Compact defensive bell curve overlay for the current five-player lineup. */
export function LineupBellCurveChart({ lineupSlots, weights, boostedBellCurves, rpPdBoosts = [] }: {
  lineupSlots: LineupSlot[];
  weights: CohesionExplanationWeights;
  /** RP-PD boosted bell curves from the evaluate response — matches the actual engine scoring. */
  boostedBellCurves?: (PlayerCompositeData["bell_curve"] | null)[];
  rpPdBoosts?: RpPdBoostInfo[];
}) {
  const width = 600;
  const height = 150;
  const padX = 34;
  const padY = 18;
  const chartW = width - padX * 2;
  const chartH = height - padY * 2;
  const yMax = 6.0;
  // X-axis ticks every 2 inches
  const ticks = Array.from({ length: Math.floor((BELL_MAX_IN - BELL_MIN_IN) / 2) + 1 }, (_, i) => BELL_MIN_IN + i * 2);
  // Y-axis gridlines at every whole number 1–6
  const yTicks = [1, 2, 3, 4, 5, 6];
  // Use RP-PD boosted bell curves when available (from evaluate response),
  // falling back to raw per-player curves before evaluation has run.
  const effectiveCurves: (PlayerCompositeData["bell_curve"] | null)[] = lineupSlots.map((slot, idx) => {
    if (boostedBellCurves?.[idx]) return boostedBellCurves[idx];
    return slot.bellCurve;
  });

  // Track original slot index alongside filtered players for legend rendering
  const lineupPlayers = lineupSlots
    .map((slot, idx) => ({ slot, originalIdx: idx }))
    .filter(({ slot, originalIdx }) => slot.player && effectiveCurves[originalIdx]);
  const stackedValues = Array.from({ length: BELL_MAX_IN - BELL_MIN_IN + 1 }, (_unused, i) => {
    const heightInches = BELL_MIN_IN + i;
    // Compute stacked coverage using effective (boosted) curves
    const values = effectiveCurves
      .map((curve) => (curve ? bellValueAtHeight(heightInches, curve) : 0))
      .sort((a, b) => b - a);
    const stacked = values.reduce((sum, value, index) => {
      const returnFactor = weights.STACKING_RETURNS[index] ?? weights.STACKING_RETURNS[weights.STACKING_RETURNS.length - 1] ?? 0;
      return sum + value * returnFactor;
    }, 0);
    return { height: heightInches, value: stacked };
  });
  const rawCoverageAverage = average(stackedValues.map((point) => point.value));
  const normalizedCoverage = Math.min(10, defensiveCoverageSubscoreFromRaw(rawCoverageAverage, weights));
  const boostProvider = rpPdBoosts[0];

  // Hovered player id — when a legend item is hovered, that player's line is brought to the front
  const [hoveredPlayerId, setHoveredPlayerId] = useState<string | null>(null);

  const toX = (inches: number) => padX + ((inches - BELL_MIN_IN) / (BELL_MAX_IN - BELL_MIN_IN)) * chartW;
  const toY = (value: number) => padY + chartH - (Math.min(value, yMax) / yMax) * chartH;

  // Build path data for each player so we can render hovered player last (on top)
  const playerPaths = lineupSlots
    .map((slot, idx) => {
      const curve = effectiveCurves[idx];
      if (!slot.player || !curve) return null;
      const color = PLAYER_COLORS[idx % PLAYER_COLORS.length];
      const d = Array.from({ length: BELL_MAX_IN - BELL_MIN_IN + 1 }, (_unused, i) => {
        const h = BELL_MIN_IN + i;
        const value = bellValueAtHeight(h, curve);
        return `${i === 0 ? "M" : "L"} ${toX(h).toFixed(1)} ${toY(value).toFixed(1)}`;
      }).join(" ");
      return { id: slot.player.id, d, color };
    })
    .filter(Boolean) as { id: string; d: string; color: string }[];

  // Sort paths so hovered player renders last (highest z-index in SVG)
  const sortedPaths = hoveredPlayerId
    ? [...playerPaths.filter((p) => p.id !== hoveredPlayerId), ...playerPaths.filter((p) => p.id === hoveredPlayerId)]
    : playerPaths;

  return (
    <div id="cohesion-cal-lineup-bellcurves" className="rounded-md border border-border/70 bg-background/60 p-2 space-y-2">
      <div id="cohesion-cal-lineup-bellcurves-header" className="flex items-center justify-between">
        <span id="cohesion-cal-lineup-bellcurves-title" className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Defensive Bell Curves
        </span>
        <span id="cohesion-cal-lineup-bellcurves-scale" className="text-[9px] text-muted-foreground/70">
          raw avg {rawCoverageAverage.toFixed(2)} {"->"} {normalizedCoverage.toFixed(1)}/10
        </span>
      </div>

      <svg
        id="cohesion-cal-lineup-bellcurves-svg"
        width={width}
        height={height}
        className="w-full"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Defensive bell curve overlay for the current lineup"
      >
        {/* Y-axis gridlines at whole numbers */}
        {yTicks.map((v) => (
          <g key={v} id={`cohesion-cal-lineup-bellcurves-grid-${v}`}>
            <line x1={padX} y1={toY(v)} x2={width - padX} y2={toY(v)} stroke="currentColor" strokeOpacity={0.08} />
            <text x={padX - 6} y={toY(v) + 3} textAnchor="end" className="fill-muted-foreground" fontSize={8}>
              {v}
            </text>
          </g>
        ))}

        {/* X-axis labels every 2 inches */}
        {ticks.map((h) => {
          const ft = Math.floor(h / 12);
          const inch = h % 12;
          return (
            <text key={h} x={toX(h)} y={height - 4} textAnchor="middle" className="fill-muted-foreground" fontSize={7}>
              {`${ft}'${inch}"`}
            </text>
          );
        })}

        {/* Player bell curves — hovered player rendered last for z-index */}
        {sortedPaths.map((p) => (
          <path
            key={p.id}
            id={`cohesion-cal-lineup-bellcurve-${p.id}`}
            d={p.d}
            fill="none"
            stroke={p.color}
            strokeWidth={hoveredPlayerId === p.id ? 3 : 2}
            strokeOpacity={hoveredPlayerId && hoveredPlayerId !== p.id ? 0.3 : 0.9}
          />
        ))}

        {/* Stacked coverage line */}
        <path
          id="cohesion-cal-lineup-bellcurve-stacked"
          d={stackedValues
            .map((point, i) => `${i === 0 ? "M" : "L"} ${toX(point.height).toFixed(1)} ${toY(point.value).toFixed(1)}`)
            .join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeOpacity={hoveredPlayerId ? 0.3 : 0.9}
        />
      </svg>

      {/* Legend with hover interaction */}
      <div id="cohesion-cal-lineup-bellcurves-legend" className="flex flex-wrap gap-2">
        <span id="cohesion-cal-lineup-bellcurves-legend-stacked" className="inline-flex items-center gap-1.5 text-[9px] font-semibold text-foreground">
          <span className="inline-block w-4 h-0.5 rounded-full bg-current" />
          <span>Stacked coverage</span>
        </span>
        {lineupPlayers.map(({ slot, originalIdx }) => {
          const curve = effectiveCurves[originalIdx];
          return (
            <span
              key={slot.player?.id}
              id={`cohesion-cal-lineup-bellcurves-legend-${slot.player?.id}`}
              className={cn(
                "inline-flex items-center gap-1.5 text-[9px] cursor-pointer transition-opacity",
                hoveredPlayerId && hoveredPlayerId !== slot.player?.id ? "opacity-40" : "text-muted-foreground",
              )}
              onMouseEnter={() => setHoveredPlayerId(slot.player?.id ?? null)}
              onMouseLeave={() => setHoveredPlayerId(null)}
            >
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: PLAYER_COLORS[originalIdx % PLAYER_COLORS.length] }}
              />
              <span>{slot.player?.name}</span>
              <span className="font-mono">amp {curve?.amplitude.toFixed(1)}</span>
            </span>
          );
        })}
      </div>

      {boostProvider && (
        <div id="cohesion-cal-lineup-rp-pd-boosts" className="rounded border border-blue-400/40 bg-blue-100/60 px-2 py-1.5 space-y-1">
          <p id="cohesion-cal-lineup-rp-pd-boosts-title" className="text-[9px] font-semibold text-black">
            {boostProvider.provider_name} {boostProvider.provider_rim_protector_tier} Rim Protector boosts teammate PD by +{boostProvider.boost.toFixed(1)}
          </p>
          <div id="cohesion-cal-lineup-rp-pd-boosts-list" className="flex flex-wrap gap-1.5">
            {rpPdBoosts.map((boost) => (
              <span
                key={`${boost.player_index}-${boost.player_name}`}
                id={`cohesion-cal-lineup-rp-pd-boost-${boost.player_index}`}
                className="rounded border border-blue-300 bg-white/70 px-1.5 py-0.5 text-[8px] text-black"
                title={`${boost.player_name}: Perimeter Disruptor ${boost.original_pd_tier} (${boost.original_pd_value.toFixed(1)}) -> ${boost.effective_pd_tier} (${boost.effective_pd_value.toFixed(1)})`}
              >
                {boost.player_name}: PD {boost.original_pd_tier} {"->"} {boost.effective_pd_tier}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
