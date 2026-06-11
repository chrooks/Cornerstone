"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Toaster, toast } from "sonner";
import { cn } from "@/lib/utils";
import { getPlayerFlags, resolveFlag, bulkResolveFlags, getSkillBreakdown, manualOverrideSkill, getPlayerStats, getReviewQueue, deletePlayer } from "@/lib/api";
import { SkillTierBadge } from "@/components/SkillTierBadge";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { ConditionBreakdown } from "@/components/ConditionBreakdown";
import type {
  PlayerReviewDetail,
  SkillFlag,
  SkillTier,
  FlagResolution,
  ConditionResult,
  FlaggedPlayerSummary,
} from "@/lib/types";
import { SKILL_TIERS, TIER_PICKER_ACTIVE_CLASS } from "@/lib/tiers";
import { ALL_SKILL_NAMES, formatSkillName } from "@/lib/skills";

const CURRENT_SEASON = "2025-26";

// Human-readable flag reason labels
const FLAG_REASON_LABELS: Record<string, string> = {
  two_tier_disagreement:   "2-tier disagreement",
  one_tier_low_confidence: "1-tier (low confidence)",
  low_notability:          "Low notability",
  claude_low_confidence:   "Claude reported low confidence",
  data_missing:            "Data missing",
};

/** Source badge for the composite result's source field. */
function SourceBadge({ source }: { source: string }) {
  const map: Record<string, string> = {
    stats_only:    "bg-blue-100 text-blue-700",
    auto_accepted: "bg-green-100 text-green-700",
    flagged:       "bg-amber-100 text-amber-700",
    resolved:      "bg-emerald-100 text-emerald-700",
  };
  return (
    <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", map[source] ?? "bg-muted text-muted-foreground")}>
      {source.replace(/_/g, " ")}
    </span>
  );
}

