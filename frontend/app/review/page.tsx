"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { getReviewQueue } from "@/lib/api";
import { PlayerSearchCombobox } from "@/components/PlayerSearchCombobox";
import type { FlaggedPlayerSummary } from "@/lib/types";

// Human-readable flag reason labels
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

/** Badge chip for a flag reason. */
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

export default function ReviewQueuePage() {
  const router = useRouter();
  const [players, setPlayers]               = useState<FlaggedPlayerSummary[]>([]);
  // allPlayers holds the full unfiltered list used to populate dropdown options
  const [allPlayers, setAllPlayers]         = useState<FlaggedPlayerSummary[]>([]);
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState<string | null>(null);

  // Filter state
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

  // Initial load — fetch unfiltered list to populate dropdown options
  useEffect(() => {
    setLoading(true);
    getReviewQueue().then((res) => {
      if (res.success && res.data) {
        // Keep the full unfiltered list for dropdown population
        setAllPlayers(res.data);
        setPlayers(res.data);
      } else {
        setError(res.error ?? "Failed to load review queue");
      }
      setLoading(false);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch whenever filters are submitted
  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    fetchQueue();
  }, [fetchQueue]);

  // Clear handler: resets all filters AND refetches from the API so the list
  // reflects current DB state rather than the stale initial-load snapshot.
  // This prevents resolved players from "reappearing" when filters are cleared.
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

  // Derive dropdown options from the full unfiltered list so options never
  // disappear when a filter is applied (which would lock users into that filter)
  const allTeams = Array.from(
    new Set(allPlayers.map((p) => p.team).filter(Boolean) as string[])
  ).sort();
  const allPositions = Array.from(
    new Set(allPlayers.map((p) => p.position).filter(Boolean) as string[])
  ).sort();
  const allReasons = Array.from(
    new Set(allPlayers.flatMap((p) => p.flag_reasons))
  ).sort();

  return (
    <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-foreground">Review Queue</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Players with at least one unresolved skill flag requiring human review.
        </p>
      </div>

      {/* Direct player lookup — navigate to any player's review card, flagged or not */}
      <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/20">
        <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">Open player</span>
        <PlayerSearchCombobox
          placeholder="Search any player…"
          onSelect={(player) => router.push(`/review/${player.id}`)}
          className="flex-1 max-w-sm"
        />
      </div>

      {/* Filters */}
      <form
        onSubmit={handleSearch}
        className="flex flex-wrap gap-2 items-end"
      >
        {/* Search */}
        <div className="flex-1 min-w-[180px]">
          <label className="text-xs font-medium text-muted-foreground block mb-1">Player Name</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search players…"
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
          />
        </div>

        {/* Team dropdown */}
        <div className="min-w-[110px]">
          <label className="text-xs font-medium text-muted-foreground block mb-1">Team</label>
          <select
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

        {/* Position dropdown */}
        <div className="min-w-[110px]">
          <label className="text-xs font-medium text-muted-foreground block mb-1">Position</label>
          <select
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

        {/* Flag reason dropdown */}
        <div className="min-w-[160px]">
          <label className="text-xs font-medium text-muted-foreground block mb-1">Flag Reason</label>
          <select
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
          type="submit"
          className="px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Filter
        </button>

        {/* Clear filters — refetches from API to avoid showing stale resolved players */}
        {(search || teamFilter || posFilter || reasonFilter) && (
          <button
            type="button"
            onClick={handleClear}
            className="px-3 py-1.5 rounded-md border border-input text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear
          </button>
        )}
      </form>

      {/* Queue count */}
      {!loading && !error && (
        <p className="text-xs text-muted-foreground">
          {players.length === 0
            ? "No players in queue."
            : `${players.length} player${players.length !== 1 ? "s" : ""} in queue`}
        </p>
      )}

      {/* Loading / error states */}
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

      {/* Player table */}
      {!loading && !error && players.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-4 py-2 bg-muted/40 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            <span>Player</span>
            <span className="text-right">Team</span>
            <span className="text-right">Pos</span>
            <span className="text-right">Flags</span>
            <span>Reasons</span>
          </div>

          {/* Rows */}
          <div className="divide-y divide-border">
            {players.map((player) => (
              <Link
                key={player.player_id}
                href={`/review/${player.player_id}`}
                className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-4 py-3 items-center hover:bg-muted/30 transition-colors group"
              >
                {/* Player name */}
                <span className="font-medium text-sm text-foreground group-hover:text-primary transition-colors truncate">
                  {player.player_name}
                </span>

                {/* Team */}
                <span className="text-xs text-muted-foreground text-right">
                  {player.team ?? "—"}
                </span>

                {/* Position */}
                <span className="text-xs text-muted-foreground text-right">
                  {player.position ?? "—"}
                </span>

                {/* Flag count */}
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

                {/* Flag reason badges */}
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
    </main>
  );
}
