"use client";

/**
 * ReviewQueueWorkspace — the full review queue as a composable component.
 *
 * Used by:
 *  - `/admin/review/page.tsx` (standalone — keeps `[player_id]` sub-route routable)
 *  - `ReviewTab.tsx` (embedded in draft workspace)
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { getReviewQueue } from "@/lib/api";
import { PlayerSearchCombobox } from "@/components/PlayerSearchCombobox";
import type { FlaggedPlayerSummary } from "@/lib/types";

const FLAG_REASON_LABELS: Record<string, string> = {
  two_tier_disagreement:   "2-Tier Disagree",
  one_tier_low_confidence: "1-Tier (Low Conf)",
  low_notability:          "Low Notability",
  claude_low_confidence:   "Claude Low Conf",
  data_missing:            "Data Missing",
};

function formatFlagReason(reason: string): string {
  return FLAG_REASON_LABELS[reason] ?? reason.replace(/_/g, " ");
}

function FlagReasonBadge({ reason }: { reason: string }) {
  const colorMap: Record<string, string> = {
    two_tier_disagreement:   "bg-red-100 text-red-700 border-red-200",
    one_tier_low_confidence: "bg-amber-100 text-amber-700 border-amber-200",
    low_notability:          "bg-slate-100 text-slate-600 border-slate-200",
    claude_low_confidence:   "bg-purple-100 text-purple-700 border-purple-200",
    data_missing:            "bg-slate-100 text-slate-500 border-slate-200",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border",
        colorMap[reason] ?? "bg-muted text-muted-foreground border-border"
      )}
    >
      {formatFlagReason(reason)}
    </span>
  );
}

export function ReviewQueueWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();

  /* Scope the queue to a Player subset when arriving from a subset pipeline
     run (#76): /admin/review?players=id,id,id. Empty/absent = full queue. */
  const playerScope = searchParams.get("players");
  const scopedIds = playerScope
    ? new Set(playerScope.split(",").map((s) => s.trim()).filter(Boolean))
    : null;

  const clearPlayerScope = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("players");
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : "/admin/review");
  }, [router, searchParams]);
  const [players, setPlayers]               = useState<FlaggedPlayerSummary[]>([]);
  const [allPlayers, setAllPlayers]         = useState<FlaggedPlayerSummary[]>([]);
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState<string | null>(null);

  const [search, setSearch]                 = useState("");
  const [teamFilter, setTeamFilter]         = useState("");
  const [posFilter, setPosFilter]           = useState("");
  const [reasonFilter, setReasonFilter]     = useState("");

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getReviewQueue({
      search:      search || undefined,
      team:        teamFilter || undefined,
      position:    posFilter || undefined,
      flag_reason: reasonFilter || undefined,
    });
    if (res.success && res.data) {
      setPlayers(res.data);
    } else {
      setError(res.error ?? "Failed to load review queue");
    }
    setLoading(false);
  }, [search, teamFilter, posFilter, reasonFilter]);

  useEffect(() => {
    setLoading(true);
    getReviewQueue().then((res) => {
      if (res.success && res.data) {
        setAllPlayers(res.data);
        setPlayers(res.data);
      } else {
        setError(res.error ?? "Failed to load review queue");
      }
      setLoading(false);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    fetchQueue();
  }, [fetchQueue]);

  const handleClear = useCallback(async () => {
    setSearch("");
    setTeamFilter("");
    setPosFilter("");
    setReasonFilter("");
    setLoading(true);
    setError(null);
    const res = await getReviewQueue();
    if (res.success && res.data) {
      setAllPlayers(res.data);
      setPlayers(res.data);
    } else {
      setError(res.error ?? "Failed to load review queue");
    }
    setLoading(false);
  }, []);

  const allTeams = Array.from(
    new Set(allPlayers.map((p) => p.team).filter(Boolean) as string[])
  ).sort();
  const allPositions = Array.from(
    new Set(allPlayers.map((p) => p.position).filter(Boolean) as string[])
  ).sort();
  const allReasons = Array.from(
    new Set(allPlayers.flatMap((p) => p.flag_reasons))
  ).sort();

  /* Apply the subset scope on top of the server-side filters (#76). */
  const visiblePlayers = scopedIds
    ? players.filter((p) => scopedIds.has(p.player_id))
    : players;

  return (
    <div id="review-queue-workspace" className="max-w-5xl space-y-6">
      <div id="review-queue-header">
        <h2 id="review-queue-title" className="text-xl font-bold text-foreground">Review Queue</h2>
        <p id="review-queue-subtitle" className="text-sm text-muted-foreground mt-1">
          Players with at least one unresolved skill flag requiring human review.
        </p>
      </div>

      <div id="review-player-lookup" className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/20">
        <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">Open player</span>
        <PlayerSearchCombobox
          placeholder="Search any player…"
          onSelect={(player) => router.push(`/admin/review/${player.id}`)}
          className="flex-1 max-w-sm"
        />
      </div>

      <form
        id="review-filters-form"
        onSubmit={handleSearch}
        className="flex flex-wrap gap-2 items-end"
      >
        <div className="flex-1 min-w-[180px]">
          <label htmlFor="review-search-input" className="text-xs font-medium text-muted-foreground block mb-1">Player Name</label>
          <input
            id="review-search-input"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search players…"
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
          />
        </div>

        <div className="min-w-[110px]">
          <label htmlFor="review-team-select" className="text-xs font-medium text-muted-foreground block mb-1">Team</label>
          <select
            id="review-team-select"
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All teams</option>
            {allTeams.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div className="min-w-[110px]">
          <label htmlFor="review-position-select" className="text-xs font-medium text-muted-foreground block mb-1">Position</label>
          <select
            id="review-position-select"
            value={posFilter}
            onChange={(e) => setPosFilter(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All positions</option>
            {allPositions.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        <div className="min-w-[160px]">
          <label htmlFor="review-reason-select" className="text-xs font-medium text-muted-foreground block mb-1">Flag Reason</label>
          <select
            id="review-reason-select"
            value={reasonFilter}
            onChange={(e) => setReasonFilter(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All reasons</option>
            {allReasons.map((r) => (
              <option key={r} value={r}>{formatFlagReason(r)}</option>
            ))}
          </select>
        </div>

        <button
          id="review-filter-btn"
          type="submit"
          className="px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Filter
        </button>

        {(search || teamFilter || posFilter || reasonFilter) && (
          <button
            id="review-clear-btn"
            type="button"
            onClick={handleClear}
            className="px-3 py-1.5 rounded-md border border-input text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear
          </button>
        )}
      </form>

      {scopedIds && (
        <div
          id="review-queue-scope-banner"
          className="flex items-center justify-between gap-3 rounded-lg border border-[#ffa05c]/40 bg-[#fff8f4] px-3 py-2 text-xs text-[#0e0907]"
        >
          <span>
            Scoped to <span className="font-semibold">{scopedIds.size}</span> Player
            {scopedIds.size === 1 ? "" : "s"} from a subset run.
          </span>
          <button
            id="review-queue-scope-clear-btn"
            type="button"
            onClick={clearPlayerScope}
            className="font-semibold text-[#fe6d34] underline hover:text-[#e85c25]"
          >
            Show full queue
          </button>
        </div>
      )}

      {!loading && !error && (
        <p id="review-queue-count" className="text-xs text-muted-foreground">
          {visiblePlayers.length === 0
            ? "No players in queue."
            : `${visiblePlayers.length} player${visiblePlayers.length !== 1 ? "s" : ""} in queue`}
        </p>
      )}

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      )}
      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && visiblePlayers.length > 0 && (
        <div id="review-player-table" className="rounded-lg border border-border overflow-hidden">
          <div id="review-player-table-header" className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-4 py-2 bg-muted/40 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            <span>Player</span>
            <span className="text-right">Team</span>
            <span className="text-right">Pos</span>
            <span className="text-right">Flags</span>
            <span>Reasons</span>
          </div>

          <div className="divide-y divide-border">
            {visiblePlayers.map((player) => (
              <Link
                key={player.player_id}
                href={`/admin/review/${player.player_id}`}
                className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-4 py-3 items-center hover:bg-muted/30 transition-colors group"
              >
                <span className="font-medium text-sm text-foreground group-hover:text-primary transition-colors truncate">
                  {player.player_name}
                </span>
                <span className="text-xs text-muted-foreground text-right">
                  {player.team ?? "—"}
                </span>
                <span className="text-xs text-muted-foreground text-right">
                  {player.position ?? "—"}
                </span>
                <span
                  className={cn(
                    "text-sm font-bold tabular-nums text-right",
                    player.unresolved_flag_count >= 5
                      ? "text-red-600"
                      : player.unresolved_flag_count >= 3
                      ? "text-amber-600"
                      : "text-muted-foreground"
                  )}
                >
                  {player.unresolved_flag_count}
                </span>
                <div className="flex flex-wrap gap-1 justify-end">
                  {player.flag_reasons.map((r) => (
                    <FlagReasonBadge key={r} reason={r} />
                  ))}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
