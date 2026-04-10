"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { getPlayerStats } from "@/lib/api";
import type { StatsBlob } from "@/lib/types";

interface PlayerStatDisplayProps {
  playerId: string;
  season?: string;
  showStabilized?: boolean;
  className?: string;
  /** Stat keys in "section.key" format to highlight (from the active skill's rule) */
  highlightedStats?: Set<string>;
  /** Skill-specific stabilized values — overrides the blob's stabilized sub-dict
   *  for the stats this skill stabilizes, so the panel matches condition evaluation */
  skillStabilizedVals?: Record<string, number>;
}

interface StatSection {
  label: string;
  key: keyof StatsBlob;
  stats: Record<string, string>;
}

/**
 * Human-readable labels for every stat key across all sections.
 * Used by StatRow for display. Keys not listed here fall back to
 * a generic title-cased string.
 */
const STAT_LABELS: Record<string, string> = {
  // Box score
  pts: "Pts",
  reb: "Reb",
  oreb: "OReb",
  dreb: "DReb",
  ast: "Ast",
  stl: "Stl",
  blk: "Blk",
  tov: "TO",
  pf: "Fouls",
  plus_minus: "+/-",
  min: "Min",
  fgm: "FGM",
  fga: "FGA",
  fg_pct: "FG%",
  fg3m: "3PM",
  fg3a: "3PA",
  fg3_pct: "3P%",
  ftm: "FTM",
  fta: "FTA",
  ft_pct: "FT%",
  // Advanced
  usg_pct: "Usage%",
  ts_pct: "TS%",
  efg_pct: "eFG%",
  off_rating: "OffRtg",
  def_rating: "DefRtg",
  net_rating: "NetRtg",
  ast_pct: "AST%",
  ast_to: "AST/TO",
  ast_ratio: "AST Ratio",
  oreb_pct: "OReb%",
  dreb_pct: "DReb%",
  reb_pct: "Reb%",
  tm_tov_pct: "TOV%",
  pace: "Pace",
  pie: "PIE",
  // Tracking — shooting (Catch & Shoot)
  catch_shoot_fgm: "Catch & Shoot FGM",
  catch_shoot_fga: "Catch & Shoot FGA",
  catch_shoot_fg_pct: "Catch & Shoot FG%",
  catch_shoot_fg3m: "Catch & Shoot 3PM",
  catch_shoot_fg3a: "Catch & Shoot 3PA",
  catch_shoot_fg3_pct: "Catch & Shoot 3P%",
  catch_shoot_pts: "Catch & Shoot Pts",
  // Tracking — shooting (Pull-Up)
  pullup_fgm: "Pull-Up FGM",
  pullup_fga: "Pull-Up FGA",
  pullup_fg_pct: "Pull-Up FG%",
  pullup_fg3m: "Pull-Up 3PM",
  pullup_fg3a: "Pull-Up 3PA",
  pullup_fg3_pct: "Pull-Up 3P%",
  pullup_pts: "Pull-Up Pts",
  // Tracking — drives
  drives: "Drives",
  drive_pts: "Drive Pts",
  drive_fg_pct: "Drive FG%",
  drive_ast: "Drive Ast",
  drive_tov: "Drive TO",
  drive_pf: "Drive Fouls",
  drive_fga: "Drive FGA",
  drive_fgm: "Drive FGM",
  // Tracking — passing
  passes_made: "Passes Made",
  passes_received: "Passes Rec",
  potential_ast: "Pot Ast",
  ast_pts_created: "Ast Pts Created",
  // Tracking — defense
  def_at_rim_fga: "Rim Att Def",
  def_at_rim_fgm: "Rim FGM Allowed",
  defended_at_rim_fg_pct: "Rim FG% Allowed",
  matchup_zone_time: "Zone Time",
  // Tracking — possessions / touches
  touches: "Touches",
  front_ct_touches: "Front Ct Touches",
  time_of_poss: "Time of Poss",
  elbow_touches: "Elbow Touches",
  paint_touches: "Paint Touches",
  post_touches: "Post Touches",
  // Shot zones
  restricted_area_fga: "RA Att",
  restricted_area_fgm: "RA Made",
  restricted_area_fg_pct: "RA FG%",
  paint_non_ra_fga: "Paint Att",
  paint_non_ra_fgm: "Paint Made",
  paint_non_ra_fg_pct: "Paint FG%",
  mid_range_fga: "Mid Att",
  mid_range_fgm: "Mid Made",
  mid_range_fg_pct: "Mid FG%",
  corner3_fga: "Corner 3 Att",
  corner3_fgm: "Corner 3 Made",
  corner3_fg_pct: "Corner 3%",
  atb3_fga: "ATB 3 Att",
  atb3_fgm: "ATB 3 Made",
  atb3_fg_pct: "ATB 3%",
  // Shot detail
  dunks_fga: "Dunks",
  tip_shots_fga: "Tip Shots",
  floating_jump_shot_fga: "Floater Att",
  floating_jump_shot_fg_pct: "Floater FG%",
  // Play types
  spotup_poss: "Spot-up Poss",
  spotup_ppp: "Spot-up PPP",
  spotup_freq: "Spot-up Freq",
  transition_poss: "Trans Poss",
  transition_ppp: "Trans PPP",
  transition_freq: "Trans Freq",
  isolation_poss: "ISO Poss",
  isolation_ppp: "ISO PPP",
  isolation_freq: "ISO Freq",
  pr_ball_handler_poss: "PnR BH Poss",
  pr_ball_handler_ppp: "PnR BH PPP",
  pr_ball_handler_freq: "PnR BH Freq",
  pr_roll_man_poss: "PnR Roll Poss",
  pr_roll_man_ppp: "PnR Roll PPP",
  pr_roll_man_freq: "PnR Roll Freq",
  postup_poss: "Post Poss",
  postup_ppp: "Post PPP",
  postup_freq: "Post Freq",
  handoff_poss: "Handoff Poss",
  handoff_ppp: "Handoff PPP",
  handoff_freq: "Handoff Freq",
  cut_poss: "Cut Poss",
  cut_ppp: "Cut PPP",
  cut_freq: "Cut Freq",
  offscreen_poss: "Off Screen Poss",
  offscreen_ppp: "Off Screen PPP",
  offscreen_freq: "Off Screen Freq",
  // Hustle
  contested_shots: "Contested Shots",
  contested_shots_2pt: "Cont 2PT",
  contested_shots_3pt: "Cont 3PT",
  deflections: "Deflections",
  loose_balls_recovered: "Loose Balls",
  charges_drawn: "Charges Drawn",
  screen_assists: "Screen Ast",
  screen_ast_pts: "Screen Ast Pts",
  box_outs_off: "Off Box Outs",
  box_outs_def: "Def Box Outs",
  // Matchup defense
  partial_possessions: "Matchup Poss",
  matchup_fg_pct: "Matchup FG%",
  matchup_3pt_fg_pct: "Matchup 3P%",
  switches_on: "Switches",
  // Salary
  annual_salary: "Annual Salary",
};

