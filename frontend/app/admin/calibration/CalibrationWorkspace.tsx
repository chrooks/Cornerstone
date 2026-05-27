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

import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getAllThresholds, getAnchors, getPlayerSkills } from "@/lib/api";
import { PlayerExplorerPanel } from "./PlayerExplorerPanel";
import { ThresholdEditorPanel } from "./ThresholdEditorPanel";
import { AnchorSidebarPanel } from "./AnchorSidebarPanel";
import { StatLeadersPanel } from "./StatLeadersPanel";
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
}

export function CalibrationWorkspace({
  embedded = false,
  onStagedEdit,
}: CalibrationWorkspaceProps) {
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<string>(DEFAULT_SKILL);
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
  }, []);

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
        className="flex-shrink-0 flex items-center justify-between px-6 py-3 border-b border-border bg-background z-10"
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

      {/* Three-panel layout */}
      <div id="calibration-workspace-panels" className="flex-1 overflow-hidden flex">
        <div id="calibration-workspace-left-panel" className="w-[380px] flex-shrink-0 overflow-hidden">
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
          />
        </div>

        <div id="calibration-workspace-center-panel" className="flex-1 min-w-0 overflow-hidden border-r border-border">
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
              onSaved={handleThresholdSaved}
              onStagedEdit={onStagedEdit}
              anchors={anchors}
              testResults={testResults}
              onTestResult={handleTestResult}
              onTestAllResults={handleTestAllResults}
              selectedPlayer={selectedPlayer}
              onReEvaluatePlayer={handleReEvaluatePlayer}
              onSkillSelect={handleSkillClick}
              onToast={handleToast}
              leagueAverages={leagueAverages}
            />
          )}
        </div>

        <div id="calibration-workspace-right-panel" className="w-[300px] flex-shrink-0 overflow-hidden">
          <AnchorSidebarPanel
            selectedSkill={selectedSkill}
            anchors={anchors}
            testResult={testResults[selectedSkill] ?? null}
            selectedPlayer={selectedPlayer}
            onAnchorClick={handleAnchorClick}
            onAnchorRemoved={handleAnchorsChanged}
            onToast={handleToast}
          />
        </div>
      </div>
    </div>
  );
}
