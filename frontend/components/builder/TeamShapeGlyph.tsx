"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { gradeForScore } from "@/lib/cohesion-colors";
import { SUBSCORE_DESCRIPTIONS } from "@/lib/cohesion-constants";
import { useTweenedValues } from "@/lib/hooks/useTweened";

/**
 * Team Shape — the engine's Lineup Subscores rendered as a radar glyph.
 * ADR 0005: every vertex is a real engine value; solid = Starting Lineup,
 * ghost = median of viable Lineup Combinations. Never invented geometry.
 */

interface ShapeAxis {
  key: string;
  label: string;
  arc: 0 | 1 | 2;
}

/** 11 shared axes in three equal-angle arcs mirroring the Subscore Tree. */
export const TEAM_SHAPE_AXES: ShapeAxis[] = [
  // Offense arc
  { key: "spacing", label: "Spacing", arc: 0 },
  { key: "shot_creation", label: "Creation", arc: 0 },
  { key: "paint_touch", label: "Rim", arc: 0 },
  { key: "post_game", label: "Post", arc: 0 },
  { key: "off_ball_impact", label: "Off-Ball", arc: 0 },
  { key: "ball_security", label: "Ball Sec", arc: 0 },
  // Defense arc
  { key: "perimeter_defense", label: "Perim D", arc: 1 },
  { key: "interior_defense", label: "Int D", arc: 1 },
  // Rebounding / transition arc
  { key: "defensive_rebounding", label: "D-Reb", arc: 2 },
  { key: "offensive_rebounding", label: "O-Reb", arc: 2 },
  { key: "transition", label: "Transition", arc: 2 },
];

export const ARC_LABELS = ["Offense", "Defense", "Reb/Trn"];
export const ARC_SPAN = (2 * Math.PI) / 3;
export const ARC_START = -Math.PI / 2; // offense arc opens at 12 o'clock
export const CENTER = 200;
export const MAX_RADIUS = 128;
export const LABEL_RADIUS = 152;
export const MAX_VALUE = 10;
/** Morph between consecutive eval results (research band: 300-600ms ease-out). */
const MORPH_MS = 450;
/** A vertex counts as "changed" past this delta; its highlight fades after the hold. */
const CHANGED_THRESHOLD = 0.1;
const CHANGED_HOLD_MS = 2200;

/** Angle for axis i: centered within its arc's equal angular span. */
function axisAngle(axis: ShapeAxis, indexInArc: number, arcCount: number): number {
  return ARC_START + axis.arc * ARC_SPAN + ((indexInArc + 0.5) / arcCount) * ARC_SPAN;
}

export const AXIS_ANGLES: number[] = (() => {
  const counts = [0, 0, 0];
  TEAM_SHAPE_AXES.forEach((axis) => { counts[axis.arc] += 1; });
  const seen = [0, 0, 0];
  return TEAM_SHAPE_AXES.map((axis) => {
    const angle = axisAngle(axis, seen[axis.arc], counts[axis.arc]);
    seen[axis.arc] += 1;
    return angle;
  });
})();

export function pointAt(angle: number, radius: number): { x: number; y: number } {
  return { x: CENTER + radius * Math.cos(angle), y: CENTER + radius * Math.sin(angle) };
}