/**
 * Explicit display order for each section. Keys listed first; any
 * remaining keys in the data not covered here are appended after.
 */
const STAT_ORDER: Record<string, string[]> = {
  box_score: [
    "pts", "reb", "ast", "stl", "blk", "tov", "pf", "plus_minus",
    "fgm", "fga", "fg_pct",
    "fg3m", "fg3a", "fg3_pct",
    "ftm", "fta", "ft_pct",
    "oreb", "dreb",
    "min",
  ],
  advanced: [
    "usg_pct", "ts_pct", "efg_pct",
    "off_rating", "def_rating", "net_rating",
    "ast_pct", "ast_to", "ast_ratio",
    "oreb_pct", "dreb_pct", "reb_pct",
    "tm_tov_pct", "pace", "pie",
  ],
  tracking_shooting: [
    "catch_shoot_fg3m", "catch_shoot_fg3a", "catch_shoot_fg3_pct",
    "catch_shoot_fgm", "catch_shoot_fga", "catch_shoot_fg_pct",
    "catch_shoot_pts",
    "pullup_fg3m", "pullup_fg3a", "pullup_fg3_pct",
    "pullup_fgm", "pullup_fga", "pullup_fg_pct",
    "pullup_pts",
  ],
  tracking_drives: [
    "drives", "drive_pts", "drive_fg_pct", "drive_fgm", "drive_fga",
    "drive_ast", "drive_tov", "drive_pf",
  ],
  tracking_passing: [
    "passes_made", "passes_received", "ast", "potential_ast", "ast_pts_created",
  ],
  tracking_defense: [
    "def_at_rim_fgm", "def_at_rim_fga", "defended_at_rim_fg_pct", "matchup_zone_time",
  ],
  tracking_possessions: [
    "touches", "front_ct_touches", "time_of_poss", "elbow_touches",
  ],
  tracking_touches: [
    "paint_touches", "post_touches", "elbow_touches",
  ],
  shot_zones: [
    "restricted_area_fgm", "restricted_area_fga", "restricted_area_fg_pct",
    "paint_non_ra_fgm", "paint_non_ra_fga", "paint_non_ra_fg_pct",
    "mid_range_fgm", "mid_range_fga", "mid_range_fg_pct",
    "corner3_fgm", "corner3_fga", "corner3_fg_pct",
    "atb3_fgm", "atb3_fga", "atb3_fg_pct",
  ],
  shot_detail: [
    "dunks_fga", "tip_shots_fga", "floating_jump_shot_fga", "floating_jump_shot_fg_pct",
  ],
  play_type: [
    "transition_poss", "transition_ppp", "transition_freq",
    "spotup_poss", "spotup_ppp", "spotup_freq",
    "isolation_poss", "isolation_ppp", "isolation_freq",
    "pr_ball_handler_poss", "pr_ball_handler_ppp", "pr_ball_handler_freq",
    "pr_roll_man_poss", "pr_roll_man_ppp", "pr_roll_man_freq",
    "postup_poss", "postup_ppp", "postup_freq",
    "handoff_poss", "handoff_ppp", "handoff_freq",
    "cut_poss", "cut_ppp", "cut_freq",
    "offscreen_poss", "offscreen_ppp", "offscreen_freq",
  ],
  hustle: [
    "contested_shots", "contested_shots_2pt", "contested_shots_3pt",
    "deflections", "loose_balls_recovered", "charges_drawn",
    "screen_assists", "screen_ast_pts",
    "box_outs_off", "box_outs_def",
  ],
  matchup_defense: [
    "partial_possessions", "matchup_fg_pct", "matchup_3pt_fg_pct", "switches_on",
  ],
  salary: ["annual_salary"],
};

