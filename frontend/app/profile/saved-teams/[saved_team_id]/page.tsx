"use client";

import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  CircleDollarSign,
  ClipboardList,
  Cog,
  UserRound,
  UsersRound,
} from "lucide-react";
import { CohesionScoreBadge } from "@/components/cohesion/CohesionScoreBadge";
import { CohesionScoreDisplay } from "@/components/builder/CohesionScoreDisplay";
import { getSavedTeam, listPlayersWithSkills } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { PlayerWithSkills, RosterEvaluation, SavedTeamSummary, SaveTeamPlayerPayload } from "@/lib/types";

type DetailState = "loading" | "ready" | "not-found" | "error";

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

function normalizePlayerName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function getTeamKind(playerCount: number): string {
  if (playerCount >= 12) return "Roster";
  if (playerCount >= 9) return "Rotation";
  return "Lineup";
}

function getTeamKindFromSize(teamSize: number | null | undefined, playerCount: number): string {
  if (teamSize === 12) return "Roster";
  if (teamSize === 9) return "Rotation";
  if (teamSize === 5) return "Lineup";
  return getTeamKind(playerCount);
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

function getSavedEvaluation(team: SavedTeamSummary): RosterEvaluation | null {
  const payload = team.evaluation?.evaluation_payload;
  return isFullRosterEvaluation(payload) ? payload : null;
}

function getFallbackScore(team: SavedTeamSummary): number {
  return team.evaluation?.star_rating ?? 0;
}

function getFallbackDescription(team: SavedTeamSummary): string {
  return team.evaluation?.team_description ?? "This Saved Team has a limited historical Eval record.";
}

function resolvePlayerPortraitId(
  player: SaveTeamPlayerPayload,
  playerRows: PlayerWithSkills[],
): number | null {
  const normalizedName = normalizePlayerName(player.player_name_snapshot);
  const resolved = playerRows.find((row) => (
    row.id === player.player_id ||
    row.id === player.legend_id ||
    normalizePlayerName(row.name) === normalizedName
  ));

  return resolved?.nba_api_id ?? null;
}

function PlayerSnapshotRow({
  player,
  nbaApiId,
  showSalary = true,
  showCornerstone = true,
}: {
  player: SaveTeamPlayerPayload;
  nbaApiId: number | null;
  showSalary?: boolean;
  showCornerstone?: boolean;
}) {
  return (
    <li
      id={`saved-team-detail-player-slot-${player.slot}`}
      className={cn(
        "grid items-center gap-3 border border-[oklch(0.84_0.018_62)] bg-[oklch(0.985_0.005_62)] p-3",
        showSalary ? "grid-cols-[4rem_minmax(0,1fr)_auto]" : "grid-cols-[4rem_minmax(0,1fr)]",
      )}
    >
      <div
        id={`saved-team-detail-player-slot-${player.slot}-badge`}
        className={cn(
          "relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-sm border font-mono text-sm font-semibold",
          showCornerstone && player.is_cornerstone
            ? "border-[oklch(0.66_0.16_55)] bg-[oklch(0.92_0.055_64)] text-[oklch(0.24_0.04_45)]"
            : "border-[oklch(0.82_0.02_62)] bg-[oklch(0.94_0.018_62)] text-[oklch(0.29_0.025_45)]"
        )}
        aria-hidden="true"
      >
        {nbaApiId ? (
          <Image
            src={`https://ak-static.cms.nba.com/wp-content/uploads/headshots/nba/latest/260x190/${nbaApiId}.png`}
            alt=""
            width={260}
            height={190}
            sizes="56px"
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
          <p
            id={`saved-team-detail-player-slot-${player.slot}-name`}
            className="truncate text-sm font-semibold text-[oklch(0.16_0.018_45)]"
          >
            {player.player_name_snapshot}
          </p>
          {showCornerstone && player.is_cornerstone && (
            <span className="rounded-sm border border-[oklch(0.76_0.13_74)] bg-[oklch(0.94_0.035_74)] px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-[oklch(0.39_0.11_55)]">
              Cornerstone
            </span>
          )}
        </div>
        <p
          id={`saved-team-detail-player-slot-${player.slot}-meta`}
          className="mt-1 text-xs text-[oklch(0.44_0.02_45)]"
        >
          Slot {player.slot} / {player.position_snapshot ?? "Position unknown"} / {player.team_snapshot ?? "Team unknown"}
        </p>
      </div>
      {showSalary && (
        <p
          id={`saved-team-detail-player-slot-${player.slot}-salary`}
          className="font-mono text-sm tabular-nums text-[oklch(0.18_0.02_45)]"
        >
          {formatMoney(player.salary_snapshot)}
        </p>
      )}
    </li>
  );
}

function SavedTeamDetailSkeleton() {
  return (
    <main id="saved-team-detail-loading" className="mx-auto max-w-6xl px-4 py-6">
      <div className="h-8 w-36 animate-pulse rounded-sm bg-[oklch(0.88_0.018_62)]" />
      <div className="mt-6 h-56 animate-pulse rounded-md border border-[oklch(0.83_0.02_62)] bg-[oklch(0.96_0.006_62)]" />
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="h-24 animate-pulse rounded-md border border-[oklch(0.83_0.02_62)] bg-[oklch(0.96_0.006_62)]" />
        ))}
      </div>
    </main>
  );
}

