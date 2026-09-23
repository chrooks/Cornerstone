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
import { ReasonChip } from "@/components/ReasonChip";
import { UNSAVED_KEY, describeUnsaved, takeUnsaved } from "./deck/_lib/deck";
import {
  ALL_SKILL_NAMES,
  SKILL_CATEGORIES,
  NO_BULK_TRUST_STATS_SKILLS,
  formatSkillName,
} from "@/lib/skills";
import { formatReasonKind, groupReasons } from "@/lib/flag-reasons";

/**
 * One column template for the header and every row. Each row is its own grid
 * (a row is a link), so `auto` tracks would size to that row alone and drift
 * out of line with the header. Fixed tracks keep every column aligned.
 */
const QUEUE_COLUMNS =
  "sm:grid-cols-[minmax(10rem,15rem)_3.5rem_3rem_3rem_minmax(0,1fr)]";

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
  /* A Skill in the URL (?skill=, set by the player page's back link) opens
     the queue already filtered. Validated: it comes from the address bar. */
  const skillParam = searchParams.get("skill") ?? "";
  const initialSkill = ALL_SKILL_NAMES.includes(skillParam) ? skillParam : "";
  const [skillFilter, setSkillFilter]       = useState(initialSkill);

  /* The Skill the CURRENT rows were fetched under — set only after a
     successful fetch, so the bulk bar's counts always describe the queue on
     screen rather than an unapplied dropdown choice (#152, M2.9). */
  const [appliedSkill, setAppliedSkill]     = useState<string | null>(null);
  const [bulkError, setBulkError]           = useState<string | null>(null);
  const [bulkResult, setBulkResult]         = useState<string | null>(null);
  const [bulkSaving, setBulkSaving]         = useState(false);
  /* #166: a swipe-deck call that failed after the deck closed (back link). */
  const [deckUnsaved, setDeckUnsaved]       = useState<string | null>(null);
  useEffect(() => {
    const show = () => {
      const text = describeUnsaved(takeUnsaved());
      if (text) setDeckUnsaved(text);
    };
    show();
    window.addEventListener(UNSAVED_KEY, show);
    return () => window.removeEventListener(UNSAVED_KEY, show);
  }, []);

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
    Promise.all([
      getReviewQueue(),
      initialSkill ? getReviewQueue({ skill_name: initialSkill }) : null,
    ]).then(([all, scoped]) => {
      const shown = scoped ?? all;
      if (all.success && all.data) setAllPlayers(all.data);
      if (shown.success && shown.data) {
        setPlayers(shown.data);
        setAppliedSkill(initialSkill || null);
      } else {
        setError(shown.error ?? "Failed to load review queue");
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
  const allReasonKinds = groupReasons(
    Array.from(new Set(allPlayers.flatMap((p) => p.flag_reasons)))
  ).map((g) => g.kind);

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
            {allReasonKinds.map((k) => (
              <option key={k} value={k}>{formatReasonKind(k)}</option>
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

      {deckUnsaved && (
        <div
          id="review-deck-unsaved"
          role="alert"
          className="flex items-start justify-between gap-3 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <p>{deckUnsaved}</p>
          <button
            id="review-deck-unsaved-dismiss-btn"
            type="button"
            aria-label="Dismiss"
            onClick={() => setDeckUnsaved(null)}
            className="-my-1 min-h-9 min-w-9 shrink-0 rounded-[4px] hover:bg-destructive/10"
          >
            ✕
          </button>
        </div>
      )}

      {/* #166: the same Skill as a swipe deck — one card per open flag, one thumb.
          The deck holds every open flag on the Skill, whatever the other
          filters show, so the link names no count; the deck header does.
          Hidden under a subset scope for the same reason. */}
      {!loading && !error && appliedSkill && !scopedIds && visiblePlayers.length > 0 && (
        <Link
          id="review-open-deck-link"
          href={`/admin/review/deck?skill=${appliedSkill}`}
          className="flex min-h-11 items-center justify-between gap-3 rounded-[4px] bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-[#fe6d34] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:inline-flex sm:justify-start"
        >
          <span>Swipe the {skillLabel} deck</span>
          <span aria-hidden>→</span>
        </Link>
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

          <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
            {/* A HIGH Skill has no Claude tier, so this button could never act:
                the note above says why, and the button stays out of the way. */}
            {!isHighSkill && (
              <button
                id="review-skill-bulk-trust-claude-btn"
                type="button"
                disabled={bulkSaving || agreementTotal === 0}
                onClick={() => runSkillBulk("trust_claude", agreementTotal, true)}
                className="min-h-11 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed sm:min-h-0 sm:py-1.5"
              >
                {bulkSaving
                  ? "Resolving…"
                  : `Trust Claude for ${agreementTotal} ${skillLabel} agreement${agreementTotal === 1 ? "" : "s"}`}
              </button>
            )}
            {canTrustStats && (
              <button
                id="review-skill-bulk-trust-stats-btn"
                type="button"
                disabled={bulkSaving || skillFlagTotal === 0}
                onClick={() => runSkillBulk("trust_stats", skillFlagTotal, false)}
                className="min-h-11 px-3 rounded-md border border-input bg-background text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed sm:min-h-0 sm:py-1.5"
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
          <div
            id="review-player-table-header"
            className={cn(
              "hidden sm:grid gap-x-4 px-4 py-2 bg-muted/40 border-b border-border text-xs font-medium text-muted-foreground",
              QUEUE_COLUMNS
            )}
          >
            <span>Player</span>
            <span>Team</span>
            <span>Pos</span>
            <span className="text-right">Flags</span>
            <span>Reasons</span>
          </div>

          <ul className="divide-y divide-border">
            {visiblePlayers.map((player) => (
              <li key={player.player_id}>
                <Link
                  id={`review-queue-row-${player.player_id}`}
                  href={`/admin/review/${player.player_id}${appliedSkill ? `?skill=${appliedSkill}` : ""}`}
                  className={cn(
                    "group grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1.5 px-4 py-2.5",
                    "transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    QUEUE_COLUMNS
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                      {player.player_name}
                    </span>
                    {/* Below sm the Team and Pos columns fold under the name. */}
                    <span className="block font-mono text-xs text-muted-foreground sm:hidden">
                      {[player.team, player.position].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </span>
                  <span className="hidden sm:block font-mono text-xs text-muted-foreground">
                    {player.team ?? "—"}
                  </span>
                  <span className="hidden sm:block font-mono text-xs text-muted-foreground">
                    {player.position ?? "—"}
                  </span>
                  {/* No count color: the list is sorted by this number, so a
                      color would only repeat what the order already says. */}
                  <span className="text-right font-mono text-sm tabular-nums text-foreground">
                    {player.unresolved_flag_count}
                    <span className="font-sans text-xs text-muted-foreground sm:hidden">
                      {player.unresolved_flag_count === 1 ? " flag" : " flags"}
                    </span>
                  </span>
                  <span className="col-span-2 flex flex-wrap gap-1 sm:col-span-1">
                    {groupReasons(player.flag_reasons).map((g) => (
                      <ReasonChip key={g.kind} kind={g.kind} details={g.details} />
                    ))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