const SECTION_LABELS: Record<string, string> = {
  box_score: "Box Score",
  advanced: "Advanced",
  tracking_shooting: "Tracking — Shooting",
  tracking_drives: "Tracking — Drives",
  tracking_passing: "Tracking — Passing",
  tracking_defense: "Tracking — Defense",
  tracking_possessions: "Tracking — Possessions",
  tracking_touches: "Tracking — Paint/Post/Elbow",
  shot_zones: "Shot Zones",
  shot_detail: "Shot Detail",
  play_type: "Play Types",
  hustle: "Hustle",
  matchup_defense: "Matchup Defense",
  salary: "Salary",
};

function formatStatValue(key: string, value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  // Format percentages (keys ending in _pct or _freq)
  if (key.endsWith("_pct") || key.endsWith("_freq")) {
    return (value * 100).toFixed(1) + "%";
  }
  // Format salary
  if (key === "annual_salary") {
    return "$" + (value / 1_000_000).toFixed(2) + "M";
  }
  // Format integers
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toFixed(2);
}

function StatRow({
  statKey,
  rawValue,
  stabilizedValue,
  showStabilized,
  highlighted,
}: {
  statKey: string;
  rawValue: number | null | undefined;
  stabilizedValue?: number;
  showStabilized: boolean;
  highlighted?: boolean;
}) {
  // Look up the flat label map; fall back to title-casing the raw key
  const label =
    STAT_LABELS[statKey] ??
    statKey
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  const displayValue =
    showStabilized && stabilizedValue !== undefined
      ? stabilizedValue
      : rawValue;

  // Flag stabilized values that differ from raw by more than 2%
  const isSignificantlyStabilized =
    showStabilized &&
    stabilizedValue !== undefined &&
    rawValue !== null &&
    rawValue !== undefined &&
    Math.abs(stabilizedValue - rawValue) > 0.02;

  if (rawValue === null || rawValue === undefined) {
    return (
      <div className={cn(
        "flex items-center justify-between py-0.5 px-1 rounded text-sm",
        highlighted && "bg-amber-50 border-l-2 border-amber-400 pl-1.5"
      )}>
        <span className={cn("text-xs", highlighted ? "text-foreground font-semibold" : "text-muted-foreground")}>{label}</span>
        <span className="text-muted-foreground text-xs">—</span>
      </div>
    );
  }

  return (
    <div className={cn(
      "flex items-center justify-between py-0.5 px-1 rounded text-sm",
      highlighted && "bg-amber-50 border-l-2 border-amber-400 pl-1.5"
    )}>
      <span className={cn("text-xs", highlighted ? "text-foreground font-semibold" : "text-muted-foreground")}>{label}</span>
      <span
        className={cn(
          "font-medium tabular-nums text-xs",
          isSignificantlyStabilized && "text-amber-600"
        )}
        title={
          isSignificantlyStabilized
            ? `Raw: ${formatStatValue(statKey, rawValue)}, Stabilized: ${formatStatValue(statKey, stabilizedValue)}`
            : undefined
        }
      >
        {formatStatValue(statKey, displayValue ?? null)}
        {isSignificantlyStabilized && (
          <span className="ml-0.5 text-amber-400" title="Stabilized value differs from raw">
            ~
          </span>
        )}
      </span>
    </div>
  );
}

