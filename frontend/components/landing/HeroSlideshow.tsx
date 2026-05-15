"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { getCommunityTeams, listRuleSets } from "@/lib/api";
import { teamLabelForSize } from "@/lib/builder-config";
import { cn } from "@/lib/utils";
import type { CommunityTeamEntry, CommunityTeamPlayer } from "@/lib/types";

/* ── Tunables ── */
const SLIDE_LIMIT = 6;
const ADVANCE_MS = 6000;
const PREVIEW_PLAYERS = 3;

/* ── Helpers ── */

function formatRuleSetName(slug: string): string {
  return (
    slug
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || slug
  );
}

function getInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function getShortName(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return name;
  return `${parts[0][0]}. ${parts[parts.length - 1]}`;
}

/** Order Cornerstone first, then by slot ascending. */
function orderPlayers(players: CommunityTeamPlayer[]): CommunityTeamPlayer[] {
  return [...players].sort((a, b) => {
    if (a.is_cornerstone && !b.is_cornerstone) return -1;
    if (!a.is_cornerstone && b.is_cornerstone) return 1;
    return a.slot - b.slot;
  });
}

/** Detect prefers-reduced-motion. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (event: MediaQueryListEvent) => setReduced(event.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}

/* ── Player preview (compact) ── */

function PlayerPreview({ player }: { player: CommunityTeamPlayer }) {
  const initials = getInitials(player.name);
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className={cn(
          "relative flex h-12 w-12 items-end justify-center overflow-hidden rounded-full border-2",
          player.is_cornerstone
            ? "border-[#fe6d34] bg-[#fff1e3]"
            : "border-[#0e0907]/15 bg-[#fff8f0]",
        )}
      >
        {player.nba_api_id ? (
          <Image
            src={`https://ak-static.cms.nba.com/wp-content/uploads/headshots/nba/latest/260x190/${player.nba_api_id}.png`}
            alt=""
            width={96}
            height={96}
            sizes="48px"
            unoptimized
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center font-mono text-[0.6875rem] font-semibold text-[#0e0907]/75">
            {initials}
          </span>
        )}
      </div>
      <span className="max-w-[5rem] truncate text-[0.6875rem] font-medium leading-none text-[#0e0907]/80">
        {getShortName(player.name)}
      </span>
    </div>
  );
}

/* ── Slide ── */

interface SlideProps {
  entry: CommunityTeamEntry;
  ruleSetLabel: string;
  active: boolean;
  index: number;
  total: number;
}

