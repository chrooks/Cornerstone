"use client";

/**
 * CohesionDebugPanel.tsx — Admin debug tab for cohesion engine evaluations.
 *
 * Shown in BuilderPage's left panel (debug tab) when the evaluation comes
 * from the cohesion engine. Displays:
 *   1. Player Composites Table — normalized 0-10 scores heatmap
 *   2. Bell Curve Mini Chart — defensive coverage overlay (inline SVG)
 *   3. Starting Lineup Subscores — 13 compact horizontal bars
 *   4. Synergies Fired — colored badge chips
 *   5. Accentuation — strength amplification + weakness coverage
 */

import { cn } from "@/lib/utils";
import type { CohesionBellCurve, CohesionPlayerComposites, CohesionRosterEvaluation } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Composite column abbreviations for the heatmap table header. */
const COMPOSITE_COLS: { key: string; abbr: string }[] = [
  { key: "spacing", abbr: "Spc" },
  { key: "finishing", abbr: "Fin" },
  { key: "paint_touch", abbr: "PT" },
  { key: "anchor", abbr: "Anc" },
  { key: "post_game", abbr: "PG" },
  { key: "pnr_screener", abbr: "PnR" },
  { key: "off_ball_impact", abbr: "OBI" },
  { key: "shot_creation", abbr: "SC" },
  { key: "rebounding", abbr: "Reb" },
  { key: "transition", abbr: "Trn" },
];

/** Distinct colors for overlaying multiple bell curves. */
const PLAYER_COLORS = [
  "#3b82f6", // blue
  "#ef4444", // red
  "#22c55e", // green
  "#f59e0b", // amber
  "#a855f7", // purple
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
];

/** Subscore key → display label, grouped for compact rendering. */
const SUBSCORE_ENTRIES: { key: string; label: string }[] = [
  { key: "spacing_creation_ratio", label: "Spc/Cre Ratio" },
  { key: "spacing_paint_touch_ratio", label: "Spc/PT Ratio" },
  { key: "rebound_transition_ratio", label: "Reb/Trn Ratio" },
  { key: "rebounding_spacing_deficit", label: "Reb-Spc Gap" },
  { key: "paint_touch_total", label: "Paint Touch" },
  { key: "post_game_total", label: "Post Game" },
  { key: "pnr_screener_total", label: "PnR Screener" },
  { key: "anchor_total", label: "Anchor" },
  { key: "collective_passing", label: "Passing" },
  { key: "rebounding", label: "Rebounding" },
  { key: "transition", label: "Transition" },
  { key: "defensive_coverage", label: "Def Coverage" },
  { key: "defensive_gaps", label: "Def Gaps" },
];

// Bell curve chart range: 6'0" (72in) to 7'4" (88in)
const BELL_MIN_IN = 72;
const BELL_MAX_IN = 88;
const BELL_HEIGHTS = Array.from({ length: BELL_MAX_IN - BELL_MIN_IN + 1 }, (_, i) => BELL_MIN_IN + i);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Heatmap cell color for 0-10 composite scores (red → yellow → green).
 *  Black text on opaque colored backgrounds for maximum readability. */
function compositeHeatColor(score: number): string {
  if (score >= 8) return "bg-green-400 text-black font-semibold";
  if (score >= 6) return "bg-green-300 text-black";
  if (score >= 4) return "bg-amber-300 text-black";
  if (score >= 2) return "bg-red-300 text-black";
  return "bg-red-400 text-black";
}

/** Convert inches to display label (e.g. 74 → "6'2\""). */
function inToLabel(inches: number): string {
  const ft = Math.floor(inches / 12);
  const inch = inches % 12;
  return `${ft}'${inch}"`;
}

/**
 * Compute defensive value at a target height for one player's bell curve.
 * Trapezoid with quadratic taper — mirrors backend bell_curve.py exactly.
 */
