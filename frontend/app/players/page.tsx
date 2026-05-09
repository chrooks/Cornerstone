"use client";

/**
 * /players — Player Explorer page.
 *
 * Features:
 *  - Loads all qualifying players with embedded skill tiers via GET /api/players/bulk
 *  - Filter bar with per-filter AND/OR/NOT operators and drag-to-reorder pills
 *  - Multi-key sorting (up to 3 sort keys)
 *  - Table view (resizable/hideable columns) and Card view (top-6 skills)
 *  - Client-side pagination (all data loaded upfront, display is paged)
 *  - View mode (table/cards) persisted to localStorage
 */

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { listPlayersWithSkills, manualOverrideSkill, searchNbaPlayers, manuallyIncludePlayer, removeManualInclude } from "@/lib/api";
import type { NbaPlayerSearchResult } from "@/lib/api";
import { useAdminStatus } from "@/lib/hooks/useAdminStatus";
import {
  PlayerPoolBrowser,
  type PlayerPoolBrowserCounts,
  type PlayerPoolFilterRequest,
  type PlayerPoolViewMode,
} from "@/components/players/PlayerPoolBrowser";
import {
  AVAILABLE_FILTERS,
  type FilterEntry,
  type FilterConnector,
  type ActiveFilter,
  MAX_ACTIVE_FILTERS,
} from "@/components/players/playerFilters";

// ---------------------------------------------------------------------------
// Legends toggle helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the filter entries contain a Legend=No pill,
 * which means legends are being actively excluded.
 */
function hasLegendsExcludeFilter(entries: FilterEntry[]): boolean {
  return entries.some(
    (e) => "filter" in e && e.filter.label === "Legend" && e.value === "No",
  );
}

/** Build a Legend=No filter entry to hide legends. */
function makeLegendsExcludeFilter(connector: FilterConnector): ActiveFilter {
  const legendFilter = AVAILABLE_FILTERS.find((f) => f.label === "Legend")!;
  return {
    id: crypto.randomUUID(),
    filter: legendFilter,
    value: "No",
    connector,
    negated: false,
  };
}
import type { SortKey } from "@/components/players/SortControls";
import type { PlayerWithSkills, SkillTier } from "@/lib/types";

// ---------------------------------------------------------------------------
// View mode persistence key
// ---------------------------------------------------------------------------

const VIEW_MODE_KEY = "playersViewMode";
const PLAYERS_TABLE_PAGE_SIZE = 8;

// ---------------------------------------------------------------------------
// Unique ID generator for filter entries
// ---------------------------------------------------------------------------

