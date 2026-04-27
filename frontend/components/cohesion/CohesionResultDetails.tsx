"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { CohesionBellCurve, CohesionLineupSummary, CohesionPlayerComposites } from "@/lib/types";

export interface CohesionRpPdBoostInfo {
  player_index: number;
  player_name: string;
  provider_index: number;
  provider_name: string;
  provider_rim_protector_tier: string;
  boost: number;
  original_pd_tier: string;
  effective_pd_tier: string;
  original_pd_value: number;
  effective_pd_value: number;
}

export interface CohesionLineupResultData {
  cohesion_score: number;
  subscores: Record<string, number>;
  synergies_applied: string[];
  accentuation: {
    strength_amplification: number;
    weakness_coverage: number;
  };
  accentuation_details?: {
    strength?: {
      score: number;
      credit: number;
      checks: number;
      terms: {
        player: string;
        composite: string;
        value: number;
        teammate: string;
        teammate_composite: string;
        teammate_value: number;
        contribution: number;
      }[];
    };
    weakness?: {
      score: number;
      credit: number;
      checks: number;
      terms: {
        player: string;
        composite: string;
        weakness_depth: number;
        teammate: string;
        cover_value: number;
        contribution: number;
      }[];
    };
  };
  boosted_bell_curves?: (CohesionBellCurve | null)[];
  rp_pd_boosts?: CohesionRpPdBoostInfo[];
}

export interface CohesionStarBreakdownData {
  starting_5: number;
  depth: number;
  archetype_diversity: number;
  floor: number;
}

const PLAYER_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#22c55e",
  "#f59e0b",
  "#a855f7",
  "#ec4899",
  "#06b6d4",
  "#f97316",
];

const BELL_MIN_IN = 72;
const BELL_MAX_IN = 88;
const BELL_HEIGHTS = Array.from({ length: BELL_MAX_IN - BELL_MIN_IN + 1 }, (_, i) => BELL_MIN_IN + i);

const COMPOSITE_COLS: { key: keyof CohesionPlayerComposites["base"]; abbr: string; label: string }[] = [
  { key: "spacing", abbr: "Spc", label: "Spacing" },
  { key: "finishing", abbr: "Fin", label: "Finishing" },
  { key: "paint_touch", abbr: "PT", label: "Paint Touch" },
  { key: "anchor", abbr: "Anc", label: "Anchor" },
  { key: "post_game", abbr: "Post", label: "Post Game" },
  { key: "pnr_screener", abbr: "PnR", label: "PnR Screener" },
  { key: "off_ball_impact", abbr: "OBI", label: "Off-Ball Impact" },
  { key: "shot_creation", abbr: "SC", label: "Shot Creation" },
  { key: "rebounding", abbr: "Reb", label: "Rebounding" },
  { key: "transition", abbr: "Trn", label: "Transition" },
];

export const COHESION_SUBSCORE_LABELS: Record<string, string> = {
  spacing_creation_ratio: "Spacing / Creation",
  creation_offball_ratio: "Creation / Off-Ball",
  spacing_paint_touch_ratio: "Spacing / Paint Touch",
  rebound_transition_ratio: "Rebound / Transition",
  rebounding_spacing_deficit: "Spacing Support",
  paint_touch_total: "Paint Touch",
  post_game_total: "Post Game",
  pnr_pairing: "PnR Pairing",
  pnr_screener_total: "PnR Screener",
  anchor_total: "Anchor",
  collective_passing: "Passing",
  rebounding: "Rebounding",
  transition: "Transition",
  defensive_coverage: "Def Coverage",
  defensive_gaps: "Def Gaps",
};