function defensiveValueAtHeight(
  targetHeight: number,
  params: CohesionBellCurve,
): number {
  const { amplitude, peak, range_down, range_up, flat_down, flat_up } = params;

  // Determine direction-specific parameters.
  // Math.abs gives same result as backend's signed subtraction in each branch.
  // When targetHeight == peak, falls into down/range_down branch (same as backend).
  const distance = Math.abs(targetHeight - peak);
  const flat = targetHeight > peak ? flat_up : flat_down;
  const total = targetHeight > peak ? range_up : range_down;

  // Flat-top zone: full amplitude
  if (distance <= flat) return amplitude;

  // Outside coverage boundary
  const taper = total - flat;
  if (taper <= 0 || distance > total) return 0;

  // Quadratic taper zone
  const t = (distance - flat) / taper;
  return amplitude * Math.max(0, 1 - t * t);
}

/** Color class for 0-10 subscore text. */
function subscoreColor(score: number): string {
  if (score >= 7) return "text-green-400";
  if (score >= 4) return "text-amber-400";
  return "text-red-400";
}

/** Bar fill color for 0-10 subscore. */
function subscoreBarFill(score: number): string {
  if (score >= 7) return "bg-green-500";
  if (score >= 4) return "bg-amber-500";
  return "bg-red-500";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Player composites heatmap table — one row per player, 10 composite columns. */
function CompositesTable({ players }: { players: CohesionPlayerComposites[] }) {
  return (
    <div id="cohesion-debug-composites" className="overflow-x-auto">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        Player Composites (0–10)
      </p>
      <table className="w-full text-[10px] border-separate" style={{ borderSpacing: "2px 3px" }}>
        <thead>
          <tr>
            <th className="text-left text-muted-foreground font-medium pr-2 py-1">Player</th>
            {COMPOSITE_COLS.map((col) => (
              <th
                key={col.key}
                className="text-center text-muted-foreground font-medium px-1 py-1 min-w-[36px]"
                title={col.key}
              >
                {col.abbr}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {players.map((player) => (
            <tr key={player.player_id}>
              <td className="text-foreground font-medium pr-2 py-1.5 whitespace-nowrap max-w-[100px] truncate">
                {player.name}
              </td>
              {COMPOSITE_COLS.map((col) => {
                // Access the score from the base composites object by key
                const score = player.base[col.key as keyof typeof player.base] ?? 0;
                const rounded = Math.round(score * 10) / 10;
                return (
                  <td
                    key={col.key}
                    className={cn(
                      "text-center font-mono tabular-nums px-1.5 py-1.5 rounded",
                      compositeHeatColor(score),
                    )}
                  >
                    {rounded.toFixed(1)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Defensive bell curve mini chart — overlaid SVG paths for all rostered players. */
function BellCurveMiniChart({ players }: { players: CohesionPlayerComposites[] }) {
  // Chart dimensions (fits left panel width)
  const width = 320;
  const height = 150;
  const padX = 30;
  const padY = 20;
  const chartW = width - padX * 2;
  const chartH = height - padY * 2;

  // Max defensive value for Y-axis scaling (cap at 4.0)
  const yMax = 4.0;

  // Convert a data point to SVG coordinates
  const toX = (inches: number) => padX + ((inches - BELL_MIN_IN) / (BELL_MAX_IN - BELL_MIN_IN)) * chartW;
  const toY = (value: number) => padY + chartH - (Math.min(value, yMax) / yMax) * chartH;

  return (
    <div id="cohesion-debug-bellcurve" className="mt-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        Defensive Bell Curves
      </p>
      <svg width={width} height={height} className="w-full" viewBox={`0 0 ${width} ${height}`}>
        {/* Grid lines at Y = 1, 2, 3, 4 */}
        {[1, 2, 3, 4].map((v) => (
          <g key={v}>
            <line x1={padX} y1={toY(v)} x2={width - padX} y2={toY(v)} stroke="currentColor" strokeOpacity={0.1} />
            <text x={padX - 4} y={toY(v) + 3} textAnchor="end" className="fill-muted-foreground" fontSize={8}>
              {v}
            </text>
          </g>
        ))}

        {/* X-axis labels — every 2 inches */}
        {BELL_HEIGHTS.filter((_, i) => i % 2 === 0).map((h) => (
          <text
            key={h}
            x={toX(h)}
            y={height - 4}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize={7}
          >
            {inToLabel(h)}
          </text>
        ))}

        {/* Player bell curve paths */}
        {players.map((player, idx) => {
          const color = PLAYER_COLORS[idx % PLAYER_COLORS.length];
          // Sample defensive value at each inch and build SVG path
          const points = BELL_HEIGHTS.map((h) => ({
            x: toX(h),
            y: toY(defensiveValueAtHeight(h, player.bell_curve)),
          }));
          const d = points
            .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
            .join(" ");

          return (
            <path
              key={player.player_id}
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              strokeOpacity={0.8}
            />
          );
        })}
      </svg>

      {/* Player legend with color swatches */}
      <div id="cohesion-debug-bellcurve-legend" className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
        {players.map((player, idx) => (
          <div key={player.player_id} className="flex items-center gap-1">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: PLAYER_COLORS[idx % PLAYER_COLORS.length] }}
            />
            <span className="text-[9px] text-muted-foreground truncate max-w-[80px]">{player.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Compact subscore bars for starting lineup. */
function SubscoresList({ subscores }: { subscores: Record<string, number> }) {
  return (
    <div id="cohesion-debug-subscores" className="mt-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        Starting Lineup Subscores
      </p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {SUBSCORE_ENTRIES.map((entry) => {
          const score = subscores[entry.key] ?? 0;
          const rounded = Math.round(score * 10) / 10;
          const widthPct = Math.max(0, Math.min(100, (score / 10) * 100));
          return (
            <div key={entry.key} id={`cohesion-debug-subscore-${entry.key}`} className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-muted-foreground">{entry.label}</span>
                <span className={cn("text-[9px] font-mono tabular-nums font-bold", subscoreColor(score))}>
                  {rounded.toFixed(1)}
                </span>
              </div>
              <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full", subscoreBarFill(score))}
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Synergies fired as colored badge chips. */
function SynergiesChips({ synergies }: { synergies: string[] }) {
  if (synergies.length === 0) return null;
  return (
    <div id="cohesion-debug-synergies" className="mt-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        Synergies Fired
      </p>
      <div className="flex flex-wrap gap-1.5">
        {synergies.map((s, idx) => {
          // Color code by prefix: OFF → blue, DEF → violet, BAL → amber
          const colorClass = s.startsWith("OFF")
            ? "bg-blue-500/20 text-blue-300 border-blue-500/30"
            : s.startsWith("DEF")
              ? "bg-violet-500/20 text-violet-300 border-violet-500/30"
              : "bg-amber-500/20 text-amber-300 border-amber-500/30";
          return (
            <span
              key={`${s}-${idx}`}
              className={cn("text-[9px] font-mono px-1.5 py-0.5 rounded border", colorClass)}
            >
              {s}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** Accentuation bars — strength amplification and weakness coverage. */
function AccentuationBars({ accentuation }: { accentuation: { strength_amplification: number; weakness_coverage: number } }) {
  return (
    <div id="cohesion-debug-accentuation" className="mt-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        Accentuation
      </p>
      <div className="grid grid-cols-2 gap-x-3">
        {[
          { key: "strength", label: "Strength Amp", value: accentuation.strength_amplification },
          { key: "weakness", label: "Weakness Cover", value: accentuation.weakness_coverage },
        ].map(({ key, label, value }) => {
          const widthPct = Math.max(0, Math.min(100, (value / 10) * 100));
          return (
            <div key={key} className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-muted-foreground">{label}</span>
                <span className={cn("text-[9px] font-mono tabular-nums font-bold", subscoreColor(value))}>
                  {(Math.round(value * 10) / 10).toFixed(1)}
                </span>
              </div>
              <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full", subscoreBarFill(value))}
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CohesionDebugPanel
// ---------------------------------------------------------------------------

interface CohesionDebugPanelProps {
  evaluation: CohesionRosterEvaluation;
}

export function CohesionDebugPanel({ evaluation }: CohesionDebugPanelProps) {
  const { player_composites, starting_lineup } = evaluation;

  return (
    <div id="cohesion-debug-panel" className="space-y-2">
      <CompositesTable players={player_composites} />
      <BellCurveMiniChart players={player_composites} />
      <SubscoresList subscores={starting_lineup.subscores} />
      <SynergiesChips synergies={starting_lineup.synergies_applied} />
      <AccentuationBars accentuation={starting_lineup.accentuation} />
    </div>
  );
}