/** Use crypto.randomUUID() to avoid hot-reload counter resets colliding with existing filter IDs. */
function nextFilterId(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// URL serialization / deserialization helpers
// ---------------------------------------------------------------------------

/**
 * Encode a FilterEntry into a single URL param value.
 * Active filters: "Label|value|connector|negated"
 * Paren markers:  "(|connector" or ")|connector"
 */
function encodeFilterEntry(entry: FilterEntry): string {
  if ("paren" in entry) {
    return `${entry.paren}|${entry.connector}`;
  }
  return [
    entry.filter.label,
    entry.value,
    entry.connector,
    entry.negated ? "1" : "0",
  ].join("|");
}

/**
 * Decode a "f" param value back into a FilterEntry.
 * Returns null when the label is unrecognized or the format is invalid.
 */
function decodeFilterEntry(raw: string): FilterEntry | null {
  const parts = raw.split("|");
  // Paren markers have 2 parts
  if (parts.length === 2 && (parts[0] === "(" || parts[0] === ")")) {
    const connector = parts[1] === "OR" ? "OR" : "AND";
    return { id: crypto.randomUUID(), paren: parts[0] as "(" | ")", connector };
  }
  // Active filters have 4 parts
  if (parts.length < 4) return null;
  const [label, value, connRaw, negRaw] = parts;
  const filter = AVAILABLE_FILTERS.find((f) => f.label === label);
  if (!filter) return null;
  const connector: FilterConnector = connRaw === "OR" ? "OR" : "AND";
  return {
    id: crypto.randomUUID(),
    filter,
    value,
    connector,
    negated: negRaw === "1",
  };
}

/** Build a URLSearchParams from current filter + sort state. */
function buildSearchParams(entries: FilterEntry[], keys: SortKey[]): URLSearchParams {
  const params = new URLSearchParams();
  for (const entry of entries) {
    params.append("f", encodeFilterEntry(entry));
  }
  for (const key of keys) {
    params.append("s", `${key.field}|${key.direction}`);
  }
  return params;
}

/** Parse initial FilterEntry[] from URLSearchParams, with legacy ?team= fallback. */
function parseFiltersFromUrl(searchParams: URLSearchParams): FilterEntry[] {
  const fParams = searchParams.getAll("f");
  if (fParams.length > 0) {
    return fParams.flatMap((raw) => {
      const entry = decodeFilterEntry(raw);
      return entry ? [entry] : [];
    });
  }
  // Backward-compat: legacy ?team=DEN links used before URL sync was added
  const teamParam = searchParams.get("team");
  if (teamParam) {
    const teamFilter = AVAILABLE_FILTERS.find((f) => f.label === "Team");
    if (teamFilter) {
      return [{ id: crypto.randomUUID(), filter: teamFilter, value: teamParam, connector: "AND", negated: false }];
    }
  }
  return [];
}

/** Parse initial SortKey[] from URLSearchParams. */
function parseSortFromUrl(searchParams: URLSearchParams): SortKey[] {
  const sParams = searchParams.getAll("s");
  if (sParams.length === 0) return [{ field: "name", direction: "asc" }];
  const keys: SortKey[] = sParams.flatMap((raw) => {
    const [field, dir] = raw.split("|");
    if (!field) return [];
    return [{ field, direction: dir === "desc" ? "desc" : "asc" } as SortKey];
  });
  return keys.length > 0 ? keys : [{ field: "name", direction: "asc" }];
}

// ---------------------------------------------------------------------------
// PlayersPage
// ---------------------------------------------------------------------------

function PlayersPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // ── Auth — gate admin-only controls behind role check ─────────────────────
  const { isAdmin } = useAdminStatus();

  // ── Data ──────────────────────────────────────────────────────────────────
  const [players, setPlayers] = useState<PlayerWithSkills[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Filter state — seeded from URL on first render ────────────────────────
  const [filterEntries, setFilterEntries] = useState<FilterEntry[]>(() =>
    parseFiltersFromUrl(searchParams),
  );
  const [nextConnector] = useState<FilterConnector>("AND");
  const [filterRequest, setFilterRequest] = useState<PlayerPoolFilterRequest | null>(null);
  const [browserCounts, setBrowserCounts] = useState<PlayerPoolBrowserCounts>({
    totalCount: 0,
    filteredCount: 0,
    sortedCount: 0,
    pageCount: 0,
  });

  // Legends are visible when no NOT-team=Legends filter is active.
  // This is derived from filterEntries so the switch always reflects filter state.
  const legendsVisible = !hasLegendsExcludeFilter(filterEntries);

  const handleToggleLegends = useCallback(() => {
    if (legendsVisible) {
      // Hide legends: add NOT-team=Legends pill
      if (filterEntries.length < MAX_ACTIVE_FILTERS) {
        const entry = makeLegendsExcludeFilter(nextConnector);
        setFilterRequest({
          id: entry.id,
          filterLabel: entry.filter.label,
          value: entry.value,
          mode: "append",
        });
      }
    } else {
      // Show legends: remove all Legend=No pills
      setFilterRequest({
        id: nextFilterId(),
        filterLabel: "Legend",
        value: "No",
        mode: "remove-label-value",
      });
    }
  }, [legendsVisible, filterEntries, nextConnector]);

  // ── Sort state — seeded from URL on first render ──────────────────────────
  const [sortKeys, setSortKeys] = useState<SortKey[]>(() =>
    parseSortFromUrl(searchParams),
  );

  // ── Sync filter + sort state → URL (replace, not push, to avoid history bloat) ──
  // Skip the very first render to avoid overwriting the seed URL params.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const params = buildSearchParams(filterEntries, sortKeys);
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [filterEntries, sortKeys, pathname, router]);

  const [viewModeReady, setViewModeReady] = useState(false); // suppress hydration flicker

  // ── Load players on mount ─────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    setError(null);
    listPlayersWithSkills()
      .then((res) => {
        if (res.success && res.data) {
          setPlayers(res.data);
        } else {
          setError(res.error ?? "Failed to load players");
        }
      })
      .catch(() => setError("Failed to load players"))
      .finally(() => setLoading(false));
  }, []);

  // ── Skill tier override (right-click edit in table) ──────────────────────
  //
  // TODO: gate this behind an admin mode check before passing to PlayerTable.
  //   e.g. const isAdmin = useAdminMode();
  //        onSkillOverride={isAdmin ? handleSkillOverride : undefined}
  const handleSkillOverride = useCallback(
    async (playerId: string, skillKey: string, tier: SkillTier) => {
      const res = await manualOverrideSkill(playerId, { skill_name: skillKey, resolved_value: tier });
      if (!res.success) return;
      setPlayers((prev) =>
        prev.map((p) =>
          p.id !== playerId
            ? p
            : { ...p, skills: { ...(p.skills ?? {}), [skillKey]: tier } },
        ),
      );
    },
    [],
  );

  // ── Add player (manual include) state ────────────────────────────────────

  const [addPlayerOpen, setAddPlayerOpen] = useState(false);
  const [addPlayerQuery, setAddPlayerQuery] = useState("");
  const [addPlayerResults, setAddPlayerResults] = useState<NbaPlayerSearchResult[]>([]);
  const [addPlayerLoading, setAddPlayerLoading] = useState(false);
  const [addPlayerError, setAddPlayerError] = useState<string | null>(null);
  const addPlayerRef = useRef<HTMLDivElement>(null);

  // Debounce the name search so we don't fire on every keystroke
  useEffect(() => {
    if (addPlayerQuery.length < 2) {
      setAddPlayerResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setAddPlayerLoading(true);
      setAddPlayerError(null);
      try {
        const res = await searchNbaPlayers(addPlayerQuery);
        if (res.success && res.data) {
          setAddPlayerResults(res.data);
          if (res.data.length === 0) setAddPlayerError("No players found");
        } else {
          setAddPlayerError(res.error ?? "Search failed");
        }
      } catch (e) {
        setAddPlayerError(e instanceof Error ? e.message : "Search failed");
      }
      setAddPlayerLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [addPlayerQuery]);

  // Close the add-player dropdown when clicking outside
  useEffect(() => {
    if (!addPlayerOpen) return;
    const handler = (e: MouseEvent) => {
      if (addPlayerRef.current && !addPlayerRef.current.contains(e.target as Node)) {
        setAddPlayerOpen(false);
        setAddPlayerQuery("");
        setAddPlayerResults([]);
        setAddPlayerError(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [addPlayerOpen]);

  const handleAddPlayer = useCallback(async (result: NbaPlayerSearchResult) => {
    // Insert/update the player row and merge into the local state immediately
    const res = await manuallyIncludePlayer(result.nba_api_id);
    if (!res.success || !res.data) return;
    const newPlayer = res.data;
    setPlayers((prev) => {
      // If the player is already in the list (e.g. they had stats), update their record
      const exists = prev.some((p) => p.id === newPlayer.id);
      if (exists) return prev.map((p) => (p.id === newPlayer.id ? { ...p, ...newPlayer } : p));
      return [...prev, newPlayer];
    });
    setAddPlayerOpen(false);
    setAddPlayerQuery("");
    setAddPlayerResults([]);
  }, []);

  const handleRemoveManualPlayer = useCallback(async (playerId: string) => {
    const res = await removeManualInclude(playerId);
    if (!res.success) return;
    // Remove the player from local state — they no longer meet the MPG threshold
    setPlayers((prev) => prev.filter((p) => p.id !== playerId));
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <main id="players-page" className="max-w-screen-2xl mx-auto px-4 py-6 space-y-4">
      {/* ── Page header ── */}
      <div id="players-header" className="flex items-center justify-between gap-4 flex-wrap">
        <div id="players-header-left">
          <h1 id="players-title" className="text-xl font-bold text-foreground">Players</h1>
          {!loading && (
            <p id="players-count" className="text-sm text-muted-foreground">
              {browserCounts.filteredCount === browserCounts.totalCount
                ? `${browserCounts.totalCount} players`
                : `${browserCounts.filteredCount} of ${browserCounts.totalCount} players`}
            </p>
          )}
        </div>

        {/* Add player (manual include) — admin only */}
        {isAdmin && <div id="add-player-control" ref={addPlayerRef} className="relative">
          {!addPlayerOpen ? (
            <button
              id="add-player-btn"
              type="button"
              onClick={() => setAddPlayerOpen(true)}
              className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors border border-dashed border-border rounded px-2 py-1"
            >
              + Add player
            </button>
          ) : (
            <div id="add-player-search" className="flex items-center gap-1">
              <input
                id="add-player-input"
                type="text"
                autoFocus
                placeholder="Search player name…"
                value={addPlayerQuery}
                onChange={(e) => setAddPlayerQuery(e.target.value)}
                className="text-xs rounded border border-input bg-background px-2 py-1 w-44 focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                id="add-player-cancel-btn"
                type="button"
                onClick={() => { setAddPlayerOpen(false); setAddPlayerQuery(""); setAddPlayerResults([]); setAddPlayerError(null); }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            </div>
          )}

          {/* Dropdown results */}
          {addPlayerOpen && (addPlayerResults.length > 0 || addPlayerLoading || addPlayerError) && (
            <div
              id="add-player-dropdown"
              className="absolute top-full left-0 mt-1 w-64 rounded-md border border-border bg-popover shadow-md z-50 overflow-hidden"
            >
              {addPlayerLoading && (
                <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>
              )}
              {!addPlayerLoading && addPlayerError && (
                <div className="px-3 py-2 text-xs text-muted-foreground">{addPlayerError}</div>
              )}
              {!addPlayerLoading && !addPlayerError && addPlayerResults.map((r) => (
                <button
                  key={r.nba_api_id}
                  id={`add-player-result-${r.nba_api_id}`}
                  type="button"
                  onClick={() => handleAddPlayer(r)}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors flex items-center justify-between gap-2"
                >
                  <span>{r.full_name}</span>
                  {!r.is_active && (
                    <span className="text-muted-foreground/60 shrink-0">inactive</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>}

        {/* Legends toggle */}
        <button
          id="legends-toggle"
          type="button"
          role="switch"
          aria-checked={legendsVisible}
          onClick={handleToggleLegends}
          className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <span
            className={cn(
              "relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200",
              legendsVisible ? "bg-primary" : "bg-muted-foreground/30",
            )}
          >
            <span
              className={cn(
                "inline-block h-4 w-4 transform rounded-full bg-background shadow transition-transform duration-200",
                legendsVisible ? "translate-x-4" : "translate-x-0",
              )}
            />
          </span>
          Legends
        </button>

      </div>

      {/* ── Loading / error states ── */}
      {loading && (
        <div id="players-loading" className="space-y-3 animate-pulse">
          <div className="h-10 bg-muted rounded-lg" />
          <div className="h-8 bg-muted rounded-lg w-1/2" />
          <div className="h-64 bg-muted rounded-lg" />
        </div>
      )}

      {!loading && error && (
        <div id="players-error" className="rounded-md border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && (
        <PlayerPoolBrowser
          id="players-pool-browser"
          players={players}
          initialFilterEntries={filterEntries}
          initialSortKeys={sortKeys}
          defaultSortKeys={[{ field: "name", direction: "asc" }]}
          defaultPageSize={PLAYERS_TABLE_PAGE_SIZE}
          pageSizeOptions={[8, 12, 24, 48, 96]}
          viewModes={["table", "cards"]}
          defaultViewMode="table"
          emptyMessage="No players match the current filters."
          persistViewModeKey={VIEW_MODE_KEY}
          hideViewToggleUntilReady
          filterRequest={filterRequest}
          onFilterRequestHandled={() => setFilterRequest(null)}
          onFilterEntriesChange={setFilterEntries}
          onSortKeysChange={setSortKeys}
          onCountsChange={setBrowserCounts}
          onViewModeReadyChange={setViewModeReady}
          onSkillOverride={isAdmin ? handleSkillOverride : undefined}
          onRemoveManualPlayer={isAdmin ? handleRemoveManualPlayer : undefined}
          isAdmin={isAdmin}
          renderViewToggle={({ viewMode, setViewMode }) => viewModeReady && (
            <div id="players-view-toggle" className="flex w-fit rounded-md border border-border overflow-hidden text-xs font-medium">
              {(["table", "cards"] as PlayerPoolViewMode[]).map((mode, index) => (
                <button
                  key={mode}
                  id={`players-view-${mode}-btn`}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className={cn(
                    "px-3 py-1.5 capitalize transition-colors",
                    index > 0 && "border-l border-border",
                    viewMode === mode
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted",
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
          )}
        />
      )}
    </main>
  );
}

// Wrap in Suspense — required by Next.js App Router when useSearchParams() is used
// in a client component, to allow static pre-rendering of the page shell.
export default function PlayersPage() {
  return (
    <Suspense
      fallback={
        <main className="max-w-screen-2xl mx-auto px-4 py-6 space-y-4">
          <div className="space-y-3 animate-pulse">
            <div className="h-8 w-48 bg-muted rounded" />
            <div className="h-10 bg-muted rounded-lg" />
            <div className="h-64 bg-muted rounded-lg" />
          </div>
        </main>
      }
    >
      <PlayersPageContent />
    </Suspense>
  );
}
