"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  CircleDollarSign,
  ClipboardList,
  Lock,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  Trophy,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { CohesionScoreBadge } from "@/components/cohesion/CohesionScoreBadge";

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
    nbaApiId: number;
  }>;
  summary: string;
  tags: string[];
}

const MOCK_SAVED_TEAMS: MockSavedTeam[] = [
  {
    id: "hakeem-space-hunt",
    name: "Hakeem Space Hunt",
    cornerstone: "Hakeem Olajuwon",
    favorite: true,
    ruleset: "Standard",
    snapshotRelease: "2025-26 Current",
    evaluationVersion: "cohesion-v1",
    createdAt: "May 9",
    savedAt: "2026-05-09",
    teamType: "Rotation",
    starRating: 4.6,
    scoreBreakdown: {
      startingLineup: 4.8,
      depth: 4.4,
      versatility: 4.5,
      floor: 4.6,
    },
    salaryUsed: 191_400_000,
    salaryCap: 195_000_000,
    players: [
      { name: "Hakeem Olajuwon", shortName: "Hakeem", nbaApiId: 165 },
      { name: "Shai Gilgeous-Alexander", shortName: "SGA", nbaApiId: 1628983 },
      { name: "Mikal Bridges", shortName: "Bridges", nbaApiId: 1628969 },
      { name: "Austin Reaves", shortName: "Reaves", nbaApiId: 1630559 },
      { name: "Evan Mobley", shortName: "Mobley", nbaApiId: 1630596 },
      { name: "Derrick White", shortName: "White", nbaApiId: 1628401 },
      { name: "Trey Murphy III", shortName: "Murphy", nbaApiId: 1630530 },
      { name: "Alex Caruso", shortName: "Caruso", nbaApiId: 1627936 },
      { name: "Dereck Lively II", shortName: "Lively", nbaApiId: 1641726 },
    ],
    summary: "Paint pressure, switch coverage, and enough spacing to keep the Cornerstone fed.",
    tags: ["Two-way", "Rim pressure", "Switchable"],
  },
  {
    id: "lebron-delay-game",
    name: "LeBron Delay Game",
    cornerstone: "LeBron James",
    favorite: false,
    ruleset: "Standard",
    snapshotRelease: "2025-26 Current",
    evaluationVersion: "cohesion-v1",
    createdAt: "May 8",
    savedAt: "2026-05-08",
    teamType: "Rotation",
    starRating: 4.2,
    scoreBreakdown: {
      startingLineup: 4.4,
      depth: 4.0,
      versatility: 4.3,
      floor: 4.1,
    },
    salaryUsed: 188_900_000,
    salaryCap: 195_000_000,
    players: [
      { name: "LeBron James", shortName: "LeBron", nbaApiId: 2544 },
      { name: "Tyrese Haliburton", shortName: "Haliburton", nbaApiId: 1630169 },
      { name: "OG Anunoby", shortName: "Anunoby", nbaApiId: 1628384 },
      { name: "Chet Holmgren", shortName: "Chet", nbaApiId: 1631096 },
      { name: "Kentavious Caldwell-Pope", shortName: "KCP", nbaApiId: 203484 },
      { name: "Josh Hart", shortName: "Hart", nbaApiId: 1628404 },
      { name: "Naz Reid", shortName: "Naz", nbaApiId: 1629675 },
      { name: "Jalen Suggs", shortName: "Suggs", nbaApiId: 1630591 },
      { name: "Brandin Podziemski", shortName: "Podziemski", nbaApiId: 1641764 },
    ],
    summary: "Passing gravity turns every cut into a problem, but the bench needs a cleaner late-clock release.",
    tags: ["Connector", "Big wing", "Depth"],
  },
  {
    id: "curry-pressure-map",
    name: "Curry Pressure Map",
    cornerstone: "Stephen Curry",
    favorite: true,
    ruleset: "Standard",
    snapshotRelease: "2025-26 Current",
    evaluationVersion: "cohesion-v1",
    createdAt: "May 7",
    savedAt: "2026-05-07",
    teamType: "Rotation",
    starRating: 4.4,
    scoreBreakdown: {
      startingLineup: 4.5,
      depth: 4.2,
      versatility: 4.7,
      floor: 4.3,
    },
    salaryUsed: 193_100_000,
    salaryCap: 195_000_000,
    players: [
      { name: "Stephen Curry", shortName: "Curry", nbaApiId: 201939 },
      { name: "Bam Adebayo", shortName: "Bam", nbaApiId: 1628389 },
      { name: "Jaden McDaniels", shortName: "McDaniels", nbaApiId: 1630183 },
      { name: "Herbert Jones", shortName: "Herb", nbaApiId: 1630529 },
      { name: "Lauri Markkanen", shortName: "Markkanen", nbaApiId: 1628374 },
      { name: "Mike Conley", shortName: "Conley", nbaApiId: 201144 },
      { name: "Jonathan Isaac", shortName: "Isaac", nbaApiId: 1628371 },
      { name: "Immanuel Quickley", shortName: "Quickley", nbaApiId: 1630193 },
      { name: "Daniel Gafford", shortName: "Gafford", nbaApiId: 1629655 },
    ],
    summary: "Motion shooting with defensive insulation. The best Lineup Combinations lean into Bam as the hinge.",
    tags: ["Movement", "Spacing", "Defensive cover"],
  },
];

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
  const now = new Date("2026-05-10T00:00:00").getTime();
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
      <span className="absolute left-0 top-0 flex h-5 min-w-5 items-center justify-center rounded-br-sm bg-[oklch(0.18_0.02_45)] px-1 font-mono text-[0.625rem] leading-none text-[oklch(0.92_0.08_64)]">
        {slot}
      </span>
      <span className="sr-only">{slot}. {player.name}</span>
    </>
  );
}

