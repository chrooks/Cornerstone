"use client";

/**
 * CalibrationWorkspace — the full calibration 3-panel layout as a composable component.
 *
 * Used by:
 *  - `/admin/calibration/page.tsx` (standalone shell — full-screen)
 *  - `ThresholdsTab.tsx` (embedded in the draft workspace — fills tab area)
 *
 * The `embedded` prop switches from `h-[calc(100vh-3rem)]` to `h-full` so the
 * parent container controls the height.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getAllThresholds, getAnchors, getPlayerSkills, getStagedThresholdEdits } from "@/lib/api";
import { PlayerExplorerPanel } from "./PlayerExplorerPanel";
import { ThresholdEditorPanel } from "./ThresholdEditorPanel";
import { AnchorSidebarPanel } from "./AnchorSidebarPanel";
import { StatLeadersPanel } from "./StatLeadersPanel";
import { CalibrationActionBar } from "./CalibrationActionBar";
import { PanelResizeHandle } from "@/components/PanelResizeHandle";
import { ALL_SKILL_NAMES } from "@/lib/skills";
import type {
  Player,
  PlayerSkills,
  ThresholdRow,
  ThresholdRule,
  AnchorsBySkill,
  Anchor,
  SkillTestResult,
  LeagueAverage,
} from "@/lib/types";

const DEFAULT_SKILL = "spot_up_shooter";
const CURRENT_SEASON = "2025-26";

export interface CalibrationWorkspaceProps {
  /** When true, uses h-full instead of h-[calc(100vh-3rem)] so parent controls height. */
  embedded?: boolean;
  /**
   * Called after a threshold edit is staged (POST /save flow).
   * Receives run_id so the caller can deep-link to the Pipeline tab.
   */
  onStagedEdit?: (runId: string) => void;
  /**
   * Skill to open on first render (power-user deep-link, e.g. ?skill=spot_up_shooter).
   * Ignored if it is not a known skill in the taxonomy.
   */
  initialSkill?: string;
}

