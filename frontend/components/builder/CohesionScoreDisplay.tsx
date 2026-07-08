"use client";

/**
 * CohesionScoreDisplay.tsx — Renders cohesion engine evaluation results.
 *
 * Layout (top to bottom):
 *   1. Star Rating Hero — large 5-star display with exact numeric
 *   2. 4-Factor Breakdown — starting_5, depth, archetype_diversity, floor (0-1 bars)
 *   3. 13 Subscore Grid — grouped by category, 0-10 scale bars
 *   4. Accentuation — strength amplification + weakness coverage
 *
 * Color coding:
 *   Stars: green (≥3.5), amber (2.0–3.49), red (<2.0)
 *   Subscores (0-10): green (≥7), amber (4–6.99), red (<4)
 *   Breakdown (0-1): green (≥0.7), amber (0.4–0.69), red (<0.4)
 */

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { CohesionScoreBadge } from "@/components/cohesion/CohesionScoreBadge";
import { AttributionLedgerPanel } from "@/components/builder/AttributionLedgerPanel";
import { TeamShapeGlyph, TEAM_SHAPE_AXES } from "@/components/builder/TeamShapeGlyph";
import { SUBSCORE_DESCRIPTIONS, SUBSCORE_GROUPS, HEADING_TO_CATEGORY_KEY, HEADING_SHOWS_SCORE, categoryScoreColor } from "@/lib/cohesion-constants";
import { gradeForScore, subscoreColor } from "@/lib/cohesion-colors";
import { rotationMedianExplainer, scoreFactorExplainer, scoreFactorLabel } from "@/lib/cohesionScoreExplainers";
import type { AttributionLedger, RosterEvaluation } from "@/lib/types";


// ---------------------------------------------------------------------------
// Color utilities (component-specific scales not shared elsewhere)
// ---------------------------------------------------------------------------

const subscoreColorClass = subscoreColor;

/** Color class for 0-1 breakdown bars. */
function breakdownColorClass(value: number): string {
  if (value >= 0.7) return "text-green-400";
  if (value >= 0.4) return "text-amber-400";
  return "text-red-400";
}

