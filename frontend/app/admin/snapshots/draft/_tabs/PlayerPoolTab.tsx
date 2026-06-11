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
import { toast } from "sonner";
import { getDraftPlayerPool, manualOverrideSkill } from "@/lib/api";
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
import type { TabSlug } from "../_lib/tabRouting";

const POOL_ROW_PAGE_SIZE = 32;
const POOL_CARD_PAGE_SIZE = 16;
const POOL_PANEL_PAGE_SIZE = 16;
const DEFAULT_SORT: SortKey[] = [{ field: "name", direction: "asc" }];

export interface PlayerPoolTabProps {
  draft: SnapshotDraftSummary;
  summary: SnapshotCountSummary | null;
  validation: SnapshotPublishValidation | null;
  reload: () => Promise<void>;
  onTabChange: (slug: TabSlug) => void;
}

export function PlayerPoolTab({ draft }: PlayerPoolTabProps) {
  const [players, setPlayers] = useState<PlayerWithSkills[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewModeReady, setViewModeReady] = useState(false);

  // Frozen in review state — overrides become read-only.
  const isFrozen = draft.status === "review";

  // ── Load the draft pool on mount ──────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    setError(null);
    getDraftPlayerPool()
      .then((res) => {
        if (res.success && res.data) {
          setPlayers(res.data);
        } else {
          setError(res.error ?? "Failed to load draft player pool");
        }
      })
      .catch(() => setError("Failed to load draft player pool"))
      .finally(() => setLoading(false));
  }, []);

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
              ? "Snapshot is in review — overrides are locked."
              : "Right-click a skill cell to override it in the draft."}
          </p>
        </div>
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
    </div>
  );
}