export function CalibrationWorkspace({
  embedded = false,
  onStagedEdit,
  initialSkill,
}: CalibrationWorkspaceProps) {
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<string>(
    initialSkill && ALL_SKILL_NAMES.includes(initialSkill) ? initialSkill : DEFAULT_SKILL
  );
  const [thresholds, setThresholds] = useState<ThresholdRow[]>([]);
  const [anchors, setAnchors] = useState<AnchorsBySkill>({});
  const [playerSkills, setPlayerSkills] = useState<PlayerSkills | null>(null);
  const [previousPlayerSkills, setPreviousPlayerSkills] = useState<PlayerSkills | null>(null);
  const [testResults, setTestResults] = useState<Record<string, SkillTestResult>>({});
  const [leagueAverages, setLeagueAverages] = useState<Record<string, number>>({});
  const [editedThresholds, setEditedThresholds] = useState<Record<string, Record<string, unknown>>>({});
  const [showStatLeaders, setShowStatLeaders] = useState(false);
  const [loadingThresholds, setLoadingThresholds] = useState(true);
  const [loadingAnchors, setLoadingAnchors] = useState(true);

  // --- Action-bar-adjacent state, lifted here so it survives the editor
  // panel unmounting when Stat Leaders is shown. ---
  const [testAllResults, setTestAllResults] = useState<SkillTestResult[]>([]);
  const [showTestAllResults, setShowTestAllResults] = useState(false);
  // Advanced JSON editor's effective error, reported up from ThresholdEditorPanel.
  // Cleared whenever Stat Leaders is shown so the action bar never stays stuck disabled.
  const [jsonError, setJsonError] = useState<string | null>(null);
  // Skills with an uncommitted threshold_edit run → run_id. Drives the "Staged"
  // pending-commit badge in the editor header. Seeded from real run state on
  // mount so it is authoritative: a skill drops out once its run is committed
  // or discarded (the draft tabs unmount/remount, so returning here re-fetches).
  const [stagedRuns, setStagedRuns] = useState<Record<string, string>>({});

  // --- Panel layout state (resizable + collapsible side panels) ---
  const [leftPanelWidth, setLeftPanelWidth] = useState(360);
  const [rightPanelWidth, setRightPanelWidth] = useState(300);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const leftWidthBeforeCollapse = useRef(360);
  const rightWidthBeforeCollapse = useRef(300);

  const handleLeftResize = useCallback((deltaX: number) => {
    setLeftPanelWidth((prev) => Math.max(220, Math.min(560, prev + deltaX)));
  }, []);

  const handleRightResize = useCallback((deltaX: number) => {
    // Right panel grows when dragged left (negative delta).
    setRightPanelWidth((prev) => Math.max(220, Math.min(480, prev - deltaX)));
  }, []);

  const toggleLeftCollapsed = useCallback(() => {
    setLeftCollapsed((prev) => {
      if (!prev) leftWidthBeforeCollapse.current = leftPanelWidth;
      else setLeftPanelWidth(leftWidthBeforeCollapse.current);
      return !prev;
    });
  }, [leftPanelWidth]);

  const toggleRightCollapsed = useCallback(() => {
    setRightCollapsed((prev) => {
      if (!prev) rightWidthBeforeCollapse.current = rightPanelWidth;
      else setRightPanelWidth(rightWidthBeforeCollapse.current);
      return !prev;
    });
  }, [rightPanelWidth]);

  useEffect(() => {
    getAllThresholds()
      .then((res) => {
        if (res.success && res.data) setThresholds(res.data);
      })
      .finally(() => setLoadingThresholds(false));

    getAnchors()
      .then((res) => {
        if (res.success && res.data) setAnchors(res.data);
      })
      .finally(() => setLoadingAnchors(false));

    import("@/lib/api").then(({ getLeagueAverages }) =>
      getLeagueAverages().then((res) => {
        if (res.success && res.data) {
          const map: Record<string, number> = {};
          for (const row of res.data as LeagueAverage[]) {
            map[row.stat_key] = row.value;
          }
          setLeagueAverages(map);
        }
      })
    );

    getStagedThresholdEdits().then((res) => {
      if (res.success && res.data) setStagedRuns(res.data);
    });
  }, []);

  // Stat Leaders view unmounts ThresholdEditorPanel (and its advanced JSON
  // editor), so clear any stale jsonError once it's shown — otherwise the
  // action bar's Stage Edit / Test Anchors buttons could stay stuck disabled.
  useEffect(() => {
    if (showStatLeaders) setJsonError(null);
  }, [showStatLeaders]);

  const handlePlayerSelect = useCallback((player: Player) => {
    setSelectedPlayer(player);
    setPreviousPlayerSkills(null);
    setPlayerSkills(null);
  }, []);

  const handleSkillsLoaded = useCallback((skills: PlayerSkills) => {
    setPlayerSkills(skills);
  }, []);

  const handleSkillClick = useCallback((skillName: string) => {
    setSelectedSkill(skillName);
  }, []);

  const handleThresholdChange = useCallback(
    (skillName: string, rule: Record<string, unknown>) => {
      setEditedThresholds((prev) => ({ ...prev, [skillName]: rule }));
    },
    []
  );

  const handleThresholdSaved = useCallback(
    (skillName: string, savedRule: Record<string, unknown>) => {
      setEditedThresholds((prev) => {
        const next = { ...prev };
        delete next[skillName];
        return next;
      });
      setThresholds((prev) =>
        prev.map((t) =>
          t.skill_name === skillName
            ? { ...t, thresholds: savedRule as ThresholdRule }
            : t
        )
      );
    },
    []
  );

  const handleTestResult = useCallback((result: SkillTestResult) => {
    setTestResults((prev) => ({ ...prev, [result.skill_name]: result }));
  }, []);

  const handleTestAllResults = useCallback((results: SkillTestResult[]) => {
    setTestResults((prev) => {
      const updated = { ...prev };
      for (const r of results) {
        updated[r.skill_name] = r;
      }
      return updated;
    });
  }, []);

  // Called by CalibrationActionBar's "Test All" button — updates both the
  // summary table (owned here so it survives ThresholdEditorPanel unmounting)
  // and the per-skill testResults record the badges read from.
  const handleTestAllComplete = useCallback(
    (results: SkillTestResult[]) => {
      setTestAllResults(results);
      setShowTestAllResults(true);
      handleTestAllResults(results);
    },
    [handleTestAllResults]
  );

  const handleDismissTestAllResults = useCallback(() => {
    setShowTestAllResults(false);
  }, []);

  const handleJsonErrorChange = useCallback((error: string | null) => {
    setJsonError(error);
  }, []);

  // Called by CalibrationActionBar after a successful Stage Edit — marks the
  // skill as staged-pending-commit so ThresholdEditorPanel's header badge appears.
  const handleSkillStaged = useCallback((skillName: string, runId: string) => {
    setStagedRuns((prev) => ({ ...prev, [skillName]: runId }));
  }, []);

  const handleReEvaluatePlayer = useCallback(async () => {
    if (!selectedPlayer) return;
    try {
      const res = await getPlayerSkills(selectedPlayer.id, true);
      if (res.success && res.data) {
        setPreviousPlayerSkills(playerSkills);
        setPlayerSkills(res.data);
        toast.success(`Re-evaluated ${selectedPlayer.name}`);
      } else {
        toast.error(res.error ?? "Re-evaluation failed");
      }
    } catch {
      toast.error("Re-evaluation failed");
    }
  }, [selectedPlayer, playerSkills]);

  const handleAnchorsChanged = useCallback(() => {
    getAnchors().then((res) => {
      if (res.success && res.data) setAnchors(res.data);
    });
  }, []);

  const handleAnchorClick = useCallback(async (anchor: Anchor) => {
    try {
      const skillsRes = await getPlayerSkills(anchor.player_id);
      if (skillsRes.success && skillsRes.data) {
        const minimalPlayer: Player = {
          id: anchor.player_id,
          nba_api_id: 0,
          name: anchor.player_name,
          team: anchor.team ?? null,
          position: null,
          age: null,
          games_played: null,
          minutes_per_game: null,
          season: CURRENT_SEASON,
        };
        setSelectedPlayer(minimalPlayer);
        setPreviousPlayerSkills(null);
        setPlayerSkills(skillsRes.data);
      }
    } catch {
      toast.error("Failed to load anchor player");
    }
  }, []);

  const skillStatKeys = useMemo((): Set<string> => {
    const rule =
      editedThresholds[selectedSkill] ??
      thresholds.find((t) => t.skill_name === selectedSkill)?.thresholds;
    if (!rule || typeof rule !== "object") return new Set();

    const keys = new Set<string>();

    const collectFromBlock = (block: unknown) => {
      if (!block || typeof block !== "object") return;
      const conditions = (block as Record<string, unknown>).conditions;
      if (Array.isArray(conditions)) {
        for (const c of conditions as Array<Record<string, unknown>>) {
          if (typeof c.stat === "string") keys.add(c.stat);
        }
      }
    };

    const r = rule as Record<string, unknown>;
    collectFromBlock(r.volume_gate);
    if (r.tiers && typeof r.tiers === "object") {
      for (const tier of Object.values(r.tiers as Record<string, unknown>)) {
        collectFromBlock(tier);
      }
    }
    if (Array.isArray(r.stabilization)) {
      for (const s of r.stabilization as Array<Record<string, unknown>>) {
        if (typeof s.stat === "string") keys.add(s.stat);
      }
    }
    if (Array.isArray(r.tier_bumps)) {
      for (const bump of r.tier_bumps as Array<Record<string, unknown>>) {
        const cond = bump.condition as Record<string, unknown> | undefined;
        if (cond && typeof cond.stat === "string") keys.add(cond.stat);
      }
    }
    return keys;
  }, [selectedSkill, editedThresholds, thresholds]);

  const handleToast = useCallback((message: string, type: "success" | "error") => {
    if (type === "success") toast.success(message);
    else toast.error(message);
  }, []);

  if (loadingThresholds) {
    return (
      <div className="flex items-center justify-center h-full min-h-[200px] bg-background">
        <div className="space-y-3 text-center">
          <div className="inline-block size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
          <p className="text-sm text-muted-foreground">Loading calibration tool…</p>
        </div>
      </div>
    );
  }

  return (
    <div
      id="calibration-workspace"
      className={cn(
        "flex flex-col overflow-hidden bg-background",
        embedded ? "h-full" : "h-[calc(100vh-3rem)]"
      )}
    >
      {/* Top bar */}
      <header
        id="calibration-workspace-header"
        className="flex-shrink-0 flex items-center justify-between px-6 py-2 border-b border-border bg-background z-10"
      >
        <div className="flex items-center gap-3">
          <h2 id="calibration-workspace-title" className="text-sm font-semibold text-foreground">
            Threshold Calibration
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <span
            id="calibration-workspace-status-dot"
            className={cn(
              "inline-block size-1.5 rounded-full",
              !loadingAnchors ? "bg-emerald-500" : "bg-amber-400 animate-pulse"
            )}
          />
          <button
            id="calibration-workspace-stat-leaders-toggle-btn"
            type="button"
            onClick={() => setShowStatLeaders((v) => !v)}
            className={cn(
              "text-xs px-3 py-1.5 rounded-md border transition-colors",
              showStatLeaders
                ? "border-primary bg-primary/10 text-primary"
                : "border-border hover:bg-muted text-muted-foreground"
            )}
          >
            {showStatLeaders ? "← Threshold Editor" : "Stat Leaders →"}
          </button>
        </div>
      </header>

      {/* Three-panel layout — resizable + collapsible side panels */}
      <div id="calibration-workspace-panels" className="flex-1 min-h-0 overflow-hidden flex">
        {/* ── Left panel: Player Explorer ── */}
        <div
          id="calibration-workspace-left-panel"
          className={cn(
            "flex-shrink-0 overflow-hidden transition-[width] duration-150",
            leftCollapsed && "!w-0",
          )}
          style={{ width: leftCollapsed ? 0 : leftPanelWidth }}
        >
          <PlayerExplorerPanel
            selectedPlayer={selectedPlayer}
            playerSkills={playerSkills}
            previousPlayerSkills={previousPlayerSkills}
            selectedSkill={selectedSkill}
            anchors={anchors}
            skillStatKeys={skillStatKeys}
            onPlayerSelect={handlePlayerSelect}
            onSkillClick={handleSkillClick}
            onSkillsLoaded={handleSkillsLoaded}
            onAnchorsChanged={handleAnchorsChanged}
            onToast={handleToast}
            onCollapse={toggleLeftCollapsed}
          />
        </div>

        {/* Left resize handle, or restore rail when collapsed */}
        {leftCollapsed ? (
          <button
            id="calibration-restore-left"
            type="button"
            onClick={toggleLeftCollapsed}
            title="Show player panel"
            className="flex-shrink-0 w-6 flex items-center justify-center border-r border-border bg-muted/30 hover:bg-muted/60 transition-colors cursor-pointer text-[10px] text-muted-foreground"
          >
            ▸
          </button>
        ) : (
          <PanelResizeHandle id="calibration-left-resize" onResize={handleLeftResize} />
        )}

        {/* ── Center panel: editor / stat leaders, plus the shared action bar
              below it — the action bar renders in both views so Stat Leaders
              isn't missing Re-evaluate/Reset/Test All/Test Anchors/Stage Edit. ── */}
        <div
          id="calibration-workspace-center-panel"
          className="flex-1 min-w-0 overflow-hidden flex flex-col"
        >
          <div className="flex-1 min-h-0 overflow-hidden">
            {showStatLeaders ? (
              <StatLeadersPanel
                thresholds={thresholds}
                editedThresholds={editedThresholds}
                initialSkill={selectedSkill}
                onSkillSelect={handleSkillClick}
              />
            ) : (
              <ThresholdEditorPanel
                selectedSkill={selectedSkill}
                thresholds={thresholds}
                editedThresholds={editedThresholds}
                onThresholdChange={handleThresholdChange}
                anchors={anchors}
                testResults={testResults}
                onSkillSelect={handleSkillClick}
                leagueAverages={leagueAverages}
                testAllResults={testAllResults}
                showTestAllResults={showTestAllResults}
                onDismissTestAllResults={handleDismissTestAllResults}
                onJsonErrorChange={handleJsonErrorChange}
                stagedRuns={stagedRuns}
                onStagedEdit={onStagedEdit}
              />
            )}
          </div>
          <CalibrationActionBar
            selectedSkill={selectedSkill}
            thresholds={thresholds}
            editedThresholds={editedThresholds}
            onThresholdChange={handleThresholdChange}
            onSaved={handleThresholdSaved}
            onStagedEdit={onStagedEdit}
            onSkillStaged={handleSkillStaged}
            onTestResult={handleTestResult}
            onTestAllComplete={handleTestAllComplete}
            selectedPlayer={selectedPlayer}
            onReEvaluatePlayer={handleReEvaluatePlayer}
            onToast={handleToast}
            jsonError={jsonError}
          />
        </div>

        {/* Right resize handle, or restore rail when collapsed */}
        {rightCollapsed ? (
          <button
            id="calibration-restore-right"
            type="button"
            onClick={toggleRightCollapsed}
            title="Show anchors panel"
            className="flex-shrink-0 w-6 flex items-center justify-center border-l border-border bg-muted/30 hover:bg-muted/60 transition-colors cursor-pointer text-[10px] text-muted-foreground"
          >
            ◂
          </button>
        ) : (
          <PanelResizeHandle id="calibration-right-resize" onResize={handleRightResize} />
        )}

        {/* ── Right panel: Anchors ── */}
        <div
          id="calibration-workspace-right-panel"
          className={cn(
            "flex-shrink-0 overflow-hidden transition-[width] duration-150",
            rightCollapsed && "!w-0",
          )}
          style={{ width: rightCollapsed ? 0 : rightPanelWidth }}
        >
          <AnchorSidebarPanel
            selectedSkill={selectedSkill}
            anchors={anchors}
            testResult={testResults[selectedSkill] ?? null}
            selectedPlayer={selectedPlayer}
            onAnchorClick={handleAnchorClick}
            onAnchorRemoved={handleAnchorsChanged}
            onToast={handleToast}
            onCollapse={toggleRightCollapsed}
          />
        </div>
      </div>
    </div>
  );
}
