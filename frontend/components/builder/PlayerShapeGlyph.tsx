"use client";

import { cn } from "@/lib/utils";
import {
  ARC_LABELS,
  ARC_SPAN,
  ARC_START,
  AXIS_ANGLES,
  CENTER,
  LABEL_RADIUS,
  MAX_RADIUS,
  MAX_VALUE,
  pointAt,
  polygonPoints,
  TEAM_SHAPE_AXES,
} from "./TeamShapeGlyph";

/**
 * Player Shape — one Player's identity glyph on the same axes and arcs as the
 * Team Shape, drawn from league-percentile composites. ADR 0005 decision 3:
 * rendered ADJACENT to the Team Shape, never superimposed — percentiles and
 * Lineup Subscores share a 0-10 scale but are not comparable point-for-point.
 */

export interface PlayerShapeAxisValue {
  key: string;
  /** 0-10 composite; null = no data for this axis (drawn as a gap, never 0). */
  value: number | null;
  /** True when the value is a raw formula read, not a league percentile. */
  isRaw: boolean;
}

interface PlayerShapeGlyphProps {
  playerName: string;
  /** Values keyed by the shared axis vocabulary (TEAM_SHAPE_AXES keys). */
  axisValues: PlayerShapeAxisValue[];
  className?: string;
}

export function PlayerShapeGlyph({ playerName, axisValues, className }: PlayerShapeGlyphProps) {
  const byKey = new Map(axisValues.map((entry) => [entry.key, entry]));
  const ordered = TEAM_SHAPE_AXES.map((axis) => byKey.get(axis.key) ?? { key: axis.key, value: null, isRaw: false });
  const values = ordered.map((entry) => entry.value);
  const hasAnyValue = values.some((value) => value != null);
  const isRawRead = ordered.some((entry) => entry.value != null && entry.isRaw);

  if (!hasAnyValue) {
    return (
      <p
        id="player-shape-empty"
        className="border border-dashed border-[#d9d0c9] bg-[#f0f0f0]/55 px-3 py-3 text-[0.75rem] text-[#0e0907]/55"
      >
        No Impact Trait data for {playerName} yet — no shape to draw.
      </p>
    );
  }

  return (
    <div id="player-shape-glyph" className={cn("mx-auto w-full max-w-[240px]", className)}>
      <svg
        viewBox="0 0 400 400"
        role="img"
        aria-label={`${playerName}'s Player Shape: ${isRawRead ? "raw formula reads" : "league-percentile composites"} across ${TEAM_SHAPE_AXES.length} axes`}
        className="block w-full"
      >
        {[5, 10].map((ring) => (
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

        {[0, 1, 2].map((arc) => {
          const outer = pointAt(ARC_START + arc * ARC_SPAN, MAX_RADIUS + 8);
          return (
            <line
              key={arc}
              x1={CENTER}
              y1={CENTER}
              x2={outer.x}
              y2={outer.y}
              stroke="#0e0907"
              strokeOpacity={0.12}
              strokeWidth={1}
            />
          );
        })}

        {ARC_LABELS.map((label, arc) => {
          const { x, y } = pointAt(ARC_START + (arc + 0.5) * ARC_SPAN, MAX_RADIUS + 62);
          return (
            <text
              key={label}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-[#0e0907]/30 font-mono"
              fontSize={11}
              letterSpacing={1}
            >
              {label.toUpperCase()}
            </text>
          );
        })}

        {TEAM_SHAPE_AXES.map((axis, i) => {
          const tip = pointAt(AXIS_ANGLES[i], MAX_RADIUS);
          const labelPos = pointAt(AXIS_ANGLES[i], LABEL_RADIUS);
          return (
            <g key={axis.key}>
              <line
                x1={CENTER}
                y1={CENTER}
                x2={tip.x}
                y2={tip.y}
                stroke="#d9d0c9"
                strokeOpacity={0.6}
                strokeWidth={0.75}
              />
              <text
                x={labelPos.x}
                y={labelPos.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={13}
                className="fill-[#0e0907]/55 font-mono"
              >
                {axis.label}
              </text>
            </g>
          );
        })}

        {/* Identity outline — Warmup Peach so it never reads as a Team Shape */}
        <polygon
          points={polygonPoints(values)}
          fill="#f3a181"
          fillOpacity={0.28}
          stroke="#0e0907"
          strokeOpacity={0.55}
          strokeWidth={1.75}
          strokeLinejoin="round"
        />

        {ordered.map((entry, i) => {
          if (entry.value == null) return null;
          const { x, y } = pointAt(AXIS_ANGLES[i], (entry.value / MAX_VALUE) * MAX_RADIUS);
          const axis = TEAM_SHAPE_AXES[i];
          return (
            <circle key={axis.key} cx={x} cy={y} r={3.5} fill="#0e0907" fillOpacity={0.6} stroke="#f7f7f7" strokeWidth={1.25}>
              <title>
                {`${axis.label}: ${entry.value.toFixed(1)} ${entry.isRaw ? "(raw read, rescaled to 0-10)" : "(league percentile, 0-10)"}`}
              </title>
            </circle>
          );
        })}
      </svg>
      <p id="player-shape-legend" className="mt-1 text-center text-[0.625rem] text-[#0e0907]/40">
        {isRawRead
          ? "Raw formula reads — percentiles appear once this Player is in the live eval"
          : "League percentiles (0-10) — not comparable point-for-point with Team Shape spokes"}
      </p>
    </div>
  );
}
