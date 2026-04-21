"use client";

/**
 * ScoringBreakdown.tsx — Admin scoring pipeline visualizer.
 *
 * Two panels:
 *   1. Contribution Table — player × dimension heatmap showing Layer 1 raw contributions.
 *      Hover any cell for the per-skill breakdown.
 *   2. Score Waterfall    — shows how each dimension travels from the Layer 2 baseline
 *      through every fired Layer 3 modifier to its final value.
 *
 * Accepts the raw player_traces and aggregate_traces from the debug payload.
 * Types are defined locally because these are internal debug structures — they
 * intentionally do not surface in the public API types.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// ── Internal trace types (mirrors backend debug payload shape) ────────────────

type DimKey = "spacing" | "creation" | "defense" | "paint" | "transition";

interface SkillContrib {
  tier_value: number;
  slot_weight: number;
  dimensions: Record<string, number>;
}

interface PlayerTrace {
  slot: number;
  slot_weight: number;
  skill_contributions: Record<string, SkillContrib>;
}

interface FiredModifier {
  trace_key: string;
  delta: number;
  dimension: string;
  presence_type: string;
  narrative: string;
}

interface AggTraces {
  pre_modifier_scores: Record<string, number>;
  fired_modifiers: FiredModifier[];
  final_scores: Record<string, number>;
}

export interface ScoringBreakdownProps {
  playerTraces: Record<string, unknown> | null;
  aggregateTraces: Record<string, unknown> | null;
}

// ── Dimension config ──────────────────────────────────────────────────────────

interface DimConfig {
  key: DimKey;
  label: string;
  /** Tailwind text class for labels/numbers. */
  textColor: string;
  /** Tailwind bg class for heatmap fill (applied with opacity via inline style). */
  heatBg: string;
  /** RGBA string for the base bar in the waterfall (inline style, avoids JIT purge). */
  barRgba: string;
  /** Tailwind class for the active pill. */
  pillActive: string;
}

const DIMS: DimConfig[] = [
  {
    key: "spacing",
    label: "Spacing",
    textColor: "text-sky-400",
    heatBg: "bg-sky-500",
    barRgba: "rgba(14,165,233,0.55)",
    pillActive: "bg-sky-500 text-white border-sky-500",
  },
  {
    key: "creation",
    label: "Creation",
    textColor: "text-orange-400",
    heatBg: "bg-orange-500",
    barRgba: "rgba(249,115,22,0.55)",
    pillActive: "bg-orange-500 text-white border-orange-500",
  },
  {
    key: "defense",
    label: "Defense",
    textColor: "text-violet-400",
    heatBg: "bg-violet-500",
    barRgba: "rgba(139,92,246,0.55)",
    pillActive: "bg-violet-500 text-white border-violet-500",
  },
  {
    key: "paint",
    label: "Paint",
    textColor: "text-rose-400",
    heatBg: "bg-rose-500",
    barRgba: "rgba(244,63,94,0.55)",
    pillActive: "bg-rose-500 text-white border-rose-500",
  },
  {
    key: "transition",
    label: "Transition",
    textColor: "text-emerald-400",
    heatBg: "bg-emerald-500",
    barRgba: "rgba(16,185,129,0.55)",
    pillActive: "bg-emerald-500 text-white border-emerald-500",
  },
];

const DIM_MAP = Object.fromEntries(DIMS.map((d) => [d.key, d])) as Record<DimKey, DimConfig>;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Reverse-map tier numeric values to human-readable names. */
const TIER_NAMES: Record<number, string> = {
  0:  "None",
  1:  "Capable",
  2:  "Proficient",
  4:  "Elite",
  10: "ATG",
};

/** Sum all skill contributions for one player toward a given dimension. */
function playerDimTotal(trace: PlayerTrace, dim: DimKey): number {
  return Object.values(trace.skill_contributions).reduce(
    (sum, sc) => sum + (sc.dimensions[dim] ?? 0),
    0,
  );
}

/** Structured breakdown for one skill's contribution to a dimension. */
interface SkillBreakdown {
  skill: string;
  value: number;
  tierVal: number;
  tierName: string;
  skillW: number;  // intra-dimension skill weight, reverse-derived
  slotW: number;
}

