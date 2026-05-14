"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight, Loader2, Trophy } from "lucide-react";
import { getCommunityTeams, listRuleSets } from "@/lib/api";
import { teamLabelForSize } from "@/lib/builder-config";
import { cn } from "@/lib/utils";
import { CohesionScoreBadge } from "@/components/cohesion/CohesionScoreBadge";
import { PlayerViewSizeToggle } from "@/components/players/PlayerView";
import type { PlayerViewSize } from "@/components/players/PlayerView/PlayerView";
import type { CommunityTeamEntry, CommunityTeamPlayer, RuleSetSummary } from "@/lib/types";

/* ── Constants ── */

type LeaderboardViewSize = Exclude<PlayerViewSize, "card">;
type SortValue = "score" | "date";
const VIEW_SIZES: LeaderboardViewSize[] = ["row", "panel"];
const VALID_TEAM_SIZES = [5, 9, 12] as const;
const PER_PAGE = 20;

/* ── Helpers ── */

function formatDate(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatRuleSetName(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || slug;
}

function formatPlayerInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : name.slice(0, 2)).toUpperCase();
}

function getShortName(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return name;
  return `${parts[0][0]}. ${parts[parts.length - 1]}`;
}

/* ── Row player names (compact inline list) ── */

function PlayerNameStrip({
  players,
  id,
}: {
  players: CommunityTeamPlayer[];
  id: string;
}) {
  if (players.length === 0) return null;

  return (
    <p id={id} className="mt-1.5 truncate text-[0.75rem] text-[oklch(0.49_0.02_45)]">
      {players.map((p, i) => (
        <span key={`${p.slot}-${p.name}`}>
          {i > 0 && <span className="mx-1 text-[oklch(0.72_0.015_62)]">·</span>}
          <span className={p.is_cornerstone ? "font-semibold text-[oklch(0.35_0.05_50)]" : ""}>
            {getShortName(p.name)}
          </span>
        </span>
      ))}
    </p>
  );
}

/* ── Panel player headshot (portrait with NBA.com image) ── */

function PlayerHeadshot({
  player,
}: {
  player: CommunityTeamPlayer;
}) {
  return (
    <div
      className={cn(
        "relative flex aspect-[4/5] items-end justify-center overflow-hidden rounded-md border",
        player.is_cornerstone
          ? "border-[oklch(0.76_0.08_60)] bg-[oklch(0.94_0.035_64)]"
          : "border-[oklch(0.86_0.015_62)] bg-[oklch(0.95_0.006_62)]",
      )}
    >
      {player.nba_api_id ? (
        <Image
          src={`https://ak-static.cms.nba.com/wp-content/uploads/headshots/nba/latest/260x190/${player.nba_api_id}.png`}
          alt={`${player.name} headshot`}
          width={260}
          height={190}
          sizes="(max-width: 640px) 18vw, (max-width: 1024px) 10vw, 80px"
          quality={100}
          unoptimized
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center font-mono text-xs font-semibold text-[oklch(0.28_0.03_45)]">
          {formatPlayerInitials(player.name)}
        </span>
      )}
      {/* Slot badge */}
      <span className="absolute left-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-br-sm bg-[oklch(0.18_0.02_45)] px-0.5 font-mono text-[0.5625rem] leading-none text-[oklch(0.92_0.08_64)]">
        {player.slot}
      </span>
      {/* Name on hover */}
      <span className="absolute inset-x-0 bottom-0 truncate bg-[oklch(0.18_0.02_45)]/80 px-1 py-0.5 text-center text-[0.5625rem] font-medium leading-tight text-[oklch(0.92_0.08_64)] opacity-0 transition-opacity group-hover/panel:opacity-100">
        {getShortName(player.name)}
      </span>
    </div>
  );
}

/* ── View-mode components ── */

