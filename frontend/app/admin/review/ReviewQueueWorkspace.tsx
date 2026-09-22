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
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getReviewQueue, bulkResolveFlags, type ReviewQueueEntry } from "@/lib/api";
import { PlayerSearchCombobox } from "@/components/PlayerSearchCombobox";
import {
  ALL_SKILL_NAMES,
  SKILL_CATEGORIES,
  NO_BULK_TRUST_STATS_SKILLS,
  formatSkillName,
} from "@/lib/skills";

const FLAG_REASON_LABELS: Record<string, string> = {
  two_tier_disagreement:   "2-Tier Disagree",
  one_tier_low_confidence: "1-Tier (Low Conf)",
  low_notability:          "Low Notability",
  claude_low_confidence:   "Claude Low Conf",
  data_missing:            "Data Missing",
};

/** Claude is never asked about a HIGH Skill, so it can have no agreements. */
const HIGH_CONFIDENCE_SKILLS = new Set(SKILL_CATEGORIES["High Confidence"]);

/** Server reasons for a flag the bulk resolve deliberately left open. */
const SKIP_REASON_LABELS: Record<string, [singular: string, plural: string]> = {
  disagreement:       ["disagreement", "disagreements"],
  human_decision:     ["human decision", "human decisions"],
  negative_candidate: ["negative candidate", "negative candidates"],
  no_claude_tier:     ["no Claude tier", "no Claude tier"],
  defensive_key:      ["defensive key", "defensive keys"],
};

/** Mirrors `_BULK_PLAYER_CAP` in backend/api/review.py. */
const BULK_PLAYER_CAP = 600;

/**
 * Error States for the bulk endpoint. The API answers with a bare code, which
 * names no cause and no way forward — so each one gets a sentence that does.
 */
const BULK_ERROR_LABELS: Record<string, string> = {
  too_many_players:
    `A bulk resolve covers at most ${BULK_PLAYER_CAP} players at once. ` +
    "Narrow the queue by team or position, then run it once per slice.",
  defensive_key_trust_stats_blocked:
    "Trust Stats is blocked on this Skill — its tier drives an archetype label, " +
    "so each flag needs a person. Use Trust Claude, or open the players one by one.",
  unknown_skill:
    "That Skill is not in the taxonomy. Reload the page and pick it again.",
  invalid_agreements_only:
    "The request was malformed. Reload the page and try once more.",
};