export const COHESION_SUBSCORE_GROUPS: { heading: string; entries: { key: string; label: string }[] }[] = [
  {
    heading: "Fit Ratios",
    entries: [
      { key: "spacing_creation_ratio", label: "Spacing / Creation" },
      { key: "creation_offball_ratio", label: "Creation / Off-Ball" },
      { key: "spacing_paint_touch_ratio", label: "Spacing / Paint Touch" },
      { key: "rebound_transition_ratio", label: "Rebound / Transition" },
      { key: "rebounding_spacing_deficit", label: "Spacing Support" },
    ],
  },
  {
    heading: "Lineup Qualities",
    entries: [
      { key: "paint_touch_total", label: "Paint Touch" },
      { key: "post_game_total", label: "Post Game" },
      { key: "pnr_pairing", label: "PnR Pairing" },
      { key: "anchor_total", label: "Anchor" },
      { key: "collective_passing", label: "Passing" },
      { key: "rebounding", label: "Rebounding" },
      { key: "transition", label: "Transition" },
    ],
  },
  {
    heading: "Defense",
    entries: [
      { key: "defensive_coverage", label: "Def Coverage" },
      { key: "defensive_gaps", label: "Def Gaps" },
    ],
  },
];

const SYNERGY_DESCRIPTIONS: Record<string, string> = {
  "OFF-02": "Screeners boost movement shooters by freeing them off the ball.",
  "OFF-03": "Movement shooters are penalized when no screener is available.",
  "OFF-04": "Screeners boost cutters by opening off-ball lanes.",
  "OFF-12": "Cutters are penalized when the lineup has no passer to find them.",
  "OFF-13": "Cutters are penalized when lineup spacing is too cramped.",
  "OFF-14": "Creators boost cutters by bending the defense.",
  "OFF-15": "Vertical spacers are penalized without passers or drivers to activate them.",
  "OFF-16": "Passers or drivers boost vertical spacers as lob and rim-pressure targets.",
  "OFF-31": "Passers boost transition threats in the open court.",
  "OFF-32": "Transition threats and passers boost high flyers.",
  "OFF-37": "Only one passer is present, making playmaking fragile.",
};

export function cohesionSubscoreColor(score: number): string {
  if (score >= 7) return "text-green-400";
  if (score >= 4) return "text-amber-400";
  return "text-red-400";
}

export function cohesionSubscoreBarFill(score: number): string {
  if (score >= 7) return "bg-green-500";
  if (score >= 4) return "bg-amber-500";
  return "bg-red-500";
}

function compositeHeatColor(score: number): string {
  if (score >= 8) return "bg-green-400 text-black font-semibold";
  if (score >= 6) return "bg-green-300 text-black";
  if (score >= 4) return "bg-amber-300 text-black";
  if (score >= 2) return "bg-red-300 text-black";
  return "bg-red-400 text-black";
}

function inToLabel(inches: number): string {
  const ft = Math.floor(inches / 12);
  const inch = inches % 12;
  return `${ft}'${inch}"`;
}

function bellValueAtHeight(targetHeight: number, params: CohesionBellCurve): number {
  const { amplitude, peak, range_down, range_up, flat_down, flat_up } = params;
  const distance = Math.abs(targetHeight - peak);
  const flat = targetHeight > peak ? flat_up : flat_down;
  const total = targetHeight > peak ? range_up : range_down;
  if (distance <= flat) return amplitude;
  const taper = total - flat;
  if (taper <= 0 || distance > total) return 0;
  const t = (distance - flat) / taper;
  return amplitude * Math.max(0, 1 - t * t);
}

function synergyChipClass(synergyId: string): string {
  if (synergyId.startsWith("OFF")) return "bg-blue-200 text-black border-blue-400";
  if (synergyId.startsWith("DEF")) return "bg-violet-200 text-black border-violet-400";
  return "bg-amber-200 text-black border-amber-400";
}

function compositeLabel(value: string): string {
  return COHESION_SUBSCORE_LABELS[value] ?? value.replaceAll("_", " ");
}