function LeaderboardRow({
  entry,
  rank,
}: {
  entry: CommunityTeamEntry;
  rank: number;
}) {
  const teamLabel = entry.team_size ? teamLabelForSize(entry.team_size) : null;

  return (
    <Link
      id={`community-entry-${entry.id}`}
      href={`/shared/${entry.id}`}
      className={cn(
        "group block rounded-md border border-transparent px-4 py-3 transition-colors duration-150",
        "hover:border-[oklch(0.83_0.02_62)] hover:bg-[oklch(0.985_0.005_62)]",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.74_0.16_55)]",
      )}
    >
      {/* Top row: rank + name/meta + ruleset + score */}
      <div className="grid items-start gap-x-3 grid-cols-[2.5rem_1fr_auto] sm:grid-cols-[2.5rem_1fr_minmax(0,14rem)_auto]">
        {/* Rank */}
        <span
          id={`community-entry-${entry.id}-rank`}
          className={cn(
            "mt-0.5 font-mono text-lg tabular-nums leading-none",
            rank <= 3
              ? "font-bold text-[oklch(0.45_0.14_55)]"
              : "font-medium text-[oklch(0.52_0.02_45)]",
          )}
        >
          {rank}
        </span>

        {/* Name + meta */}
        <div className="min-w-0">
          <p
            id={`community-entry-${entry.id}-name`}
            className="truncate font-display text-[0.9375rem] font-semibold leading-tight tracking-[-0.01em] text-[oklch(0.16_0.018_45)]"
          >
            {entry.name}
          </p>
          <p className="mt-0.5 truncate text-[0.8125rem] text-[oklch(0.42_0.02_45)]">
            {entry.cornerstone_name !== "-" && (
              <>
                <span className="font-medium text-[oklch(0.28_0.02_45)]">{entry.cornerstone_name}</span>
                <span className="mx-1.5 text-[oklch(0.67_0.02_62)]">·</span>
              </>
            )}
            {teamLabel && (
              <>
                {teamLabel}
                <span className="mx-1.5 text-[oklch(0.67_0.02_62)]">·</span>
              </>
            )}
            {formatDate(entry.created_at)}
          </p>
        </div>

        {/* Rule Set — hidden on mobile */}
        <span className="mt-0.5 hidden truncate text-[0.8125rem] text-[oklch(0.42_0.02_45)] sm:block">
          {formatRuleSetName(entry.ruleset_slug)}
        </span>

        {/* Score */}
        {entry.star_rating != null ? (
          <CohesionScoreBadge
            id={`community-entry-${entry.id}-score`}
            value={entry.star_rating}
            ariaLabel={`${entry.name} score: ${entry.star_rating.toFixed(1)} out of 5`}
            className="justify-self-end"
          />
        ) : (
          <span className="justify-self-end font-mono text-sm text-[oklch(0.52_0.02_45)]">—</span>
        )}
      </div>

      {/* Full-width player names row */}
      <PlayerNameStrip
        players={entry.players}
        id={`community-entry-${entry.id}-players`}
      />
    </Link>
  );
}