/** Override tier picker for manual resolution. */
function TierPicker({
  value,
  onChange,
}: {
  value: SkillTier | "";
  onChange: (tier: SkillTier) => void;
}) {
  // SKILL_TIERS and TIER_PICKER_ACTIVE_CLASS imported from @/lib/tiers
  return (
    <div className="flex gap-1 flex-wrap">
      {SKILL_TIERS.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={cn(
            "text-xs px-2 py-1 rounded border transition-colors",
            value === t
              ? TIER_PICKER_ACTIVE_CLASS[t]
              : "border-input text-muted-foreground hover:border-foreground"
          )}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

/**
 * A single skill row in the review panel.
 * Shows stat tier | flag reason | claude tier, plus resolution buttons.
 */
function SkillReviewRow({
  flag,
  statTier,
  claudeTier,
  isFocused,
  onRowMount,
  onResolve,
  saving,
  playerId,
  season,
}: {
  flag: SkillFlag;
  statTier: string | null;
  claudeTier: string | null;
  isFocused: boolean;
  /** Ref callback — called with the outer div element once mounted */
  onRowMount?: (el: HTMLDivElement | null) => void;
  onResolve: (resolution: FlagResolution, resolvedValue?: string) => void;
  saving: boolean;
  playerId: string;
  season: string;
}) {
  const [showOverride, setShowOverride] = useState(false);
  const [overrideTier, setOverrideTier] = useState<SkillTier | "">("");

  // Lazy-loaded condition breakdown
  const [breakdown, setBreakdown]           = useState<ConditionResult[] | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [breakdownError, setBreakdownError] = useState<string | null>(null);

  // Fetch breakdown on first expand — cached in state after that
  const handleFetchBreakdown = async () => {
    if (breakdown !== null) return; // Already loaded
    setBreakdownLoading(true);
    setBreakdownError(null);
    try {
      const res = await getSkillBreakdown(playerId, flag.skill_name, season);
      if (res.success && res.data) {
        setBreakdown(res.data.condition_results);
      } else {
        setBreakdownError(res.error ?? "Failed to load breakdown");
      }
    } catch {
      setBreakdownError("Failed to load breakdown");
    } finally {
      setBreakdownLoading(false);
    }
  };

  const isResolved = flag.resolution != null;

  return (
    <div
      ref={onRowMount}
      className={cn(
        "rounded-lg border transition-all",
        isFocused
          ? "border-ring ring-2 ring-ring/30 bg-accent/30"
          : "border-border",
        isResolved && "opacity-60"
      )}
    >
      {/* Skill name + flag reason */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
        <span className="font-medium text-sm text-foreground flex-1">
          {formatSkillName(flag.skill_name)}
        </span>
        <span className="text-xs text-muted-foreground italic">
          {FLAG_REASON_LABELS[flag.flag_reason] ?? flag.flag_reason}
        </span>
        {isResolved && (
          <span className="text-xs text-emerald-600 font-medium">✓ Resolved</span>
        )}
      </div>

      {/* Tier comparison row */}
      <div className="grid grid-cols-3 gap-2 px-3 py-2.5 items-center">
        {/* Stat tier */}
        <div className="space-y-1">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Stats</p>
          {statTier ? (
            <SkillTierBadge tier={statTier as SkillTier} size="sm" />
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </div>

        {/* Composite final tier */}
        <div className="space-y-1 text-center">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Composite</p>
          {isResolved && flag.resolved_value ? (
            <div className="flex flex-col items-center gap-0.5">
              <SkillTierBadge tier={flag.resolved_value as SkillTier} size="sm" />
              <span className="text-[9px] text-muted-foreground">
                via {flag.resolution?.replace(/_/g, " ")}
              </span>
            </div>
          ) : (
            <span className="text-xs text-amber-600">Unresolved</span>
          )}
        </div>

        {/* Claude tier */}
        <div className="space-y-1 text-right">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Claude</p>
          {claudeTier ? (
            <SkillTierBadge tier={claudeTier as SkillTier} size="sm" />
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </div>
      </div>

      {/* Claude justification */}
      {flag.claude_justification && (
        <div className="px-3 pb-2">
          <p className="text-xs text-muted-foreground italic border-l-2 border-muted pl-2">
            {flag.claude_justification}
          </p>
        </div>
      )}

      {/* Stats vs Thresholds condition breakdown — lazy loaded on expand */}
      <div className="px-3 pb-2">
        {breakdown !== null ? (
          <ConditionBreakdown conditions={breakdown} defaultOpen />
        ) : breakdownError ? (
          <p className="text-[10px] text-destructive">{breakdownError}</p>
        ) : (
          <button
            type="button"
            onClick={handleFetchBreakdown}
            disabled={breakdownLoading}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors select-none disabled:opacity-50"
          >
            <span>▸</span>
            <span>{breakdownLoading ? "Loading…" : "Stats vs Thresholds"}</span>
          </button>
        )}
      </div>

      {/* Resolution buttons — only shown for unresolved flags */}
      {!isResolved && (
        <div className="px-3 pb-3 space-y-2">
          <div className="flex gap-2 flex-wrap">
            {/* Trust Stats */}
            <button
              type="button"
              disabled={saving}
              onClick={() => onResolve("trust_stats")}
              className={cn(
                "text-xs px-3 py-1.5 rounded-md border font-medium transition-colors",
                "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100",
                saving && "opacity-50 cursor-not-allowed"
              )}
            >
              Trust Stats ({statTier ?? "—"})
            </button>

            {/* Trust Claude */}
            {claudeTier && (
              <button
                type="button"
                disabled={saving}
                onClick={() => onResolve("trust_claude")}
                className={cn(
                  "text-xs px-3 py-1.5 rounded-md border font-medium transition-colors",
                  "border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100",
                  saving && "opacity-50 cursor-not-allowed"
                )}
              >
                Trust Claude ({claudeTier})
              </button>
            )}

            {/* Override */}
            <button
              type="button"
              disabled={saving}
              onClick={() => setShowOverride((v) => !v)}
              className={cn(
                "text-xs px-3 py-1.5 rounded-md border font-medium transition-colors",
                showOverride
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input text-muted-foreground hover:text-foreground hover:border-foreground",
                saving && "opacity-50 cursor-not-allowed"
              )}
            >
              Override
            </button>
          </div>

          {/* Override picker */}
          {showOverride && (
            <div className="flex items-center gap-2">
              <TierPicker value={overrideTier} onChange={setOverrideTier} />
              <button
                type="button"
                disabled={!overrideTier || saving}
                onClick={() => {
                  if (overrideTier) onResolve("manual_override", overrideTier);
                }}
                className={cn(
                  "text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground font-medium transition-colors",
                  "hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                Set Override
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PlayerReviewPage() {
  const { player_id } = useParams<{ player_id: string }>();
  const router        = useRouter();

  const [detail, setDetail]     = useState<PlayerReviewDetail | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  // Ordered review queue for prev/next navigation
  const [queue, setQueue] = useState<FlaggedPlayerSummary[]>([]);
  useEffect(() => {
    getReviewQueue().then((res) => {
      if (res.success && res.data) setQueue(res.data);
    });
  }, []);
  const queueIdx  = queue.findIndex((p) => p.player_id === player_id);
  const prevEntry = queueIdx > 0 ? queue[queueIdx - 1] : null;
  const nextEntry = queueIdx >= 0 && queueIdx < queue.length - 1 ? queue[queueIdx + 1] : null;

  // Box score stats for the player header line (pts/reb/ast/stl/blk/fg%/3p%)
  const [boxStats, setBoxStats] = useState<Record<string, number | null> | null>(null);

  const [savingSkill, setSavingSkill] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving]   = useState(false);

  const [refreshing, setRefreshing] = useState(false);

  // Delete confirmation modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleting, setDeleting]               = useState(false);
  const [deleteError, setDeleteError]         = useState<string | null>(null);

  const handleDeleteConfirm = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await deletePlayer(player_id);
      if (res.success) {
        router.push("/admin/snapshots/draft?tab=review");
      } else {
        setDeleteError(res.error ?? "Delete failed");
        setDeleting(false);
      }
    } catch {
      setDeleteError("Request failed");
      setDeleting(false);
    }
  };

  // Manual override state for the "All Skills" section
  const [overridingSkill, setOverridingSkill] = useState<string | null>(null);
  const [overrideTier, setOverrideTier]       = useState<SkillTier | "">("");
  const [overrideSaving, setOverrideSaving]   = useState(false);
  const [allSkillsOpen, setAllSkillsOpen]     = useState(false);

  // Keyboard navigation: focused skill index within unresolved flags
  const [focusedIdx, setFocusedIdx]         = useState(0);
  // Map of skill_name → actual DOM element (populated via ref callbacks in JSX)
  const rowRefs                             = useRef<Map<string, HTMLDivElement>>(new Map());

  const fetchDetail = useCallback(async () => {
    if (!player_id) return;
    setLoading(true);
    setError(null);
    // Fetch flags and stats blob in parallel. cachedOnly: the review profile
    // must not block on the ~18s cold nba_api refetch — stats refresh belongs
    // to the draft fetch-stats pipeline stage, not this read-only QA view.
    const [flagsRes, statsRes] = await Promise.all([
      getPlayerFlags(player_id, CURRENT_SEASON),
      getPlayerStats(player_id, CURRENT_SEASON, false, true),
    ]);
    if (flagsRes.success && flagsRes.data) {
      setDetail(flagsRes.data);
    } else {
      setError(flagsRes.error ?? "Failed to load player flags");
    }
    if (statsRes.success && statsRes.data?.box_score) {
      setBoxStats(statsRes.data.box_score);
    }
    setLoading(false);
  }, [player_id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  // Keyboard shortcut handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when focus is inside an input / textarea
      if (
        (e.target as HTMLElement).tagName === "INPUT" ||
        (e.target as HTMLElement).tagName === "TEXTAREA"
      ) {
        return;
      }

      const unresolvedFlags =
        detail?.flags.filter((f) => f.resolution == null) ?? [];

      if (e.key === "j" || e.key === "ArrowDown") {
        setFocusedIdx((i) => Math.min(i + 1, unresolvedFlags.length - 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        setFocusedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "ArrowRight" && nextEntry) {
        router.push(`/admin/review/${nextEntry.player_id}`);
      } else if (e.key === "ArrowLeft" && prevEntry) {
        router.push(`/admin/review/${prevEntry.player_id}`);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [detail, prevEntry, nextEntry, router]);

  // Auto-scroll focused row into view
  useEffect(() => {
    const unresolvedFlags =
      detail?.flags.filter((f) => f.resolution == null) ?? [];
    if (unresolvedFlags[focusedIdx]) {
      const skill = unresolvedFlags[focusedIdx].skill_name;
      const el    = rowRefs.current.get(skill);
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [focusedIdx, detail]);

  // Resolve a single flag
  const handleResolve = useCallback(
    async (flag: SkillFlag, resolution: FlagResolution, resolvedValue?: string) => {
      if (!player_id) return;
      setSavingSkill(flag.skill_name);
      try {
        const res = await resolveFlag(player_id, {
          skill_name:     flag.skill_name,
          resolution,
          resolved_value: resolvedValue ?? null,
          season:         CURRENT_SEASON,
        });
        if (res.success) {
          const resolvedTier = res.data?.resolved_tier ?? resolvedValue ?? null;
          // Update both the flag record and the composite profile so "All Skills" stays in sync
          setDetail((d) => {
            if (!d) return d;
            const existingSkill = d.profiles.composite[flag.skill_name] ?? {};
            return {
              ...d,
              flags: d.flags.map((f) =>
                f.skill_name === flag.skill_name
                  ? {
                      ...f,
                      resolution,
                      resolved_value: resolvedTier,
                      resolved_at:    new Date().toISOString(),
                    }
                  : f
              ),
              profiles: {
                ...d.profiles,
                composite: {
                  ...d.profiles.composite,
                  [flag.skill_name]: {
                    ...existingSkill,
                    final_tier: resolvedTier ?? existingSkill.final_tier,
                    source:     "resolved",
                  },
                },
              },
            };
          });
          toast.success(`${formatSkillName(flag.skill_name)} resolved`);

          if (res.data?.all_flags_resolved) {
            toast.success("All flags resolved — player review complete!", {
              action: {
                label:   "Back to Queue",
                onClick: () => router.push("/admin/snapshots/draft?tab=review"),
              },
            });
          }
        } else {
          toast.error(res.error ?? "Failed to resolve flag");
        }
      } catch {
        toast.error("Request failed");
      } finally {
        setSavingSkill(null);
      }
    },
    [player_id, router]
  );

  // Bulk resolve all unresolved flags for this player
  const handleBulkResolve = useCallback(
    async (resolution: "trust_stats" | "trust_claude") => {
      if (!player_id) return;
      setBulkSaving(true);
      try {
        const res = await bulkResolveFlags(player_id, resolution, undefined, CURRENT_SEASON);
        if (res.success && res.data) {
          toast.success(`Resolved ${res.data.resolved_count} flags`);
          await fetchDetail(); // Refresh all flags
        } else {
          toast.error(res.error ?? "Bulk resolve failed");
        }
      } catch {
        toast.error("Request failed");
      } finally {
        setBulkSaving(false);
      }
    },
    [player_id, fetchDetail]
  );

  // Force re-fetch stats from NBA API, then reload flag detail
  const handleRefresh = useCallback(async () => {
    if (!player_id) return;
    setRefreshing(true);
    try {
      const res = await getPlayerStats(player_id, undefined, true);
      if (res.success) {
        await fetchDetail();
        toast.success("Stats refreshed");
      } else {
        toast.error(res.error ?? "Failed to refresh stats");
      }
    } catch {
      toast.error("Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }, [player_id, fetchDetail]);

  // Manually override any skill's final tier regardless of flag status
  const handleManualOverride = useCallback(
    async (skillName: string, tier: SkillTier) => {
      if (!player_id) return;
      setOverrideSaving(true);
      try {
        const res = await manualOverrideSkill(player_id, {
          skill_name:     skillName,
          resolved_value: tier,
          season:         CURRENT_SEASON,
        });
        if (res.success && res.data) {
          // Update composite profile in local state
          setDetail((d) => {
            if (!d) return d;
            const existingSkill = d.profiles.composite[skillName] ?? {};
            return {
              ...d,
              profiles: {
                ...d.profiles,
                composite: {
                  ...d.profiles.composite,
                  [skillName]: {
                    ...existingSkill,
                    final_tier: tier,
                    source:     "manual_override",
                  },
                },
              },
              // If the skill already had a flag, update it too
              flags: d.flags.map((f) =>
                f.skill_name === skillName
                  ? {
                      ...f,
                      resolution:     "manual_override",
                      resolved_value: tier,
                      resolved_at:    new Date().toISOString(),
                    }
                  : f
              ),
            };
          });
          toast.success(`${formatSkillName(skillName)} overridden → ${tier}`);
          setOverridingSkill(null);
          setOverrideTier("");
        } else {
          toast.error(res.error ?? "Override failed");
        }
      } catch {
        toast.error("Request failed");
      } finally {
        setOverrideSaving(false);
      }
    },
    [player_id]
  );

  if (loading) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="space-y-3 animate-pulse">
          <div className="h-8 w-64 bg-muted rounded" />
          <div className="h-4 w-40 bg-muted rounded" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-32 bg-muted rounded-lg" />
          ))}
        </div>
      </main>
    );
  }

  if (error || !detail) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive">
          {error ?? "Player not found"}
        </div>
        <Link href="/admin/snapshots/draft?tab=review" className="mt-4 inline-block text-sm text-muted-foreground hover:text-foreground">
          ← Back to queue
        </Link>
      </main>
    );
  }

  const { player, flags, profiles } = detail;
  const unresolvedFlags = flags.filter((f) => f.resolution == null);
  const resolvedFlags   = flags.filter((f) => f.resolution != null);

  return (
    <main id="player-review-page" className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <Toaster position="top-right" richColors />

      {/* Delete confirmation modal */}
      {deleteModalOpen && (
        <div
          id="review-delete-modal-overlay"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => { if (!deleting) setDeleteModalOpen(false); }}
        >
          <div
            id="review-delete-modal"
            className="bg-background border border-border rounded-lg shadow-lg p-6 w-full max-w-sm mx-4 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="review-delete-modal-title" className="text-base font-semibold text-foreground">
              Delete {player.name}?
            </h2>
            <p id="review-delete-modal-body" className="text-sm text-muted-foreground">
              This will permanently remove the player and all associated stats, skill profiles,
              and flags. This action cannot be undone.
            </p>
            {deleteError && (
              <p id="review-delete-modal-error" className="text-sm text-destructive">{deleteError}</p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                id="review-delete-modal-cancel"
                type="button"
                disabled={deleting}
                onClick={() => { setDeleteModalOpen(false); setDeleteError(null); }}
                className="text-sm px-3 py-1.5 rounded border border-border text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
              >
                Cancel
              </button>
              <button
                id="review-delete-modal-confirm"
                type="button"
                disabled={deleting}
                onClick={handleDeleteConfirm}
                className="text-sm px-3 py-1.5 rounded bg-destructive text-destructive-foreground font-medium hover:opacity-80 disabled:opacity-40 transition-opacity"
              >
                {deleting ? "Deleting…" : "Delete Player"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Prev/next navigation — fixed in the left and right margins */}
      {prevEntry && (
        <button
          id="review-prev-btn"
          type="button"
          onClick={() => router.push(`/admin/review/${prevEntry.player_id}`)}
          title={`← ${prevEntry.player_name}`}
          className={cn(
            "fixed left-3 top-1/2 -translate-y-1/2 z-40",
            "flex flex-col items-center gap-1",
            "p-2 rounded-lg border border-border bg-background/80 backdrop-blur-sm shadow-sm",
            "text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors group"
          )}
        >
          <span className="text-base leading-none">‹</span>
          <span className="text-[9px] font-medium max-w-[48px] text-center truncate leading-tight opacity-60 group-hover:opacity-100">
            {prevEntry.player_name.split(" ").at(-1)}
          </span>
        </button>
      )}
      {nextEntry && (
        <button
          id="review-next-btn"
          type="button"
          onClick={() => router.push(`/admin/review/${nextEntry.player_id}`)}
          title={`${nextEntry.player_name} →`}
          className={cn(
            "fixed right-3 top-1/2 -translate-y-1/2 z-40",
            "flex flex-col items-center gap-1",
            "p-2 rounded-lg border border-border bg-background/80 backdrop-blur-sm shadow-sm",
            "text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors group"
          )}
        >
          <span className="text-base leading-none">›</span>
          <span className="text-[9px] font-medium max-w-[48px] text-center truncate leading-tight opacity-60 group-hover:opacity-100">
            {nextEntry.player_name.split(" ").at(-1)}
          </span>
        </button>
      )}

      {/* Back link + player header */}
      <div id="review-player-header">
        <Link
          id="review-back-link"
          href="/admin/snapshots/draft?tab=review"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Review Queue
        </Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <PlayerHeadshot nba_api_id={player.nba_api_id} size={72} name={player.name} />
            <div>
            <div className="flex items-center gap-2">
              <h1 id="review-player-name" className="text-xl font-bold text-foreground">
                {player.name}
              </h1>
              <button
                id="review-refresh-btn"
                type="button"
                onClick={handleRefresh}
                disabled={refreshing}
                title="Force re-fetch stats from NBA API (bypasses cache)"
                className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
              >
                {refreshing ? "Refreshing…" : "↻ Refresh"}
              </button>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {player.team && (
                <>
                  <Link
                    href={`/players?team=${encodeURIComponent(player.team)}`}
                    className="hover:underline hover:text-foreground transition-colors"
                  >
                    {player.team}
                  </Link>
                  {" · "}
                </>
              )}
              {[
                player.position,
                player.age ? `Age ${player.age}` : null,
                player.height ?? null,
                player.weight ? `${player.weight} lbs` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              {player.games_played && (
                <span>
                  {" "}· {player.games_played} GP · {player.minutes_per_game?.toFixed(1)} MPG
                </span>
              )}
            </p>
            {boxStats && (
              <p className="text-xs text-muted-foreground mt-0.5 font-mono tabular-nums">
                {[
                  boxStats.pts    != null ? `${boxStats.pts.toFixed(1)} Pts`    : null,
                  boxStats.reb    != null ? `${boxStats.reb.toFixed(1)} Reb`    : null,
                  boxStats.ast    != null ? `${boxStats.ast.toFixed(1)} Ast`    : null,
                  boxStats.stl    != null ? `${boxStats.stl.toFixed(1)} Stl`    : null,
                  boxStats.blk    != null ? `${boxStats.blk.toFixed(1)} Blk`    : null,
                  boxStats.fg_pct  != null ? `${(boxStats.fg_pct * 100).toFixed(1)}% FG`  : null,
                  boxStats.fg3_pct != null ? `${(boxStats.fg3_pct * 100).toFixed(1)}% 3P` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
            </div>
          </div>
          {/* Top-right actions: profile link + delete */}
          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <Link
              id="review-view-profile-link"
              href={`/admin/players/${player_id}`}
              className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
            >
              View Profile →
            </Link>
            <button
              id="review-delete-btn"
              type="button"
              onClick={() => { setDeleteError(null); setDeleteModalOpen(true); }}
              className="text-xs px-2 py-1 rounded border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      {/* Summary + bulk actions */}
      <div id="review-summary-bar" className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 px-4 py-3">
        <div id="review-summary-counts" className="text-sm">
          <span className="font-semibold text-foreground">{unresolvedFlags.length}</span>
          <span className="text-muted-foreground"> unresolved · </span>
          <span className="font-semibold text-foreground">{resolvedFlags.length}</span>
          <span className="text-muted-foreground"> resolved of {flags.length} flags</span>
        </div>
        {unresolvedFlags.length > 0 && (
          <div id="review-bulk-actions" className="flex gap-2">
            <button
              id="review-bulk-trust-stats-btn"
              type="button"
              disabled={bulkSaving}
              onClick={() => handleBulkResolve("trust_stats")}
              className="text-xs px-3 py-1.5 rounded-md border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium transition-colors disabled:opacity-50"
            >
              Trust All Stats
            </button>
            <button
              id="review-bulk-trust-claude-btn"
              type="button"
              disabled={bulkSaving}
              onClick={() => handleBulkResolve("trust_claude")}
              className="text-xs px-3 py-1.5 rounded-md border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 font-medium transition-colors disabled:opacity-50"
            >
              Trust All Claude
            </button>
          </div>
        )}
      </div>

      {/* Keyboard shortcut hint */}
      {unresolvedFlags.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Use <kbd className="px-1 py-0.5 rounded bg-muted text-foreground text-[10px] font-mono">j</kbd> /{" "}
          <kbd className="px-1 py-0.5 rounded bg-muted text-foreground text-[10px] font-mono">k</kbd>{" "}
          to navigate between flags.
        </p>
      )}

      {/* Unresolved flags */}
      {unresolvedFlags.length > 0 && (
        <section id="review-unresolved-section" className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">
            Unresolved ({unresolvedFlags.length})
          </h2>
          {unresolvedFlags.map((flag, idx) => (
            <SkillReviewRow
              key={flag.id}
              flag={flag}
              statTier={profiles.stats[flag.skill_name] ?? null}
              claudeTier={profiles.claude[flag.skill_name] ?? null}
              isFocused={idx === focusedIdx}
              onRowMount={(el) => {
                if (el) {
                  rowRefs.current.set(flag.skill_name, el);
                } else {
                  rowRefs.current.delete(flag.skill_name);
                }
              }}
              onResolve={(resolution, resolvedValue) =>
                handleResolve(flag, resolution, resolvedValue)
              }
              saving={savingSkill === flag.skill_name}
              playerId={player_id}
              season={CURRENT_SEASON}
            />
          ))}
        </section>
      )}

      {/* Resolved flags (collapsed by default if there are unresolved) */}
      {resolvedFlags.length > 0 && (
        <section id="review-resolved-section" className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Resolved ({resolvedFlags.length})
          </h2>
          {resolvedFlags.map((flag) => (
            <SkillReviewRow
              key={flag.id}
              flag={flag}
              statTier={profiles.stats[flag.skill_name] ?? null}
              claudeTier={profiles.claude[flag.skill_name] ?? null}
              isFocused={false}
              onResolve={() => {}}
              saving={false}
              playerId={player_id}
              season={CURRENT_SEASON}
            />
          ))}
        </section>
      )}

      {flags.length === 0 && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No flags found for this player.{" "}
          <Link href="/admin/snapshots/draft?tab=review" className="underline hover:text-foreground">
            Back to queue
          </Link>
        </div>
      )}

      {/* All Skills — manual override for any skill regardless of flag status */}
      {Object.keys(profiles.composite).length > 0 && (
        <section id="review-all-skills-section">
          <button
            id="review-all-skills-toggle-btn"
            type="button"
            onClick={() => setAllSkillsOpen((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>{allSkillsOpen ? "▾" : "▸"}</span>
            <span>All Skills</span>
            <span className="text-xs font-normal">(manual override)</span>
          </button>

          {allSkillsOpen && (
            <div className="mt-3 rounded-lg border border-border overflow-hidden">
              <table id="review-all-skills-table" className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Skill</th>
                    <th className="text-center px-3 py-2 font-medium text-muted-foreground">Tier</th>
                    <th className="text-center px-3 py-2 font-medium text-muted-foreground">Source</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {ALL_SKILL_NAMES.filter((skill) => skill in profiles.composite).map((skill) => {
                    const composite = profiles.composite[skill];
                    const isOverriding = overridingSkill === skill;

                    return (
                      <tr key={skill} className="border-b border-border last:border-0 hover:bg-muted/20">
                        <td className="px-3 py-2 font-medium">{formatSkillName(skill)}</td>
                        <td className="px-3 py-2 text-center">
                          <SkillTierBadge tier={composite.final_tier as SkillTier} />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <SourceBadge source={composite.source} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          {isOverriding ? (
                            <div className="flex items-center justify-end gap-2">
                              <TierPicker
                                value={overrideTier}
                                onChange={setOverrideTier}
                              />
                              <button
                                type="button"
                                disabled={!overrideTier || overrideSaving}
                                onClick={() =>
                                  overrideTier && handleManualOverride(skill, overrideTier)
                                }
                                className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground font-medium disabled:opacity-40 hover:opacity-80 transition-opacity"
                              >
                                {overrideSaving ? "…" : "Save"}
                              </button>
                              <button
                                type="button"
                                onClick={() => { setOverridingSkill(null); setOverrideTier(""); }}
                                className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setOverridingSkill(skill);
                                setOverrideTier(composite.final_tier as SkillTier ?? "");
                              }}
                              className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
                            >
                              Override
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
