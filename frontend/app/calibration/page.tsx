"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Toaster, toast } from "sonner";
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

// Default skill to show when the page first loads
const DEFAULT_SKILL = "spot_up_shooter";

// Current season — keep in sync with CURRENT_SEASON in players_service.py
// TODO: fetch from /api/health or a dedicated /api/config endpoint when it exists
const CURRENT_SEASON = "2025-26";

export default function CalibrationPage() {
  // --- Core state ---
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<string>(DEFAULT_SKILL);
  const [thresholds, setThresholds] = useState<ThresholdRow[]>([]);
  const [anchors, setAnchors] = useState<AnchorsBySkill>({});
  const [playerSkills, setPlayerSkills] = useState<PlayerSkills | null>(null);
  const [previousPlayerSkills, setPreviousPlayerSkills] = useState<PlayerSkills | null>(null);
  const [testResults, setTestResults] = useState<Record<string, SkillTestResult>>({});
  const [leagueAverages, setLeagueAverages] = useState<Record<string, number>>({});
  // Per-skill edited (unsaved) threshold JSON — replaces saved rule for that skill
  const [editedThresholds, setEditedThresholds] = useState<Record<string, Record<string, unknown>>>({});

  // Toggle state for swapping the center panel between Threshold Editor and Stat Leaders table
  const [showStatLeaders, setShowStatLeaders] = useState(false);

  const [loadingThresholds, setLoadingThresholds] = useState(true);
  const [loadingAnchors, setLoadingAnchors] = useState(true);
  // Sidebar "Add from current player" → triggers the anchor form in the left panel

  // --- Initial data loading ---
  useEffect(() => {
    // Load all skill thresholds
    getAllThresholds()
      .then((res) => {
        if (res.success && res.data) setThresholds(res.data);
      })
      .finally(() => setLoadingThresholds(false));

    // Load all anchors
    getAnchors()
      .then((res) => {
        if (res.success && res.data) setAnchors(res.data);
      })
      .finally(() => setLoadingAnchors(false));

    // Load league averages for the stabilization section
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

  // --- Handlers ---

  const handlePlayerSelect = useCallback((player: Player) => {
    setSelectedPlayer(player);
    // Skills are loaded by the PlayerExplorerPanel and passed up via onSkillsLoaded
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
      // Remove the skill from editedThresholds so hasUnsavedChanges clears
      setEditedThresholds((prev) => {
        const { [skillName]: _removed, ...rest } = prev;
        return rest;
      });
      // Update the source-of-truth thresholds array so thresholdRow.thresholds stays current
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
        // Snapshot current skills as "previous" so the card can highlight changes
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
    // Reload the full anchors map after any create/delete
    getAnchors().then((res) => {
      if (res.success && res.data) setAnchors(res.data);
    });
  }, []);

  const handleAnchorClick = useCallback(
    async (anchor: Anchor) => {
      // Build a minimal Player object from the anchor data for immediate display
      // The full player object will be loaded by the PlayerSearchCombobox on selection
      // For now, we need to load the player and their skills
      try {
        const skillsRes = await getPlayerSkills(anchor.player_id);
        if (skillsRes.success && skillsRes.data) {
          // Reconstruct a minimal player from available anchor data
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
    },
    []
  );

  // Extract all stat keys (in "section.key" format) referenced by the active skill's rule.
  // Used to highlight those rows in the PlayerStatDisplay.
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

  // --- Loading skeleton ---
  if (loadingThresholds) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="space-y-3 text-center">
          <div className="inline-block size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
          <p className="text-sm text-muted-foreground">Loading calibration tool…</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Sonner toast container */}
      <Toaster
        position="bottom-right"
        richColors
        closeButton
        toastOptions={{ duration: 4000 }}
      />

      <div className="flex flex-col h-[calc(100vh-3rem)] overflow-hidden bg-background">
        {/* Top bar */}
        <header id="calibration-header" className="flex-shrink-0 flex items-center justify-between px-6 py-3 border-b border-border bg-background z-10">
          <div className="flex items-center gap-3">
            <a
              id="calibration-back-link"
              href="/"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Cornerstone
            </a>
            <span className="text-muted-foreground/30">/</span>
            <h1 id="calibration-title" className="text-sm font-semibold text-foreground">
              Threshold Calibration
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {/* Data-loaded indicator dot */}
            <span
              id="calibration-status-dot"
              className={cn(
                "inline-block size-1.5 rounded-full",
                !loadingAnchors ? "bg-emerald-500" : "bg-amber-400 animate-pulse"
              )}
            />
            {/* Toggle button: swaps center panel between Threshold Editor and Stat Leaders */}
            <button
              id="calibration-stat-leaders-toggle-btn"
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
        <div id="calibration-panels" className="flex-1 overflow-hidden flex">
          {/* Left panel — Player Explorer (~400px) */}
          <div id="calibration-left-panel" className="w-[380px] flex-shrink-0 overflow-hidden">
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

          {/* Center panel — conditionally shows Threshold Editor or Stat Leaders table */}
          <div id="calibration-center-panel" className="flex-1 min-w-0 overflow-hidden border-r border-border">
            {showStatLeaders ? (
              /* Stat Leaders table — replaces the editor when the toggle is active */
              <StatLeadersPanel
                thresholds={thresholds}
                editedThresholds={editedThresholds}
                initialSkill={selectedSkill}
                onSkillSelect={handleSkillClick}
              />
            ) : (
              /* Threshold Editor — the default center panel */
              <ThresholdEditorPanel
                selectedSkill={selectedSkill}
                thresholds={thresholds}
                editedThresholds={editedThresholds}
                onThresholdChange={handleThresholdChange}
                onSaved={handleThresholdSaved}
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

          {/* Right panel — Anchor Sidebar (~300px) */}
          <div id="calibration-right-panel" className="w-[300px] flex-shrink-0 overflow-hidden">
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
    </>
  );
}