function LeaderboardPanel({
  entry,
  rank,
}: {
  entry: CommunityTeamEntry;
  rank: number;
}) {
  const teamLabel = entry.team_size ? teamLabelForSize(entry.team_size) : null;

  return (
    <Link
      id={`community-entry-${entry.id}`}
      href={`/shared/${entry.id}`}
      className={cn(
        "group/panel grid gap-4 rounded-md border border-[oklch(0.83_0.02_62)] bg-[oklch(0.985_0.005_62)] p-5 transition-colors duration-150",
        "hover:border-[oklch(0.73_0.08_53)]",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.74_0.16_55)]",
        "md:grid-cols-[minmax(0,1fr)_auto]",
      )}
    >
      <div className="min-w-0 space-y-3">
        {/* Header */}
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "font-mono text-xl tabular-nums leading-none",
              rank <= 3
                ? "font-bold text-[oklch(0.45_0.14_55)]"
                : "font-medium text-[oklch(0.52_0.02_45)]",
            )}
          >
            {rank}
          </span>
          <h3 className="truncate font-display text-xl font-semibold leading-tight tracking-[-0.01em] text-[oklch(0.16_0.018_45)]">
            {entry.name}
          </h3>
        </div>

        {/* Meta */}
        <p className="text-sm text-[oklch(0.42_0.02_45)]">
          Cornerstone:{" "}
          <span className="font-medium text-[oklch(0.2_0.02_45)]">
            {entry.cornerstone_name !== "-" ? entry.cornerstone_name : "None"}
          </span>
          <span className="mx-2 text-[oklch(0.67_0.02_62)]">/</span>
          {teamLabel ?? "Team"}
          <span className="mx-2 text-[oklch(0.67_0.02_62)]">/</span>
          {formatRuleSetName(entry.ruleset_slug)}
          <span className="mx-2 text-[oklch(0.67_0.02_62)]">/</span>
          {formatDate(entry.created_at)}
        </p>

        {entry.starting_lineup_score != null && (
          <p className="text-[0.8125rem] text-[oklch(0.42_0.02_45)]">
            Starting lineup score:{" "}
            <span className="font-mono font-medium tabular-nums text-[oklch(0.22_0.02_45)]">
              {entry.starting_lineup_score.toFixed(1)}
            </span>
          </p>
        )}

        {/* Player portraits */}
        {entry.players.length > 0 && (
          <div
            id={`community-entry-${entry.id}-roster`}
            className={cn(
              entry.players.length > 9
                ? "flex overflow-x-auto gap-2"
                : "grid grid-cols-5 sm:grid-cols-9 gap-2",
            )}
          >
            {entry.players.map((p) => (
              <PlayerHeadshot key={`${p.slot}-${p.name}`} player={p} />
            ))}
          </div>
        )}
      </div>

      <div className="flex items-start justify-end">
        {entry.star_rating != null ? (
          <CohesionScoreBadge
            id={`community-entry-${entry.id}-score`}
            value={entry.star_rating}
            ariaLabel={`${entry.name} score: ${entry.star_rating.toFixed(1)} out of 5`}
            featured
          />
        ) : (
          <span className="font-mono text-lg text-[oklch(0.52_0.02_45)]">—</span>
        )}
      </div>
    </Link>
  );
}

/* ── Filter select ── */

function FilterSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor={id}
        className="text-[0.75rem] font-medium uppercase tracking-[0.03em] text-[oklch(0.49_0.02_45)]"
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "rounded border border-[oklch(0.83_0.02_62)] bg-transparent px-2.5 py-1.5 text-sm text-[oklch(0.22_0.02_45)]",
          "transition-colors duration-150",
          "hover:border-[oklch(0.73_0.08_53)]",
          "focus-visible:border-[#ffa05c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffa05c]/30",
        )}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ── Pagination ── */

function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <nav
      id="community-pagination"
      aria-label="Leaderboard pagination"
      className="flex items-center justify-center gap-3 pt-4"
    >
      <button
        id="community-pagination-prev"
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className={cn(
          "inline-flex items-center gap-1 rounded border border-[oklch(0.83_0.02_62)] px-3 py-1.5 text-sm font-medium transition-colors",
          page <= 1
            ? "cursor-not-allowed text-[oklch(0.67_0.02_62)]"
            : "text-[oklch(0.22_0.02_45)] hover:border-[oklch(0.73_0.08_53)] hover:bg-[oklch(0.96_0.006_62)]",
        )}
      >
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Prev
      </button>

      <span className="font-mono text-sm tabular-nums text-[oklch(0.42_0.02_45)]">
        {page} / {totalPages}
      </span>

      <button
        id="community-pagination-next"
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className={cn(
          "inline-flex items-center gap-1 rounded border border-[oklch(0.83_0.02_62)] px-3 py-1.5 text-sm font-medium transition-colors",
          page >= totalPages
            ? "cursor-not-allowed text-[oklch(0.67_0.02_62)]"
            : "text-[oklch(0.22_0.02_45)] hover:border-[oklch(0.73_0.08_53)] hover:bg-[oklch(0.96_0.006_62)]",
        )}
      >
        Next
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </nav>
  );
}