export default function SavedTeamDetailPage() {
  const params = useParams<{ saved_team_id: string }>();
  const savedTeamId = params.saved_team_id;
  const [state, setState] = useState<DetailState>("loading");
  const [savedTeam, setSavedTeam] = useState<SavedTeamSummary | null>(null);
  const [playerRows, setPlayerRows] = useState<PlayerWithSkills[]>([]);

  useEffect(() => {
    let alive = true;

    async function loadSavedTeam() {
      setState("loading");
      try {
        const res = await getSavedTeam(savedTeamId);
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

    void loadSavedTeam();

    return () => {
      alive = false;
    };
  }, [savedTeamId]);

  useEffect(() => {
    let alive = true;

    listPlayersWithSkills()
      .then((res) => {
        if (!alive) return;
        if (res.success && res.data) setPlayerRows(res.data);
      })
      .catch(() => {
        if (alive) setPlayerRows([]);
      });

    return () => {
      alive = false;
    };
  }, []);

  const orderedPlayers = useMemo(
    () => [...(savedTeam?.players ?? [])].sort((a, b) => a.slot - b.slot),
    [savedTeam?.players]
  );
  const playerPortraitIds = useMemo(
    () => new Map(orderedPlayers.map((player) => [
      player.slot,
      resolvePlayerPortraitId(player, playerRows),
    ])),
    [orderedPlayers, playerRows]
  );
  const fullEvaluation = savedTeam ? getSavedEvaluation(savedTeam) : null;
  const score = fullEvaluation?.star_rating ?? (savedTeam ? getFallbackScore(savedTeam) : 0);
  const description = fullEvaluation?.team_description ?? (savedTeam ? getFallbackDescription(savedTeam) : "");
  const teamKind = getTeamKindFromSize(savedTeam?.team_size, orderedPlayers.length);
  const salaryTotal = savedTeam?.total_salary ?? orderedPlayers.reduce((sum, player) => sum + player.salary_snapshot, 0);
  const hasSalaryCap = !savedTeam?.ruleset_slug?.startsWith("free-for-all");
  const hasCornerstone = orderedPlayers.some((p) => p.is_cornerstone) && hasSalaryCap;

  if (state === "loading") return <SavedTeamDetailSkeleton />;

  if (state === "not-found" || state === "error" || !savedTeam) {
    return (
      <main id="saved-team-detail-error" className="mx-auto max-w-3xl px-4 py-10">
        <Link
          id="saved-team-detail-error-back-link"
          href="/profile"
          className="inline-flex items-center gap-2 text-sm font-semibold text-[oklch(0.28_0.04_45)] hover:text-[oklch(0.18_0.02_45)]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Profile
        </Link>
        <div className="mt-6 border border-[oklch(0.83_0.02_62)] bg-[oklch(0.985_0.005_62)] p-5">
          <h1 className="text-xl font-semibold text-[oklch(0.16_0.018_45)]">
            Saved Team unavailable
          </h1>
          <p className="mt-2 text-sm leading-6 text-[oklch(0.42_0.02_45)]">
            {state === "not-found" ? "This Saved Team could not be found." : "This Saved Team could not be loaded."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main id="saved-team-detail-page" className="mx-auto max-w-6xl px-4 py-6">
      <Link
        id="saved-team-detail-back-link"
        href="/profile"
        className="inline-flex items-center gap-2 text-sm font-semibold text-[oklch(0.28_0.04_45)] hover:text-[oklch(0.18_0.02_45)]"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Profile
      </Link>

      <section
        id="saved-team-detail-header"
        className="relative mt-5 rounded-md border border-[oklch(0.78_0.08_62)] bg-[oklch(0.985_0.005_62)] p-5"
      >
        <div className="min-w-0 lg:pr-56">
          <p className="font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[oklch(0.47_0.07_55)]">
            Historical Eval
          </p>
          <h1
            id="saved-team-detail-title"
            className="mt-2 text-2xl font-semibold leading-tight tracking-[-0.01em] text-[oklch(0.16_0.018_45)]"
          >
            {savedTeam.name}
          </h1>
          <p
            id="saved-team-detail-meta"
            className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[oklch(0.42_0.02_45)]"
          >
            <span>{teamKind}</span>
            <span aria-hidden="true">/</span>
            <span>{formatRulesetName(savedTeam.ruleset_slug)}</span>
            <span aria-hidden="true">/</span>
            <span>{formatDate(savedTeam.created_at)}</span>
          </p>
        </div>

        <p
          id="saved-team-detail-description"
          className="mt-5 w-full max-w-none text-sm leading-6 text-[oklch(0.34_0.02_45)]"
        >
          {description}
        </p>

        <div id="saved-team-detail-score-corner" className="mt-4 w-fit lg:absolute lg:right-5 lg:top-5 lg:mt-0">
          <CohesionScoreBadge
            id="saved-team-detail-score"
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
        </div>
      </section>

      <dl
        id="saved-team-detail-context"
        className={cn("mt-5 grid gap-3 md:grid-cols-2", hasSalaryCap ? "xl:grid-cols-4" : "xl:grid-cols-4")}
      >
        <div className="rounded-md border border-[oklch(0.83_0.02_62)] bg-[oklch(0.985_0.005_62)] p-4">
          <dt className="flex items-center gap-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[oklch(0.49_0.02_45)]">
            <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
            Rule Set
          </dt>
          <dd id="saved-team-detail-ruleset-version" className="mt-2 font-mono text-sm text-[oklch(0.18_0.02_45)]">
            {formatRulesetName(savedTeam.ruleset_slug)}{savedTeam.ruleset_version_label ? ` · ${savedTeam.ruleset_version_label}` : ""}
          </dd>
        </div>
        <div className="rounded-md border border-[oklch(0.83_0.02_62)] bg-[oklch(0.985_0.005_62)] p-4">
          <dt className="flex items-center gap-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[oklch(0.49_0.02_45)]">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            Snapshot Release
          </dt>
          <dd id="saved-team-detail-snapshot-release" className="mt-2 break-all font-mono text-sm text-[oklch(0.18_0.02_45)]">
            {savedTeam.snapshot_release_id}
          </dd>
        </div>
        <div className="rounded-md border border-[oklch(0.83_0.02_62)] bg-[oklch(0.985_0.005_62)] p-4">
          <dt className="flex items-center gap-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[oklch(0.49_0.02_45)]">
            <UsersRound className="h-3.5 w-3.5" aria-hidden="true" />
            Team Size
          </dt>
          <dd id="saved-team-detail-team-size" className="mt-2 font-mono text-sm text-[oklch(0.18_0.02_45)]">
            {teamKind}
          </dd>
        </div>
        <div className="rounded-md border border-[oklch(0.83_0.02_62)] bg-[oklch(0.985_0.005_62)] p-4">
          <dt className="flex items-center gap-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[oklch(0.49_0.02_45)]">
            <Cog className="h-3.5 w-3.5" aria-hidden="true" />
            Evaluation Version
          </dt>
          <dd id="saved-team-detail-evaluation-version" className="mt-2 font-mono text-sm text-[oklch(0.18_0.02_45)]">
            {savedTeam.evaluation?.evaluation_version ?? "Unknown"}
          </dd>
        </div>
        {hasSalaryCap && (
          <div className="rounded-md border border-[oklch(0.83_0.02_62)] bg-[oklch(0.985_0.005_62)] p-4">
            <dt className="flex items-center gap-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[oklch(0.49_0.02_45)]">
              <CircleDollarSign className="h-3.5 w-3.5" aria-hidden="true" />
              Salary Cap
            </dt>
            <dd id="saved-team-detail-salary" className="mt-2 font-mono text-sm tabular-nums text-[oklch(0.18_0.02_45)]">
              {formatMoney(salaryTotal)}
            </dd>
          </div>
        )}
      </dl>

      <section id="saved-team-detail-players-section" className="mt-5 grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="self-start rounded-md border border-[oklch(0.83_0.02_62)] bg-[oklch(0.96_0.006_62)] p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[oklch(0.16_0.018_45)]">
              <UsersRound className="h-4 w-4" aria-hidden="true" />
              Ordered Players
            </h2>
            <span className="font-mono text-xs tabular-nums text-[oklch(0.42_0.02_45)]">
              {orderedPlayers.length}
            </span>
          </div>
          <ol id="saved-team-detail-players" className="mt-4 grid gap-2">
            {orderedPlayers.map((player) => (
              <PlayerSnapshotRow
                key={`${player.slot}-${player.player_name_snapshot}`}
                player={player}
                nbaApiId={playerPortraitIds.get(player.slot) ?? null}
                showSalary={hasSalaryCap}
                showCornerstone={hasCornerstone}
              />
            ))}
          </ol>
        </div>

        <div id="saved-team-detail-eval-panel" className="min-w-0">
          {fullEvaluation ? (
            <CohesionScoreDisplay
              evaluation={fullEvaluation}
              isLineupOnly={orderedPlayers.length <= 5}
              teamLabel={teamKind}
            />
          ) : (
            <div
              id="saved-team-detail-limited-eval"
              className="rounded-md border border-[oklch(0.83_0.02_62)] bg-[oklch(0.985_0.005_62)] p-5"
            >
              <div className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-[oklch(0.47_0.07_55)]" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-[oklch(0.16_0.018_45)]">
                  Limited Eval Record
                </h2>
              </div>
              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="border border-[oklch(0.84_0.018_62)] bg-[oklch(0.96_0.006_62)] p-3">
                  <dt className="text-xs text-[oklch(0.45_0.02_45)]">Cohesion Score</dt>
                  <dd className="mt-1 font-mono text-xl tabular-nums text-[oklch(0.16_0.018_45)]">
                    {getFallbackScore(savedTeam).toFixed(1)}
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
    </main>
  );
}
