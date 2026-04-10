"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { getPlayerProfile, getSkillBreakdown, getPlayerStats, manualOverrideSkill } from "@/lib/api";
import { SkillTierBadge } from "@/components/SkillTierBadge";
import { StatConfidenceIndicator } from "@/components/StatConfidenceIndicator";
import { ConditionBreakdown } from "@/components/ConditionBreakdown";
import type { PlayerProfile, CompositeSkillResult, SkillTier, StatConfidence, ConditionResult } from "@/lib/types";
import { SKILL_TIERS, TIER_PICKER_ACTIVE_CLASS } from "@/lib/tiers";
import { SKILL_CATEGORIES, formatSkillName } from "@/lib/skills";

const CURRENT_SEASON = "2025-26";

/** Source badge for how the final tier was determined. */
function SourceBadge({ source }: { source: string }) {
  const map: Record<string, { label: string; className: string }> = {
    stats_only:    { label: "Stats",     className: "bg-blue-50 text-blue-600 border-blue-100" },
    auto_accepted: { label: "Auto",      className: "bg-green-50 text-green-700 border-green-100" },
    flagged:       { label: "Flagged",   className: "bg-amber-50 text-amber-700 border-amber-100" },
    resolved:      { label: "Resolved",  className: "bg-emerald-50 text-emerald-700 border-emerald-100" },
  };
  const config = map[source];
  if (!config) return null;
  return (
    <span className={cn("text-[9px] font-medium px-1.5 py-0.5 rounded border", config.className)}>
      {config.label}
    </span>
  );
}

/** Inline tier picker — same style as the review page. */
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
            "text-xs px-2 py-0.5 rounded border transition-colors",
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

/** A single skill row in the profile view. Lazy-loads condition breakdown on click. */
function SkillRow({
  skillName,
  result,
  playerId,
  season,
  onOverride,
}: {
  skillName: string;
  result: CompositeSkillResult;
  playerId: string;
  season: string;
  onOverride: (skillName: string, tier: SkillTier) => void;
}) {
  const finalTier = result.final_tier ?? "None";

  // Tier override state
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [selectedTier, setSelectedTier] = useState<SkillTier | "">(finalTier as SkillTier);
  const [saving, setSaving]             = useState(false);
  const [saveError, setSaveError]       = useState<string | null>(null);

  const handleSaveOverride = async () => {
    if (!selectedTier) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await manualOverrideSkill(playerId, {
        skill_name:     skillName,
        resolved_value: selectedTier,
        season,
      });
      if (res.success) {
        onOverride(skillName, selectedTier);
        setOverrideOpen(false);
      } else {
        setSaveError(res.error ?? "Save failed");
      }
    } catch {
      setSaveError("Request failed");
    } finally {
      setSaving(false);
    }
  };

  // Lazy-loaded condition breakdown — only fetched once on first expand
  const [breakdown, setBreakdown]               = useState<ConditionResult[] | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [breakdownError, setBreakdownError]     = useState<string | null>(null);

  const handleFetchBreakdown = async () => {
    if (breakdown !== null || breakdownLoading) return;
    setBreakdownLoading(true);
    setBreakdownError(null);
    try {
      const res = await getSkillBreakdown(playerId, skillName, season);
      if (res.success && res.data) {
        setBreakdown(res.data.condition_results);
      } else {
        setBreakdownError(res.error ?? "Failed to load breakdown");
      }
    } catch {
      setBreakdownError("Request failed");
    } finally {
      setBreakdownLoading(false);
    }
  };

  return (
    <div className="px-2 py-1.5 rounded-sm hover:bg-muted/40 transition-colors">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground flex-1 truncate">
          {formatSkillName(skillName)}
        </span>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {result.stat_confidence && (
            <StatConfidenceIndicator confidence={result.stat_confidence as StatConfidence} />
          )}
          <SourceBadge source={result.source} />
          {/* Clicking the tier badge opens the inline override picker */}
          <button
            type="button"
            onClick={() => {
              setSelectedTier(finalTier as SkillTier);
              setSaveError(null);
              setOverrideOpen((v) => !v);
            }}
            title="Click to override tier"
            className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <SkillTierBadge tier={finalTier as SkillTier} size="sm" />
          </button>
        </div>
      </div>

      {/* Inline tier override picker */}
      {overrideOpen && (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <TierPicker value={selectedTier} onChange={setSelectedTier} />
          <button
            type="button"
            disabled={!selectedTier || saving}
            onClick={handleSaveOverride}
            className="text-xs px-2 py-0.5 rounded bg-foreground text-background font-medium disabled:opacity-40 hover:opacity-80 transition-opacity"
          >
            {saving ? "…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => { setOverrideOpen(false); setSaveError(null); }}
            className="text-xs px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          {saveError && (
            <span className="text-[10px] text-destructive">{saveError}</span>
          )}
        </div>
      )}

      {/* Condition breakdown — fetches lazily on first click */}
      {breakdownError ? (
        <p className="mt-1 text-[10px] text-destructive">{breakdownError}</p>
      ) : breakdownLoading ? (
        <p className="mt-1 text-[10px] text-muted-foreground animate-pulse">Loading…</p>
      ) : breakdown !== null ? (
        <ConditionBreakdown conditions={breakdown} defaultOpen />
      ) : (
        <button
          type="button"
          onClick={handleFetchBreakdown}
          className="flex items-center gap-1 mt-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors select-none"
        >
          <span>▸</span>
          <span>Stats vs Thresholds</span>
        </button>
      )}
    </div>
  );
}