/* ── Empty state ── */

function EmptyState() {
  return (
    <div id="community-empty" className="flex flex-col items-center gap-4 py-16 text-center">
      <Trophy className="h-10 w-10 text-[oklch(0.67_0.02_62)]" aria-hidden="true" />
      <div className="space-y-1">
        <p className="text-[0.9375rem] font-medium text-[oklch(0.28_0.02_45)]">
          No public Teams yet
        </p>
        <p className="text-sm text-[oklch(0.49_0.02_45)]">
          Build one in the Lab and set its visibility to public.
        </p>
      </div>
      <Link
        id="community-empty-lab-link"
        href="/lab"
        className="rounded border border-[oklch(0.18_0.02_45)] bg-[oklch(0.18_0.02_45)] px-4 py-2 text-sm font-semibold text-[oklch(0.92_0.08_64)] transition-colors hover:bg-[oklch(0.25_0.03_45)]"
      >
        Go to Lab
      </Link>
    </div>
  );
}

/* ── Page ── */

type PageState = "loading" | "ready" | "error";

export default function CommunityPage() {
  const [pageState, setPageState] = useState<PageState>("loading");
  const [teams, setTeams] = useState<CommunityTeamEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const [rulesets, setRulesets] = useState<RuleSetSummary[]>([]);
  const [rulesetFilter, setRulesetFilter] = useState("");
  const [teamSizeFilter, setTeamSizeFilter] = useState("");
  const [sort, setSort] = useState<SortValue>("score");
  const [viewSize, setViewSize] = useState<LeaderboardViewSize>("panel");

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const fetchTeams = useCallback(async (
    rulesetSlug: string,
    teamSize: string,
    sortValue: SortValue,
    pageNum: number,
  ) => {
    const res = await getCommunityTeams({
      ruleset_slug: rulesetSlug || undefined,
      team_size: teamSize ? Number(teamSize) : undefined,
      sort: sortValue,
      page: pageNum,
      per_page: PER_PAGE,
    });
    if (res.success && res.data) {
      setTeams(res.data.teams);
      setTotal(res.data.total);
      setPageState("ready");
    } else {
      setPageState("error");
    }
  }, []);

  // Initial load: rulesets + first page of teams
  useEffect(() => {
    let alive = true;

    const safeRulesets = listRuleSets().catch(
      () => ({ success: false, data: null, error: null }) as const,
    );

    Promise.all([
      safeRulesets,
      getCommunityTeams({ sort: "score", page: 1, per_page: PER_PAGE }),
    ]).then(([rsRes, teamsRes]) => {
      if (!alive) return;
      if (rsRes.success && rsRes.data) {
        setRulesets(rsRes.data.filter((rs) => rs.status === "active"));
      }
      if (teamsRes.success && teamsRes.data) {
        setTeams(teamsRes.data.teams);
        setTotal(teamsRes.data.total);
        setPageState("ready");
      } else {
        setPageState("error");
      }
    }).catch(() => {
      if (alive) setPageState("error");
    });

    return () => { alive = false; };
  }, []);

  const handleFilterChange = useCallback((
    newRuleset: string,
    newTeamSize: string,
    newSort: SortValue,
    newPage: number,
  ) => {
    setRulesetFilter(newRuleset);
    setTeamSizeFilter(newTeamSize);
    setSort(newSort);
    setPage(newPage);
    setPageState("loading");
    fetchTeams(newRuleset, newTeamSize, newSort, newPage);
  }, [fetchTeams]);

  const baseRank = (page - 1) * PER_PAGE;

  /* ── Filter options ── */

  const rulesetOptions = [
    { value: "", label: "All Rule Sets" },
    ...rulesets.map((rs) => ({ value: rs.slug, label: rs.name })),
  ];

  const teamSizeOptions = [
    { value: "", label: "All Sizes" },
    ...VALID_TEAM_SIZES.map((s) => ({
      value: String(s),
      label: teamLabelForSize(s),
    })),
  ];

  const sortOptions = [
    { value: "score", label: "Score" },
    { value: "date", label: "Newest" },
  ];

  return (
    <main
      id="community-page"
      className="min-h-[calc(100vh-48px)] bg-[oklch(0.96_0.006_62)]"
    >
      <div className="mx-auto max-w-screen-lg px-4 py-8">
        {/* Header */}
        <div id="community-header" className="mb-6">
          <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-[oklch(0.16_0.018_45)]">
            Community Leaderboard
          </h1>
          <p className="mt-1 text-sm text-[oklch(0.42_0.02_45)]">
            Public Teams ranked by cohesion score
          </p>
        </div>

        {/* Toolbar: filters + view toggle */}
        <div
          id="community-toolbar"
          className="mb-4 flex flex-wrap items-center gap-3"
        >
          <FilterSelect
            id="community-filter-ruleset"
            label="Rule Set"
            value={rulesetFilter}
            options={rulesetOptions}
            onChange={(v) => handleFilterChange(v, teamSizeFilter, sort, 1)}
          />
          <FilterSelect
            id="community-filter-size"
            label="Size"
            value={teamSizeFilter}
            options={teamSizeOptions}
            onChange={(v) => handleFilterChange(rulesetFilter, v, sort, 1)}
          />
          <FilterSelect
            id="community-filter-sort"
            label="Sort"
            value={sort}
            options={sortOptions}
            onChange={(v) => handleFilterChange(rulesetFilter, teamSizeFilter, v as SortValue, 1)}
          />

          <div className="ml-auto">
            <PlayerViewSizeToggle
              id="community-view-toggle"
              viewSize={viewSize}
              viewSizes={VIEW_SIZES}
              onViewSizeChange={(s) => setViewSize(s as LeaderboardViewSize)}
              borderClassName="border-[oklch(0.83_0.02_62)]"
              activeClassName="bg-[oklch(0.18_0.02_45)] text-[oklch(0.92_0.08_64)]"
              inactiveClassName="text-[oklch(0.49_0.02_45)] hover:text-[oklch(0.22_0.02_45)] hover:bg-[oklch(0.94_0.006_62)]"
            />
          </div>
        </div>

        {/* Divider */}
        <hr className="mb-4 border-[oklch(0.83_0.02_62)]" />

        {/* Content */}
        {pageState === "loading" && (
          <div id="community-loading" className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-[oklch(0.52_0.02_45)]" />
          </div>
        )}

        {pageState === "error" && (
          <div id="community-error" className="flex flex-col items-center gap-2 py-16 text-center">
            <p className="text-sm text-[oklch(0.42_0.02_45)]">
              Failed to load leaderboard. Try refreshing.
            </p>
          </div>
        )}

        {pageState === "ready" && teams.length === 0 && <EmptyState />}

        {pageState === "ready" && teams.length > 0 && (
          <>
            {/* Row view */}
            {viewSize === "row" && (
              <div id="community-list" className="flex flex-col gap-0.5">
                {teams.map((entry, i) => (
                  <LeaderboardRow
                    key={entry.id}
                    entry={entry}
                    rank={baseRank + i + 1}
                  />
                ))}
              </div>
            )}

            {/* Panel view */}
            {viewSize === "panel" && (
              <div id="community-panels" className="flex flex-col gap-4">
                {teams.map((entry, i) => (
                  <LeaderboardPanel
                    key={entry.id}
                    entry={entry}
                    rank={baseRank + i + 1}
                  />
                ))}
              </div>
            )}

            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={(p) => handleFilterChange(rulesetFilter, teamSizeFilter, sort, p)}
            />
          </>
        )}
      </div>
    </main>
  );
}
