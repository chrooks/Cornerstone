"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  CircleDollarSign,
  ClipboardList,
  Eye,
  Loader2,
  Minus,
  Rocket,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { CohesionScoreBadge } from "@/components/cohesion/CohesionScoreBadge";
import { CohesionScoreDisplay } from "@/components/builder/CohesionScoreDisplay";
import { getSharedTeam, getSharedRebuildCheck } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { RebuildCheckResponse, RebuildPlayerReport, RosterEvaluation, SavedTeamSummary, SaveTeamPlayerPayload } from "@/lib/types";

type PageState = "loading" | "ready" | "not-found" | "error";

function formatMoney(value: number): string {
  return `$${(value / 1_000_000).toFixed(1)}M`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatRulesetName(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Standard";
}

function formatPlayerInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : name.slice(0, 2)).toUpperCase();
}

function getTeamKindFromSize(teamSize: number | null | undefined, playerCount: number): string {
  if (teamSize === 12) return "Roster";
  if (teamSize === 9) return "Rotation";
  if (teamSize === 5) return "Lineup";
  if (playerCount >= 12) return "Roster";
  if (playerCount >= 9) return "Rotation";
  return "Lineup";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFullRosterEvaluation(value: unknown): value is RosterEvaluation {
  if (!isRecord(value)) return false;
  return (
    typeof value.star_rating === "number" &&
    isRecord(value.star_rating_breakdown) &&
    isRecord(value.starting_lineup) &&
    isRecord(value.lineup_summary) &&
    Array.isArray(value.player_composites) &&
    Array.isArray(value.notes)
  );
}

function PlayerSnapshotRow({
  player,
  showSalary = true,
  showCornerstone = true,
}: {
  player: SaveTeamPlayerPayload;
  showSalary?: boolean;
  showCornerstone?: boolean;
}) {
  return (
    <li
      id={`shared-team-player-slot-${player.slot}`}
      className={cn(
        "grid items-center gap-3 border border-[oklch(0.84_0.018_62)] bg-[oklch(0.985_0.005_62)] p-3",
        showSalary ? "grid-cols-[3.5rem_minmax(0,1fr)_auto]" : "grid-cols-[3.5rem_minmax(0,1fr)]",
      )}
    >
      <div
        id={`shared-team-player-slot-${player.slot}-portrait`}
        className={cn(
          "flex h-12 w-12 items-center justify-center overflow-hidden rounded-sm border font-mono text-xs font-semibold",
          showCornerstone && player.is_cornerstone
            ? "border-[oklch(0.66_0.16_55)] bg-[oklch(0.92_0.055_64)] text-[oklch(0.24_0.04_45)]"
            : "border-[oklch(0.82_0.02_62)] bg-[oklch(0.94_0.018_62)] text-[oklch(0.29_0.025_45)]",
        )}
        aria-hidden="true"
      >
        {player.nba_api_id ? (
          <Image
            id={`shared-team-player-slot-${player.slot}-portrait-image`}
            src={`https://ak-static.cms.nba.com/wp-content/uploads/headshots/nba/latest/260x190/${player.nba_api_id}.png`}
            alt=""
            width={260}
            height={190}
            sizes="48px"
            quality={100}
            unoptimized
            className="h-full w-full object-cover"
          />
        ) : (
          formatPlayerInitials(player.player_name_snapshot)
        )}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold text-[oklch(0.16_0.018_45)]">
            {player.player_name_snapshot}
          </p>
          {showCornerstone && player.is_cornerstone && (
            <span className="rounded-sm border border-[oklch(0.76_0.13_74)] bg-[oklch(0.94_0.035_74)] px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-[oklch(0.39_0.11_55)]">
              Cornerstone
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-[oklch(0.44_0.02_45)]">
          {player.position_snapshot ?? "?"} / {player.team_snapshot ?? "?"}
        </p>
      </div>
      {showSalary && (
        <p className="font-mono text-sm tabular-nums text-[oklch(0.18_0.02_45)]">
          {formatMoney(player.salary_snapshot)}
        </p>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Rebuild compatibility modal (shared/unauthenticated variant)
// ---------------------------------------------------------------------------

type RebuildModalState = "loading" | "ready" | "error";

function skillTierLabel(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "final_tier" in value) {
    return String((value as Record<string, unknown>).final_tier ?? "—");
  }
  return "—";
}

function SharedRebuildPlayerRow({ report }: { report: RebuildPlayerReport }) {
  const [expanded, setExpanded] = useState(false);
  const currentPlayer = report.status === "matched" ? report.current : null;
  const matched = currentPlayer != null;
  const salaryDelta = currentPlayer ? currentPlayer.salary - report.saved.salary_snapshot : 0;

  const savedSkills = report.saved.skill_profile_snapshot ?? {};
  const currentSkills = currentPlayer ? currentPlayer.skill_profile_snapshot ?? {} : {};
  const allSkillKeys = Array.from(new Set([...Object.keys(savedSkills), ...Object.keys(currentSkills)])).sort();
  const changedSkills = allSkillKeys.filter((key) => skillTierLabel(savedSkills[key]) !== skillTierLabel(currentSkills[key]));
  const hasSkillDiffs = matched && changedSkills.length > 0;

  return (
    <div className="border-b border-[oklch(0.88_0.015_62)] last:border-b-0">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-[oklch(0.92_0.035_64)] font-mono text-xs font-semibold text-[oklch(0.28_0.03_45)]">
          {report.slot}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[oklch(0.18_0.02_45)]">
            {report.saved.player_name_snapshot}
          </p>
          {currentPlayer && salaryDelta !== 0 && (
            <p className="text-xs text-[oklch(0.42_0.02_45)]">
              {formatMoney(report.saved.salary_snapshot)} → {formatMoney(currentPlayer.salary)}
              <span className={cn("ml-1 font-mono", salaryDelta > 0 ? "text-red-600" : "text-green-700")}>
                ({salaryDelta > 0 ? "+" : ""}{formatMoney(salaryDelta)})
              </span>
            </p>
          )}
        </div>
        {matched ? (
          <span className="inline-flex items-center gap-1 rounded-sm bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">
            <Check className="h-3 w-3" aria-hidden="true" />
            Matched
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-sm bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800">
            <Minus className="h-3 w-3" aria-hidden="true" />
            Missing
          </span>
        )}
        {hasSkillDiffs && (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
            className="flex h-6 w-6 items-center justify-center rounded-sm text-[oklch(0.42_0.02_45)] transition-colors hover:bg-[oklch(0.92_0.035_64)] hover:text-[oklch(0.18_0.02_45)]"
            title="Show skill changes"
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} aria-hidden="true" />
          </button>
        )}
      </div>
      {expanded && hasSkillDiffs && (
        <div className="border-t border-dashed border-[oklch(0.88_0.015_62)] bg-[oklch(0.96_0.006_62)] px-3 py-2">
          <p className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[oklch(0.49_0.02_45)]">
            Skill changes
          </p>
          <ul className="space-y-0.5">
            {changedSkills.map((key) => (
              <li key={key} className="flex items-center justify-between text-xs">
                <span className="text-[oklch(0.34_0.02_45)]">{key.replace(/_/g, " ")}</span>
                <span className="font-mono text-[oklch(0.42_0.02_45)]">
                  {skillTierLabel(savedSkills[key])} → {skillTierLabel(currentSkills[key])}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SharedRebuildCheckModal({
  savedTeamId,
  savedTeamName,
  rulesetSlug,
  onClose,
}: {
  savedTeamId: string;
  savedTeamName: string;
  rulesetSlug: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<RebuildModalState>("loading");
  const [report, setReport] = useState<RebuildCheckResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setState("loading");
    getSharedRebuildCheck(savedTeamId)
      .then((res) => {
        if (!alive) return;
        if (res.success && res.data) {
          setReport(res.data);
          setState("ready");
        } else {
          setErrorMessage(res.error ?? "Could not load rebuild report.");
          setState("error");
        }
      })
      .catch(() => {
        if (alive) {
          setErrorMessage("Network error loading rebuild report.");
          setState("error");
        }
      });
    return () => { alive = false; };
  }, [savedTeamId]);

  const versionChanged = report?.version_drift?.changed ?? false;
  const cornerstoneAvailable = report?.cornerstone?.available ?? false;
  const matchedCount = report?.players.filter((p) => p.status === "matched").length ?? 0;
  const missingCount = report?.players.filter((p) => p.status === "missing").length ?? 0;
  const totalPlayers = report?.players.length ?? 0;

  function buildTargetUrl(): string {
    if (!report) return "#";
    const params = new URLSearchParams(report.builder_url_params);
    const paramStr = params.toString();
    if (!cornerstoneAvailable) {
      return `/lab/${rulesetSlug}/legends${paramStr ? `?${paramStr}` : ""}`;
    }
    return `/lab/${rulesetSlug}/build?${paramStr}`;
  }

  return (
    <div
      id="shared-rebuild-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        id="shared-rebuild-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shared-rebuild-modal-title"
        className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-[oklch(0.83_0.02_62)] bg-[oklch(0.985_0.005_62)] shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-[oklch(0.86_0.018_62)] px-5 py-4">
          <div>
            <h2 id="shared-rebuild-modal-title" className="font-display text-lg font-semibold text-[oklch(0.16_0.018_45)]">
              Rebuild Compatibility
            </h2>
            <p className="mt-0.5 text-sm text-[oklch(0.42_0.02_45)]">{savedTeamName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-sm text-[oklch(0.42_0.02_45)] transition-colors hover:bg-[oklch(0.92_0.035_64)] hover:text-[oklch(0.18_0.02_45)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {state === "loading" && (
            <div className="flex flex-col items-center gap-3 py-10">
              <Loader2 className="h-6 w-6 animate-spin text-[oklch(0.47_0.07_55)]" aria-hidden="true" />
              <p className="text-sm text-[oklch(0.42_0.02_45)]">Checking compatibility…</p>
            </div>
          )}
          {state === "error" && (
            <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
              {errorMessage}
            </div>
          )}
          {state === "ready" && report && (
            <div className="space-y-4">
              {versionChanged && (
                <div className="flex items-start gap-2.5 rounded-md border border-amber-300 bg-amber-50 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                  <div className="text-sm text-amber-900">
                    <p className="font-semibold">Rule Set Version changed</p>
                    <p className="mt-1 text-xs text-amber-800">
                      {report.version_drift.original?.version_label ?? "?"} → {report.version_drift.current.version_label}
                    </p>
                  </div>
                </div>
              )}
              {!cornerstoneAvailable && (
                <div className="flex items-start gap-2.5 rounded-md border border-orange-300 bg-orange-50 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" aria-hidden="true" />
                  <div className="text-sm text-orange-900">
                    <p className="font-semibold">Cornerstone unavailable</p>
                    <p className="mt-0.5 text-xs text-orange-800">
                      {report.cornerstone.name} is no longer available. You&apos;ll pick a new Cornerstone first.
                    </p>
                  </div>
                </div>
              )}
              {cornerstoneAvailable && (
                <div className="flex items-center gap-3 rounded-md border border-[oklch(0.88_0.015_62)] bg-[oklch(0.96_0.006_62)] px-3 py-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-[oklch(0.66_0.16_55)] font-mono text-xs font-semibold text-white">1</span>
                  <p className="flex-1 text-sm font-semibold text-[oklch(0.18_0.02_45)]">{report.cornerstone.name}</p>
                  <span className="inline-flex items-center gap-1 rounded-sm bg-[oklch(0.92_0.035_64)] px-2 py-0.5 text-xs font-semibold text-[oklch(0.28_0.03_45)]">
                    Legend
                  </span>
                </div>
              )}
              <p className="text-sm text-[oklch(0.42_0.02_45)]">
                {matchedCount} of {totalPlayers} supporting player{totalPlayers !== 1 ? "s" : ""} matched
                {missingCount > 0 && (
                  <span className="text-orange-700"> · {missingCount} missing (slot{missingCount !== 1 ? "s" : ""} will be empty)</span>
                )}
              </p>
              <div className="overflow-hidden rounded-md border border-[oklch(0.88_0.015_62)]">
                {report.players.map((player) => (
                  <SharedRebuildPlayerRow key={player.slot} report={player} />
                ))}
              </div>
            </div>
          )}
        </div>

        {state === "ready" && report && (
          <div className="flex items-center justify-end gap-2 border-t border-[oklch(0.86_0.018_62)] px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              className="min-h-9 rounded border border-[oklch(0.83_0.02_62)] bg-[oklch(0.96_0.006_62)] px-4 py-1.5 text-sm font-semibold text-[oklch(0.22_0.02_45)] transition-colors hover:border-[oklch(0.73_0.08_53)] hover:bg-[oklch(0.92_0.035_64)]"
            >
              Cancel
            </button>
            <Link
              href={buildTargetUrl()}
              className="inline-flex min-h-9 items-center gap-2 rounded border border-[oklch(0.18_0.02_45)] bg-[oklch(0.18_0.02_45)] px-4 py-1.5 text-sm font-semibold text-[oklch(0.92_0.08_64)] transition-colors hover:bg-[oklch(0.25_0.03_45)]"
            >
              {cornerstoneAvailable ? "Continue to Builder" : "Pick a Cornerstone"}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function SharedTeamSkeleton() {
  return (
    <main id="shared-team-loading" className="mx-auto max-w-6xl px-4 py-6">
      <div className="h-6 w-48 animate-pulse rounded-sm bg-[oklch(0.88_0.018_62)]" />
      <div className="mt-6 h-48 animate-pulse rounded-md border border-[oklch(0.83_0.02_62)] bg-[oklch(0.96_0.006_62)]" />
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="h-20 animate-pulse rounded-md border border-[oklch(0.83_0.02_62)] bg-[oklch(0.96_0.006_62)]" />
        ))}
      </div>
    </main>
  );
}

export default function SharedTeamPage() {
  const params = useParams<{ saved_team_id: string }>();
  const savedTeamId = params.saved_team_id;
  const [state, setState] = useState<PageState>("loading");
  const [savedTeam, setSavedTeam] = useState<SavedTeamSummary | null>(null);
  const [rebuildModalOpen, setRebuildModalOpen] = useState(false);

  useEffect(() => {
    let alive = true;

    async function load() {
      setState("loading");
      try {
        const res = await getSharedTeam(savedTeamId);
        if (!alive) return;
        if (res.success && res.data) {
          setSavedTeam(res.data);
          setState("ready");
          return;
        }
        setState(res.error?.toLowerCase().includes("not found") ? "not-found" : "error");
      } catch {
        if (alive) setState("error");
      }
    }

    void load();
    return () => { alive = false; };
  }, [savedTeamId]);

  const orderedPlayers = useMemo(
    () => [...(savedTeam?.players ?? [])].sort((a, b) => a.slot - b.slot),
    [savedTeam?.players],
  );

  const fullEvaluation = savedTeam?.evaluation && isFullRosterEvaluation(savedTeam.evaluation.evaluation_payload)
    ? (savedTeam.evaluation.evaluation_payload as RosterEvaluation)
    : null;
  const score = fullEvaluation?.star_rating ?? savedTeam?.evaluation?.star_rating ?? null;
  const description = fullEvaluation?.team_description ?? (savedTeam?.evaluation?.team_description ?? "");
  const teamKind = getTeamKindFromSize(savedTeam?.team_size, orderedPlayers.length);
  const salaryTotal = savedTeam?.total_salary ?? orderedPlayers.reduce((sum, p) => sum + p.salary_snapshot, 0);
  const hasSalaryCap = !savedTeam?.ruleset_slug?.startsWith("free-for-all");
  const hasCornerstone = orderedPlayers.some((p) => p.is_cornerstone) && hasSalaryCap;

  if (state === "loading") return <SharedTeamSkeleton />;

  if (state === "not-found" || state === "error" || !savedTeam) {
    return (
      <main id="shared-team-error" className="mx-auto max-w-3xl px-4 py-10">
        <div className="border border-[oklch(0.83_0.02_62)] bg-[oklch(0.985_0.005_62)] p-5">
          <h1 className="text-xl font-semibold text-[oklch(0.16_0.018_45)]">
            {state === "not-found" ? "Team not found" : "Something went wrong"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-[oklch(0.42_0.02_45)]">
            {state === "not-found"
              ? "This team doesn't exist or isn't publicly shared."
              : "We couldn't load this team. Try again later."}
          </p>
          <Link
            id="shared-team-error-cta"
            href="/"
            className="mt-4 inline-flex items-center gap-2 rounded-sm border border-[oklch(0.83_0.02_62)] bg-[oklch(0.985_0.005_62)] px-3 py-1.5 text-sm font-medium text-[oklch(0.28_0.04_45)] hover:bg-[oklch(0.94_0.018_62)]"
          >
            Go home
          </Link>
        </div>
      </main>
    );
  }

  const rulesetLabel = formatRulesetName(savedTeam.ruleset_slug);

  const rulesetSlug = savedTeam.ruleset_slug;

  return (
    <main id="shared-team-page" className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-[oklch(0.49_0.02_45)]">
          <Eye className="h-3 w-3" aria-hidden="true" />
          <span>Shared {teamKind}</span>
        </div>
        <button
          id="shared-team-cta"
          type="button"
          onClick={() => setRebuildModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-sm bg-[oklch(0.72_0.16_55)] px-3 py-1.5 text-xs font-semibold text-[oklch(0.14_0.02_45)] transition-colors duration-150 hover:bg-[oklch(0.66_0.17_48)]"
        >
          <Rocket className="h-3.5 w-3.5" aria-hidden="true" />
          Build Your Own
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>

      <section
        id="shared-team-header"
        className="relative mt-3 rounded-md border border-[oklch(0.78_0.08_62)] bg-[oklch(0.985_0.005_62)] p-5"
      >
        <div className="min-w-0 lg:pr-56">
          <p className="font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[oklch(0.47_0.07_55)]">
            {rulesetLabel} {teamKind}
          </p>
          <h1
            id="shared-team-title"
            className="mt-2 text-2xl font-semibold leading-tight tracking-[-0.01em] text-[oklch(0.16_0.018_45)]"
          >
            {savedTeam.name}
          </h1>
          <p
            id="shared-team-meta"
            className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[oklch(0.42_0.02_45)]"
          >
            <span>{teamKind}</span>
            <span aria-hidden="true">/</span>
            <span>{rulesetLabel}</span>
            <span aria-hidden="true">/</span>
            <span>Saved {formatDate(savedTeam.created_at)}</span>
          </p>
        </div>

        {description && (
          <p
            id="shared-team-description"
            className="mt-5 w-full max-w-none text-sm leading-6 text-[oklch(0.34_0.02_45)]"
          >
            {description}
          </p>
        )}

        <div id="shared-team-score-corner" className="mt-4 w-fit lg:absolute lg:right-5 lg:top-5 lg:mt-0">
          {score != null ? (
          <CohesionScoreBadge
            id="shared-team-score"
            value={score}
            featured
            ariaLabel={`${savedTeam.name} Cohesion score: ${score.toFixed(1)} out of 5`}
            breakdown={fullEvaluation ? [
              { label: "Starting Lineup", value: fullEvaluation.star_rating_breakdown.starting_5 },
              { label: "Depth", value: fullEvaluation.star_rating_breakdown.depth },
              { label: "Versatility", value: fullEvaluation.star_rating_breakdown.archetype_diversity },
              { label: "Floor", value: fullEvaluation.star_rating_breakdown.floor },
            ] : undefined}
          />
          ) : (
            <span className="font-mono text-lg text-[oklch(0.52_0.02_45)]">—</span>
          )}
        </div>
      </section>

      <dl
        id="shared-team-context"
        className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4"
      >
        <div className="rounded-md border border-[oklch(0.83_0.02_62)] bg-[oklch(0.985_0.005_62)] p-4">
          <dt className="flex items-center gap-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[oklch(0.49_0.02_45)]">
            <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
            Rule Set
          </dt>
          <dd className="mt-2 font-mono text-sm text-[oklch(0.18_0.02_45)]">
            {rulesetLabel}{savedTeam.ruleset_version_label ? ` \u00B7 ${savedTeam.ruleset_version_label}` : ""}
          </dd>
        </div>
        <div className="rounded-md border border-[oklch(0.83_0.02_62)] bg-[oklch(0.985_0.005_62)] p-4">
          <dt className="flex items-center gap-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[oklch(0.49_0.02_45)]">
            <UsersRound className="h-3.5 w-3.5" aria-hidden="true" />
            Team Size
          </dt>
          <dd className="mt-2 font-mono text-sm text-[oklch(0.18_0.02_45)]">
            {teamKind} ({orderedPlayers.length})
          </dd>
        </div>
        {hasSalaryCap && (
          <div className="rounded-md border border-[oklch(0.83_0.02_62)] bg-[oklch(0.985_0.005_62)] p-4">
            <dt className="flex items-center gap-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[oklch(0.49_0.02_45)]">
              <CircleDollarSign className="h-3.5 w-3.5" aria-hidden="true" />
              Salary Total
            </dt>
            <dd className="mt-2 font-mono text-sm tabular-nums text-[oklch(0.18_0.02_45)]">
              {formatMoney(salaryTotal)}
            </dd>
          </div>
        )}
      </dl>

      <section id="shared-team-players-section" className="mt-5 grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="self-start rounded-md border border-[oklch(0.83_0.02_62)] bg-[oklch(0.96_0.006_62)] p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[oklch(0.16_0.018_45)]">
              <UsersRound className="h-4 w-4" aria-hidden="true" />
              Players
            </h2>
            <span className="font-mono text-xs tabular-nums text-[oklch(0.42_0.02_45)]">
              {orderedPlayers.length}
            </span>
          </div>
          <ol id="shared-team-players" className="mt-4 grid gap-2">
            {orderedPlayers.map((player) => (
              <PlayerSnapshotRow
                key={`${player.slot}-${player.player_name_snapshot}`}
                player={player}
                showSalary={hasSalaryCap}
                showCornerstone={hasCornerstone}
              />
            ))}
          </ol>
        </div>

        <div id="shared-team-eval-panel" className="min-w-0">
          {fullEvaluation ? (
            <CohesionScoreDisplay
              evaluation={fullEvaluation}
              isLineupOnly={orderedPlayers.length <= 5}
              teamLabel={teamKind}
            />
          ) : (
            <div className="rounded-md border border-[oklch(0.83_0.02_62)] bg-[oklch(0.985_0.005_62)] p-5">
              <div className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-[oklch(0.47_0.07_55)]" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-[oklch(0.16_0.018_45)]">
                  Evaluation Summary
                </h2>
              </div>
              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="border border-[oklch(0.84_0.018_62)] bg-[oklch(0.96_0.006_62)] p-3">
                  <dt className="text-xs text-[oklch(0.45_0.02_45)]">Cohesion Score</dt>
                  <dd className="mt-1 font-mono text-xl tabular-nums text-[oklch(0.16_0.018_45)]">
                    {score != null ? score.toFixed(1) : "—"}
                  </dd>
                </div>
                <div className="border border-[oklch(0.84_0.018_62)] bg-[oklch(0.96_0.006_62)] p-3">
                  <dt className="text-xs text-[oklch(0.45_0.02_45)]">Starting Lineup</dt>
                  <dd className="mt-1 font-mono text-xl tabular-nums text-[oklch(0.16_0.018_45)]">
                    {(savedTeam.evaluation?.starting_lineup_score ?? 0).toFixed(1)}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      </section>

      {rebuildModalOpen && (
        <SharedRebuildCheckModal
          savedTeamId={savedTeamId}
          savedTeamName={savedTeam.name}
          rulesetSlug={rulesetSlug}
          onClose={() => setRebuildModalOpen(false)}
        />
      )}
    </main>
  );
}
