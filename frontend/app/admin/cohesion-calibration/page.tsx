"use client";

/**
 * Cohesion Calibration Page — Admin tool for inspecting and tuning the cohesion engine.
 *
 * Three-panel layout (mirrors existing /admin/calibration pattern):
 *   Left (~380px):  PlayerCompositePanel — search + composite bars + bell curve overlay
 *   Center (flex):  Tabbed — "Bell Curves" | "Lineup Tester" | "Weights"
 *   Right (~320px): ResultsPanel — test history with before/after comparison
 *
 * All state lifted to page level. No global stores.
 */

import { useState, useCallback, useMemo } from "react";
import { Toaster, toast } from "sonner";
import { cn } from "@/lib/utils";
import { PlayerSearchCombobox } from "@/components/PlayerSearchCombobox";
import {
  fetchPlayerComposites,
  fetchBellCurve,
  evaluateLineup,
  fetchCohesionWeights,
  updateCohesionWeights,
} from "@/lib/api";
import type { Player } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Composite data for one player, fetched from GET /api/cohesion/player/<id>/composites. */
interface PlayerCompositeData {
  player_id: string;
  name: string;
  height: string | null;
  composites_normalized: Record<string, number>;
  bell_curve: {
    amplitude: number;
    peak: number;
    range_down: number;
    range_up: number;
    flat_down: number;
    flat_up: number;
  };
}

/** Bell curve data for one player, fetched from GET /api/cohesion/bell-curve/<id>. */
interface BellCurveData {
  player_id: string;
  name: string;
  curve: { height: number; height_display: string; value: number }[];
}

/** Lineup test result from POST /api/cohesion/lineup/evaluate. */
interface LineupTestResult {
  id: string;
  timestamp: number;
  playerNames: string[];
  cohesion_score: number;
  subscores: Record<string, number>;
  synergies_applied: string[];
  accentuation: { strength_amplification: number; weakness_coverage: number };
}

/** A player slot in the lineup tester. */
interface LineupSlot {
  player: Player | null;
  skills: Record<string, string>;
  height: string | null;
}

type CenterTab = "bell_curves" | "lineup" | "weights";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMPOSITE_LABELS: { key: string; label: string }[] = [
  { key: "spacing", label: "Spacing" },
  { key: "finishing", label: "Finishing" },
  { key: "paint_touch", label: "Paint Touch" },
  { key: "anchor", label: "Anchor" },
  { key: "post_game", label: "Post Game" },
  { key: "pnr_screener", label: "PnR Screener" },
  { key: "off_ball_impact", label: "Off-Ball Impact" },
  { key: "shot_creation", label: "Shot Creation" },
  { key: "rebounding", label: "Rebounding" },
  { key: "transition", label: "Transition" },
];

/** Distinct colors for overlaying bell curves (same as CohesionDebugPanel). */
const PLAYER_COLORS = [
  "#3b82f6", "#ef4444", "#22c55e", "#f59e0b",
  "#a855f7", "#ec4899", "#06b6d4", "#f97316",
];

// Bell curve chart range: 6'0" (72in) to 7'4" (88in)
const BELL_MIN_IN = 72;
const BELL_MAX_IN = 88;

const SUBSCORE_LABELS: Record<string, string> = {
  spacing_creation_ratio: "Spacing / Creation",
  spacing_paint_touch_ratio: "Spacing / Paint Touch",
  rebound_transition_ratio: "Rebound / Transition",
  rebounding_spacing_deficit: "Rebound–Spacing Gap",
  paint_touch_total: "Paint Touch",
  post_game_total: "Post Game",
  pnr_screener_total: "PnR Screener",
  anchor_total: "Anchor",
  collective_passing: "Passing",
  rebounding: "Rebounding",
  transition: "Transition",
  defensive_coverage: "Def Coverage",
  defensive_gaps: "Def Gaps",
};

// ---------------------------------------------------------------------------
// Color utilities
// ---------------------------------------------------------------------------

function compositeBarColor(score: number): string {
  if (score >= 8) return "bg-green-500";
  if (score >= 6) return "bg-green-600/60";
  if (score >= 4) return "bg-amber-500";
  if (score >= 2) return "bg-red-500/70";
  return "bg-red-600";
}