function StatSection({
  label,
  sectionKey,
  data,
  stabilized,
  showStabilized,
  highlightedStats,
}: {
  label: string;
  sectionKey: string;
  data: Record<string, number | null> | undefined;
  stabilized: Record<string, number> | undefined;
  showStabilized: boolean;
  highlightedStats?: Set<string>;
}) {
  // Sort keys by the defined display order; unlisted keys come after
  const rawKeys = data ? Object.keys(data) : [];
  const order = STAT_ORDER[sectionKey] ?? [];
  const orderedKeys = [
    ...order.filter((k) => rawKeys.includes(k)),
    ...rawKeys.filter((k) => !order.includes(k)),
  ];

  // Auto-open this section if it contains any highlighted stats
  const hasHighlight = highlightedStats
    ? orderedKeys.some((k) => highlightedStats.has(`${sectionKey}.${k}`))
    : false;
  const [open, setOpen] = useState(true);
  // Expand when highlighted stats change (e.g. skill selection changes)
  useEffect(() => {
    if (hasHighlight) setOpen(true);
  }, [hasHighlight]);

  if (orderedKeys.length === 0) return null;

  return (
    <div className="border border-border rounded-md overflow-hidden">
      {/* Section header — click to collapse */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
      >
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-foreground">{label}</span>
          {hasHighlight && (
            <span className="inline-block size-1.5 rounded-full bg-primary" title="Contains stats used by this skill" />
          )}
        </div>
        <span className="text-muted-foreground text-xs">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="px-3 py-2 grid grid-cols-1 gap-0.5">
          {orderedKeys.map((key) => {
            // Stabilized values are stored as "section.key" in the blob
            const dotKey = `${sectionKey}.${key}`;
            return (
              <StatRow
                key={key}
                statKey={key}
                rawValue={data![key]}
                stabilizedValue={stabilized?.[dotKey]}
                showStabilized={showStabilized}
                highlighted={highlightedStats?.has(dotKey)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Displays the full statistical profile for a player in collapsible sections.
 * Supports stabilized/raw toggle — stabilized values that differ from raw by >2%
 * are highlighted in amber.
 *
 * Reused in: calibration, review panel, player profile, roster builder.
 */
export function PlayerStatDisplay({
  playerId,
  season,
  showStabilized: externalShowStabilized,
  className,
  highlightedStats,
  skillStabilizedVals,
}: PlayerStatDisplayProps) {
  const [stats, setStats] = useState<StatsBlob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Internal toggle if the parent doesn't control it
  const [internalShowStabilized, setInternalShowStabilized] = useState(true);

  const showStabilized = externalShowStabilized ?? internalShowStabilized;

  useEffect(() => {
    if (!playerId) return;
    setLoading(true);
    setError(null);
    getPlayerStats(playerId, season)
      .then((res) => {
        if (res.success && res.data) {
          setStats(res.data);
        } else {
          setError(res.error ?? "Failed to load stats");
        }
      })
      .catch(() => setError("Failed to load stats"))
      .finally(() => setLoading(false));
  }, [playerId, season]);

  if (loading) {
    return (
      <div className={cn("space-y-2 animate-pulse", className)}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 bg-muted rounded-md" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive", className)}>
        {error}
      </div>
    );
  }

  if (!stats) return null;

  // Merge skill-specific stabilized values over the blob's stabilized sub-dict.
  // Skill values take precedence so the panel shows the same Bayesian-adjusted
  // numbers that the condition evaluator actually used.
  const blobStabilized = stats.stabilized as Record<string, number> | undefined;
  const stabilized: Record<string, number> | undefined =
    skillStabilizedVals && Object.keys(skillStabilizedVals).length > 0
      ? { ...(blobStabilized ?? {}), ...skillStabilizedVals }
      : blobStabilized;
  const sections = Object.keys(SECTION_LABELS) as (keyof StatsBlob)[];

  return (
    <div className={cn("space-y-2", className)}>
      {/* Stabilized/Raw toggle — only shown when not externally controlled */}
      {externalShowStabilized === undefined && (
        <div className="flex items-center gap-2 pb-1">
          <span className="text-xs text-muted-foreground">Display:</span>
          <button
            type="button"
            onClick={() => setInternalShowStabilized((v) => !v)}
            className={cn(
              "relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors",
              internalShowStabilized
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted text-muted-foreground border-border"
            )}
          >
            {internalShowStabilized ? "Stabilized" : "Raw"}
          </button>
        </div>
      )}

      {sections.map((sectionKey) => {
        const sectionData = stats[sectionKey] as Record<string, number | null> | undefined;
        if (!sectionData) return null;
        return (
          <StatSection
            key={sectionKey as string}
            label={SECTION_LABELS[sectionKey as string] ?? String(sectionKey)}
            sectionKey={sectionKey as string}
            data={sectionData}
            stabilized={stabilized}
            showStabilized={showStabilized}
            highlightedStats={highlightedStats}
          />
        );
      })}
    </div>
  );
}