export function polygonPoints(values: (number | null)[]): string {
  return values
    .map((value, i) => {
      if (value == null) return null;
      const r = (Math.min(MAX_VALUE, Math.max(0, value)) / MAX_VALUE) * MAX_RADIUS;
      const { x, y } = pointAt(AXIS_ANGLES[i], r);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter(Boolean)
    .join(" ");
}

/** ADR 0005: a key the engine didn't return stays null — never coerced to 0. */
function axisValues(subscores: Record<string, number>): (number | null)[] {
  return TEAM_SHAPE_AXES.map((axis) => subscores[axis.key] ?? null);
}

function vertexTone(value: number): string {
  if (value >= 7) return "#047857";
  if (value >= 4) return "#a34400";
  return "#b91c1c";
}

interface TeamShapeGlyphProps {
  /** Starting Lineup subscores from the last real eval; null before eval. */
  subscores: Record<string, number> | null;
  /** Median subscores across viable Lineup Combinations; null/undefined hides the ghost. */
  medianSubscores?: Record<string, number> | null;
  viableLineups?: number;
  totalLineups?: number;
  /** Filled roster slots — under 5 renders the not-yet-scorable state. */
  filledCount: number;
  /** True while the debounced live eval is in flight. */
  isRecomputing: boolean;
  /** Lineup-only RuleSets have no rotation, so no ghost and no viability badge. */
  isLineupOnly?: boolean;
  /** Subscore keys touched by the selected Skill trace — their vertices highlight. */
  affectedKeys?: Set<string>;
  /** #89: vertices land in sequence around the arcs on mount (Final Eval reveal). */
  staggerReveal?: boolean;
}

/** Per-vertex reveal spacing; 11 vertices finish within ~550ms. */
const REVEAL_STEP_MS = 50;

export function TeamShapeGlyph({
  subscores,
  medianSubscores,
  viableLineups,
  totalLineups,
  filledCount,
  isRecomputing,
  isLineupOnly = false,
  affectedKeys,
  staggerReveal = false,
}: TeamShapeGlyphProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  // A new eval can move a vertex out from under the cursor; drop stale hover.
  useEffect(() => {
    setHovered(null);
  }, [subscores]);

  const isUnderFilled = filledCount < 5;
  const hasShape = subscores !== null && !isUnderFilled;
  const targetValues = hasShape ? axisValues(subscores) : null;
  const hasViable = (viableLineups ?? 0) > 0;
  const showGhost = hasShape && !isLineupOnly && hasViable && medianSubscores != null;
  const ghostTargets = showGhost ? axisValues(medianSubscores) : null;

  // #98: outlines travel between consecutive real eval results — never anticipatory.
  const values = useTweenedValues(targetValues, MORPH_MS);
  const ghostValues = useTweenedValues(ghostTargets, MORPH_MS);

  // Changed-vertex highlight: diff consecutive engine results, hold, then fade.
  const prevSubscoresRef = useRef<Record<string, number> | null>(null);
  const [changed, setChanged] = useState<{ seq: number; keys: Set<string> } | null>(null);
  useEffect(() => {
    const prev = prevSubscoresRef.current;
    prevSubscoresRef.current = subscores;
    if (!subscores || !prev) return;
    const keys = new Set(
      TEAM_SHAPE_AXES
        .filter((axis) => {
          const before = prev[axis.key];
          const after = subscores[axis.key];
          return before != null && after != null && Math.abs(after - before) >= CHANGED_THRESHOLD;
        })
        .map((axis) => axis.key),
    );
    if (keys.size === 0) return;
    setChanged((current) => ({ seq: (current?.seq ?? 0) + 1, keys }));
  }, [subscores]);

  // Fade follows the highlight itself, so a no-change eval can't strand it.
  useEffect(() => {
    if (!changed) return;
    const timeout = setTimeout(() => setChanged(null), CHANGED_HOLD_MS);
    return () => clearTimeout(timeout);
  }, [changed]);
  const showZeroViableBadge =
    hasShape && !isLineupOnly && !hasViable && (totalLineups ?? 0) > 0;

  const hoveredAxis = hovered != null ? TEAM_SHAPE_AXES[hovered] : null;
  // Tooltip text is engine truth (target values); position follows the drawn vertex.
  const hoveredValue = hovered != null && targetValues ? targetValues[hovered] : null;
  const hoveredDrawn = hovered != null && values ? values[hovered] : null;
  const hoveredPoint =
    hovered != null && hoveredDrawn != null
      ? pointAt(AXIS_ANGLES[hovered], (hoveredDrawn / MAX_VALUE) * MAX_RADIUS)
      : null;

  return (
    <div id="team-shape-glyph" className="relative mx-auto w-full max-w-[360px]">
      <svg
        viewBox="0 0 400 400"
        role="group"
        aria-label={
          hasShape
            ? `Team Shape: Starting Lineup subscores across ${TEAM_SHAPE_AXES.length} axes`
            : "Team Shape forms once the Build has 5 Players"
        }
        className="block w-full"
      >
        {/* Grid rings */}
        {[2.5, 5, 7.5, 10].map((ring) => (
          <circle
            key={ring}
            cx={CENTER}
            cy={CENTER}
            r={(ring / MAX_VALUE) * MAX_RADIUS}
            fill="none"
            stroke="#d9d0c9"
            strokeWidth={ring === 10 ? 1.25 : 0.75}
            strokeOpacity={ring === 10 ? 0.9 : 0.55}
          />
        ))}

        {/* Arc boundary separators */}
        {[0, 1, 2].map((arc) => {
          const angle = ARC_START + arc * ARC_SPAN;
          const outer = pointAt(angle, MAX_RADIUS + 10);
          return (
            <line
              key={arc}
              x1={CENTER}
              y1={CENTER}
              x2={outer.x}
              y2={outer.y}
              stroke="#0e0907"
              strokeOpacity={0.14}
              strokeWidth={1}
            />
          );
        })}

        {/* Arc labels along the outer edge */}
        {ARC_LABELS.map((label, arc) => {
          const mid = ARC_START + (arc + 0.5) * ARC_SPAN;
          const { x, y } = pointAt(mid, MAX_RADIUS + 62);
          return (
            <text
              key={label}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-[#0e0907]/30 font-mono"
              fontSize={10}
              letterSpacing={1}
            >
              {label.toUpperCase()}
            </text>
          );
        })}

        {/* Axis spokes + labels */}
        {TEAM_SHAPE_AXES.map((axis, i) => {
          const angle = AXIS_ANGLES[i];
          const tip = pointAt(angle, MAX_RADIUS);
          const labelPos = pointAt(angle, LABEL_RADIUS);
          const isAffected = affectedKeys?.has(axis.key) ?? false;
          const isHovered = hovered === i;
          return (
            <g key={axis.key}>
              <line
                x1={CENTER}
                y1={CENTER}
                x2={tip.x}
                y2={tip.y}
                stroke={isAffected || isHovered ? "#ffa05c" : "#d9d0c9"}
                strokeOpacity={isAffected || isHovered ? 0.9 : 0.6}
                strokeWidth={isAffected || isHovered ? 1.5 : 0.75}
              />
              <text
                x={labelPos.x}
                y={labelPos.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={12}
                className={cn(
                  "font-mono transition-colors motion-reduce:transition-none",
                  isAffected || isHovered ? "fill-[#a34400]" : "fill-[#0e0907]/55",
                )}
              >
                {axis.label}
              </text>
            </g>
          );
        })}

        {/* Under-filled: dashed circle placeholder — off the axes, clearly not data */}
        {!hasShape && (
          <circle
            cx={CENTER}
            cy={CENTER}
            r={MAX_RADIUS * 0.3}
            fill="none"
            stroke="#0e0907"
            strokeOpacity={0.25}
            strokeWidth={1.5}
            strokeDasharray="5 4"
          />
        )}

        {hasShape && values && (
          <g className={cn("shape-fade-in", isRecomputing && "motion-safe:animate-pulse opacity-60")}>
            {/* Ghost: rotation median across viable Lineup Combinations */}
            {ghostValues && (
              <polygon
                points={polygonPoints(ghostValues)}
                fill="none"
                stroke="#0e0907"
                strokeOpacity={0.35}
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )}

            {/* Solid: Starting Lineup */}
            <polygon
              points={polygonPoints(values)}
              fill="#ffa05c"
              fillOpacity={0.22}
              stroke="#fe6d34"
              strokeWidth={2}
              strokeLinejoin="round"
            />

            {/* Vertex dots + hover/focus hit areas */}
            {values.map((value, i) => {
              if (value == null) return null;
              const engineValue = targetValues?.[i] ?? value;
              const { x, y } = pointAt(AXIS_ANGLES[i], (value / MAX_VALUE) * MAX_RADIUS);
              const axis = TEAM_SHAPE_AXES[i];
              const isChanged = changed?.keys.has(axis.key) ?? false;
              return (
                <g
                  key={axis.key}
                  className={cn(staggerReveal && "reveal-pop")}
                  style={staggerReveal ? { "--reveal-delay": `${i * REVEAL_STEP_MS}ms` } as CSSProperties : undefined}
                >
                  {isChanged && (
                    <circle
                      key={`ping-${changed?.seq}`}
                      cx={x}
                      cy={y}
                      r={7}
                      fill="none"
                      stroke="#fe6d34"
                      strokeWidth={1.5}
                      className="shape-ping pointer-events-none"
                    />
                  )}
                  <circle
                    cx={x}
                    cy={y}
                    r={hovered === i ? 5 : 3.5}
                    fill={vertexTone(engineValue)}
                    stroke={isChanged ? "#fe6d34" : "#f7f7f7"}
                    strokeWidth={isChanged ? 2 : 1.25}
                    className="transition-all motion-reduce:transition-none"
                  />
                  <circle
                    id={`team-shape-vertex-${axis.key}`}
                    cx={x}
                    cy={y}
                    r={14}
                    fill="transparent"
                    tabIndex={0}
                    role="img"
                    aria-label={`${axis.label}: ${engineValue.toFixed(1)} out of 10, grade ${gradeForScore(engineValue)}`}
                    className="cursor-pointer outline-none focus-visible:stroke-[#ffa05c] focus-visible:stroke-2"
                    onMouseEnter={() => setHovered(i)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(i)}
                    onBlur={() => setHovered(null)}
                  />
                </g>
              );
            })}
          </g>
        )}
      </svg>

      {/* Vertex tooltip */}
      {hoveredAxis && hoveredValue != null && hoveredPoint && (
        <div
          id="team-shape-vertex-tooltip"
          role="tooltip"
          className="pointer-events-none absolute z-20 w-52 -translate-x-1/2 border border-[#d9d0c9] bg-[#f7f7f7] px-3 py-2 shadow-[0_4px_16px_rgba(14,9,7,0.1)]"
          style={{
            left: `${(hoveredPoint.x / 400) * 100}%`,
            top: `${(hoveredPoint.y / 400) * 100}%`,
            transform: "translate(-50%, calc(-100% - 10px))",
          }}
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[0.75rem] font-semibold text-[#0e0907]">{hoveredAxis.label}</span>
            <span className="shrink-0 font-mono text-[0.75rem] font-semibold tabular-nums text-[#0e0907]">
              {hoveredValue.toFixed(1)}
              <span className="ml-1.5" style={{ color: vertexTone(hoveredValue) }}>
                {gradeForScore(hoveredValue)}
              </span>
            </span>
          </div>
          <p className="mt-1 text-[0.6875rem] leading-snug text-[#0e0907]/60">
            {SUBSCORE_DESCRIPTIONS[hoveredAxis.key] ?? ""}
          </p>
        </div>
      )}

      {/* State badges */}
      <div className="pointer-events-none absolute right-0 top-0 flex flex-col items-end gap-1">
        <span
          id="team-shape-recomputing"
          aria-live="polite"
          className={cn(
            "border border-[#d9d0c9] bg-[#f0f0f0]/90 px-2 py-0.5 font-mono text-[0.5625rem] uppercase tracking-[0.14em] text-[#0e0907]/55",
            !(isRecomputing && hasShape) && "invisible",
          )}
        >
          {isRecomputing && hasShape ? "Recomputing" : ""}
        </span>
        {showZeroViableBadge && (
          <span
            id="team-shape-zero-viable"
            className="border border-[#e53e3e]/30 bg-[#e53e3e]/10 px-2 py-0.5 font-mono text-[0.5625rem] uppercase tracking-[0.14em] text-[#b91c1c]"
          >
            0 of {totalLineups} viable
          </span>
        )}
      </div>

      {/* Outline key / progress copy */}
      {hasShape ? (
        <p id="team-shape-key" className="mt-1 text-center text-[0.625rem] text-[#0e0907]/40">
          <span className="text-[#fe6d34]">━</span> Starting Lineup
          {showGhost && (
            <>
              <span className="ml-3 text-[#0e0907]/45">╌╌</span> Rotation median
            </>
          )}
        </p>
      ) : (
        <p id="team-shape-progress" className="mt-1 text-center text-[0.75rem] text-[#0e0907]/55">
          {filledCount === 0
            ? "Pick a Cornerstone to start the Build."
            : filledCount < 5
              ? `Add ${5 - filledCount} more Player${5 - filledCount === 1 ? "" : "s"} — the Team Shape forms at 5.`
              : "Scoring this Build…"}
        </p>
      )}
    </div>
  );
}