function subscoreColor(score: number): string {
  if (score >= 7) return "text-green-400";
  if (score >= 4) return "text-amber-400";
  return "text-red-400";
}

function subscoreBarFill(score: number): string {
  if (score >= 7) return "bg-green-500";
  if (score >= 4) return "bg-amber-500";
  return "bg-red-500";
}

// ---------------------------------------------------------------------------
// Sub-components: Left Panel
// ---------------------------------------------------------------------------

interface CompositeBarsProps {
  composites: Record<string, number>;
}

/** Horizontal bars for 10 composites (0-10 scale). */
function CompositeBars({ composites }: CompositeBarsProps) {
  return (
    <div id="cohesion-cal-composites" className="space-y-1.5">
      {COMPOSITE_LABELS.map(({ key, label }) => {
        const score = composites[key] ?? 0;
        const rounded = Math.round(score * 10) / 10;
        const widthPct = Math.max(0, Math.min(100, (score / 10) * 100));
        return (
          <div key={key} id={`cohesion-cal-composite-${key}`} className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-20 truncate" title={label}>
              {label}
            </span>
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all duration-300", compositeBarColor(score))}
                style={{ width: `${widthPct}%` }}
              />
            </div>
            <span className="text-[10px] font-mono tabular-nums text-foreground w-7 text-right">
              {rounded.toFixed(1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components: Bell Curve Visualizer
// ---------------------------------------------------------------------------

interface BellCurveChartProps {
  overlayPlayers: BellCurveData[];
  onRemovePlayer: (playerId: string) => void;
}

/** SVG bell curve overlay chart — one line per player. */
function BellCurveChart({ overlayPlayers, onRemovePlayer }: BellCurveChartProps) {
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
        <div id="cohesion-cal-bellcurve-legend" className="flex flex-wrap gap-2 mt-2">
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
// Sub-components: Lineup Tester
// ---------------------------------------------------------------------------

interface LineupTesterProps {
  lineupSlots: LineupSlot[];
  onSlotSelect: (index: number, player: Player) => void;
  onEvaluate: () => void;
  evaluating: boolean;
  latestResult: LineupTestResult | null;
}

/** 5-player slot picker + evaluate button + result display. */
function LineupTester({ lineupSlots, onSlotSelect, onEvaluate, evaluating, latestResult }: LineupTesterProps) {
  const filledCount = lineupSlots.filter((s) => s.player !== null).length;

  return (
    <div id="cohesion-cal-lineup-tester" className="space-y-4">
      {/* 5 player slot pickers */}
      <div className="space-y-2">
        {lineupSlots.map((slot, i) => (
          <div key={i} id={`cohesion-cal-lineup-slot-${i}`} className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-4">{i + 1}.</span>
            {slot.player ? (
              <span className="text-xs text-foreground font-medium truncate flex-1">
                {slot.player.name}
              </span>
            ) : (
              <div className="flex-1">
                <PlayerSearchCombobox
                  onSelect={(p) => onSlotSelect(i, p)}
                  placeholder={`Slot ${i + 1}…`}
                  className="text-xs"
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Evaluate button */}
      <button
        id="cohesion-cal-evaluate-lineup-btn"
        type="button"
        disabled={filledCount < 5 || evaluating}
        onClick={onEvaluate}
        className={cn(
          "w-full text-xs font-medium py-2 rounded-md border transition-colors cursor-pointer",
          filledCount >= 5 && !evaluating
            ? "bg-primary text-primary-foreground hover:bg-primary/90 border-primary"
            : "bg-muted text-muted-foreground border-border cursor-not-allowed",
        )}
      >
        {evaluating ? "Evaluating…" : `Evaluate Lineup (${filledCount}/5)`}
      </button>

      {/* Latest result inline */}
      {latestResult && (
        <div id="cohesion-cal-lineup-result" className="rounded-lg border border-border bg-card p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Cohesion Score
            </span>
            <span className={cn("text-lg font-bold font-mono tabular-nums", subscoreColor(latestResult.cohesion_score * 2))}>
              {latestResult.cohesion_score.toFixed(2)}
            </span>
          </div>

          {/* Subscores grid */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {Object.entries(latestResult.subscores).map(([key, val]) => {
              const widthPct = Math.max(0, Math.min(100, (val / 10) * 100));
              return (
                <div key={key} className="flex flex-col gap-0.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] text-muted-foreground">{SUBSCORE_LABELS[key] ?? key}</span>
                    <span className={cn("text-[8px] font-mono tabular-nums font-bold", subscoreColor(val))}>
                      {val.toFixed(1)}
                    </span>
                  </div>
                  <div className="h-0.5 w-full bg-muted rounded-full overflow-hidden">
                    <div className={cn("h-full rounded-full", subscoreBarFill(val))} style={{ width: `${widthPct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Synergies chips */}
          {latestResult.synergies_applied.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {latestResult.synergies_applied.map((s, idx) => {
                const colorClass = s.startsWith("OFF")
                  ? "bg-blue-500/20 text-blue-300 border-blue-500/30"
                  : s.startsWith("DEF")
                    ? "bg-violet-500/20 text-violet-300 border-violet-500/30"
                    : "bg-amber-500/20 text-amber-300 border-amber-500/30";
                return (
                  <span key={`${s}-${idx}`} className={cn("text-[8px] font-mono px-1 py-0.5 rounded border", colorClass)}>
                    {s}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components: Weights Editor
// ---------------------------------------------------------------------------

interface WeightsEditorProps {
  onWeightsUpdated: () => void;
}

/** Monaco JSON editor for weight overrides with test/save/reset. */
function WeightsEditor({ onWeightsUpdated }: WeightsEditorProps) {
  const [editorContent, setEditorContent] = useState<string>("{}");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Lazy import Monaco to avoid SSR issues
  const [MonacoEditor, setMonacoEditor] = useState<typeof import("@monaco-editor/react").default | null>(null);

  // Load Monaco lazily on mount
  useState(() => {
    import("@monaco-editor/react").then((mod) => setMonacoEditor(() => mod.default));
  });

  // Fetch current weights on mount
  useState(() => {
    fetchCohesionWeights().then((res) => {
      if (res.success && res.data) {
        setEditorContent(JSON.stringify(res.data, null, 2));
      }
      setLoading(false);
    });
  });

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const parsed = JSON.parse(editorContent);
      const res = await updateCohesionWeights(parsed);
      if (res.success) {
        toast.success("Weight overrides applied");
        onWeightsUpdated();
      } else {
        toast.error(res.error ?? "Failed to save weights");
      }
    } catch {
      toast.error("Invalid JSON");
    } finally {
      setSaving(false);
    }
  }, [editorContent, onWeightsUpdated]);

  const handleReset = useCallback(async () => {
    // Reset by sending empty overrides, then refetch
    const res = await updateCohesionWeights({});
    if (res.success && res.data) {
      setEditorContent(JSON.stringify(res.data, null, 2));
      toast.success("Weights reset to defaults");
      onWeightsUpdated();
    }
  }, [onWeightsUpdated]);

  if (loading) {
    return <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">Loading weights…</div>;
  }

  return (
    <div id="cohesion-cal-weights-editor" className="space-y-3 h-full flex flex-col">
      {/* Monaco editor */}
      <div className="flex-1 min-h-0 rounded-md border border-border overflow-hidden">
        {MonacoEditor ? (
          <MonacoEditor
            height="100%"
            language="json"
            theme="vs-dark"
            value={editorContent}
            onChange={(v) => setEditorContent(v ?? "{}")}
            options={{
              minimap: { enabled: false },
              fontSize: 11,
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              wordWrap: "on",
              tabSize: 2,
            }}
          />
        ) : (
          <textarea
            id="cohesion-cal-weights-textarea"
            value={editorContent}
            onChange={(e) => setEditorContent(e.target.value)}
            className="w-full h-full bg-background text-foreground font-mono text-xs p-3 resize-none focus:outline-none"
            spellCheck={false}
          />
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          id="cohesion-cal-weights-save-btn"
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="flex-1 text-xs font-medium py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save Overrides"}
        </button>
        <button
          id="cohesion-cal-weights-reset-btn"
          type="button"
          onClick={handleReset}
          className="text-xs font-medium py-1.5 px-3 rounded-md border border-border hover:bg-muted text-muted-foreground transition-colors cursor-pointer"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components: Results Panel
// ---------------------------------------------------------------------------

interface ResultsPanelProps {
  testHistory: LineupTestResult[];
}

/** Session history of lineup evaluations (LIFO, collapsible). */
function ResultsPanel({ testHistory }: ResultsPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (testHistory.length === 0) {
    return (
      <div id="cohesion-cal-results-empty" className="flex items-center justify-center h-full text-xs text-muted-foreground/50">
        No test results yet
      </div>
    );
  }

  return (
    <div id="cohesion-cal-results" className="space-y-1.5 overflow-y-auto">
      {testHistory.map((result, idx) => {
        const isExpanded = expandedId === result.id;
        const prevResult = testHistory[idx + 1]; // older result (LIFO)
        const delta = prevResult ? result.cohesion_score - prevResult.cohesion_score : null;

        return (
          <button
            key={result.id}
            type="button"
            onClick={() => setExpandedId(isExpanded ? null : result.id)}
            className="w-full text-left rounded-md border border-border bg-card hover:bg-muted/50 transition-colors p-2.5 cursor-pointer"
          >
            {/* Summary row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[9px] text-muted-foreground tabular-nums">
                  {new Date(result.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="text-[10px] text-foreground truncate">
                  {result.playerNames.slice(0, 3).join(", ")}
                  {result.playerNames.length > 3 && ` +${result.playerNames.length - 3}`}
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className={cn("text-xs font-mono font-bold tabular-nums", subscoreColor(result.cohesion_score * 2))}>
                  {result.cohesion_score.toFixed(2)}
                </span>
                {delta !== null && (
                  <span className={cn("text-[9px] font-mono tabular-nums", delta >= 0 ? "text-green-400" : "text-red-400")}>
                    {delta >= 0 ? "+" : ""}{delta.toFixed(2)}
                  </span>
                )}
              </div>
            </div>

            {/* Expanded detail */}
            {isExpanded && (
              <div className="mt-2 pt-2 border-t border-border/50 space-y-2" onClick={(e) => e.stopPropagation()}>
                {/* Full player names */}
                <p className="text-[9px] text-muted-foreground">{result.playerNames.join(" / ")}</p>
                {/* Subscores */}
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                  {Object.entries(result.subscores).map(([key, val]) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-[8px] text-muted-foreground">{SUBSCORE_LABELS[key] ?? key}</span>
                      <span className={cn("text-[8px] font-mono tabular-nums", subscoreColor(val))}>{val.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
                {/* Synergies */}
                {result.synergies_applied.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {result.synergies_applied.map((s, i) => (
                      <span key={`${s}-${i}`} className="text-[7px] font-mono text-muted-foreground bg-muted px-1 rounded">
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

const EMPTY_LINEUP: LineupSlot[] = Array.from({ length: 5 }, () => ({
  player: null,
  skills: {},
  height: null,
}));

export default function CohesionCalibrationPage() {
  // --- Left panel state ---
  const [selectedComposites, setSelectedComposites] = useState<PlayerCompositeData | null>(null);
  const [loadingComposites, setLoadingComposites] = useState(false);

  // --- Bell curve overlay state ---
  const [overlayPlayers, setOverlayPlayers] = useState<BellCurveData[]>([]);

  // --- Center tab state ---
  const [centerTab, setCenterTab] = useState<CenterTab>("bell_curves");

  // --- Lineup tester state ---
  const [lineupSlots, setLineupSlots] = useState<LineupSlot[]>(EMPTY_LINEUP);
  const [evaluatingLineup, setEvaluatingLineup] = useState(false);

  // --- Results state ---
  const [testHistory, setTestHistory] = useState<LineupTestResult[]>([]);

  // --- Derived ---
  const latestResult = testHistory[0] ?? null;

  // --- Handlers ---

  /** Fetch composites when a player is selected in the left panel search. */
  const handlePlayerSelect = useCallback(async (player: Player) => {
    setLoadingComposites(true);
    const res = await fetchPlayerComposites(player.id);
    if (res.success && res.data) {
      setSelectedComposites(res.data);
    } else {
      toast.error(res.error ?? "Failed to load composites");
      setSelectedComposites(null);
    }
    setLoadingComposites(false);
  }, []);

  /** Add a player's bell curve to the overlay chart. */
  const handleAddToBellCurve = useCallback(async () => {
    if (!selectedComposites) return;
    // Don't add duplicates
    if (overlayPlayers.some((p) => p.player_id === selectedComposites.player_id)) {
      toast.error("Player already on chart");
      return;
    }
    const res = await fetchBellCurve(selectedComposites.player_id);
    if (res.success && res.data) {
      setOverlayPlayers((prev) => [...prev, res.data!]);
      // Auto-switch to bell curves tab
      setCenterTab("bell_curves");
    } else {
      toast.error(res.error ?? "Failed to load bell curve");
    }
  }, [selectedComposites, overlayPlayers]);

  /** Remove a player from the bell curve overlay. */
  const handleRemoveBellCurvePlayer = useCallback((playerId: string) => {
    setOverlayPlayers((prev) => prev.filter((p) => p.player_id !== playerId));
  }, []);

  /** Set a player into a lineup slot and fetch their skills. */
  const handleLineupSlotSelect = useCallback(async (index: number, player: Player) => {
    // Fetch this player's composites to get skills + height
    const res = await fetchPlayerComposites(player.id);
    if (res.success && res.data) {
      setLineupSlots((prev) =>
        prev.map((slot, i) =>
          i === index
            ? { player, skills: {}, height: res.data!.height }
            : slot,
        ),
      );
      // We need the skill profile, but composites endpoint doesn't return raw skills.
      // For the lineup tester, the backend computes composites from skills internally,
      // so we pass the player name + height and let the backend handle it.
    } else {
      toast.error("Failed to load player data");
    }
  }, []);

  /** Evaluate the current 5-player lineup. */
  const handleEvaluateLineup = useCallback(async () => {
    setEvaluatingLineup(true);
    // Build the player array for the API — using name + height
    const players = lineupSlots.map((slot) => ({
      name: slot.player?.name ?? "",
      height: slot.height,
      skills: slot.skills,
    }));

    const res = await evaluateLineup(players);
    if (res.success && res.data) {
      const result: LineupTestResult = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        playerNames: lineupSlots.map((s) => s.player?.name ?? "?"),
        cohesion_score: res.data.cohesion_score,
        subscores: res.data.subscores,
        synergies_applied: res.data.synergies_applied,
        accentuation: res.data.accentuation,
      };
      setTestHistory((prev) => [result, ...prev].slice(0, 20));
      toast.success(`Cohesion: ${res.data.cohesion_score.toFixed(2)}`);
    } else {
      toast.error(res.error ?? "Lineup evaluation failed");
    }
    setEvaluatingLineup(false);
  }, [lineupSlots]);

  /** Notify results panel when weights change (for before/after comparison). */
  const handleWeightsUpdated = useCallback(() => {
    // No-op for now — in the future, could auto-re-evaluate the current lineup
  }, []);

  // --- Tab data ---
  const tabs: { key: CenterTab; label: string }[] = useMemo(() => [
    { key: "bell_curves", label: "Bell Curves" },
    { key: "lineup", label: "Lineup Tester" },
    { key: "weights", label: "Weights" },
  ], []);

  return (
    <>
      <Toaster position="bottom-right" richColors closeButton toastOptions={{ duration: 4000 }} />

      <div className="flex flex-col h-[calc(100vh-3rem)] overflow-hidden bg-background">
        {/* Header bar */}
        <header id="cohesion-cal-header" className="flex-shrink-0 flex items-center justify-between px-6 py-3 border-b border-border bg-background z-10">
          <div className="flex items-center gap-3">
            <a
              id="cohesion-cal-back-link"
              href="/admin"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              ← Cornerstone
            </a>
            <span className="text-muted-foreground/30">/</span>
            <h1 id="cohesion-cal-title" className="text-sm font-semibold text-foreground">
              Cohesion Calibration
            </h1>
          </div>
        </header>

        {/* Three-panel layout */}
        <div id="cohesion-cal-panels" className="flex-1 overflow-hidden flex">

          {/* ── Left panel: Player Composites (~380px) ────────────────── */}
          <div
            id="cohesion-cal-left-panel"
            className="w-[380px] flex-shrink-0 border-r border-border overflow-y-auto p-4 space-y-4"
          >
            {/* Player search */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Player Search
              </p>
              <PlayerSearchCombobox onSelect={handlePlayerSelect} placeholder="Search players…" />
            </div>

            {/* Loading state */}
            {loadingComposites && (
              <div className="flex items-center justify-center py-8">
                <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
              </div>
            )}

            {/* Composite bars */}
            {selectedComposites && !loadingComposites && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-foreground">{selectedComposites.name}</p>
                  <span className="text-[10px] text-muted-foreground">{selectedComposites.height ?? "—"}</span>
                </div>

                <CompositeBars composites={selectedComposites.composites_normalized} />

                {/* Action buttons */}
                <div className="flex gap-2">
                  <button
                    id="cohesion-cal-add-bellcurve-btn"
                    type="button"
                    onClick={handleAddToBellCurve}
                    className="flex-1 text-[10px] font-medium py-1.5 rounded-md border border-border hover:bg-muted text-muted-foreground transition-colors cursor-pointer"
                  >
                    Add to Bell Curve
                  </button>
                  <button
                    id="cohesion-cal-set-lineup-btn"
                    type="button"
                    onClick={() => {
                      // Fill next empty lineup slot
                      const emptyIdx = lineupSlots.findIndex((s) => s.player === null);
                      if (emptyIdx >= 0 && selectedComposites) {
                        const minimalPlayer: Player = {
                          id: selectedComposites.player_id,
                          nba_api_id: 0,
                          name: selectedComposites.name,
                          team: null,
                          position: null,
                          age: null,
                          games_played: null,
                          minutes_per_game: null,
                          season: "",
                        };
                        handleLineupSlotSelect(emptyIdx, minimalPlayer);
                        setCenterTab("lineup");
                      } else {
                        toast.error("All lineup slots filled");
                      }
                    }}
                    className="flex-1 text-[10px] font-medium py-1.5 rounded-md border border-border hover:bg-muted text-muted-foreground transition-colors cursor-pointer"
                  >
                    Set in Lineup
                  </button>
                </div>

                {/* Bell curve params summary */}
                <div className="text-[9px] text-muted-foreground/60 space-y-0.5">
                  <p>
                    Bell: amp={selectedComposites.bell_curve.amplitude.toFixed(1)},
                    peak={selectedComposites.bell_curve.peak}in,
                    range=[{selectedComposites.bell_curve.range_down},{selectedComposites.bell_curve.range_up}]
                  </p>
                </div>
              </div>
            )}

            {/* Empty state */}
            {!selectedComposites && !loadingComposites && (
              <div className="text-xs text-muted-foreground/40 text-center py-8">
                Search a player to view composites
              </div>
            )}
          </div>

          {/* ── Center panel: Tabbed ──────────────────────────────────── */}
          <div id="cohesion-cal-center-panel" className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {/* Tab bar */}
            <div id="cohesion-cal-tab-bar" className="flex-shrink-0 flex border-b border-border bg-background">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  id={`cohesion-cal-tab-${tab.key}`}
                  type="button"
                  onClick={() => setCenterTab(tab.key)}
                  className={cn(
                    "px-4 py-2.5 text-xs font-medium transition-colors cursor-pointer border-b-2",
                    centerTab === tab.key
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              {centerTab === "bell_curves" && (
                <BellCurveChart overlayPlayers={overlayPlayers} onRemovePlayer={handleRemoveBellCurvePlayer} />
              )}
              {centerTab === "lineup" && (
                <LineupTester
                  lineupSlots={lineupSlots}
                  onSlotSelect={handleLineupSlotSelect}
                  onEvaluate={handleEvaluateLineup}
                  evaluating={evaluatingLineup}
                  latestResult={latestResult}
                />
              )}
              {centerTab === "weights" && (
                <WeightsEditor onWeightsUpdated={handleWeightsUpdated} />
              )}
            </div>
          </div>

          {/* ── Right panel: Results (~320px) ─────────────────────────── */}
          <div
            id="cohesion-cal-right-panel"
            className="w-[320px] flex-shrink-0 border-l border-border overflow-hidden flex flex-col"
          >
            <div className="flex-shrink-0 px-4 py-3 border-b border-border">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Test History ({testHistory.length})
              </p>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              <ResultsPanel testHistory={testHistory} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
