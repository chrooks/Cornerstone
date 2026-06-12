"use client";

/**
 * PlayerPoolTab — draft workspace Player Pool (before Diff).
 *
 * Shows every player + legend with the DRAFT composite Skill Profile: the
 * ratings that will be frozen when this draft publishes (NOT the active
 * release). Mirrors the /players explorer's PlayerPoolBrowser usage, but:
 *   - Data comes from GET /api/snapshots/draft/player-pool (getDraftPlayerPool).
 *   - Right-click-to-edit a skill tier writes to the draft via the existing
 *     manual-override endpoint (manualOverrideSkill → draft_skill_profiles),
 *     and optimistically updates local row state.
 *   - Unrated skills render in-place as muted "—" cells (PlayerTable). A
 *     header chip summarizes how many players have unrated skills (#5b).
 *   - Overrides are read-only when the draft is frozen (status === "review").
 */

import { useState, useEffect, useCallback } from "react";
import type React from "react";
import { toast } from "sonner";
import {
  getDraftPlayerPool,
  manualOverrideSkill,
  setPlayersExcludedFromSnapshot,
} from "@/lib/api";
import type {
  PlayerWithSkills,
  SkillTier,
  SnapshotDraftSummary,
  SnapshotCountSummary,
  SnapshotPublishValidation,
} from "@/lib/types";
import { PlayerPoolBrowser, type PlayerPoolViewMode } from "@/components/players/PlayerPoolBrowser";
import { PlayerViewSizeToggle } from "@/components/players/PlayerView";
import type { SortKey } from "@/components/players/SortControls";
import { ExcludedSection } from "../_components/ExcludedSection";
import { RunPipelineConfirmDialog } from "../_components/RunPipelineConfirmDialog";
import { useRunCompositePipeline } from "../_lib/useRunCompositePipeline";
import type { TabSlug } from "../_lib/tabRouting";

const POOL_ROW_PAGE_SIZE = 32;
const POOL_CARD_PAGE_SIZE = 16;
const POOL_PANEL_PAGE_SIZE = 16;
const DEFAULT_SORT: SortKey[] = [{ field: "name", direction: "asc" }];

interface RowMenuState {
  open: boolean;
  x: number;
  y: number;
  playerId: string;
  playerName: string;
  excluded: boolean;
  saving: boolean;
}

const CLOSED_ROW_MENU: RowMenuState = {
  open: false, x: 0, y: 0, playerId: "", playerName: "", excluded: false, saving: false,
};

export interface PlayerPoolTabProps {
  draft: SnapshotDraftSummary;
  summary: SnapshotCountSummary | null;
  validation: SnapshotPublishValidation | null;
  reload: () => Promise<void>;
  onTabChange: (slug: TabSlug) => void;
}

