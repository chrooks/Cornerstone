"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  ClipboardList,
  Lock,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  Trophy,
  UserRound,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getUserProfile, listPlayersWithSkills, listSavedTeams, getRebuildCheck } from "@/lib/api";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { CohesionScoreBadge } from "@/components/cohesion/CohesionScoreBadge";
import type { PlayerWithSkills, RebuildCheckResponse, RebuildPlayerReport, SavedTeamSummary, UserProfile } from "@/lib/types";

type ProfileLoadState = "loading" | "ready" | "signed-out" | "error";
type SavedTeamType = "Lineup" | "Rotation" | "Roster";
type DateFilter = "all" | "last-7" | "last-30";
type SavedTeamFilterField = "name" | "cornerstone" | "ruleset" | "snapshot" | "date" | "team-size" | "favorite" | "score";
type SortField = "date" | "score" | "name" | "cornerstone" | "ruleset" | "snapshot" | "team-size";
type SortDirection = "desc" | "asc";

interface SavedTeamAppliedFilter {
  id: string;
  field: SavedTeamFilterField;
  value: string;
}

interface SavedTeamSort {
  id: string;
  field: SortField;
  direction: SortDirection;
}

interface MockSavedTeam {
  id: string;
  name: string;
  cornerstone: string;
  favorite: boolean;
  ruleset: string;
  snapshotRelease: string;
  evaluationVersion: string;
  createdAt: string;
  savedAt: string;
  teamType: SavedTeamType;
  starRating: number;
  scoreBreakdown: {
    startingLineup: number;
    depth: number;
    versatility: number;
    floor: number;
  };
  salaryUsed: number;
  salaryCap: number;
  players: Array<{
    name: string;
    shortName: string;
    nbaApiId: number | null;
    playerId: string | null;
    legendId: string | null;
  }>;
  summary: string;
  tags: string[];
}

const DEFAULT_SAVED_TEAM_SORTS: SavedTeamSort[] = [
  { id: "date-desc", field: "date", direction: "desc" },
];

const FILTER_FIELD_LABELS: Record<SavedTeamFilterField, string> = {
  name: "Name",
  cornerstone: "Cornerstone",
  ruleset: "RuleSet",
  snapshot: "Snapshot Release",
  date: "Date",
  "team-size": "Team size",
  favorite: "Favorites",
  score: "Score",
};

const SORT_FIELD_LABELS: Record<SortField, string> = {
  date: "Date",
  score: "Score",
  name: "Name",
  cornerstone: "Cornerstone",
  ruleset: "RuleSet",
  snapshot: "Snapshot Release",
  "team-size": "Team size",
};

const SORT_FIELD_ORDER: SortField[] = ["date", "score", "name", "cornerstone", "ruleset", "snapshot", "team-size"];
const TEAM_SIZE_ORDER: Record<SavedTeamType, number> = { Lineup: 5, Rotation: 9, Roster: 12 };

function formatMoney(value: number): string {
  return `$${(value / 1_000_000).toFixed(1)}M`;
}