function Slide({ entry, ruleSetLabel, active, index, total }: SlideProps) {
  const ordered = useMemo(() => orderPlayers(entry.players), [entry.players]);
  const preview = ordered.slice(0, PREVIEW_PLAYERS);
  const extra = Math.max(0, ordered.length - preview.length);
  const teamLabel = entry.team_size ? teamLabelForSize(entry.team_size) : null;
  const score = entry.star_rating;

  return (
    <Link
      id={`hero-slideshow-slide-${entry.id}`}
      href={`/shared/${entry.id}`}
      role="group"
      aria-roledescription="slide"
      aria-label={`Slide ${index + 1} of ${total}: ${entry.name}`}
      aria-hidden={!active}
      tabIndex={active ? 0 : -1}
      className={cn(
        "group/slide block h-full rounded-lg border border-[#0e0907]/10 bg-[#fff8f0]/95 p-5 shadow-[0_1px_0_0_rgba(14,9,7,0.06),0_8px_24px_-12px_rgba(14,9,7,0.25)] backdrop-blur-sm transition-all duration-200",
        "hover:border-[#0e0907]/25 hover:shadow-[0_1px_0_0_rgba(14,9,7,0.08),0_12px_28px_-12px_rgba(14,9,7,0.35)]",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0e0907]",
      )}
    >
      {/* Header row: rank + score */}
      <div className="flex items-start justify-between gap-3">
        <span className="font-mono text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-[#0e0907]/55">
          #{index + 1} community pick
        </span>
        {score != null ? (
          <span
            className="inline-flex items-baseline gap-1 rounded-sm bg-[#0e0907] px-2 py-1 font-mono text-[0.8125rem] font-semibold tabular-nums leading-none text-[#ffa05c]"
            aria-label={`Score ${score.toFixed(1)} out of 5`}
          >
            {score.toFixed(1)}
            <span className="text-[0.625rem] font-normal text-[#ffa05c]/70">/ 5</span>
          </span>
        ) : (
          <span className="font-mono text-[0.75rem] text-[#0e0907]/50">unscored</span>
        )}
      </div>

      {/* Team name */}
      <h3
        id={`hero-slideshow-slide-${entry.id}-name`}
        className="mt-3 truncate font-display text-xl font-semibold leading-tight tracking-[-0.01em] text-[#0e0907]"
      >
        {entry.name}
      </h3>

      {/* Meta: Cornerstone / RuleSet */}
      <p className="mt-1 truncate text-[0.8125rem] leading-snug text-[#0e0907]/65">
        <span className="font-medium text-[#0e0907]/85">
          {entry.cornerstone_name !== "-" ? entry.cornerstone_name : "No Cornerstone"}
        </span>
        <span aria-hidden className="mx-1.5 text-[#0e0907]/30">·</span>
        {ruleSetLabel}
        {teamLabel && (
          <>
            <span aria-hidden className="mx-1.5 text-[#0e0907]/30">·</span>
            {teamLabel}
          </>
        )}
      </p>

      {/* Player preview */}
      <div className="mt-4 flex items-end gap-3">
        {preview.map((p) => (
          <PlayerPreview key={p.player_id ?? p.legend_id ?? `${p.slot}-${p.name}`} player={p} />
        ))}
        {extra > 0 && (
          <div className="flex flex-col items-center gap-1.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-dashed border-[#0e0907]/20 bg-transparent font-mono text-[0.75rem] font-medium text-[#0e0907]/55">
              +{extra}
            </div>
            <span className="text-[0.6875rem] text-[#0e0907]/55">more</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-5 flex items-center justify-between border-t border-[#0e0907]/10 pt-3">
        <span className="text-[0.75rem] text-[#0e0907]/60">View this Team</span>
        <span
          aria-hidden
          className="inline-flex items-center font-mono text-[0.75rem] font-medium text-[#0e0907] transition-transform duration-150 group-hover/slide:translate-x-0.5"
        >
          →
        </span>
      </div>
    </Link>
  );
}

/* ── Skeleton (loading state) ── */

function SlideSkeleton() {
  return (
    <div
      aria-hidden
      className="h-full rounded-lg border border-[#0e0907]/10 bg-[#fff8f0]/70 p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="h-3 w-24 rounded-sm bg-[#0e0907]/10" />
        <div className="h-6 w-14 rounded-sm bg-[#0e0907]/15" />
      </div>
      <div className="mt-3 h-6 w-3/4 rounded-sm bg-[#0e0907]/15" />
      <div className="mt-2 h-3 w-1/2 rounded-sm bg-[#0e0907]/10" />
      <div className="mt-5 flex gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <div className="h-12 w-12 rounded-full bg-[#0e0907]/10" />
            <div className="h-2 w-10 rounded-sm bg-[#0e0907]/10" />
          </div>
        ))}
      </div>
      <div className="mt-5 h-3 w-1/3 rounded-sm bg-[#0e0907]/10" />
    </div>
  );
}

/* ── Empty State ── */

function EmptyState() {
  return (
    <div
      id="hero-slideshow-empty"
      className="rounded-lg border border-dashed border-[#0e0907]/25 bg-[#fff8f0]/70 p-6 text-center"
    >
      <p className="font-display text-base font-semibold tracking-[-0.01em] text-[#0e0907]">
        No public Teams yet.
      </p>
      <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[#0e0907]/70">
        Be the first to build something and share it with the community.
      </p>
      <Link
        id="hero-slideshow-empty-cta"
        href="/lab"
        className="mt-4 inline-flex items-center rounded-md bg-[#0e0907] px-4 py-2 text-[0.8125rem] font-medium text-[#ffa05c] transition-colors duration-150 hover:bg-[#0e0907]/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0e0907]"
      >
        Build a Team
      </Link>
    </div>
  );
}

/* ── Main slideshow ── */

interface HeroSlideshowProps {
  className?: string;
}

export function HeroSlideshow({ className }: HeroSlideshowProps) {
  const [teams, setTeams] = useState<CommunityTeamEntry[]>([]);
  const [ruleSetNameMap, setRuleSetNameMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  /* Fetch top public Teams */
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [teamsRes, ruleSetsRes] = await Promise.all([
          getCommunityTeams({ sort: "score", page: 1, per_page: SLIDE_LIMIT }),
          listRuleSets(),
        ]);
        if (cancelled) return;
        if (teamsRes.success && teamsRes.data) {
          setTeams(teamsRes.data.teams);
        } else {
          setErrored(true);
        }
        if (ruleSetsRes.success && ruleSetsRes.data) {
          const map: Record<string, string> = {};
          for (const rs of ruleSetsRes.data) map[rs.slug] = rs.name;
          setRuleSetNameMap(map);
        }
      } catch {
        if (!cancelled) setErrored(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const total = teams.length;
  const shouldAutoAdvance =
    total > 1 && !paused && !hovered && !focused && !reducedMotion;

  /* Auto-advance */
  useEffect(() => {
    if (!shouldAutoAdvance) return;
    const id = window.setInterval(() => {
      setActive((prev) => (prev + 1) % total);
    }, ADVANCE_MS);
    return () => window.clearInterval(id);
  }, [shouldAutoAdvance, total]);

  /* Keep active index in range as data loads */
  useEffect(() => {
    if (total === 0) return;
    setActive((prev) => (prev >= total ? 0 : prev));
  }, [total]);

  const goPrev = useCallback(() => {
    if (total === 0) return;
    setActive((prev) => (prev - 1 + total) % total);
  }, [total]);

  const goNext = useCallback(() => {
    if (total === 0) return;
    setActive((prev) => (prev + 1) % total);
  }, [total]);

  const goTo = useCallback(
    (idx: number) => {
      if (total === 0) return;
      setActive(((idx % total) + total) % total);
    },
    [total],
  );

  /* Keyboard navigation when focus is inside the carousel */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrev();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      }
    },
    [goPrev, goNext],
  );

  /* States */
  if (loading) {
    return (
      <div
        id="hero-slideshow"
        className={cn("relative", className)}
        aria-busy="true"
        aria-live="polite"
      >
        <SlideSkeleton />
      </div>
    );
  }

  if (errored || total === 0) {
    // Error and Empty States share the same posture: graceful fallback CTA.
    return (
      <div id="hero-slideshow" className={cn("relative", className)}>
        <EmptyState />
      </div>
    );
  }

  const liveLabel = `Showing community Team ${active + 1} of ${total}`;

  return (
    <div
      id="hero-slideshow"
      ref={containerRef}
      role="region"
      aria-roledescription="carousel"
      aria-label="Top community Teams"
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocused(false);
        }
      }}
      className={cn("relative", className)}
    >
      {/* Screen-reader live region for slide changes */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {liveLabel}
      </span>

      {/* Slide stack — only the active slide is laid out; others stacked beneath for transition */}
      <div className="relative">
        {teams.map((entry, i) => {
          const isActive = i === active;
          return (
            <div
              key={entry.id}
              className={cn(
                "transition-opacity duration-300",
                isActive ? "relative opacity-100" : "pointer-events-none absolute inset-0 opacity-0",
              )}
            >
              <Slide
                entry={entry}
                ruleSetLabel={
                  ruleSetNameMap[entry.ruleset_slug] ?? formatRuleSetName(entry.ruleset_slug)
                }
                active={isActive}
                index={i}
                total={total}
              />
            </div>
          );
        })}
      </div>

      {/* Controls row */}
      {total > 1 && (
        <div className="mt-3 flex items-center justify-between gap-3">
          {/* Dots */}
          <div
            id="hero-slideshow-dots"
            role="tablist"
            aria-label="Choose community Team slide"
            className="flex items-center gap-1.5"
          >
            {teams.map((entry, i) => (
              <button
                key={entry.id}
                id={`hero-slideshow-dot-${i}`}
                type="button"
                role="tab"
                aria-selected={i === active}
                aria-label={`Go to slide ${i + 1}: ${entry.name}`}
                onClick={() => goTo(i)}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0e0907]",
                  i === active
                    ? "w-6 bg-[#0e0907]"
                    : "w-1.5 bg-[#0e0907]/25 hover:bg-[#0e0907]/45",
                )}
              />
            ))}
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-1">
            <button
              id="hero-slideshow-pause"
              type="button"
              onClick={() => setPaused((p) => !p)}
              aria-pressed={paused}
              aria-label={paused ? "Resume slideshow" : "Pause slideshow"}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#0e0907]/20 bg-[#fff8f0]/70 text-[#0e0907] transition-colors duration-150 hover:border-[#0e0907]/40 hover:bg-[#fff8f0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0e0907]"
            >
              {paused || reducedMotion ? (
                <Play className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Pause className="h-3.5 w-3.5" aria-hidden />
              )}
            </button>
            <button
              id="hero-slideshow-prev"
              type="button"
              onClick={goPrev}
              aria-label="Previous Team"
              aria-controls="hero-slideshow"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#0e0907]/20 bg-[#fff8f0]/70 text-[#0e0907] transition-colors duration-150 hover:border-[#0e0907]/40 hover:bg-[#fff8f0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0e0907]"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            <button
              id="hero-slideshow-next"
              type="button"
              onClick={goNext}
              aria-label="Next Team"
              aria-controls="hero-slideshow"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#0e0907]/20 bg-[#fff8f0]/70 text-[#0e0907] transition-colors duration-150 hover:border-[#0e0907]/40 hover:bg-[#fff8f0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0e0907]"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