/** Return the skills a player contributes to a dimension, sorted by value desc. */
function playerSkillsForDim(trace: PlayerTrace, dim: DimKey): SkillBreakdown[] {
  return Object.entries(trace.skill_contributions)
    .filter(([, sc]) => (sc.dimensions[dim] ?? 0) > 0)
    .map(([skill, sc]) => {
      const value = sc.dimensions[dim];
      const tierVal = sc.tier_value;
      const slotW = sc.slot_weight;
      // Derive intra-dimension skill_weight by inverting: value = tier × skill_weight × slot_weight
      const skillW = tierVal > 0 && slotW > 0 ? value / (tierVal * slotW) : 0;
      const tierName = TIER_NAMES[tierVal] ?? String(tierVal);
      return { skill, value, tierVal, tierName, skillW, slotW };
    })
    .sort((a, b) => b.value - a.value);
}

/** Tailwind classes for tier badge chips in the tooltip. */
function tierChipClass(tierVal: number): string {
  if (tierVal >= 10) return "bg-amber-500/20 text-amber-300 border border-amber-500/40";
  if (tierVal >= 4)  return "bg-orange-500/20 text-orange-300 border border-orange-500/40";
  if (tierVal >= 2)  return "bg-blue-500/20 text-blue-300 border border-blue-500/40";
  return "bg-muted/60 text-muted-foreground border border-border";
}

/** Slot badge color: amber for star slots, blue for starters, muted for bench. */
function slotBadgeClass(slot: number): string {
  if (slot <= 2) return "bg-amber-500/20 text-amber-400 border-amber-500/30";
  if (slot <= 5) return "bg-blue-500/20 text-blue-400 border-blue-500/30";
  return "bg-muted/60 text-muted-foreground border-border";
}

/**
 * Extract multiplier-only skills from a player trace.
 * These skills (passer, cutter, high_flyer, etc.) have no Layer 1 dimension
 * contribution (dimensions: {}) but drive Layer 3 modifiers — they're invisible
 * in the heatmap without this explicit surfacing.
 */
function getMultiplierSkills(
  trace: PlayerTrace,
): Array<{ skill: string; tierName: string; tierVal: number }> {
  return Object.entries(trace.skill_contributions)
    .filter(([, sc]) => Object.keys(sc.dimensions).length === 0)
    .map(([skill, sc]) => ({
      skill,
      tierVal: sc.tier_value,
      tierName: TIER_NAMES[sc.tier_value] ?? String(sc.tier_value),
    }))
    .sort((a, b) => b.tierVal - a.tierVal);
}

// ── Cell Tooltip ──────────────────────────────────────────────────────────────

interface CellTooltipState {
  skills: SkillBreakdown[];
  playerName: string;
  dimLabel: string;
  dimTextColor: string;
  /** Viewport-relative anchor position of the hovered cell. */
  rect: DOMRect;
}