export function CohesionCompositesTable({
  players,
  idPrefix = "cohesion-composites",
}: {
  players: CohesionPlayerComposites[];
  idPrefix?: string;
}) {
  return (
    <div id={idPrefix} className="overflow-x-auto">
      <p id={`${idPrefix}-title`} className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Player Composites (0-10)
      </p>
      <table id={`${idPrefix}-table`} className="w-full text-[10px] border-separate" style={{ borderSpacing: "2px 3px" }}>
        <thead>
          <tr id={`${idPrefix}-header-row`}>
            <th id={`${idPrefix}-header-player`} className="text-left text-muted-foreground font-medium pr-2 py-1">Player</th>
            {COMPOSITE_COLS.map((col) => (
              <th
                key={col.key}
                id={`${idPrefix}-header-${col.key}`}
                className="text-center text-muted-foreground font-medium px-1 py-1 min-w-[36px]"
                title={col.label}
              >
                {col.abbr}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {players.map((player) => (
            <tr key={player.player_id} id={`${idPrefix}-player-${player.player_id}`}>
              <td id={`${idPrefix}-player-${player.player_id}-name`} className="text-foreground font-medium pr-2 py-1.5 whitespace-nowrap max-w-[120px] truncate">
                {player.name}
              </td>
              {COMPOSITE_COLS.map((col) => {
                const score = player.base[col.key] ?? 0;
                return (
                  <td
                    key={col.key}
                    id={`${idPrefix}-player-${player.player_id}-${col.key}`}
                    className={cn("text-center font-mono tabular-nums px-1.5 py-1.5 rounded", compositeHeatColor(score))}
                  >
                    {score.toFixed(1)}
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

export function CohesionBellCurveChart({
  players,
  boostedBellCurves,
  rpPdBoosts,
  idPrefix = "cohesion-lineup-bellcurves",
}: {
  players: CohesionPlayerComposites[];
  boostedBellCurves?: (CohesionBellCurve | null)[];
  rpPdBoosts?: CohesionRpPdBoostInfo[];
  idPrefix?: string;
}) {
  const [hoveredPlayerId, setHoveredPlayerId] = useState<string | null>(null);
  const width = 520;
  const height = 205;
  const padX = 34;
  const padY = 26;
  const chartW = width - padX * 2;
  const chartH = height - padY * 2;
  const effectiveCurves = players.map((player, index) => boostedBellCurves?.[index] ?? player.bell_curve);
  const stackedValues = BELL_HEIGHTS.map((heightInches) => {
    const values = effectiveCurves.map((curve) => (curve ? bellValueAtHeight(heightInches, curve) : 0)).sort((a, b) => b - a);
    const returns = [1, 0.5, 0.25, 0.1];
    return {
      height: heightInches,
      value: values.reduce((sum, value, index) => sum + value * (returns[index] ?? 0), 0),
    };
  });
  const yMax = Math.max(4, Math.ceil(Math.max(...stackedValues.map((point) => point.value), ...effectiveCurves.flatMap((curve) => (
    curve ? BELL_HEIGHTS.map((heightInches) => bellValueAtHeight(heightInches, curve)) : [0]
  ))) / 2) * 2);
  const yTicks = Array.from({ length: Math.floor(yMax / 2) }, (_, index) => (index + 1) * 2);
  const toX = (inches: number) => padX + ((inches - BELL_MIN_IN) / (BELL_MAX_IN - BELL_MIN_IN)) * chartW;
  const toY = (value: number) => padY + chartH - (Math.min(value, yMax) / yMax) * chartH;

  return (
    <div id={idPrefix} className="rounded-md border border-border/70 bg-background/60 p-2 space-y-2">
      <div id={`${idPrefix}-header`} className="flex items-center justify-between">
        <span id={`${idPrefix}-title`} className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Defensive Bell Curves
        </span>
        <span id={`${idPrefix}-scale`} className="text-[9px] text-muted-foreground/70">
          {inToLabel(BELL_MIN_IN)} to {inToLabel(BELL_MAX_IN)}
        </span>
      </div>
      <svg
        id={`${idPrefix}-svg`}
        width={width}
        height={height}
        className="w-full"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Defensive bell curve overlay for the current lineup"
      >
        {yTicks.map((v) => (
          <g key={v} id={`${idPrefix}-grid-${v}`}>
            <line x1={padX} y1={toY(v)} x2={width - padX} y2={toY(v)} stroke="currentColor" strokeOpacity={0.08} />
            <text x={padX - 6} y={toY(v) + 3} textAnchor="end" className="fill-muted-foreground" fontSize={8}>{v}</text>
          </g>
        ))}
        {[72, 76, 80, 84, 88].map((h) => (
          <text key={h} x={toX(h)} y={height - 4} textAnchor="middle" className="fill-muted-foreground" fontSize={7}>
            {inToLabel(h)}
          </text>
        ))}
        {players.map((player, index) => {
          const curve = effectiveCurves[index];
          if (!curve) return null;
          const d = BELL_HEIGHTS.map((heightInches, pointIndex) => {
            const command = pointIndex === 0 ? "M" : "L";
            return `${command} ${toX(heightInches).toFixed(1)} ${toY(bellValueAtHeight(heightInches, curve)).toFixed(1)}`;
          }).join(" ");
          const isDimmed = hoveredPlayerId !== null && hoveredPlayerId !== player.player_id;
          return (
            <path
              key={player.player_id}
              id={`${idPrefix}-curve-${player.player_id}`}
              d={d}
              fill="none"
              stroke={PLAYER_COLORS[index % PLAYER_COLORS.length]}
              strokeWidth={hoveredPlayerId === player.player_id ? 3 : 2}
              strokeOpacity={isDimmed ? 0.3 : 0.9}
            />
          );
        })}
        <path
          id={`${idPrefix}-stacked`}
          d={stackedValues.map((point, index) => `${index === 0 ? "M" : "L"} ${toX(point.height).toFixed(1)} ${toY(point.value).toFixed(1)}`).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeOpacity={hoveredPlayerId ? 0.35 : 0.9}
        />
      </svg>
      <div id={`${idPrefix}-legend`} className="flex flex-wrap gap-2">
        <span id={`${idPrefix}-legend-stacked`} className="inline-flex items-center gap-1.5 text-[9px] font-semibold text-foreground">
          <span className="inline-block w-4 h-0.5 rounded-full bg-current" />
          <span>Stacked coverage</span>
        </span>
        {players.map((player, index) => {
          const curve = effectiveCurves[index];
          return (
            <span
              key={player.player_id}
              id={`${idPrefix}-legend-${player.player_id}`}
              className={cn("inline-flex items-center gap-1.5 text-[9px] cursor-pointer transition-opacity", hoveredPlayerId && hoveredPlayerId !== player.player_id ? "opacity-40" : "text-muted-foreground")}
              onMouseEnter={() => setHoveredPlayerId(player.player_id)}
              onMouseLeave={() => setHoveredPlayerId(null)}
            >
              <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: PLAYER_COLORS[index % PLAYER_COLORS.length] }} />
              <span>{player.name}</span>
              <span className="font-mono">amp {curve?.amplitude.toFixed(1) ?? "0.0"}</span>
            </span>
          );
        })}
      </div>
      {rpPdBoosts && rpPdBoosts.length > 0 && (
        <div id={`${idPrefix}-rp-pd-boosts`} className="rounded border border-blue-400/40 bg-blue-100/60 px-2 py-1.5 space-y-1">
          <p id={`${idPrefix}-rp-pd-boosts-title`} className="text-[9px] font-semibold text-black">
            {rpPdBoosts[0].provider_name} {rpPdBoosts[0].provider_rim_protector_tier} Rim Protector boosts teammate PD by +{rpPdBoosts[0].boost.toFixed(1)}
          </p>
          <div id={`${idPrefix}-rp-pd-boosts-list`} className="flex flex-wrap gap-1.5">
            {rpPdBoosts.map((boost) => (
              <span key={`${boost.player_index}-${boost.player_name}`} id={`${idPrefix}-rp-pd-boost-${boost.player_index}`} className="rounded border border-blue-300 bg-white/70 px-1.5 py-0.5 text-[8px] text-black">
                {boost.player_name}: PD {boost.original_pd_tier} {"->"} {boost.effective_pd_tier}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function CohesionExpandableSubscores({
  subscores,
  idPrefix = "cohesion-result-subscores",
}: {
  subscores: Record<string, number>;
  idPrefix?: string;
}) {
  const knownKeys = new Set(COHESION_SUBSCORE_GROUPS.flatMap((group) => group.entries.map((entry) => entry.key)));
  const grouped = COHESION_SUBSCORE_GROUPS.map((group) => ({
    ...group,
    entries: group.entries.filter((entry) => entry.key in subscores),
  })).filter((group) => group.entries.length > 0);
  const uncategorized = Object.keys(subscores)
    .filter((key) => !knownKeys.has(key))
    .map((key) => ({ key, label: COHESION_SUBSCORE_LABELS[key] ?? key }));

  return (
    <div id={idPrefix} className="space-y-3">
      {[...grouped, ...(uncategorized.length > 0 ? [{ heading: "Other", entries: uncategorized }] : [])].map((group) => (
        <div key={group.heading} id={`${idPrefix}-${group.heading.toLowerCase().replaceAll(" ", "-")}`} className="space-y-1.5">
          <p id={`${idPrefix}-${group.heading.toLowerCase().replaceAll(" ", "-")}-title`} className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
            {group.heading}
          </p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {group.entries.map((entry) => {
              const score = subscores[entry.key] ?? 0;
              const widthPct = Math.max(0, Math.min(100, (score / 10) * 100));
              return (
                <details key={entry.key} id={`${idPrefix}-${entry.key}`} className="group rounded-sm">
                  <summary id={`${idPrefix}-${entry.key}-summary`} className="list-none cursor-pointer">
                    <div className="flex items-center justify-between">
                      <span id={`${idPrefix}-${entry.key}-label`} className="text-[9px] text-muted-foreground group-hover:text-foreground">{entry.label}</span>
                      <span id={`${idPrefix}-${entry.key}-value`} className={cn("text-[9px] font-mono tabular-nums font-bold", cohesionSubscoreColor(score))}>
                        {score.toFixed(1)}
                      </span>
                    </div>
                    <div id={`${idPrefix}-${entry.key}-bar`} className="h-1 w-full bg-muted rounded-full overflow-hidden">
                      <div className={cn("h-full rounded-full", cohesionSubscoreBarFill(score))} style={{ width: `${widthPct}%` }} />
                    </div>
                  </summary>
                  <div id={`${idPrefix}-${entry.key}-detail`} className="mt-1 text-[8px] leading-relaxed text-muted-foreground">
                    <span className="font-semibold text-foreground">{entry.label}</span>
                    <span className="mx-1">=</span>
                    <span className={cn("font-mono font-semibold tabular-nums", cohesionSubscoreColor(score))}>{score.toFixed(2)}</span>
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CohesionSynergyDetails({
  synergies,
  idPrefix = "cohesion-result-synergies",
}: {
  synergies: string[];
  idPrefix?: string;
}) {
  const [selectedSynergy, setSelectedSynergy] = useState<string | null>(null);
  if (synergies.length === 0) return null;

  return (
    <div id={idPrefix} className="space-y-2">
      <div id={`${idPrefix}-chips`} className="flex flex-wrap gap-1">
        {synergies.map((synergyId, index) => (
          <span
            key={`${synergyId}-${index}`}
            id={`${idPrefix}-${synergyId}-${index}`}
            role="button"
            tabIndex={0}
            className={cn("text-[8px] font-mono px-1 py-0.5 rounded border cursor-pointer", synergyChipClass(synergyId), selectedSynergy === synergyId && "ring-2 ring-offset-1 ring-black")}
            onClick={() => setSelectedSynergy((current) => (current === synergyId ? null : synergyId))}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setSelectedSynergy((current) => (current === synergyId ? null : synergyId));
              }
            }}
            title={SYNERGY_DESCRIPTIONS[synergyId] ?? "No description available for this synergy."}
          >
            {synergyId}
          </span>
        ))}
      </div>
      {selectedSynergy && (
        <div id={`${idPrefix}-calculation`} className="rounded-md border border-border bg-background p-2">
          <div id={`${idPrefix}-calculation-header`} className="flex items-center gap-2">
            <span id={`${idPrefix}-calculation-code`} className={cn("text-[8px] font-mono px-1 py-0.5 rounded border", synergyChipClass(selectedSynergy))}>
              {selectedSynergy}
            </span>
            <span id={`${idPrefix}-calculation-description`} className="text-[9px] text-muted-foreground">
              {SYNERGY_DESCRIPTIONS[selectedSynergy] ?? "No description available for this synergy."}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function RatingCalculationDetails({
  result,
  starBreakdown,
  lineupSummary,
  idPrefix,
}: {
  result: CohesionLineupResultData;
  starBreakdown?: CohesionStarBreakdownData;
  lineupSummary?: CohesionLineupSummary;
  idPrefix: string;
}) {
  const strength = result.accentuation_details?.strength;
  const weakness = result.accentuation_details?.weakness;
  const archetypeCount = lineupSummary?.archetype_labels.length ?? 0;
  const archetypeTotal = 6;

  return (
    <div id={idPrefix} className="space-y-2">
      <p id={`${idPrefix}-title`} className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Rating Calculations
      </p>
      <div id={`${idPrefix}-grid`} className="grid grid-cols-1 gap-2">
        {starBreakdown && lineupSummary && (
          <>
            <details id={`${idPrefix}-depth`} className="rounded border border-border/60 bg-background/50 p-2">
              <summary id={`${idPrefix}-depth-summary`} className="cursor-pointer text-[9px] font-semibold text-foreground">
                Depth = <span className={cn("font-mono", cohesionSubscoreColor(starBreakdown.depth * 10))}>{(starBreakdown.depth * 100).toFixed(1)}%</span>
              </summary>
              <div id={`${idPrefix}-depth-equation`} className="mt-1 space-y-1 text-[8px] leading-relaxed text-muted-foreground">
                <p>
                  <span className="font-semibold text-foreground">Depth</span> = 0.60 x viable ratio {((lineupSummary.depth_viable_ratio ?? 0) * 100).toFixed(1)}% + 0.40 x quality {((lineupSummary.depth_quality ?? 0) * 100).toFixed(1)}%
                </p>
                <p>
                  viable ratio = {lineupSummary.bench_viable_lineups ?? 0} viable bench lineups / {lineupSummary.bench_lineups ?? 0} bench lineups
                </p>
                <p>
                  quality = median bench score {(lineupSummary.bench_median_score ?? 0).toFixed(2)} / 5.00
                </p>
              </div>
            </details>

            <details id={`${idPrefix}-versatility`} className="rounded border border-border/60 bg-background/50 p-2">
              <summary id={`${idPrefix}-versatility-summary`} className="cursor-pointer text-[9px] font-semibold text-foreground">
                Versatility = <span className={cn("font-mono", cohesionSubscoreColor(starBreakdown.archetype_diversity * 10))}>{(starBreakdown.archetype_diversity * 100).toFixed(1)}%</span>
              </summary>
              <div id={`${idPrefix}-versatility-equation`} className="mt-1 space-y-1 text-[8px] leading-relaxed text-muted-foreground">
                <p>
                  <span className="font-semibold text-foreground">Versatility</span> = {archetypeCount} lineup archetypes / {archetypeTotal} possible archetypes
                </p>
                <p>active archetypes: {lineupSummary.archetype_labels.join(", ") || "none"}</p>
              </div>
            </details>

            <details id={`${idPrefix}-floor`} className="rounded border border-border/60 bg-background/50 p-2">
              <summary id={`${idPrefix}-floor-summary`} className="cursor-pointer text-[9px] font-semibold text-foreground">
                Floor = <span className={cn("font-mono", cohesionSubscoreColor(starBreakdown.floor * 10))}>{(starBreakdown.floor * 100).toFixed(1)}%</span>
              </summary>
              <div id={`${idPrefix}-floor-equation`} className="mt-1 text-[8px] leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">Floor</span> = median lineup score {lineupSummary.median_score.toFixed(2)} / 5.00
              </div>
            </details>
          </>
        )}

        {strength && (
          <details id={`${idPrefix}-strength`} className="rounded border border-border/60 bg-background/50 p-2">
            <summary id={`${idPrefix}-strength-summary`} className="cursor-pointer text-[9px] font-semibold text-foreground">
              Strength Amp = <span className={cn("font-mono", cohesionSubscoreColor(strength.score))}>{strength.score.toFixed(1)}</span>
            </summary>
            <div id={`${idPrefix}-strength-equation`} className="mt-1 space-y-1 text-[8px] leading-relaxed text-muted-foreground">
              <p><span className="font-semibold text-foreground">Strength Amp</span> = credit {strength.credit.toFixed(2)} / {strength.checks} checks</p>
              {strength.terms.slice(0, 8).map((term, index) => (
                <p key={`${term.player}-${term.composite}-${index}`} id={`${idPrefix}-strength-term-${index}`}>
                  {term.player} {compositeLabel(term.composite)} {term.value.toFixed(1)} x {term.teammate} {compositeLabel(term.teammate_composite)} {term.teammate_value.toFixed(1)} / 10 = <span className="font-mono text-foreground">{term.contribution.toFixed(2)}</span>
                </p>
              ))}
            </div>
          </details>
        )}

        {weakness && (
          <details id={`${idPrefix}-weakness`} className="rounded border border-border/60 bg-background/50 p-2">
            <summary id={`${idPrefix}-weakness-summary`} className="cursor-pointer text-[9px] font-semibold text-foreground">
              Weakness Cover = <span className={cn("font-mono", cohesionSubscoreColor(weakness.score))}>{weakness.score.toFixed(1)}</span>
            </summary>
            <div id={`${idPrefix}-weakness-equation`} className="mt-1 space-y-1 text-[8px] leading-relaxed text-muted-foreground">
              <p><span className="font-semibold text-foreground">Weakness Cover</span> = credit {weakness.credit.toFixed(2)} / {weakness.checks} checks</p>
              {weakness.terms.slice(0, 8).map((term, index) => (
                <p key={`${term.player}-${term.composite}-${index}`} id={`${idPrefix}-weakness-term-${index}`}>
                  {term.player} {compositeLabel(term.composite)} weakness depth {term.weakness_depth.toFixed(1)} x {term.teammate} cover {term.cover_value.toFixed(1)} / 10 = <span className="font-mono text-foreground">{term.contribution.toFixed(2)}</span>
                </p>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

export function CohesionResultDetails({
  result,
  players,
  compositesPlayers,
  starBreakdown,
  lineupSummary,
  idPrefix = "cohesion-lineup-result",
}: {
  result: CohesionLineupResultData;
  players: CohesionPlayerComposites[];
  compositesPlayers?: CohesionPlayerComposites[];
  starBreakdown?: CohesionStarBreakdownData;
  lineupSummary?: CohesionLineupSummary;
  idPrefix?: string;
}) {
  return (
    <div id={idPrefix} className="rounded-lg border border-border bg-card p-3 space-y-3">
      <div id={`${idPrefix}-header`} className="flex items-center justify-between">
        <span id={`${idPrefix}-title`} className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Cohesion Score
        </span>
        <span id={`${idPrefix}-score`} className={cn("text-lg font-bold font-mono tabular-nums", cohesionSubscoreColor(result.cohesion_score * 2))}>
          {result.cohesion_score.toFixed(2)}
        </span>
      </div>
      <CohesionBellCurveChart
        players={players}
        boostedBellCurves={result.boosted_bell_curves}
        rpPdBoosts={result.rp_pd_boosts}
        idPrefix={`${idPrefix}-bellcurves`}
      />
      <CohesionExpandableSubscores subscores={result.subscores} idPrefix={`${idPrefix}-subscores`} />
      <RatingCalculationDetails
        result={result}
        starBreakdown={starBreakdown}
        lineupSummary={lineupSummary}
        idPrefix={`${idPrefix}-rating-calculations`}
      />
      <CohesionSynergyDetails synergies={result.synergies_applied} idPrefix={`${idPrefix}-synergies`} />
      {compositesPlayers && compositesPlayers.length > 0 && (
        <CohesionCompositesTable players={compositesPlayers} idPrefix={`${idPrefix}-composites`} />
      )}
    </div>
  );
}