/** Bar fill color for 0-1 breakdown bars. */
function breakdownBarColor(value: number): string {
  if (value >= 0.7) return "bg-green-500";
  if (value >= 0.4) return "bg-amber-500";
  return "bg-red-500";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** A labeled horizontal bar for 0-1 breakdown factors. */
function BreakdownBar({ id, label, value, description }: { id: string; label: string; value: number; description: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div id={id} className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span id={`${id}-label`} className="text-xs font-medium text-muted-foreground cursor-help" title={description}>
          {label}
        </span>
        <span className={cn("text-xs font-mono font-bold tabular-nums", breakdownColorClass(value))}>
          {pct}%
        </span>
      </div>
      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", breakdownBarColor(value))}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
        />
      </div>
    </div>
  );
}

function SummaryMetric({
  id,
  label,
  value,
  description,
}: {
  id: string;
  label: string;
  value: string;
  description: string;
}) {
  return (
    <div
      id={id}
      className="border border-[#d9d0c9]/70 bg-[#f7f7f7] px-3 py-2"
      title={description}
    >
      <p id={`${id}-label`} className="text-[0.6875rem] font-semibold text-[#0e0907]/50">
        {label}
      </p>
      <p id={`${id}-value`} className="mt-1 font-mono text-[0.875rem] font-semibold tabular-nums text-[#0e0907]">
        {value}
      </p>
    </div>
  );
}

function gradeToneClass(score: number): string {
  if (score >= 8) return "border-green-500/35 bg-green-500/10 text-green-700 dark:text-green-300";
  if (score >= 6) return "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "border-red-500/35 bg-red-500/10 text-red-700 dark:text-red-300";
}

function deltaLabel(score: number, rotationScore?: number): string {
  if (rotationScore == null) return "No Median";
  const delta = Math.round((rotationScore - score) * 10) / 10;
  if (Math.abs(delta) < 0.05) return "Even";
  return `${delta > 0 ? "+" : ""}${delta.toFixed(1)}`;
}

function deltaToneClass(score: number, rotationScore?: number): string {
  if (rotationScore == null) return "text-[#0e0907]/35";
  const delta = rotationScore - score;
  if (delta >= 0.25) return "text-green-600";
  if (delta <= -0.75) return "text-red-600";
  return "text-[#0e0907]/45";
}

/** A scouting-grade tile for 0-10 subscore values. */
function SubscoreGrade({
  id,
  label,
  score,
  rotationScore,
  description,
  hideRotation = false,
  medianLabel = "Rotation Median",
  medianExplainer,
  isExpandable = false,
  isExpanded = false,
  onToggle,
}: {
  id: string;
  label: string;
  score: number;
  rotationScore?: number;
  description: string;
  hideRotation?: boolean;
  medianLabel?: string;
  /** #103 (ADR 0007): hover read naming what the Rotation Median is made of. */
  medianExplainer?: string;
  /** #93: the tile opens its Attribution Ledger on click. */
  isExpandable?: boolean;
  isExpanded?: boolean;
  onToggle?: () => void;
}) {
  const rounded = Math.round(score * 10) / 10;
  const hasRotation = rotationScore != null;
  const rotRounded = hasRotation ? Math.round(rotationScore * 10) / 10 : 0;
  const grade = gradeForScore(score);
  return (
    <div
      id={id}
      className={cn(
        "grid min-h-[88px] grid-cols-[3.25rem_minmax(0,1fr)] border border-[#d9d0c9]/70 bg-[#f7f7f7] transition-colors hover:border-[#ffa05c]/55",
        isExpandable && "cursor-pointer",
        isExpanded && "border-[#ffa05c]/70",
      )}
      title={isExpandable ? description : `${description} Attribution breakdown not available for this formula shape.`}
      role={isExpandable ? "button" : undefined}
      tabIndex={isExpandable ? 0 : undefined}
      aria-label={isExpandable ? `${label}: open attribution breakdown` : undefined}
      aria-expanded={isExpandable ? isExpanded : undefined}
      onClick={onToggle}
      onKeyDown={
        isExpandable && onToggle
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onToggle();
              }
            }
          : undefined
      }
    >
      <div
        id={`${id}-grade`}
        className={cn(
          "flex items-center justify-center border-r px-2 font-mono text-lg font-bold tabular-nums",
          gradeToneClass(score),
        )}
      >
        {grade}
      </div>
      <div className="min-w-0 px-3 py-2">
        <p id={`${id}-label`} className="flex items-center justify-between gap-2 text-xs font-semibold text-[#0e0907]">
          <span className="truncate">{label}</span>
          {isExpandable && (
            <span
              id={`${id}-why`}
              className={cn(
                "shrink-0 font-mono text-[0.625rem] font-normal",
                isExpanded ? "text-[#a34400]" : "text-[#0e0907]/40",
              )}
              aria-hidden="true"
            >
              {isExpanded ? "why ▾" : "why ▸"}
            </span>
          )}
        </p>
        <div className="mt-2 grid gap-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[0.6875rem] text-[#0e0907]/48">Starting Lineup</span>
            <span className={cn("font-mono text-xs font-bold tabular-nums", subscoreColorClass(score))}>
              {rounded.toFixed(1)}
            </span>
          </div>
          {!hideRotation && (
            <>
              <div
                id={`${id}-rotation-row`}
                className={cn("flex items-center justify-between gap-3", medianExplainer && "cursor-help")}
                title={medianExplainer}
              >
                <span className="text-[0.6875rem] text-[#0e0907]/48">{medianLabel}</span>
                <span
                  id={`${id}-rotation`}
                  className={cn("font-mono text-xs tabular-nums", hasRotation ? subscoreColorClass(rotationScore) : "text-[#0e0907]/35")}
                >
                  {hasRotation ? rotRounded.toFixed(1) : "--"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-[#d9d0c9]/60 pt-1">
                <span className="text-[0.625rem] text-[#0e0907]/38">Durability</span>
                <span id={`${id}-delta`} className={cn("font-mono text-[0.6875rem] tabular-nums", deltaToneClass(score, rotationScore))}>
                  {deltaLabel(score, rotationScore)}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// SUBSCORE_GROUPS imported from @/lib/cohesion-constants

// ---------------------------------------------------------------------------
// CohesionScoreDisplay
// ---------------------------------------------------------------------------

interface CohesionScoreDisplayProps {
  evaluation: RosterEvaluation;
  /** When true, hide rotation/bench sections and relabel for pure lineup eval. */
  isLineupOnly?: boolean;
  /** Team label derived from the RuleSet (e.g. "Lineup", "Rotation", "Roster"). Falls back to isLineupOnly toggle. */
  teamLabel?: string;
}

// #89 sequential cause-reveal: glyph vertices land first (0-550ms), factors and
// tiles follow, the star total lands last — whole sequence under ~1s.
const FACTOR_REVEAL_BASE_MS = 150;
const FACTOR_REVEAL_STEP_MS = 70;
const TILE_REVEAL_BASE_MS = 300;
const TILE_REVEAL_STEP_MS = 40;
const SCORE_REVEAL_MS = 800;

function revealStyle(delayMs: number): CSSProperties {
  return { "--reveal-delay": `${delayMs}ms` } as CSSProperties;
}

const LINEUP_ONLY_FACTOR_KEYS = new Set(["starting_5", "archetype_diversity"]);
const LINEUP_ONLY_LABELS: Record<string, string> = {
  starting_5: "Lineup Strength",
  archetype_diversity: "Versatility",
};

/** Starting five derivable from ledger player lines, in first-appearance order. */
function ledgerPlayers(
  breakdowns: Record<string, AttributionLedger> | null | undefined,
): { id: string; name: string }[] {
  if (!breakdowns) return [];
  const seen = new Map<string, string>();
  for (const ledger of Object.values(breakdowns)) {
    for (const line of ledger.lines) {
      if (line.kind === "player" && line.player_id && line.player_name && !seen.has(line.player_id)) {
        seen.set(line.player_id, line.player_name);
      }
    }
  }
  return Array.from(seen, ([id, name]) => ({ id, name }));
}

export function CohesionScoreDisplay({ evaluation, isLineupOnly = false, teamLabel }: CohesionScoreDisplayProps) {
  const resolvedLabel = teamLabel ?? (isLineupOnly ? "Lineup" : "Rotation");
  const { star_rating, star_rating_breakdown, starting_lineup, lineup_summary } = evaluation;

  // #93 Attribution Ledger state: one expanded subscore, one selected Player.
  const breakdowns = starting_lineup.subscore_breakdowns ?? null;
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<{ id: string; name: string } | null>(null);

  // A re-eval can swap players out from under the drilldown state — a stale
  // selection would dim the glyph for a departed player with zero markers.
  useEffect(() => {
    setExpandedKey(null);
    setSelectedPlayer(null);
  }, [evaluation]);

  const players = ledgerPlayers(breakdowns);
  const contribution = selectedPlayer && breakdowns
    ? {
        playerName: selectedPlayer.name,
        values: TEAM_SHAPE_AXES.map((axis) => {
          const line = breakdowns[axis.key]?.lines.find(
            (l) => l.kind === "player" && l.player_id === selectedPlayer.id,
          );
          return line ? line.value : null;
        }),
      }
    : null;

  const toggleExpanded = (key: string) => {
    setExpandedKey((current) => (current === key ? null : key));
  };

  const handleVertexSelect = (key: string) => {
    if (!breakdowns?.[key]) return;
    setExpandedKey(key);
    // The ledger opens inside the subscore grid — bring it into view.
    document.getElementById(`cohesion-subscore-${key}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const handleSelectPlayer = (id: string, name: string) => {
    setSelectedPlayer((current) => (current?.id === id ? null : { id, name }));
  };
  const rotationMedian = isLineupOnly ? undefined : lineup_summary.rotation_median_subscores;
  const rotationSpread = isLineupOnly ? undefined : lineup_summary.rotation_median_spread;
  const explainerFor = (key: string): string | undefined => {
    const spread = rotationSpread?.[key];
    return spread ? rotationMedianExplainer(lineup_summary.viable_lineups, spread) : undefined;
  };
  const factorEntries = Object.entries(star_rating_breakdown)
    .filter(([key]) => !isLineupOnly || LINEUP_ONLY_FACTOR_KEYS.has(key))
    .map(([key, value]) => ({
      key,
      label: isLineupOnly ? (LINEUP_ONLY_LABELS[key] ?? scoreFactorLabel(key)) : scoreFactorLabel(key),
      value,
      description: scoreFactorExplainer(key),
    }));

  return (
    <div id="cohesion-score-display" className="space-y-5 border border-[#d9d0c9] bg-[#f7f7f7] p-4 sm:p-5">

      {/* Team Shape Hero — the glyph leads, the star lands last as its caption */}
      <div
        id="cohesion-score-hero"
        role="group"
        aria-label={`Team cohesion: ${star_rating.toFixed(2)} out of 5 stars`}
        className="space-y-3"
      >
        <div id="cohesion-score-heading" className="min-w-0">
          <p className="text-xs font-semibold text-[#0e0907]/50">
            Final Team Read
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-[#0e0907]">
            {resolvedLabel} Cohesion
          </h2>
          <p className="mt-1 max-w-[62ch] text-sm leading-6 text-[#0e0907]/62">
            {isLineupOnly
              ? "The engine evaluates how these five players fit together across spacing, creation, defense, and synergy."
              : `The engine evaluates the Starting Lineup, then tests the full ${resolvedLabel} across its Lineup Combinations.`}
          </p>
        </div>
        <TeamShapeGlyph
          subscores={starting_lineup.subscores}
          medianSubscores={rotationMedian ?? null}
          medianSpread={rotationSpread ?? null}
          viableLineups={lineup_summary.viable_lineups}
          totalLineups={lineup_summary.total_lineups}
          filledCount={5}
          isRecomputing={false}
          isLineupOnly={isLineupOnly}
          staggerReveal
          onVertexSelect={breakdowns ? handleVertexSelect : undefined}
          contribution={contribution}
        />
        {/* #93 Contribution Overlay: pick a starter to mark their ledger inputs on the spokes */}
        {players.length > 0 && (
          <div id="cohesion-contribution-picker" className="flex flex-wrap items-center justify-center gap-1.5">
            <span
              className="text-[0.625rem] text-[#0e0907]/40"
              title="Markers show the player's weighted share of each subscore — their role-weighted input, not a 0-10 rating."
            >
              Who contributes where:
            </span>
            {players.map((player) => {
              const isSelected = selectedPlayer?.id === player.id;
              return (
                <button
                  key={player.id}
                  id={`cohesion-contribution-chip-${player.id}`}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => handleSelectPlayer(player.id, player.name)}
                  className={cn(
                    "border px-2 py-0.5 text-[0.6875rem] transition-colors",
                    isSelected
                      ? "border-[#0e0907] bg-[#0e0907] text-[#f7f7f7]"
                      : "border-[#d9d0c9] bg-[#f0f0f0]/60 text-[#0e0907]/65 hover:border-[#ffa05c]/70 hover:text-[#0e0907]",
                  )}
                >
                  {player.name}
                </button>
              );
            })}
          </div>
        )}
        <div className="reveal-pop flex justify-center" style={revealStyle(SCORE_REVEAL_MS)}>
          <CohesionScoreBadge
            id="cohesion-score-rating"
            value={star_rating}
            precision={2}
            featured
            ariaLabel={`Team Cohesion score: ${star_rating.toFixed(2)} out of 5`}
          />
        </div>
      </div>

      <div className="w-full h-px bg-border" />

      <div id="cohesion-rotation-summary" className={cn("grid gap-2", isLineupOnly ? "sm:grid-cols-1" : "sm:grid-cols-3")}>
        <SummaryMetric
          id="cohesion-summary-starting-lineup"
          label={isLineupOnly ? "Lineup Strength" : "Starting Lineup"}
          value={starting_lineup.cohesion_score.toFixed(2)}
          description={isLineupOnly ? "Cohesion score for this starting five." : "Cohesion score for slots 1 through 5."}
        />
        {!isLineupOnly && (
          <>
            <SummaryMetric
              id="cohesion-summary-viable-combos"
              label="Viable Combos"
              value={`${lineup_summary.viable_lineups}/${lineup_summary.total_lineups}`}
              description="Lineup Combinations above the engine viability floor."
            />
            <SummaryMetric
              id="cohesion-summary-median-combo"
              label="Median Combo"
              value={lineup_summary.median_score.toFixed(2)}
              description="Middle Lineup Combination score across the Rotation."
            />
          </>
        )}
      </div>

      <div className="w-full h-px bg-border" />

      {/* 4-Factor Breakdown (0-1 bars shown as percentages) */}
      <div id="cohesion-breakdown" className="space-y-3">
        <div>
          <p className="text-xs font-semibold text-muted-foreground">
            Score Factors
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Hover a factor for the engine read. A low factor can pull down an otherwise strong Team.
          </p>
        </div>
        {factorEntries.map((item, index) => (
          <div
            key={item.key}
            className="reveal-pop"
            style={revealStyle(FACTOR_REVEAL_BASE_MS + index * FACTOR_REVEAL_STEP_MS)}
          >
            <BreakdownBar
              id={`cohesion-breakdown-${item.key}`}
              label={item.label}
              value={item.value}
              description={item.description}
            />
          </div>
        ))}
      </div>

      <div className="w-full h-px bg-border" />

      {/* 13 Subscore Grid (0-10 scale, grouped) */}
      <div id="cohesion-subscores" className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-muted-foreground">
            Subscores
          </p>
          {!isLineupOnly && rotationMedian && Object.keys(rotationMedian).length > 0 && (
            <p id="cohesion-subscores-legend" className="text-[9px] text-muted-foreground/60">
              Starting Lineup / <span className="opacity-50">{resolvedLabel} Median</span>
            </p>
          )}
        </div>
        {SUBSCORE_GROUPS.map((group, groupIndex) => {
          const tileOffset = SUBSCORE_GROUPS
            .slice(0, groupIndex)
            .reduce((count, prior) => count + prior.entries.length, 0);
          const catKey = HEADING_TO_CATEGORY_KEY[group.heading];
          const showScore = HEADING_SHOWS_SCORE[group.heading] && catKey;
          const catScore = showScore ? starting_lineup.category_scores?.[catKey] : undefined;
          return (
            <div key={group.heading} className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium text-muted-foreground/70">
                  {group.heading}
                </p>
                {catScore !== undefined && (
                  <span className={cn("text-xs font-mono tabular-nums font-semibold", categoryScoreColor(catScore))}>
                    {(catScore * 100).toFixed(0)}%
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {group.entries.map((entry, entryIndex) => {
                  const ledger = breakdowns?.[entry.key];
                  const isExpanded = expandedKey === entry.key && !!ledger;
                  return (
                    <div
                      key={entry.key}
                      className={cn("reveal-pop", isExpanded && "col-span-2")}
                      style={revealStyle(TILE_REVEAL_BASE_MS + (tileOffset + entryIndex) * TILE_REVEAL_STEP_MS)}
                    >
                      <SubscoreGrade
                        id={`cohesion-subscore-${entry.key}`}
                        label={entry.label}
                        score={starting_lineup.subscores[entry.key] ?? 0}
                        rotationScore={rotationMedian?.[entry.key]}
                        description={SUBSCORE_DESCRIPTIONS[entry.key] ?? "Cohesion subscore used in the lineup rollup."}
                        hideRotation={isLineupOnly}
                        medianLabel={`${resolvedLabel} Median`}
                        medianExplainer={explainerFor(entry.key)}
                        isExpandable={!!ledger}
                        isExpanded={isExpanded}
                        onToggle={ledger ? () => toggleExpanded(entry.key) : undefined}
                      />
                      {isExpanded && ledger && (
                        <AttributionLedgerPanel
                          id={`cohesion-ledger-${entry.key}`}
                          subscoreLabel={entry.label}
                          ledger={ledger}
                          selectedPlayerId={selectedPlayer?.id ?? null}
                          onSelectPlayer={handleSelectPlayer}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="w-full h-px bg-border" />

      {/* Accentuation — strength amplification + weakness coverage */}
      <div id="cohesion-accentuation" className="space-y-3">
        <p className="text-xs font-semibold text-muted-foreground">
          Accentuation
        </p>
        <div className="grid grid-cols-2 gap-x-4">
          <SubscoreGrade
            id="cohesion-accentuation-strength"
            label="Strength Amp"
            score={starting_lineup.accentuation.strength_amplification}
            rotationScore={rotationMedian?.accentuation_strength}
            description={SUBSCORE_DESCRIPTIONS.accentuation_strength}
            hideRotation={isLineupOnly}
            medianLabel={`${resolvedLabel} Median`}
            medianExplainer={explainerFor("accentuation_strength")}
          />
          <SubscoreGrade
            id="cohesion-accentuation-weakness"
            label="Weakness Cover"
            score={starting_lineup.accentuation.weakness_coverage}
            rotationScore={rotationMedian?.accentuation_weakness}
            description={SUBSCORE_DESCRIPTIONS.accentuation_weakness}
            hideRotation={isLineupOnly}
            medianLabel={`${resolvedLabel} Median`}
            medianExplainer={explainerFor("accentuation_weakness")}
          />
        </div>
      </div>
    </div>
  );
}