function formatSavedDate(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatRulesetName(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Standard";
}

function getSavedTeamType(playerCount: number): SavedTeamType {
  if (playerCount >= 12) return "Roster";
  if (playerCount >= 9) return "Rotation";
  return "Lineup";
}

function getShortName(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : name;
}

function getInitials(email: string | null): string {
  if (!email) return "CS";
  const [name] = email.split("@");
  return name
    .split(/[._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || email.charAt(0).toUpperCase();
}

function getUsername(email: string | null): string {
  if (!email) return "Cornerstone User";
  return email.split("@")[0].replace(/[._-]+/g, " ");
}

function getUniqueValues<T extends string>(items: T[]): T[] {
  return Array.from(new Set(items)).sort((a, b) => a.localeCompare(b));
}

function matchesDateFilter(savedAt: string, filter: DateFilter): boolean {
  if (filter === "all") return true;
  const savedTime = new Date(`${savedAt}T00:00:00`).getTime();
  const now = new Date().getTime();
  const days = filter === "last-7" ? 7 : 30;
  return now - savedTime <= days * 24 * 60 * 60 * 1000;
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function getFilterDisplayValue(filter: SavedTeamAppliedFilter): string {
  if (filter.field === "favorite") return filter.value === "yes" ? "Yes" : "No";
  if (filter.field === "date") {
    if (filter.value === "last-7") return "Last 7 days";
    if (filter.value === "last-30") return "Last 30 days";
  }
  if (filter.field === "score") return `${Number(filter.value).toFixed(1)}+`;
  return filter.value;
}

function matchesSavedTeamFilter(team: MockSavedTeam, filter: SavedTeamAppliedFilter): boolean {
  const normalizedValue = filter.value.trim().toLowerCase();

  if (filter.field === "name") return team.name.toLowerCase().includes(normalizedValue);
  if (filter.field === "cornerstone") return team.cornerstone.toLowerCase().includes(normalizedValue);
  if (filter.field === "ruleset") return team.ruleset === filter.value;
  if (filter.field === "snapshot") return team.snapshotRelease === filter.value;
  if (filter.field === "team-size") return team.teamType === filter.value;
  if (filter.field === "date") return matchesDateFilter(team.savedAt, filter.value as DateFilter);
  if (filter.field === "favorite") return filter.value === "yes" ? team.favorite : !team.favorite;
  if (filter.field === "score") return team.starRating >= Number(filter.value);
  return true;
}

function compareSavedTeamsBySort(a: MockSavedTeam, b: MockSavedTeam, sort: SavedTeamSort): number {
  if (sort.field === "date") {
    return new Date(a.savedAt).getTime() - new Date(b.savedAt).getTime();
  }
  if (sort.field === "score") return a.starRating - b.starRating;
  if (sort.field === "name") return compareText(a.name, b.name);
  if (sort.field === "cornerstone") return compareText(a.cornerstone, b.cornerstone);
  if (sort.field === "ruleset") return compareText(a.ruleset, b.ruleset);
  if (sort.field === "snapshot") return compareText(a.snapshotRelease, b.snapshotRelease);
  if (sort.field === "team-size") return TEAM_SIZE_ORDER[a.teamType] - TEAM_SIZE_ORDER[b.teamType];
  return 0;
}

function isDefaultSavedTeamSort(sorts: SavedTeamSort[]): boolean {
  return JSON.stringify(sorts) === JSON.stringify(DEFAULT_SAVED_TEAM_SORTS);
}

function getFeaturedSavedTeamLabel(filters: SavedTeamAppliedFilter[], sorts: SavedTeamSort[]): string {
  if (filters.length === 0 && isDefaultSavedTeamSort(sorts)) return "Latest Saved Team";
  if (filters.length > 0 && isDefaultSavedTeamSort(sorts)) return "Latest Match";
  return "First Result";
}

function normalizePlayerName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function splitSummary(summary: string): { firstSentence: string; remainder: string } {
  const trimmed = summary.trim();
  if (!trimmed) return { firstSentence: "", remainder: "" };

  const match = trimmed.match(/^(.+?[.!?])(\s+[\s\S]+)$/);
  if (!match) return { firstSentence: trimmed, remainder: "" };

  return {
    firstSentence: match[1].trim(),
    remainder: match[2].trim(),
  };
}

function mapSavedTeamSummary(team: SavedTeamSummary, profile: UserProfile | null): MockSavedTeam {
  const players = [...(team.players ?? [])].sort((a, b) => a.slot - b.slot);
  const cornerstone = players.find((player) => player.is_cornerstone) ?? players[0];
  const savedAt = team.created_at?.slice(0, 10) ?? "";
  const starRating = team.evaluation?.star_rating ?? 0;
  const startingLineup = team.evaluation?.starting_lineup_score ?? starRating;
  const teamType = getSavedTeamType(players.length);

  return {
    id: team.id,
    name: team.name,
    cornerstone: cornerstone?.player_name_snapshot ?? "Unknown Cornerstone",
    favorite: normalizePlayerName(profile?.favorite_player_name ?? "") === normalizePlayerName(cornerstone?.player_name_snapshot ?? ""),
    ruleset: formatRulesetName(team.ruleset_slug),
    snapshotRelease: team.snapshot_release_id,
    evaluationVersion: team.evaluation?.evaluation_version ?? "cohesion-v1",
    createdAt: formatSavedDate(team.created_at),
    savedAt,
    teamType,
    starRating,
    scoreBreakdown: {
      startingLineup,
      depth: starRating,
      versatility: starRating,
      floor: starRating,
    },
    salaryUsed: team.total_salary ?? players.reduce((sum, player) => sum + player.salary_snapshot, 0),
    salaryCap: team.ruleset_slug === "standard" ? 195_000_000 : Math.max(1, team.total_salary ?? 0),
    players: players.map((player) => ({
      name: player.player_name_snapshot,
      shortName: getShortName(player.player_name_snapshot),
      nbaApiId: null,
      playerId: player.player_id,
      legendId: player.legend_id,
    })),
    summary: team.evaluation?.team_description ?? "Saved evaluation details are attached to this Team.",
    tags: [team.evaluation?.evaluation_version ?? "cohesion-v1", team.ruleset_slug],
  };
}

function getRulesetSlug(ruleset: string): string {
  return ruleset.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "standard";
}

function resolveSavedTeamPlayer(
  player: MockSavedTeam["players"][number],
  playerRows: PlayerWithSkills[],
  isCornerstone: boolean,
): PlayerWithSkills | null {
  const normalizedName = normalizePlayerName(player.name);
  const candidates = playerRows.filter((row) => (
    row.id === player.playerId ||
    row.id === player.legendId ||
    row.nba_api_id === player.nbaApiId ||
    normalizePlayerName(row.name) === normalizedName
  ));

  if (isCornerstone) {
    return candidates.find((row) => row.is_legend) ?? candidates[0] ?? null;
  }

  return candidates.find((row) => !row.is_legend) ?? candidates[0] ?? null;
}

function resolvePortraitSource(
  player: MockSavedTeam["players"][number],
  playerRows: PlayerWithSkills[],
  isCornerstone: boolean,
): number | null {
  if (player.nbaApiId) return player.nbaApiId;
  const resolved = resolveSavedTeamPlayer(player, playerRows, isCornerstone);
  return resolved?.nba_api_id ?? null;
}

function enrichSavedTeamPortraits(
  teams: MockSavedTeam[],
  playerRows: PlayerWithSkills[],
): MockSavedTeam[] {
  if (playerRows.length === 0) return teams;

  return teams.map((team) => ({
    ...team,
    players: team.players.map((player, index) => ({
      ...player,
      nbaApiId: resolvePortraitSource(player, playerRows, index === 0),
    })),
  }));
}

function SavedTeamSkeleton() {
  return (
    <div id="profile-saved-team-skeleton" className="space-y-3">
      {[0, 1, 2].map((item) => (
        <div key={item} className="h-36 animate-pulse rounded-md border border-[oklch(0.83_0.02_62)] bg-[oklch(0.96_0.006_62)]" />
      ))}
    </div>
  );
}

function SalaryCapMeter({ used, cap, id }: { used: number; cap: number; id: string }) {
  const pct = Math.min(100, Math.max(0, (used / cap) * 100));
  const room = cap - used;

  return (
    <div id={id} className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-sm tabular-nums text-[oklch(0.18_0.02_45)]">{formatMoney(used)}</span>
        <span className="font-mono text-xs tabular-nums text-[oklch(0.49_0.02_45)]">{formatMoney(cap)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-sm bg-[oklch(0.89_0.015_62)]" aria-hidden="true">
        <div
          className="h-full rounded-sm bg-[oklch(0.72_0.15_55)]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-[oklch(0.42_0.02_45)]">{formatMoney(room)} room</p>
    </div>
  );
}

function SavedTeamHeadshot({
  player,
  slot,
}: {
  player: MockSavedTeam["players"][number];
  slot: number;
}) {
  return (
    <>
      {player.nbaApiId ? (
        <Image
          src={`https://ak-static.cms.nba.com/wp-content/uploads/headshots/nba/latest/260x190/${player.nbaApiId}.png`}
          alt={`${player.name} headshot`}
          width={260}
          height={190}
          sizes="(max-width: 640px) 18vw, (max-width: 1024px) 10vw, 128px"
          quality={100}
          unoptimized
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-[oklch(0.9_0.035_64)] font-mono text-xs font-semibold text-[oklch(0.28_0.03_45)]">
          {player.shortName.slice(0, 3).toUpperCase()}
        </span>
      )}
      <span className="absolute left-0 top-0 flex h-5 min-w-5 items-center justify-center rounded-br-sm bg-[oklch(0.18_0.02_45)] px-1 font-mono text-[0.625rem] leading-none text-[oklch(0.92_0.08_64)]">
        {slot}
      </span>
      <span className="sr-only">{slot}. {player.name}</span>
    </>
  );
}

// ---------------------------------------------------------------------------
// RebuildCheckModal — compatibility report before re-entering the Builder
// ---------------------------------------------------------------------------

type RebuildModalState = "loading" | "ready" | "error";

function skillTierLabel(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "final_tier" in value) {
    return String((value as Record<string, unknown>).final_tier ?? "—");
  }
  return "—";
}

function RebuildPlayerRow({ report }: { report: RebuildPlayerReport }) {
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
    <div id={`rebuild-player-slot-${report.slot}`} className="border-b border-[oklch(0.88_0.015_62)] last:border-b-0">
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
            id={`rebuild-player-slot-${report.slot}-expand-btn`}
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
        <div id={`rebuild-player-slot-${report.slot}-skill-diffs`} className="border-t border-dashed border-[oklch(0.88_0.015_62)] bg-[oklch(0.96_0.006_62)] px-3 py-2">
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

function RebuildCheckModal({
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
    getRebuildCheck(savedTeamId)
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
    const params = report.builder_url_params;
    const paramStr = new URLSearchParams(params).toString();

    if (!cornerstoneAvailable) {
      // Redirect to Legends picker with supporting player params
      return `/lab/${rulesetSlug}/legends${paramStr ? `?${paramStr}` : ""}`;
    }
    return `/lab/${rulesetSlug}/build?${paramStr}`;
  }

  return (
    <div
      id="rebuild-check-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        id="rebuild-check-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rebuild-check-modal-title"
        className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-[oklch(0.83_0.02_62)] bg-[oklch(0.985_0.005_62)] shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[oklch(0.86_0.018_62)] px-5 py-4">
          <div>
            <h2 id="rebuild-check-modal-title" className="font-display text-lg font-semibold text-[oklch(0.16_0.018_45)]">
              Rebuild Compatibility
            </h2>
            <p className="mt-0.5 text-sm text-[oklch(0.42_0.02_45)]">{savedTeamName}</p>
          </div>
          <button
            id="rebuild-check-modal-close-btn"
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-sm text-[oklch(0.42_0.02_45)] transition-colors hover:bg-[oklch(0.92_0.035_64)] hover:text-[oklch(0.18_0.02_45)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {state === "loading" && (
            <div id="rebuild-check-modal-loading" className="flex flex-col items-center gap-3 py-10">
              <Loader2 className="h-6 w-6 animate-spin text-[oklch(0.47_0.07_55)]" aria-hidden="true" />
              <p className="text-sm text-[oklch(0.42_0.02_45)]">Checking compatibility…</p>
            </div>
          )}

          {state === "error" && (
            <div id="rebuild-check-modal-error" className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
              {errorMessage}
            </div>
          )}

          {state === "ready" && report && (
            <div id="rebuild-check-modal-report" className="space-y-4">
              {/* Version drift banner */}
              {versionChanged && (
                <div id="rebuild-version-drift-banner" className="flex items-start gap-2.5 rounded-md border border-amber-300 bg-amber-50 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                  <div className="text-sm text-amber-900">
                    <p className="font-semibold">Rule Set Version changed</p>
                    <p className="mt-1 text-xs text-amber-800">
                      {report.version_drift.original?.version_label ?? "?"} → {report.version_drift.current.version_label}
                      {(() => {
                        const origCap = report.version_drift.original?.rules_json?.salary_cap;
                        const currCap = report.version_drift.current.rules_json?.salary_cap;
                        if (typeof origCap === "number" && typeof currCap === "number" && origCap !== currCap) {
                          return ` · SalaryCap: ${formatMoney(origCap)} → ${formatMoney(currCap)}`;
                        }
                        return "";
                      })()}
                    </p>
                  </div>
                </div>
              )}

              {/* Cornerstone status */}
              {!cornerstoneAvailable && (
                <div id="rebuild-cornerstone-warning" className="flex items-start gap-2.5 rounded-md border border-orange-300 bg-orange-50 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" aria-hidden="true" />
                  <div className="text-sm text-orange-900">
                    <p className="font-semibold">Cornerstone Legend unavailable</p>
                    <p className="mt-0.5 text-xs text-orange-800">
                      {report.cornerstone.name} is no longer available. You&apos;ll pick a new Cornerstone first.
                    </p>
                  </div>
                </div>
              )}

              {cornerstoneAvailable && (
                <div id="rebuild-cornerstone-status" className="flex items-center gap-3 rounded-md border border-[oklch(0.88_0.015_62)] bg-[oklch(0.96_0.006_62)] px-3 py-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-[oklch(0.66_0.16_55)] font-mono text-xs font-semibold text-white">
                    1
                  </span>
                  <p className="flex-1 text-sm font-semibold text-[oklch(0.18_0.02_45)]">{report.cornerstone.name}</p>
                  <span className="inline-flex items-center gap-1 rounded-sm bg-[oklch(0.92_0.035_64)] px-2 py-0.5 text-xs font-semibold text-[oklch(0.28_0.03_45)]">
                    Legend
                  </span>
                </div>
              )}

              {/* Summary line */}
              <p id="rebuild-check-modal-summary" className="text-sm text-[oklch(0.42_0.02_45)]">
                {matchedCount} of {totalPlayers} supporting player{totalPlayers !== 1 ? "s" : ""} matched
                {missingCount > 0 && (
                  <span className="text-orange-700"> · {missingCount} missing (slot{missingCount !== 1 ? "s" : ""} will be empty)</span>
                )}
              </p>

              {/* Player rows */}
              <div id="rebuild-check-modal-players" className="overflow-hidden rounded-md border border-[oklch(0.88_0.015_62)]">
                {report.players.map((player) => (
                  <RebuildPlayerRow key={player.slot} report={player} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {state === "ready" && report && (
          <div className="flex items-center justify-end gap-2 border-t border-[oklch(0.86_0.018_62)] px-5 py-3">
            <button
              id="rebuild-check-modal-cancel-btn"
              type="button"
              onClick={onClose}
              className="min-h-9 rounded border border-[oklch(0.83_0.02_62)] bg-[oklch(0.96_0.006_62)] px-4 py-1.5 text-sm font-semibold text-[oklch(0.22_0.02_45)] transition-colors hover:border-[oklch(0.73_0.08_53)] hover:bg-[oklch(0.92_0.035_64)]"
            >
              Cancel
            </button>
            <Link
              id="rebuild-check-modal-continue-btn"
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

function SavedTeamRecord({
  team,
  featured = false,
  featuredLabel,
}: {
  team: MockSavedTeam;
  featured?: boolean;
  featuredLabel?: string;
}) {
  const openButtonClassName = "inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded border border-[oklch(0.18_0.02_45)] bg-[oklch(0.18_0.02_45)] px-3 py-2 text-sm font-semibold text-[oklch(0.92_0.08_64)] transition-colors duration-150 hover:bg-[oklch(0.25_0.03_45)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.74_0.16_55)]";
  const secondaryButtonClassName = "inline-flex min-h-10 flex-1 items-center justify-center rounded border border-[oklch(0.83_0.02_62)] bg-[oklch(0.96_0.006_62)] px-3 py-2 text-sm font-semibold text-[oklch(0.22_0.02_45)] transition-colors duration-150 hover:border-[oklch(0.73_0.08_53)] hover:bg-[oklch(0.92_0.035_64)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.74_0.16_55)]";
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [rebuildModalOpen, setRebuildModalOpen] = useState(false);
  const summaryParts = splitSummary(team.summary);

  return (
    <article
      id={`profile-saved-team-${team.id}`}
      className={cn(
        "group grid rounded-md border bg-[oklch(0.985_0.005_62)] transition-colors duration-150 hover:border-[oklch(0.73_0.08_53)] md:grid-cols-[minmax(0,1fr)_15rem]",
        featured
          ? "gap-5 border-[oklch(0.76_0.08_60)] p-5"
          : "gap-4 border-[oklch(0.83_0.02_62)] p-4"
      )}
    >
      <div id={`profile-saved-team-${team.id}-main`} className={cn("min-w-0", featured ? "space-y-5" : "space-y-4")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {featured && (
              <p className="mb-2 font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[oklch(0.47_0.07_55)]">
                {featuredLabel ?? "First Result"}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={`profile-saved-team-${team.id}-name`} className={cn("font-display font-semibold leading-tight tracking-[-0.01em] text-[oklch(0.16_0.018_45)]", featured ? "text-2xl" : "text-xl")}>
                {team.name}
              </h2>
              {team.favorite && (
                <span
                  className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-[oklch(0.76_0.13_74)] bg-[oklch(0.94_0.035_74)] text-[oklch(0.39_0.11_55)]"
                  aria-label="Favorite"
                  title="Favorite"
                >
                  <Star className="h-3 w-3 fill-current" aria-hidden="true" />
                </span>
              )}
            </div>
            <p id={`profile-saved-team-${team.id}-meta`} className="mt-1 text-sm text-[oklch(0.42_0.02_45)]">
              Cornerstone: <span className="font-medium text-[oklch(0.2_0.02_45)]">{team.cornerstone}</span>
              <span className="mx-2 text-[oklch(0.67_0.02_62)]">/</span>
              {team.teamType}
              <span className="mx-2 text-[oklch(0.67_0.02_62)]">/</span>
              {team.createdAt}
            </p>
          </div>

          <CohesionScoreBadge
            id={`profile-saved-team-${team.id}-score`}
            value={team.starRating}
            featured={featured}
            ariaLabel={`${team.name} Cohesion score: ${team.starRating.toFixed(1)} out of 5`}
            breakdown={[
              { label: "Starting Lineup", value: team.scoreBreakdown.startingLineup },
              { label: "Depth", value: team.scoreBreakdown.depth },
              { label: "Versatility", value: team.scoreBreakdown.versatility },
              { label: "Floor", value: team.scoreBreakdown.floor },
            ]}
          />
        </div>

        <div id={`profile-saved-team-${team.id}-summary`} className={cn("max-w-3xl space-y-2 text-sm leading-6 text-[oklch(0.34_0.02_45)]", featured && "text-[0.9375rem]")}>
          <p>{summaryParts.firstSentence}</p>
          {summaryParts.remainder && summaryExpanded && (
            <p id={`profile-saved-team-${team.id}-summary-extra`}>
              {summaryParts.remainder}
            </p>
          )}
          {summaryParts.remainder && (
            <button
              id={`profile-saved-team-${team.id}-summary-toggle-btn`}
              type="button"
              onClick={() => setSummaryExpanded((current) => !current)}
              aria-expanded={summaryExpanded}
              aria-controls={`profile-saved-team-${team.id}-summary-extra`}
              className="text-xs font-semibold text-[oklch(0.47_0.07_55)] underline-offset-4 transition-colors hover:text-[oklch(0.3_0.05_45)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.74_0.16_55)]"
            >
              {summaryExpanded ? "Hide details" : "Show details"}
            </button>
          )}
        </div>

        <div
          id={`profile-saved-team-${team.id}-players`}
          className={cn("grid grid-cols-5 sm:grid-cols-9", featured ? "gap-3" : "gap-2.5")}
        >
          {team.players.map((player, index) => (
            <div
              key={`${team.id}-${player.name}`}
              className={cn(
                "relative flex aspect-[4/5] items-end justify-center overflow-hidden rounded-md border bg-[oklch(0.95_0.006_62)]",
                featured
                  ? "min-h-[3.7rem] sm:min-h-[4.35rem] lg:min-h-[4.8rem]"
                  : "min-h-[3.2rem] sm:min-h-[3.7rem] lg:min-h-[4rem]",
                index === 0
                  ? "border-[oklch(0.66_0.16_55)]"
                  : "border-[oklch(0.84_0.018_62)]"
              )}
              title={`${index + 1}. ${player.name}`}
            >
              <SavedTeamHeadshot player={player} slot={index + 1} />
            </div>
          ))}
        </div>
      </div>

      <aside id={`profile-saved-team-${team.id}-details`} className="grid content-between gap-4 border-t border-[oklch(0.86_0.018_62)] pt-4 md:border-l md:border-t-0 md:pl-4 md:pt-0">
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-1">
          <div>
            <dt className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[oklch(0.49_0.02_45)]">
              <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
              RuleSet
            </dt>
            <dd className="mt-1 font-mono text-sm tabular-nums text-[oklch(0.18_0.02_45)]">{team.ruleset}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[oklch(0.49_0.02_45)]">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
              Snapshot Release
            </dt>
            <dd className="mt-1 font-mono text-sm tabular-nums text-[oklch(0.18_0.02_45)]">{team.snapshotRelease}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[oklch(0.49_0.02_45)]">
              <CircleDollarSign className="h-3.5 w-3.5" aria-hidden="true" />
              SalaryCap
            </dt>
            <dd className="mt-1">
              <SalaryCapMeter
                id={`profile-saved-team-${team.id}-salary-meter`}
                used={team.salaryUsed}
                cap={team.salaryCap}
              />
            </dd>
          </div>
        </dl>

        <div id={`profile-saved-team-${team.id}-actions`} className="flex flex-wrap gap-2">
          <Link
            id={`profile-saved-team-${team.id}-see-eval-link`}
            href={`/profile/saved-teams/${team.id}`}
            className={secondaryButtonClassName}
          >
            See Eval
          </Link>
          <button
            id={`profile-saved-team-${team.id}-rebuild-btn`}
            type="button"
            onClick={() => setRebuildModalOpen(true)}
            className={openButtonClassName}
          >
            Rebuild
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </aside>

      {rebuildModalOpen && (
        <RebuildCheckModal
          savedTeamId={team.id}
          savedTeamName={team.name}
          rulesetSlug={getRulesetSlug(team.ruleset)}
          onClose={() => setRebuildModalOpen(false)}
        />
      )}
    </article>
  );
}

export default function ProfilePage() {
  const [loadState, setLoadState] = useState<ProfileLoadState>("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [savedTeams, setSavedTeams] = useState<MockSavedTeam[]>([]);
  const [filterField, setFilterField] = useState<SavedTeamFilterField>("name");
  const [filterValue, setFilterValue] = useState("");
  const [savedTeamFilters, setSavedTeamFilters] = useState<SavedTeamAppliedFilter[]>([]);
  const [savedTeamSorts, setSavedTeamSorts] = useState<SavedTeamSort[]>(DEFAULT_SAVED_TEAM_SORTS);
  const [builderPlayerRows, setBuilderPlayerRows] = useState<PlayerWithSkills[]>([]);

  useEffect(() => {
    let alive = true;

    async function loadProfileIdentity() {
      try {
        const supabase = getBrowserSupabase();
        const { data: { session }, error } = await supabase.auth.getSession();

        if (!alive) return;
        if (error) {
          setLoadState("error");
          return;
        }
        if (!session) {
          setLoadState("signed-out");
          return;
        }

        setEmail(session.user.email ?? null);
        const [profileRes, savedTeamsRes] = await Promise.all([
          getUserProfile(),
          listSavedTeams(),
        ]);

        if (!alive) return;
        const profileData = profileRes.success ? profileRes.data : null;
        setUserProfile(profileData);
        setSavedTeams(
          savedTeamsRes.success && savedTeamsRes.data
            ? savedTeamsRes.data.map((team) => mapSavedTeamSummary(team, profileData))
            : []
        );
        setLoadState("ready");
      } catch {
        if (alive) setLoadState("error");
      }
    }

    void loadProfileIdentity();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;

    listPlayersWithSkills()
      .then((res) => {
        if (!alive) return;
        if (res.success && res.data) {
          setBuilderPlayerRows(res.data);
        }
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, []);

  const rulesetOptions = useMemo(
    () => getUniqueValues(savedTeams.map((team) => team.ruleset)),
    [savedTeams]
  );
  const snapshotOptions = useMemo(
    () => getUniqueValues(savedTeams.map((team) => team.snapshotRelease)),
    [savedTeams]
  );
  const teamTypeOptions = useMemo(
    () => getUniqueValues(savedTeams.map((team) => team.teamType)),
    [savedTeams]
  );

  const displaySavedTeams = useMemo(
    () => enrichSavedTeamPortraits(savedTeams, builderPlayerRows),
    [savedTeams, builderPlayerRows]
  );

  const visibleTeams = useMemo(() => {
    const filtered = displaySavedTeams.filter((team) => savedTeamFilters.every((filter) => matchesSavedTeamFilter(team, filter)));

    return [...filtered].sort((a, b) => {
      for (const sort of savedTeamSorts) {
        const result = compareSavedTeamsBySort(a, b, sort);
        if (result !== 0) return sort.direction === "asc" ? result : -result;
      }
      return 0;
    });
  }, [displaySavedTeams, savedTeamFilters, savedTeamSorts]);

  const hasActiveAdvancedFilters = savedTeamFilters.length > 0 || !isDefaultSavedTeamSort(savedTeamSorts);
  const featuredSavedTeamLabel = getFeaturedSavedTeamLabel(savedTeamFilters, savedTeamSorts);
  const canAddFilter = filterValue.trim().length > 0;

  function resetSavedTeamControls() {
    setFilterField("name");
    setFilterValue("");
    setSavedTeamFilters([]);
    setSavedTeamSorts(DEFAULT_SAVED_TEAM_SORTS);
  }

  function addSavedTeamFilter() {
    const nextValue = filterValue.trim();
    if (!nextValue) return;

    const nextFilter: SavedTeamAppliedFilter = {
      id: `${filterField}-${nextValue}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      field: filterField,
      value: nextValue,
    };

    setSavedTeamFilters((current) => {
      if (current.some((filter) => filter.field === nextFilter.field && filter.value === nextFilter.value)) return current;
      return [...current, nextFilter];
    });
    setFilterValue("");
  }

  function removeSavedTeamFilter(id: string) {
    setSavedTeamFilters((current) => current.filter((filter) => filter.id !== id));
  }

  function addSavedTeamSort(field: SortField) {
    setSavedTeamSorts((current) => {
      if (current.some((sort) => sort.field === field)) return current;
      const direction: SortDirection = field === "date" || field === "score" ? "desc" : "asc";
      return [...current, { id: `${field}-${direction}`, field, direction }];
    });
  }

  function toggleSavedTeamSortDirection(id: string) {
    setSavedTeamSorts((current) =>
      current.map((sort) =>
        sort.id === id
          ? { ...sort, direction: sort.direction === "asc" ? "desc" : "asc" }
          : sort
      )
    );
  }

  function removeSavedTeamSort(id: string) {
    setSavedTeamSorts((current) => {
      const next = current.filter((sort) => sort.id !== id);
      return next.length > 0 ? next : DEFAULT_SAVED_TEAM_SORTS;
    });
  }

  const username = getUsername(email);
  const initials = getInitials(email);
  const savedTeamCount = savedTeams.length;
  const averageScore = savedTeamCount > 0
    ? savedTeams.reduce((sum, team) => sum + team.starRating, 0) / savedTeamCount
    : 0;
  const topScore = savedTeamCount > 0 ? Math.max(...savedTeams.map((team) => team.starRating)) : 0;
  const latestTeam = savedTeams[0] ?? null;

  if (loadState === "loading") {
    return (
      <main id="profile-page-loading" className="min-h-[calc(100vh-3rem)] bg-[oklch(0.94_0.006_62)] px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-screen-2xl gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <div className="h-80 animate-pulse rounded-md border border-[oklch(0.83_0.02_62)] bg-[oklch(0.985_0.005_62)]" />
          <SavedTeamSkeleton />
        </div>
      </main>
    );
  }

  if (loadState === "signed-out") {
    return (
      <main id="profile-page-signed-out" className="min-h-[calc(100vh-3rem)] bg-[oklch(0.94_0.006_62)] px-4 py-16 sm:px-6 lg:px-8">
        <section className="mx-auto max-w-xl rounded-md border border-[oklch(0.83_0.02_62)] bg-[oklch(0.985_0.005_62)] p-6 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-md border border-[oklch(0.83_0.02_62)] bg-[oklch(0.95_0.006_62)] text-[oklch(0.28_0.03_45)]">
            <Lock className="h-7 w-7" aria-hidden="true" />
          </div>
          <h1 className="mt-5 font-display text-2xl font-semibold tracking-[-0.01em] text-[oklch(0.16_0.018_45)]">Sign in to view your profile</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[oklch(0.42_0.02_45)]">
            Saved Teams live with your account so your Lab work stays private until you choose otherwise.
          </p>
          <Link
            id="profile-signed-out-login-link"
            href="/login?redirectTo=%2Fprofile"
            className="mt-6 inline-flex min-h-10 items-center justify-center rounded border border-[oklch(0.18_0.02_45)] bg-[oklch(0.18_0.02_45)] px-4 py-2 text-sm font-semibold text-[oklch(0.92_0.08_64)] transition-colors duration-150 hover:bg-[oklch(0.25_0.03_45)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.74_0.16_55)]"
          >
            Sign in
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main id="profile-page" className="min-h-[calc(100vh-3rem)] bg-[oklch(0.94_0.006_62)] px-4 py-6 text-[oklch(0.16_0.018_45)] sm:px-6 lg:px-8 lg:py-8">
      <div id="profile-shell" className="mx-auto grid max-w-screen-2xl gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <aside id="profile-identity-rail" className="space-y-4">
          <section className="rounded-md border border-[oklch(0.83_0.02_62)] bg-[oklch(0.985_0.005_62)] p-5">
            <div className="flex items-start gap-4">
              <div
                id="profile-avatar"
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-[oklch(0.73_0.08_53)] bg-[oklch(0.9_0.07_64)] font-display text-xl font-bold text-[oklch(0.2_0.035_45)]"
                aria-hidden="true"
              >
                {initials}
              </div>
              <div className="min-w-0">
                <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[oklch(0.49_0.02_45)]">Profile</p>
                <h1 id="profile-username" className="mt-1 font-display text-2xl font-semibold leading-tight tracking-[-0.01em] capitalize text-[oklch(0.16_0.018_45)]">
                  {username}
                </h1>
                <p id="profile-email" className="mt-1 truncate text-sm text-[oklch(0.42_0.02_45)]">{email}</p>
              </div>
            </div>

            <dl id="profile-details" className="mt-6 grid gap-3 border-t border-[oklch(0.86_0.018_62)] pt-4">
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-sm text-[oklch(0.42_0.02_45)]">
                  <UserRound className="h-4 w-4" aria-hidden="true" />
                  Favorite Player
                </dt>
                <dd className="text-right text-sm font-semibold text-[oklch(0.18_0.02_45)]">
                  {userProfile?.favorite_player_name ?? "None"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-sm text-[oklch(0.42_0.02_45)]">
                  <Trophy className="h-4 w-4" aria-hidden="true" />
                  Saved Teams
                </dt>
                <dd className="font-mono text-sm tabular-nums text-[oklch(0.18_0.02_45)]">{savedTeamCount}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-sm text-[oklch(0.42_0.02_45)]">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  Top score
                </dt>
                <dd className="font-mono text-sm tabular-nums text-[oklch(0.18_0.02_45)]">{topScore.toFixed(1)}</dd>
              </div>
            </dl>
          </section>

          <section id="profile-scorecard" className="rounded-md border border-[oklch(0.83_0.02_62)] bg-[oklch(0.985_0.005_62)] p-5">
            <h2 className="text-sm font-semibold text-[oklch(0.18_0.02_45)]">Build file</h2>
            <p className="mt-2 text-xs leading-5 text-[oklch(0.42_0.02_45)]">
              Latest: <span className="font-semibold text-[oklch(0.18_0.02_45)]">{latestTeam?.name ?? "None yet"}</span>
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[oklch(0.49_0.02_45)]">Avg score</p>
                <p className="mt-1 font-mono text-2xl tabular-nums text-[oklch(0.16_0.018_45)]">{averageScore.toFixed(1)}</p>
              </div>
              <div>
                <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[oklch(0.49_0.02_45)]">Private</p>
                <p className="mt-1 font-mono text-2xl tabular-nums text-[oklch(0.16_0.018_45)]">{savedTeamCount}</p>
              </div>
            </div>
            <Link
              id="profile-start-lab-link"
              href="/lab"
              className="mt-5 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded border border-[oklch(0.18_0.02_45)] bg-[oklch(0.18_0.02_45)] px-4 py-2 text-sm font-semibold text-[oklch(0.92_0.08_64)] transition-colors duration-150 hover:bg-[oklch(0.25_0.03_45)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.74_0.16_55)]"
            >
              New Lab
              <Plus className="h-4 w-4" aria-hidden="true" />
            </Link>
          </section>
        </aside>

        <section id="profile-saved-teams-section" className="min-w-0 space-y-4">
          <div className="rounded-md border border-[oklch(0.83_0.02_62)] bg-[oklch(0.985_0.005_62)] p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[oklch(0.49_0.02_45)]">Saved Teams</p>
                <h2 className="mt-1 font-display text-3xl font-semibold leading-tight tracking-[-0.01em] text-[oklch(0.16_0.018_45)]">Your scouting shelf</h2>
                <p id="profile-saved-team-result-count" className="mt-2 text-sm text-[oklch(0.42_0.02_45)]">
                  Showing <span className="font-mono tabular-nums text-[oklch(0.18_0.02_45)]">{visibleTeams.length}</span> of{" "}
                  <span className="font-mono tabular-nums text-[oklch(0.18_0.02_45)]">{savedTeamCount}</span>
                </p>
              </div>
            </div>

            <div id="profile-saved-team-controls" className="mt-5 space-y-2 border-t border-[oklch(0.86_0.018_62)] pt-4">
              <div id="profile-filter-controls-row" className="grid w-full gap-1.5 sm:grid-cols-[minmax(8rem,10rem)_minmax(14rem,1fr)_auto_auto_auto]">
                <label htmlFor="profile-filter-field-select" className="sr-only">Filter category</label>
                <select
                  id="profile-filter-field-select"
                  value={filterField}
                  onChange={(event) => {
                    setFilterField(event.target.value as SavedTeamFilterField);
                    setFilterValue("");
                  }}
                  className="min-h-9 w-full rounded border border-[oklch(0.83_0.02_62)] bg-[oklch(0.95_0.006_62)] px-2 text-sm text-[oklch(0.18_0.02_45)] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.74_0.16_55)]"
                >
                  {Object.entries(FILTER_FIELD_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>

                {filterField === "name" || filterField === "cornerstone" ? (
                  <span className="flex min-h-9 w-full items-center gap-2 rounded border border-[oklch(0.83_0.02_62)] bg-[oklch(0.95_0.006_62)] px-2 text-sm text-[oklch(0.18_0.02_45)]">
                    <Search className="h-4 w-4 text-[oklch(0.42_0.02_45)]" aria-hidden="true" />
                    <input
                      id="profile-filter-value-input"
                      type="search"
                      value={filterValue}
                      onChange={(event) => setFilterValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") addSavedTeamFilter();
                      }}
                      placeholder="Value..."
                      className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[oklch(0.58_0.02_45)]"
                    />
                  </span>
                ) : (
                  <select
                    id="profile-filter-value-select"
                    value={filterValue}
                    onChange={(event) => setFilterValue(event.target.value)}
                    className="min-h-9 w-full rounded border border-[oklch(0.83_0.02_62)] bg-[oklch(0.95_0.006_62)] px-2 text-sm text-[oklch(0.18_0.02_45)] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.74_0.16_55)]"
                  >
                    <option value="">Value...</option>
                    {filterField === "ruleset" && rulesetOptions.map((ruleset) => (
                      <option key={ruleset} value={ruleset}>{ruleset}</option>
                    ))}
                    {filterField === "snapshot" && snapshotOptions.map((snapshot) => (
                      <option key={snapshot} value={snapshot}>{snapshot}</option>
                    ))}
                    {filterField === "team-size" && teamTypeOptions.map((teamType) => (
                      <option key={teamType} value={teamType}>{teamType}</option>
                    ))}
                    {filterField === "date" && (
                      <>
                        <option value="last-7">Last 7 days</option>
                        <option value="last-30">Last 30 days</option>
                      </>
                    )}
                    {filterField === "favorite" && (
                      <>
                        <option value="yes">Favorites</option>
                        <option value="no">Not favorites</option>
                      </>
                    )}
                    {filterField === "score" && (
                      <>
                        <option value="4.5">4.5+</option>
                        <option value="4.0">4.0+</option>
                        <option value="3.5">3.5+</option>
                      </>
                    )}
                  </select>
                )}

                <button
                  id="profile-add-filter-btn"
                  type="button"
                  onClick={addSavedTeamFilter}
                  disabled={!canAddFilter}
                  className="min-h-9 rounded border border-[oklch(0.79_0.12_55)] bg-[oklch(0.78_0.16_55)] px-3 text-sm font-semibold text-[oklch(0.18_0.02_45)] transition-opacity duration-150 hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.74_0.16_55)]"
                >
                  Add Filter
                </button>
                <button
                  id="profile-filter-add-parens-btn"
                  type="button"
                  disabled
                  title="Filter groups are not wired for Saved Teams yet"
                  className="min-h-9 rounded border border-violet-300 bg-violet-100 px-3 text-sm font-bold text-violet-800 opacity-60"
                >
                  ( )
                </button>
                <button
                  id="profile-clear-filters-btn"
                  type="button"
                  onClick={() => setSavedTeamFilters([])}
                  disabled={savedTeamFilters.length === 0}
                  className="min-h-9 rounded border border-[oklch(0.83_0.02_62)] px-3 text-sm font-semibold text-[oklch(0.49_0.02_45)] transition-colors duration-150 hover:border-[oklch(0.73_0.08_53)] hover:text-[oklch(0.18_0.02_45)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.74_0.16_55)]"
                >
                  Clear All
                </button>
              </div>

              {savedTeamFilters.length > 0 && (
                <div id="profile-filter-pills-row" className="flex flex-wrap items-center gap-1.5">
                  {savedTeamFilters.map((filter) => (
                    <span
                      key={filter.id}
                      id={`profile-filter-pill-${filter.id}`}
                      className="inline-flex min-h-7 items-center gap-1 rounded-sm border border-[oklch(0.83_0.02_62)] bg-[oklch(0.92_0.035_64)] px-2 text-xs font-semibold text-[oklch(0.25_0.025_45)]"
                    >
                      {FILTER_FIELD_LABELS[filter.field]}: {getFilterDisplayValue(filter)}
                      <button
                        id={`profile-remove-filter-${filter.id}-btn`}
                        type="button"
                        onClick={() => removeSavedTeamFilter(filter.id)}
                        className="ml-1 text-[oklch(0.49_0.02_45)] hover:text-[oklch(0.18_0.02_45)]"
                        aria-label={`Remove ${FILTER_FIELD_LABELS[filter.field]} filter`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div id="profile-sort-controls-row" className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-semibold text-[oklch(0.49_0.02_45)]">Sort:</span>
                {savedTeamSorts.map((sort, index) => (
                  <span
                    key={sort.id}
                    id={`profile-sort-pill-${sort.id}`}
                    className="inline-flex min-h-7 items-center gap-1 rounded-sm border border-[oklch(0.83_0.02_62)] bg-[oklch(0.92_0.035_64)] px-2 text-xs font-semibold text-[oklch(0.25_0.025_45)]"
                  >
                    {savedTeamSorts.length > 1 && <span className="font-mono text-[0.625rem] text-[oklch(0.49_0.02_45)]">{index + 1}.</span>}
                    {SORT_FIELD_LABELS[sort.field]}
                    <button
                      id={`profile-toggle-sort-${sort.id}-btn`}
                      type="button"
                      onClick={() => toggleSavedTeamSortDirection(sort.id)}
                      className="font-mono text-[oklch(0.49_0.02_45)] hover:text-[oklch(0.18_0.02_45)]"
                      aria-label={`Toggle ${SORT_FIELD_LABELS[sort.field]} sort direction`}
                    >
                      {sort.direction === "asc" ? "▲" : "▼"}
                    </button>
                    <button
                      id={`profile-remove-sort-${sort.id}-btn`}
                      type="button"
                      onClick={() => removeSavedTeamSort(sort.id)}
                      className="ml-1 text-[oklch(0.49_0.02_45)] hover:text-[oklch(0.18_0.02_45)]"
                      aria-label={`Remove ${SORT_FIELD_LABELS[sort.field]} sort`}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <select
                  id="profile-add-sort-select"
                  value=""
                  onChange={(event) => {
                    if (event.target.value) addSavedTeamSort(event.target.value as SortField);
                  }}
                  className="min-h-7 rounded-sm border border-dashed border-[oklch(0.83_0.02_62)] bg-transparent px-2 text-xs font-semibold text-[oklch(0.49_0.02_45)] outline-none hover:border-[oklch(0.73_0.08_53)] hover:text-[oklch(0.18_0.02_45)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.74_0.16_55)]"
                >
                  <option value="">+ Add sort</option>
                  {SORT_FIELD_ORDER.filter((field) => !savedTeamSorts.some((sort) => sort.field === field)).map((field) => (
                    <option key={field} value={field}>{SORT_FIELD_LABELS[field]}</option>
                  ))}
                </select>
                <button
                  id="profile-clear-sorts-btn"
                  type="button"
                  onClick={() => setSavedTeamSorts(DEFAULT_SAVED_TEAM_SORTS)}
                  className="min-h-7 px-2 text-xs font-semibold text-[oklch(0.49_0.02_45)] transition-colors duration-150 hover:text-[oklch(0.18_0.02_45)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.74_0.16_55)]"
                >
                  Clear sorts
                </button>
              </div>
            </div>
          </div>

          {loadState === "error" && (
            <div id="profile-error-state" className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
              Account details could not be loaded. Saved Teams could not be loaded from the backend.
            </div>
          )}

          {visibleTeams.length > 0 ? (
            <div id="profile-saved-team-list" className="space-y-3">
              {visibleTeams.map((team, index) => (
                <SavedTeamRecord
                  key={team.id}
                  team={team}
                  featured={index === 0}
                  featuredLabel={index === 0 ? featuredSavedTeamLabel : undefined}
                />
              ))}
            </div>
          ) : (
            <section id="profile-empty-saved-teams" className="rounded-md border border-[oklch(0.83_0.02_62)] bg-[oklch(0.985_0.005_62)] p-8 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-md border border-[oklch(0.83_0.02_62)] bg-[oklch(0.95_0.006_62)]">
                <ClipboardList className="h-7 w-7 text-[oklch(0.42_0.02_45)]" aria-hidden="true" />
              </div>
              <h2 className="mt-5 font-display text-2xl font-semibold tracking-[-0.01em] text-[oklch(0.16_0.018_45)]">
                {hasActiveAdvancedFilters ? "No matching Saved Teams" : "No Saved Teams yet"}
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[oklch(0.42_0.02_45)]">
                {hasActiveAdvancedFilters
                  ? "Loosen the lookup, filters, or sorting controls to bring more Teams back into view."
                  : "Run a final Eval, save the Team, and it will land here with its RuleSet and Snapshot Release attached."}
              </p>
              {hasActiveAdvancedFilters ? (
                <button
                  id="profile-empty-reset-filters-btn"
                  type="button"
                  onClick={resetSavedTeamControls}
                  className="mt-6 inline-flex min-h-10 items-center justify-center gap-2 rounded border border-[oklch(0.18_0.02_45)] bg-[oklch(0.18_0.02_45)] px-4 py-2 text-sm font-semibold text-[oklch(0.92_0.08_64)] transition-colors duration-150 hover:bg-[oklch(0.25_0.03_45)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.74_0.16_55)]"
                >
                  Reset controls
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : (
                <Link
                  id="profile-empty-start-lab-link"
                  href="/lab"
                  className="mt-6 inline-flex min-h-10 items-center justify-center gap-2 rounded border border-[oklch(0.18_0.02_45)] bg-[oklch(0.18_0.02_45)] px-4 py-2 text-sm font-semibold text-[oklch(0.92_0.08_64)] transition-colors duration-150 hover:bg-[oklch(0.25_0.03_45)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.74_0.16_55)]"
                >
                  Start a Lab
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              )}
            </section>
          )}
        </section>
      </div>

    </main>
  );
}