function describeSkips(skipped: { reason: string }[]): string {
  const counts = new Map<string, number>();
  for (const s of skipped) {
    counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  }
  return Array.from(counts, ([reason, n]) => {
    const labels = SKIP_REASON_LABELS[reason];
    const label = labels ? labels[n === 1 ? 0 : 1] : reason.replace(/_/g, " ");
    return `${n} ${label}`;
  }).join(", ");
}

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
  const [players, setPlayers]               = useState<ReviewQueueEntry[]>([]);
  const [allPlayers, setAllPlayers]         = useState<ReviewQueueEntry[]>([]);
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState<string | null>(null);

  const [search, setSearch]                 = useState("");
  const [teamFilter, setTeamFilter]         = useState("");
  const [posFilter, setPosFilter]           = useState("");
  const [reasonFilter, setReasonFilter]     = useState("");
  const [skillFilter, setSkillFilter]       = useState("");

  /* The Skill the CURRENT rows were fetched under — set only after a
     successful fetch, so the bulk bar's counts always describe the queue on
     screen rather than an unapplied dropdown choice (#152, M2.9). */
  const [appliedSkill, setAppliedSkill]     = useState<string | null>(null);
  const [bulkError, setBulkError]           = useState<string | null>(null);
  const [bulkResult, setBulkResult]         = useState<string | null>(null);
  const [bulkSaving, setBulkSaving]         = useState(false);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getReviewQueue({
      search:      search || undefined,
      team:        teamFilter || undefined,
      position:    posFilter || undefined,
      flag_reason: reasonFilter || undefined,
      skill_name:  skillFilter || undefined,
    });
    if (res.success && res.data) {
      setPlayers(res.data);
      setAppliedSkill(skillFilter || null);
    } else {
      setError(res.error ?? "Failed to load review queue");
    }
    setLoading(false);
  }, [search, teamFilter, posFilter, reasonFilter, skillFilter]);

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
    setBulkError(null);
    setBulkResult(null);
    fetchQueue();
  }, [fetchQueue]);

  const handleClear = useCallback(async () => {
    setSearch("");
    setTeamFilter("");
    setPosFilter("");
    setReasonFilter("");
    setSkillFilter("");
    setAppliedSkill(null);
    setBulkError(null);
    setBulkResult(null);
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

  /* Per-Skill bulk bar (#152, M2.10). Every count below describes the rows on
     screen, so a button label promises exactly what the click will resolve. */
  const skillLabel      = appliedSkill ? formatSkillName(appliedSkill) : "";
  const agreementTotal  = visiblePlayers.reduce((n, p) => n + (p.agreement_count ?? 0), 0);
  const skillFlagTotal  = visiblePlayers.reduce((n, p) => n + p.unresolved_flag_count, 0);
  const isHighSkill     = appliedSkill != null && HIGH_CONFIDENCE_SKILLS.has(appliedSkill);
  const canTrustStats   = appliedSkill != null && !NO_BULK_TRUST_STATS_SKILLS.has(appliedSkill);

  const runSkillBulk = useCallback(
    async (
      resolution: "trust_stats" | "trust_claude",
      count: number,
      agreementsOnly: boolean
    ) => {
      if (!appliedSkill || bulkSaving) return;
      const label = formatSkillName(appliedSkill);
      const noun = agreementsOnly ? "agreement" : "flag";
      const confirmed = window.confirm(
        `${resolution === "trust_claude" ? "Trust Claude" : "Trust Stats"} for ` +
          `${count} ${label} ${noun}${count === 1 ? "" : "s"} across ` +
          `${visiblePlayers.length} player${visiblePlayers.length === 1 ? "" : "s"}?\n\n` +
          "This writes the tier into each published composite profile and cannot be undone."
      );
      if (!confirmed) return;

      setBulkSaving(true);
      setBulkError(null);
      try {
        const res = await bulkResolveFlags(
          {
            playerIds: visiblePlayers.map((p) => p.player_id),
            skillName: appliedSkill,
            agreementsOnly,
          },
          resolution
        );
        if (res.success && res.data) {
          const skipped = res.data.skipped ?? [];
          const summary =
            `Resolved ${res.data.resolved_count}` +
            (skipped.length > 0
              ? ` · ${skipped.length} left open: ${describeSkips(skipped)}. ` +
                "Those need a person — open the players below."
              : "");
          setBulkResult(summary);
          toast.success(summary);
          await fetchQueue();
        } else {
          /* Error State: the request was refused, so the queue is unchanged. */
          const code = res.error ?? "";
          setBulkError(BULK_ERROR_LABELS[code] ?? (code || "Bulk resolve failed"));
        }
      } catch {
        /* A dropped or timed-out request is NOT "nothing happened" — the write
           runs per player, so some of it may have landed. Refetch, and say so. */
        setBulkError(
          "The request did not finish. Some flags may already be resolved — " +
            "the queue below has been refreshed."
        );
        await fetchQueue();
      } finally {
        setBulkSaving(false);
      }
    },
    [appliedSkill, bulkSaving, visiblePlayers, fetchQueue]
  );

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

        <div className="min-w-[170px]">
          <label htmlFor="review-skill-select" className="text-xs font-medium text-muted-foreground block mb-1">Skill</label>
          <select
            id="review-skill-select"
            value={skillFilter}
            onChange={(e) => setSkillFilter(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All skills</option>
            {ALL_SKILL_NAMES.map((s) => (
              <option key={s} value={s}>{formatSkillName(s)}</option>
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

        {(search || teamFilter || posFilter || reasonFilter || skillFilter) && (
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
          role="status"
          className="flex items-center justify-between gap-3 rounded-[6px] border border-[#ffa05c]/40 bg-[#fff8f4] px-3 py-2 text-xs text-[#0e0907]"
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

      {/* Per-Skill bulk bar (#152, M2.10) — only after a Skill filter applied. */}
      {!loading && !error && appliedSkill && visiblePlayers.length > 0 && (
        <div
          id="review-skill-bulk-actions"
          className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3"
        >
          <div className="min-w-[220px]">
            <p className="text-sm font-semibold text-foreground">{skillLabel}</p>
            <p id="review-skill-bulk-counts" className="text-xs text-muted-foreground mt-0.5">
              {agreementTotal} agreement{agreementTotal === 1 ? "" : "s"} ·{" "}
              {skillFlagTotal} open flag{skillFlagTotal === 1 ? "" : "s"} across{" "}
              {visiblePlayers.length} player{visiblePlayers.length === 1 ? "" : "s"}
            </p>
            {isHighSkill && (
              <p id="review-skill-bulk-high-note" className="text-xs text-muted-foreground mt-1">
                Claude is never asked about a high-confidence Skill, so it has no agreements to trust.
              </p>
            )}
            {!canTrustStats && (
              <p id="review-skill-bulk-defensive-note" className="text-xs text-muted-foreground mt-1">
                Trust Stats is blocked here — the archetype labels read this defensive tier, so each flag gets a human.
              </p>
            )}
            {reasonFilter && (
              <p id="review-skill-bulk-reason-note" className="text-xs text-muted-foreground mt-1">
                The Flag Reason filter narrows the list, not the bulk action — this
                resolves every open {skillLabel} flag on the players shown.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              id="review-skill-bulk-trust-claude-btn"
              type="button"
              disabled={bulkSaving || isHighSkill || agreementTotal === 0}
              onClick={() => runSkillBulk("trust_claude", agreementTotal, true)}
              className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {bulkSaving
                ? "Resolving…"
                : `Trust Claude for ${agreementTotal} ${skillLabel} agreement${agreementTotal === 1 ? "" : "s"}`}
            </button>
            {canTrustStats && (
              <button
                id="review-skill-bulk-trust-stats-btn"
                type="button"
                disabled={bulkSaving || skillFlagTotal === 0}
                onClick={() => runSkillBulk("trust_stats", skillFlagTotal, false)}
                className="px-3 py-1.5 rounded-md border border-input bg-background text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {bulkSaving
                  ? "Resolving…"
                  : `Trust Stats for ${skillFlagTotal} ${skillLabel} flag${skillFlagTotal === 1 ? "" : "s"}`}
              </button>
            )}
          </div>
        </div>
      )}

      {bulkError && (
        <div
          id="review-skill-bulk-error"
          role="alert"
          className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive"
        >
          {bulkError}
        </div>
      )}

      {/* The standalone /admin/review route mounts no <Toaster>, so the same
          sentence the toast carries also lands here. */}
      {bulkResult && !bulkError && (
        <p
          id="review-skill-bulk-result"
          role="status"
          className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm text-foreground"
        >
          {bulkResult}
        </p>
      )}

      {/* Empty State: a Skill filter that matched nothing. */}
      {!loading && !error && appliedSkill && visiblePlayers.length === 0 && (
        <div
          id="review-skill-bulk-empty"
          className="rounded-lg border border-border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground"
        >
          No open {skillLabel} flags
        </div>
      )}

      {/* The Skill Empty State above already says why the list is empty, and
          "No players in queue." would be untrue when only that Skill is clear. */}
      {!loading && !error && !(visiblePlayers.length === 0 && appliedSkill) && (
        <p id="review-queue-count" className="text-xs text-muted-foreground">
          {visiblePlayers.length === 0
            ? scopedIds
              ? "None of the scoped Players have unresolved flags in the current queue."
              : "No players in queue."
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