function SavedTeamRecord({ team, featured = false }: { team: MockSavedTeam; featured?: boolean }) {
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
                Latest Saved Team
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

        <p id={`profile-saved-team-${team.id}-summary`} className={cn("max-w-3xl text-sm leading-6 text-[oklch(0.34_0.02_45)]", featured && "text-[0.9375rem]")}>
          {team.summary}
        </p>

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
          <button
            id={`profile-saved-team-${team.id}-open-btn`}
            type="button"
            className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded border border-[oklch(0.18_0.02_45)] bg-[oklch(0.18_0.02_45)] px-3 py-2 text-sm font-semibold text-[oklch(0.92_0.08_64)] transition-colors duration-150 hover:bg-[oklch(0.25_0.03_45)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.74_0.16_55)]"
          >
            Open
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            id={`profile-saved-team-${team.id}-rerun-btn`}
            type="button"
            className="inline-flex min-h-10 items-center justify-center rounded border border-[oklch(0.83_0.02_62)] bg-[oklch(0.96_0.006_62)] px-3 py-2 text-sm font-semibold text-[oklch(0.22_0.02_45)] transition-colors duration-150 hover:border-[oklch(0.73_0.08_53)] hover:bg-[oklch(0.92_0.035_64)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.74_0.16_55)]"
            aria-label={`Re-evaluate ${team.name}`}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </aside>
    </article>
  );
}

export default function ProfilePage() {
  const [loadState, setLoadState] = useState<ProfileLoadState>("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [filterField, setFilterField] = useState<SavedTeamFilterField>("name");
  const [filterValue, setFilterValue] = useState("");
  const [savedTeamFilters, setSavedTeamFilters] = useState<SavedTeamAppliedFilter[]>([]);
  const [savedTeamSorts, setSavedTeamSorts] = useState<SavedTeamSort[]>(DEFAULT_SAVED_TEAM_SORTS);

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

  const rulesetOptions = useMemo(
    () => getUniqueValues(MOCK_SAVED_TEAMS.map((team) => team.ruleset)),
    []
  );
  const snapshotOptions = useMemo(
    () => getUniqueValues(MOCK_SAVED_TEAMS.map((team) => team.snapshotRelease)),
    []
  );
  const teamTypeOptions = useMemo(
    () => getUniqueValues(MOCK_SAVED_TEAMS.map((team) => team.teamType)),
    []
  );

  const visibleTeams = useMemo(() => {
    const filtered = MOCK_SAVED_TEAMS.filter((team) => savedTeamFilters.every((filter) => matchesSavedTeamFilter(team, filter)));

    return [...filtered].sort((a, b) => {
      for (const sort of savedTeamSorts) {
        const result = compareSavedTeamsBySort(a, b, sort);
        if (result !== 0) return sort.direction === "asc" ? result : -result;
      }
      return 0;
    });
  }, [savedTeamFilters, savedTeamSorts]);

  const hasActiveAdvancedFilters = savedTeamFilters.length > 0 || JSON.stringify(savedTeamSorts) !== JSON.stringify(DEFAULT_SAVED_TEAM_SORTS);
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
  const savedTeamCount = MOCK_SAVED_TEAMS.length;
  const averageScore = MOCK_SAVED_TEAMS.reduce((sum, team) => sum + team.starRating, 0) / MOCK_SAVED_TEAMS.length;
  const topScore = Math.max(...MOCK_SAVED_TEAMS.map((team) => team.starRating));
  const latestTeam = MOCK_SAVED_TEAMS[0];

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
                <dd className="text-right text-sm font-semibold text-[oklch(0.18_0.02_45)]">Hakeem</dd>
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
              Latest: <span className="font-semibold text-[oklch(0.18_0.02_45)]">{latestTeam.name}</span>
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
                  <span className="font-mono tabular-nums text-[oklch(0.18_0.02_45)]">{MOCK_SAVED_TEAMS.length}</span>
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
              Account details could not be loaded. The mocked Saved Teams are still visible for this screen pass.
            </div>
          )}

          {visibleTeams.length > 0 ? (
            <div id="profile-saved-team-list" className="space-y-3">
              {visibleTeams.map((team, index) => (
                <SavedTeamRecord key={team.id} team={team} featured={index === 0} />
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