/** Format salary as "$X.Xm" or "$Xk". */
function formatSalary(salary: number | null): string {
  if (salary == null) return "—";
  if (salary >= 1_000_000) return `$${(salary / 1_000_000).toFixed(1)}m`;
  return `$${Math.round(salary / 1000)}k`;
}

export default function PlayerProfilePage() {
  const { player_id } = useParams<{ player_id: string }>();

  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [boxStats, setBoxStats] = useState<Record<string, number | null> | null>(null);

  useEffect(() => {
    if (!player_id) return;
    setLoading(true);
    setError(null);
    // Fetch profile and box stats in parallel
    Promise.all([
      getPlayerProfile(player_id, CURRENT_SEASON),
      getPlayerStats(player_id, CURRENT_SEASON),
    ])
      .then(([profileRes, statsRes]) => {
        if (profileRes.success && profileRes.data) {
          setProfile(profileRes.data);
        } else {
          setError(profileRes.error ?? "Failed to load player profile");
        }
        if (statsRes.success && statsRes.data?.box_score) {
          setBoxStats(statsRes.data.box_score);
        }
      })
      .catch(() => setError("Failed to load player profile"))
      .finally(() => setLoading(false));
  }, [player_id]);

  // Update a single skill's tier and source in local state after a manual override
  const handleOverride = (skillName: string, tier: SkillTier) => {
    setProfile((p) => {
      if (!p?.skills) return p;
      const existing = p.skills[skillName] ?? {};
      return {
        ...p,
        skills: {
          ...p.skills,
          [skillName]: {
            ...existing,
            final_tier: tier,
            source:     "manual_override",
          },
        },
      };
    });
  };

  if (loading) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="space-y-4 animate-pulse">
          <div className="h-8 w-56 bg-muted rounded" />
          <div className="h-4 w-40 bg-muted rounded" />
          <div className="h-64 bg-muted rounded-lg" />
        </div>
      </main>
    );
  }

  if (error || !profile) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive">
          {error ?? "Player not found"}
        </div>
      </main>
    );
  }

  const { player, skills, flag_summary } = profile;

  return (
    <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Player header */}
      <div className="space-y-1">
        <h1 className="text-xl font-bold text-foreground">{player.name}</h1>
        <p className="text-sm text-muted-foreground">
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
          {player.games_played != null && (
            <span> · {player.games_played} GP · {player.minutes_per_game?.toFixed(1)} MPG</span>
          )}
          {player.salary != null && (
            <span> · {formatSalary(player.salary)}</span>
          )}
        </p>
        {boxStats && (
          <p className="text-xs text-muted-foreground font-mono tabular-nums">
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

      {/* Flag summary + review link */}
      {flag_summary.total > 0 && (
        <div
          className={cn(
            "flex items-center justify-between rounded-lg border px-4 py-3",
            flag_summary.unresolved > 0
              ? "border-amber-200 bg-amber-50"
              : "border-emerald-200 bg-emerald-50"
          )}
        >
          <div className="text-sm">
            {flag_summary.unresolved > 0 ? (
              <>
                <span className="font-semibold text-amber-800">
                  {flag_summary.unresolved} unresolved flag{flag_summary.unresolved !== 1 ? "s" : ""}
                </span>
                <span className="text-amber-700"> · {flag_summary.total} total</span>
              </>
            ) : (
              <span className="font-semibold text-emerald-800">
                All {flag_summary.total} flags resolved
              </span>
            )}
          </div>
          {flag_summary.unresolved > 0 && (
            <Link
              href={`/review/${player_id}`}
              className="text-xs font-medium text-amber-800 underline hover:text-amber-900 transition-colors"
            >
              Review Flags →
            </Link>
          )}
        </div>
      )}

      {/* Skill profile */}
      {skills ? (
        <div className="space-y-3">
          {/* Legend */}
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="font-semibold">Source key:</span>
            <span className="bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded">Stats</span>
            <span className="bg-green-50 text-green-700 border border-green-100 px-1.5 py-0.5 rounded">Auto</span>
            <span className="bg-amber-50 text-amber-700 border border-amber-100 px-1.5 py-0.5 rounded">Flagged</span>
            <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 py-0.5 rounded">Resolved</span>
          </div>

          {Object.entries(SKILL_CATEGORIES).map(([category, skillNames]) => {
            // Only render skills present in the composite profile
            const categorySkills = skillNames.filter((name) => skills[name]);
            if (categorySkills.length === 0) return null;

            return (
              <div key={category} className="rounded-lg border border-border overflow-hidden">
                <div className="px-2 py-1.5 bg-muted/40 border-b border-border">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {category}
                  </span>
                </div>
                <div className="px-1 py-1 space-y-0.5">
                  {categorySkills.map((skillName) => (
                    <SkillRow
                      key={skillName}
                      skillName={skillName}
                      result={skills[skillName]}
                      playerId={player_id}
                      season={CURRENT_SEASON}
                      onOverride={handleOverride}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-muted/20 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No composite skill profile yet.{" "}
            <Link href="/pipeline" className="underline hover:text-foreground">
              Run the pipeline
            </Link>{" "}
            to generate skill ratings for this player.
          </p>
        </div>
      )}
    </main>
  );
}