export function PlayerPoolTab({ draft, reload, onTabChange }: PlayerPoolTabProps) {
  const [players, setPlayers] = useState<PlayerWithSkills[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewModeReady, setViewModeReady] = useState(false);

  // Bulk-selection state (Player Pool tab owns it; row view only).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Bumped after a mutation so ExcludedSection re-fetches its authoritative list.
  const [excludedRefreshKey, setExcludedRefreshKey] = useState(0);
  // Row right-click exclude/include menu.
  const [rowMenu, setRowMenu] = useState<RowMenuState>(CLOSED_ROW_MENU);

  // Frozen in review state — overrides become read-only.
  const isFrozen = draft.status === "review";

  // ── Load the draft pool (mount + after an include) ────────────────────────
  const loadPool = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getDraftPlayerPool();
      if (res.success && res.data) {
        setPlayers(res.data);
      } else {
        setError(res.error ?? "Failed to load draft player pool");
      }
    } catch {
      setError("Failed to load draft player pool");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPool();
  }, [loadPool]);

  const excludedCount = players.filter(
    (p) => p.excluded_from_snapshot === true,
  ).length;

  // ── Exclude/include mutation → API then authoritative reload ────────────────
  const applyExclusion = useCallback(
    async (playerIds: string[], excluded: boolean): Promise<boolean> => {
      if (playerIds.length === 0) return false;
      const res = await setPlayersExcludedFromSnapshot(playerIds, excluded);
      if (!res.success) {
        toast.error(res.error ?? "Failed to update snapshot exclusion");
        return false;
      }
      toast.success(
        excluded
          ? `Excluded ${playerIds.length} from snapshot`
          : `Included ${playerIds.length} in snapshot`,
      );
      await loadPool();
      setExcludedRefreshKey((k) => k + 1);
      // Also refresh the shell's draft validation so the Publish tab's
      // missing-composite count stays in sync across tabs after an exclude.
      await reload();
      return true;
    },
    [loadPool, reload],
  );

  // ── Bulk selection helpers ──────────────────────────────────────────────────
  const toggleSelected = useCallback((playerId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  }, []);

  const selectAllFiltered = useCallback((filteredIds: string[]) => {
    setSelectedIds(new Set(filteredIds));
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const excludeSelected = useCallback(
    async (excluded: boolean) => {
      const ok = await applyExclusion(Array.from(selectedIds), excluded);
      if (ok) setSelectedIds(new Set());
    },
    [applyExclusion, selectedIds],
  );

  // ── Run the compositing pipeline for the selected players ───────────────────
  // In review status this confirms, composites, then reverts to draft so the
  // new flags are reviewable (see useRunCompositePipeline).
  const runPipeline = useRunCompositePipeline({
    draft,
    reload,
    onTabChange,
    onComplete: async () => {
      setSelectedIds(new Set());
      await loadPool();
    },
  });

  // How many selected rows are already excluded — drives Exclude vs Include label.
  const selectedExcludedCount = players.filter(
    (p) => selectedIds.has(p.id) && p.excluded_from_snapshot === true,
  ).length;
  const selectedAllExcluded =
    selectedIds.size > 0 && selectedExcludedCount === selectedIds.size;

  // ── Row right-click menu ────────────────────────────────────────────────────
  const openRowMenu = useCallback((event: React.MouseEvent, player: PlayerWithSkills) => {
    event.preventDefault();
    event.stopPropagation();
    const x = Math.min(event.clientX, window.innerWidth - 230);
    const y = Math.min(event.clientY, window.innerHeight - 90);
    setRowMenu({
      open: true,
      x, y,
      playerId: player.id,
      playerName: player.name,
      excluded: player.excluded_from_snapshot === true,
      saving: false,
    });
  }, []);

  useEffect(() => {
    if (!rowMenu.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRowMenu(CLOSED_ROW_MENU);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [rowMenu.open]);

  const handleRowMenuToggle = useCallback(async () => {
    if (rowMenu.saving) return;
    setRowMenu((prev) => ({ ...prev, saving: true }));
    await applyExclusion([rowMenu.playerId], !rowMenu.excluded);
    setRowMenu(CLOSED_ROW_MENU);
  }, [applyExclusion, rowMenu.playerId, rowMenu.excluded, rowMenu.saving]);

  // ── Right-click skill override → writes to the draft, optimistic local merge ──
  const handleSkillOverride = useCallback(
    async (playerId: string, skillKey: string, tier: SkillTier) => {
      const res = await manualOverrideSkill(playerId, {
        skill_name: skillKey,
        resolved_value: tier,
        season: draft.season,
      });
      if (!res.success) {
        toast.error(res.error ?? "Failed to override skill");
        throw new Error(res.error ?? "override_failed");
      }
      // Optimistically update the row's skill + recompute data-missing.
      setPlayers((prev) =>
        prev.map((p) => {
          if (p.id !== playerId) return p;
          const nextSkills = { ...(p.skills ?? {}), [skillKey]: tier };
          const nextMissing = (p.data_missing_skills ?? []).filter(
            (s) => s !== skillKey,
          );
          return { ...p, skills: nextSkills, data_missing_skills: nextMissing };
        }),
      );
      toast.success("Skill updated in draft");
    },
    [draft.season],
  );

  const playersWithMissing = players.filter(
    (p) => (p.data_missing_skills?.length ?? 0) > 0,
  ).length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div id="player-pool-tab-content" className="space-y-3">
      <div id="player-pool-tab-header" className="flex items-center justify-between gap-4 flex-wrap">
        <div id="player-pool-tab-header-left">
          <h2 id="player-pool-tab-title" className="text-base font-semibold text-[#0e0907]">
            Player Pool
          </h2>
          <p id="player-pool-tab-subtitle" className="text-xs text-neutral-500 mt-0.5">
            The draft composite ratings that will be frozen when this draft
            publishes.{" "}
            {isFrozen
              ? "Snapshot is in review — skill overrides are locked, but you can still exclude players: right-click a row or use the checkboxes."
              : "Right-click a skill cell to override it, or right-click a row (or use the checkboxes) to exclude players from the snapshot."}
          </p>
        </div>
        <div id="player-pool-tab-chips" className="flex items-center gap-2 flex-wrap">
        {!loading && excludedCount > 0 && (
          <span
            id="player-pool-excluded-chip"
            className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#e3d9cf] bg-[#f1ece6]
              px-2.5 py-1 text-[11px] font-medium text-neutral-500"
            title="Players excluded from snapshot Releases. Reverse below or in the Publish tab."
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-neutral-400" />
            {excludedCount} excluded
          </span>
        )}
        {!loading && playersWithMissing > 0 && (
          <span
            id="player-pool-unrated-chip"
            className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#e3d9cf] bg-[#f7f1ea]
              px-2.5 py-1 text-[11px] font-medium text-neutral-600"
            title="Players with at least one canonical skill that has no draft composite rating."
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#fe6d34]" />
            {playersWithMissing} with unrated skills
          </span>
        )}
        </div>
      </div>

      {loading && (
        <div id="player-pool-loading" className="space-y-3 animate-pulse">
          <div className="h-10 bg-[#efe7df] rounded-lg" />
          <div className="h-8 bg-[#efe7df] rounded-lg w-1/2" />
          <div className="h-64 bg-[#efe7df] rounded-lg" />
        </div>
      )}

      {!loading && error && (
        <div
          id="player-pool-error"
          className="rounded-md border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {!loading && !error && (
        <ExcludedSection
          id="player-pool-excluded-section"
          onChanged={loadPool}
          refreshKey={excludedRefreshKey}
        />
      )}

      {!loading && !error && (
        <PlayerPoolBrowser
          id="player-pool-browser"
          players={players}
          initialSortKeys={DEFAULT_SORT}
          defaultSortKeys={DEFAULT_SORT}
          defaultPageSize={POOL_ROW_PAGE_SIZE}
          defaultPageSizeByViewSize={{
            row: POOL_ROW_PAGE_SIZE,
            card: POOL_CARD_PAGE_SIZE,
            panel: POOL_PANEL_PAGE_SIZE,
          }}
          pageSizeOptions={[8, 16, 32, 48, 96]}
          viewSizes={["row", "card", "panel"]}
          defaultViewSize="row"
          emptyMessage="No players in the draft pool yet."
          hideViewToggleUntilReady
          onViewModeReadyChange={setViewModeReady}
          onSkillOverride={isFrozen ? undefined : handleSkillOverride}
          onRowContextMenu={openRowMenu}
          bulkSelection={{
            selectedIds,
            onToggle: toggleSelected,
            onSelectAllFiltered: selectAllFiltered,
            onClear: clearSelection,
            renderActions: () => (
              <div className="flex items-center gap-2">
                <button
                  id="player-pool-run-pipeline-btn"
                  type="button"
                  disabled={selectedIds.size === 0 || runPipeline.isRunning}
                  onClick={() => runPipeline.start(Array.from(selectedIds))}
                  title="Run the compositing pipeline for the selected players, then review their composites here."
                  className="font-semibold px-3 py-1.5 rounded-[4px] border border-[#d9d0c9]
                    bg-white text-[#0e0907] hover:text-[#fe6d34] hover:border-[#fe6d34]
                    focus:outline-none focus:ring-2 focus:ring-[#ffa05c] focus:ring-offset-1
                    disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {runPipeline.isRunning
                    ? "Running…"
                    : `Run pipeline (${selectedIds.size})`}
                </button>
                <button
                  id="player-pool-exclude-selected-btn"
                  type="button"
                  disabled={selectedIds.size === 0 || runPipeline.isRunning}
                  onClick={() => excludeSelected(!selectedAllExcluded)}
                  className="font-semibold px-3 py-1.5 rounded-[4px] border border-[#d9d0c9]
                    text-[#fe6d34] hover:text-[#0e0907] hover:border-[#fe6d34]
                    focus:outline-none focus:ring-2 focus:ring-[#ffa05c] focus:ring-offset-1
                    disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {selectedAllExcluded
                    ? `Include ${selectedIds.size} in snapshot`
                    : `Exclude ${selectedIds.size} from snapshot`}
                </button>
              </div>
            ),
          }}
          getMutedPlayerIds={(rows) =>
            new Set(rows.filter((p) => p.excluded_from_snapshot).map((p) => p.id))
          }
          isAdmin
          renderViewToggle={({ viewSize, setViewSize }) => (
            <PlayerViewSizeToggle
              id="player-pool-view-toggle"
              viewSize={viewSize}
              viewSizes={["row", "card", "panel"] as PlayerPoolViewMode[]}
              onViewSizeChange={setViewSize}
              ready={viewModeReady}
            />
          )}
        />
      )}

      {/* Row right-click exclude/include menu */}
      {rowMenu.open && (
        <>
          <div
            className="fixed inset-0 z-[9998]"
            onMouseDown={() => setRowMenu(CLOSED_ROW_MENU)}
          />
          <div
            id="player-pool-row-menu"
            role="menu"
            aria-label={`Snapshot exclusion for ${rowMenu.playerName}`}
            style={{ left: rowMenu.x, top: rowMenu.y }}
            className="fixed z-[9999] w-56 rounded-lg border border-[#d9d0c9] bg-[#fff8f4] shadow-lg py-1 text-xs"
          >
            <div className="px-3 py-1.5 border-b border-[#e3d9cf]">
              <div className="font-semibold text-[#0e0907] truncate">{rowMenu.playerName}</div>
            </div>
            <button
              id="player-pool-rowmenu-exclude"
              type="button"
              role="menuitem"
              disabled={rowMenu.saving}
              onClick={handleRowMenuToggle}
              className="w-full text-left px-3 py-1.5 font-medium text-[#fe6d34]
                hover:bg-[#f7ede5] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {rowMenu.saving
                ? "Saving…"
                : rowMenu.excluded
                ? "Include in snapshot"
                : "Exclude from snapshot"}
            </button>
          </div>
        </>
      )}

      {runPipeline.pendingIds && (
        <RunPipelineConfirmDialog
          id="player-pool-run-pipeline-confirm"
          count={runPipeline.pendingIds.length}
          isRunning={runPipeline.isRunning}
          onConfirm={runPipeline.confirm}
          onCancel={runPipeline.cancel}
        />
      )}
    </div>
  );
}