function CellTooltip({
  tip,
  pinned,
  onUnpin,
}: {
  tip: CellTooltipState;
  pinned: boolean;
  onUnpin: () => void;
}) {
  const CARD_HEIGHT_EST = tip.skills.length * 44 + 32;
  const spaceBelow = window.innerHeight - tip.rect.bottom;
  const top = spaceBelow > CARD_HEIGHT_EST
    ? tip.rect.bottom + 6
    : tip.rect.top - CARD_HEIGHT_EST - 6;
  const left = Math.max(8, Math.min(tip.rect.left, window.innerWidth - 244));

  return (
    <div
      id="contribution-cell-tooltip"
      // pointer-events-auto when pinned so the × button is clickable
      className={cn("fixed z-[200]", pinned ? "pointer-events-auto" : "pointer-events-none")}
      style={{ top, left }}
    >
      <div
        className={cn(
          "w-[236px] rounded-lg border bg-card shadow-2xl overflow-hidden transition-colors",
          pinned
            ? "border-foreground/25 ring-1 ring-foreground/10"
            : "border-border",
        )}
      >
        {/* Header */}
        <div className="px-3 py-1.5 border-b border-border/50 flex items-center gap-1.5">
          <span className="text-[9px] font-medium text-muted-foreground truncate">
            {tip.playerName.split(" ").slice(-1)[0]}
          </span>
          <span className="text-[9px] text-muted-foreground/40">·</span>
          <span className={cn("text-[9px] font-semibold", tip.dimTextColor)}>
            {tip.dimLabel}
          </span>
          {/* Close button — only shown when pinned */}
          {pinned && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onUnpin(); }}
              className="ml-auto text-[10px] text-muted-foreground/50 hover:text-foreground transition-colors leading-none"
              aria-label="Close"
            >
              ✕
            </button>
          )}
        </div>

        {/* Skill rows */}
        <div className="px-3 py-2 space-y-2.5">
          {tip.skills.map((s) => (
            <div key={s.skill}>
              <p className="text-[10px] font-medium text-foreground mb-1 leading-none">
                {s.skill}
              </p>
              <div className="flex items-center gap-1 font-mono text-[10px]">
                <span className={cn("px-1 py-px rounded text-[9px] font-semibold", tierChipClass(s.tierVal))}>
                  {s.tierName}
                </span>
                <span className="text-muted-foreground/60">×</span>
                <span className="text-foreground/80" title="skill weight">{s.skillW.toFixed(2)}</span>
                <span className="text-muted-foreground/60">×</span>
                <span className="text-foreground/80" title="slot weight">{s.slotW.toFixed(2)}</span>
                <span className="text-muted-foreground/60">=</span>
                <span className="text-foreground font-bold">{s.value.toFixed(3)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Contribution Table ────────────────────────────────────────────────────────

function ContributionTable({ players }: { players: Array<{ name: string; trace: PlayerTrace }> }) {
  const [tooltip, setTooltip] = useState<CellTooltipState | null>(null);
  const [pinned, setPinned] = useState(false);
  // Use a ref so the document mousedown handler always reads current pinned value
  const pinnedRef = useRef(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync ref with state
  pinnedRef.current = pinned;

  // Dismiss pinned tooltip on click outside the tooltip card
  useEffect(() => {
    function handleDocMouseDown(e: MouseEvent) {
      if (!pinnedRef.current) return;
      const el = document.getElementById("contribution-cell-tooltip");
      if (el && el.contains(e.target as Node)) return; // click inside card — keep pinned
      setPinned(false);
      setTooltip(null);
    }
    document.addEventListener("mousedown", handleDocMouseDown);
    return () => document.removeEventListener("mousedown", handleDocMouseDown);
  }, []);

  const colMaxes = useMemo(
    () =>
      Object.fromEntries(
        DIMS.map(({ key }) => [
          key,
          Math.max(...players.map(({ trace }) => playerDimTotal(trace, key)), 0.001),
        ]),
      ) as Record<DimKey, number>,
    [players],
  );

  function showTooltip(
    e: React.MouseEvent<HTMLTableCellElement>,
    name: string,
    skills: SkillBreakdown[],
    dimLabel: string,
    dimTextColor: string,
  ) {
    if (pinnedRef.current) return; // don't override a pinned tooltip on hover
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    if (skills.length === 0) return;
    setTooltip({ skills, playerName: name, dimLabel, dimTextColor, rect: e.currentTarget.getBoundingClientRect() });
  }

  function pinTooltip(
    e: React.MouseEvent<HTMLTableCellElement>,
    name: string,
    skills: SkillBreakdown[],
    dimLabel: string,
    dimTextColor: string,
  ) {
    e.stopPropagation(); // prevent doc handler from immediately unpinning
    if (skills.length === 0) return;
    setTooltip({ skills, playerName: name, dimLabel, dimTextColor, rect: e.currentTarget.getBoundingClientRect() });
    setPinned(true);
  }

  function hideTooltip() {
    if (pinnedRef.current) return; // don't hide a pinned tooltip on mouse leave
    leaveTimer.current = setTimeout(() => setTooltip(null), 80);
  }

  function unpin() {
    setPinned(false);
    setTooltip(null);
  }

  return (
    <>
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        {/* Header */}
        <thead>
          <tr className="border-b border-border">
            <th className="px-2.5 py-2 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider w-36">
              Player
            </th>
            {DIMS.map(({ key, label, textColor }) => (
              <th
                key={key}
                className={cn(
                  "px-2.5 py-2 text-right text-[10px] font-semibold uppercase tracking-wider",
                  textColor,
                )}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>

        {/* Body */}
        <tbody>
          {players.map(({ name, trace }, rowIdx) => (
            <tr
              key={name}
              className={cn(
                "border-b border-border/30 transition-colors hover:bg-muted/20",
                rowIdx % 2 === 1 && "bg-muted/5",
              )}
            >
              {/* Player name + slot badge + multiplier skill chips */}
              <td className="px-2.5 py-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className={cn(
                      "flex-shrink-0 text-[9px] font-bold px-1 py-0.5 rounded border tabular-nums",
                      slotBadgeClass(trace.slot),
                    )}
                  >
                    {trace.slot}
                  </span>
                  <div className="min-w-0 flex flex-col gap-0.5">
                    <span
                      className="truncate text-[11px] text-foreground font-medium"
                      title={name}
                    >
                      {name.split(" ").slice(-1)[0]}
                    </span>
                    {/* Multiplier skills — no Layer 1 contribution; impact is in waterfall modifiers */}
                    {(() => {
                      const mults = getMultiplierSkills(trace);
                      return mults.length > 0 ? (
                        <div className="flex flex-wrap gap-0.5">
                          {mults.map(({ skill, tierName, tierVal }) => (
                            <span
                              key={skill}
                              title={`${skill} (${tierName}) — multiplier skill: no direct dimension contribution, drives Layer 3 modifiers. Look for related keys in the waterfall.`}
                              className={cn(
                                "text-[8px] font-mono px-1 py-px rounded border cursor-help",
                                tierVal >= 10 ? "bg-amber-500/10 text-amber-300/80 border-amber-500/20"
                                  : tierVal >= 4  ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/25"
                                  : tierVal >= 2  ? "bg-indigo-500/10 text-indigo-400/70 border-indigo-500/15"
                                  :                 "bg-muted/30 text-muted-foreground/50 border-border/50",
                              )}
                            >
                              {skill.replace(/_/g, " ")}
                            </span>
                          ))}
                        </div>
                      ) : null;
                    })()}
                  </div>
                </div>
              </td>

              {/* Dimension cells */}
              {DIMS.map(({ key, heatBg, label, textColor }) => {
                const value = playerDimTotal(trace, key);
                const ratio = colMaxes[key] > 0 ? value / colMaxes[key] : 0;
                const skills = playerSkillsForDim(trace, key);

                return (
                  <td
                    key={key}
                    onMouseEnter={(e) => showTooltip(e, name, skills, label, textColor)}
                    onMouseLeave={hideTooltip}
                    onClick={(e) => pinTooltip(e, name, skills, label, textColor)}
                    className="relative px-2.5 py-2 text-right tabular-nums cursor-pointer"
                  >
                    {/* Heatmap background fill */}
                    <div
                      className={cn("absolute inset-0", heatBg)}
                      style={{ opacity: ratio * 0.45 }}
                    />
                    {/* Value */}
                    <span className="relative text-[11px] font-mono text-foreground">
                      {value > 0.001 ? (
                        value.toFixed(2)
                      ) : (
                        <span className="text-muted-foreground/30">—</span>
                      )}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {/* Custom floating tooltip — rendered outside the overflow container so it's never clipped */}
    {tooltip && <CellTooltip tip={tooltip} pinned={pinned} onUnpin={unpin} />}
    </>
  );
}

// ── Score Waterfall ───────────────────────────────────────────────────────────

function WaterfallRow({
  label,
  delta,
  from,
  to,
  isBase,
  narrative,
  barRgba,
}: {
  label: string;
  delta: number;
  from: number;
  to: number;
  isBase: boolean;
  narrative: string;
  barRgba: string;
}) {
  const isPos = delta >= 0;
  const barLeft = Math.min(from, to);
  const barWidth = Math.min(100, Math.abs(delta));

  return (
    <div
      title={narrative}
      className="group grid items-center gap-2 cursor-default"
      style={{ gridTemplateColumns: "7rem 1fr 4.5rem" }}
    >
      {/* Label */}
      <div className="flex items-center gap-1 min-w-0">
        {!isBase && (
          <span
            className={cn(
              "flex-shrink-0 text-[8px] font-bold",
              isPos ? "text-green-400" : "text-red-400",
            )}
          >
            {isPos ? "▲" : "▼"}
          </span>
        )}
        <span
          className={cn(
            "truncate font-mono text-[9px]",
            isBase ? "text-muted-foreground" : isPos ? "text-green-400/80" : "text-red-400/80",
          )}
        >
          {label}
        </span>
      </div>

      {/* Bar track */}
      <div className="relative h-2.5 rounded-full overflow-hidden bg-muted/30">
        {/* Grey "filled-so-far" context bar (not shown for base) */}
        {!isBase && from > 0 && (
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-muted-foreground/15"
            style={{ width: `${from}%` }}
          />
        )}
        {/* Delta / base bar */}
        <div
          className={cn(
            "absolute top-0 h-full rounded-full",
            !isBase && !isPos && "bg-red-500/60",
            !isBase && isPos && "bg-green-500/60",
          )}
          style={{
            left: `${barLeft}%`,
            width: `${barWidth}%`,
            // Base bar uses dimension accent color via inline style
            ...(isBase ? { backgroundColor: barRgba } : {}),
          }}
        />
      </div>

      {/* Delta + running total */}
      <div className="flex items-center justify-end gap-1.5">
        {!isBase && (
          <span
            className={cn(
              "text-[9px] font-mono tabular-nums w-8 text-right",
              isPos ? "text-green-400" : "text-red-400",
            )}
          >
            {isPos ? "+" : ""}
            {delta.toFixed(1)}
          </span>
        )}
        <span className="text-[10px] font-mono font-bold tabular-nums text-foreground w-8 text-right">
          {to.toFixed(1)}
        </span>
      </div>
    </div>
  );
}

function ScoreWaterfall({
  dim,
  preScore,
  modifiers,
  finalScore,
}: {
  dim: DimKey;
  preScore: number;
  modifiers: FiredModifier[];
  finalScore: number;
}) {
  const cfg = DIM_MAP[dim];

  // Build rows: base row + one row per modifier
  let running = 0;
  const rows: Array<{
    label: string;
    delta: number;
    from: number;
    to: number;
    isBase: boolean;
    narrative: string;
  }> = [
    // Base row: Layer 1+2 contribution
    (() => {
      const from = 0;
      const to = Math.max(0, Math.min(100, preScore));
      running = to;
      return {
        label: "Base (L1+2)",
        delta: preScore,
        from,
        to,
        isBase: true,
        narrative: "Raw slot-weighted tier contributions, normalized to 0–100 against theoretical maximum.",
      };
    })(),
    // Modifier rows
    ...modifiers.map((m) => {
      const from = running;
      running = Math.max(0, Math.min(100, running + m.delta));
      return {
        label: m.trace_key,
        delta: m.delta,
        from,
        to: running,
        isBase: false,
        narrative: m.narrative,
      };
    }),
  ];

  const hasModifiers = modifiers.length > 0;

  return (
    <div className="space-y-1.5">
      {/* Column headers */}
      <div
        className="grid items-center gap-2 mb-2"
        style={{ gridTemplateColumns: "7rem 1fr 4.5rem" }}
      >
        <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">
          Modifier
        </span>
        <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">
          Score
        </span>
        <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wider text-right">
          Running
        </span>
      </div>

      {rows.map((row, i) => (
        <WaterfallRow key={row.label + i} {...row} barRgba={cfg.barRgba} />
      ))}

      {!hasModifiers && (
        <p className="text-[10px] text-muted-foreground/50 pt-1 pl-1">
          No modifiers fired for this dimension.
        </p>
      )}

      {/* Final score summary */}
      <div className="pt-2 mt-2 border-t border-border/40 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">
          Final <span className={cfg.textColor}>{cfg.label}</span>
        </span>
        <span className={cn("text-2xl font-extrabold font-mono tabular-nums leading-none", cfg.textColor)}>
          {Math.round(finalScore)}
        </span>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function ScoringBreakdown({ playerTraces, aggregateTraces }: ScoringBreakdownProps) {
  const [selectedDim, setSelectedDim] = useState<DimKey>("spacing");

  // Cast raw unknown traces to typed shapes — safe since this is admin-only debug data
  const typedPlayerTraces = playerTraces as Record<string, PlayerTrace> | null;
  const typedAggTraces = aggregateTraces as AggTraces | null;

  // Sort players by slot for the table
  const sortedPlayers = useMemo(() => {
    if (!typedPlayerTraces) return [];
    return Object.entries(typedPlayerTraces)
      .map(([name, trace]) => ({ name, trace }))
      .sort((a, b) => a.trace.slot - b.trace.slot);
  }, [typedPlayerTraces]);

  // ── Empty state ──────────────────────────────────────────────────────────────
  if (!typedPlayerTraces || !typedAggTraces) {
    return (
      <div
        id="scoring-breakdown-empty"
        className="flex flex-col items-center justify-center gap-3 py-16 px-4 text-center"
      >
        <div className="w-10 h-10 rounded-full bg-muted/40 flex items-center justify-center">
          <span className="text-lg text-muted-foreground/50">⎔</span>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">No trace data</p>
          <p className="text-[10px] text-muted-foreground/50 max-w-[18rem]">
            Add players to your roster. Traces populate once an evaluation runs with debug mode enabled.
          </p>
        </div>
      </div>
    );
  }

  const dimModifiers = typedAggTraces.fired_modifiers.filter(
    (m) => m.dimension === selectedDim,
  );
  const preScore = typedAggTraces.pre_modifier_scores[selectedDim] ?? 0;
  const finalScore = typedAggTraces.final_scores[selectedDim] ?? 0;

  return (
    <div id="scoring-breakdown" className="space-y-6 pb-6">

      {/* ── Section 1: Contribution Table ──────────────────────────────────────── */}
      <section id="scoring-breakdown-table">
        <div className="flex items-baseline gap-2 mb-2">
          <h4 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Layer 1 — Contributions
          </h4>
          <span className="text-[9px] text-muted-foreground/40">hover cell for skill detail</span>
        </div>

        <div className="rounded-lg border border-border overflow-hidden">
          <ContributionTable players={sortedPlayers} />
        </div>

        <p className="text-[9px] text-muted-foreground/40 mt-1.5 px-0.5">
          Values are slot-weighted tier contributions before normalization. Intensity = column-relative share.
          Indigo chips = multiplier skills (passer, cutter, high flyer…) — no L1 contribution; see waterfall for impact.
        </p>
      </section>

      {/* ── Section 2: Score Waterfall ──────────────────────────────────────────── */}
      <section id="scoring-breakdown-waterfall">
        <div className="flex items-baseline gap-2 mb-3">
          <h4 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Layer 2→3 — Score Breakdown
          </h4>
          <span className="text-[9px] text-muted-foreground/40">hover row for narrative</span>
        </div>

        {/* Dimension picker pills */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {DIMS.map(({ key, label, textColor, pillActive }) => {
            const score = Math.round(typedAggTraces.final_scores[key] ?? 0);
            const isActive = selectedDim === key;
            return (
              <button
                key={key}
                id={`breakdown-dim-${key}`}
                type="button"
                onClick={() => setSelectedDim(key)}
                className={cn(
                  "flex items-center gap-1 text-[10px] font-medium px-2.5 py-1 rounded-full border transition-all duration-150",
                  isActive
                    ? pillActive
                    : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 bg-transparent",
                )}
              >
                {label}
                <span
                  className={cn(
                    "font-mono font-bold text-[9px] tabular-nums",
                    isActive ? "text-white/75" : textColor,
                  )}
                >
                  {score}
                </span>
              </button>
            );
          })}
        </div>

        {/* Waterfall panel */}
        <div className="rounded-lg border border-border bg-card/40 p-4">
          <ScoreWaterfall
            dim={selectedDim}
            preScore={preScore}
            modifiers={dimModifiers}
            finalScore={finalScore}
          />
        </div>
      </section>
    </div>
  );
}
