"use client";

/**
 * ProofCardRotator — landing proof Surface that rotates real Skill Profiles.
 *
 * Pool: union of current Snapshot Release Players + Legends, fetched via
 * listPlayersWithSkills({ include_legends: true }). The component is the
 * editorial "show, don't tell" Surface for the landing Hero — it surfaces
 * real Players and Legends with real Skill Tier badges instead of mock copy.
 *
 * Motion intent: a slow cross-fade between curated subjects, not a carousel.
 * Pauses on hover/focus and disables auto-advance under prefers-reduced-motion.
 * On any error/empty pool the card falls back to a static Sample Player
 * Profile so the Hero never crashes.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { listPlayersWithSkills } from "@/lib/api";
import { SKILL_LABELS } from "@/lib/skills";
import { TIER_BADGE_CLASSES, tierToNum } from "@/lib/tiers";
import type { PlayerWithSkills, SkillTier } from "@/lib/types";

/** Portrait size in px — matches the Saved Team detail Surface (h-12 w-12). */
const PORTRAIT_SIZE = 48;

/* ── Tunables ── */
const ROTATE_MS = 5000;
const FADE_MS = 500;
const SKILLS_PER_CARD = 6;
/** Minimum MPG floor so we don't surface fringe rotation Players in the Hero. */
const MIN_MPG_FOR_PROOF = 20;

/* ── Reduced-motion detection (matches HeroSlideshow convention) ── */
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

/* ── Helpers ── */

/** Fisher-Yates shuffle for a single randomized rotation order per mount. */
function shuffle<T>(items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Pick the top N Skills by Skill Tier rank (highest first), stable by label. */
function topSkills(
  skills: Record<string, string> | null | undefined,
  limit: number,
): Array<{ key: string; label: string; tier: SkillTier }> {
  if (!skills) return [];
  const ranked = Object.entries(skills)
    .filter(([, tier]) => tier && tier !== "None")
    .map(([key, tier]) => ({
      key,
      label: SKILL_LABELS[key] ?? key,
      tier: tier as SkillTier,
    }))
    .sort((a, b) => {
      const diff = tierToNum(b.tier) - tierToNum(a.tier);
      if (diff !== 0) return diff;
      return a.label.localeCompare(b.label);
    });
  return ranked.slice(0, limit);
}

/** Format MPG / GP into a single short readout. */
function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

/** Build a sub-line like "Guard · 2024-25" or "Wing · Legend". */
function buildEraChip(player: PlayerWithSkills): string {
  const position = player.position?.trim() || "Player";
  if (player.is_legend) {
    if (player.peak_year) {
      const peakSeason = `${player.peak_year}-${String((player.peak_year + 1) % 100).padStart(2, "0")}`;
      return `${position} · Peak ${peakSeason}`;
    }
    return `${position} · Legend`;
  }
  return `${position} · ${player.season}`;
}

/** Decide whether a subject is suitable for the rotation (has real Skills). */
function isEligible(player: PlayerWithSkills): boolean {
  if (!player.skills) return false;
  const eliteCount = Object.values(player.skills).filter(
    (tier) => tier === "Elite" || tier === "All-Time Great",
  ).length;
  if (eliteCount === 0) return false;
  if (player.is_legend) return true;
  // For active Players, require a real rotation role.
  return (player.minutes_per_game ?? 0) >= MIN_MPG_FOR_PROOF;
}

/* ── Static fallback (matches original mock copy) ── */

const FALLBACK_SKILLS: Array<{ label: string; tier: SkillTier }> = [
  { label: "Isolation Scorer", tier: "Elite" },
  { label: "Off-Dribble Shooter", tier: "Proficient" },
  { label: "PnR Ball Handler", tier: "Elite" },
  { label: "Driver", tier: "All-Time Great" },
  { label: "Passer", tier: "Proficient" },
  { label: "Versatile Defender", tier: "Capable" },
  { label: "Perimeter Disruptor", tier: "Elite" },
  { label: "Defensive Rebounding", tier: "Capable" },
];

function FallbackCard() {
  return (
    <>
      <div className="flex items-center justify-between mb-5 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <PlayerHeadshot
            nba_api_id={null}
            name="Sample Player"
            size={PORTRAIT_SIZE}
          />
          <div className="min-w-0">
            <h3
              id="landing-proof-card-name"
              className="text-base font-semibold text-foreground"
            >
              Sample Player Profile
            </h3>
            <span className="text-xs text-muted-foreground">
              Guard &middot; 27.4 PPG &middot; 6.2 APG
            </span>
          </div>
        </div>
        <span className="font-mono text-xs text-muted-foreground tracking-wider">
          2024-25
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {FALLBACK_SKILLS.map((skill) => (
          <div
            key={skill.label}
            className="flex flex-col gap-1 p-2.5 rounded-md border border-border bg-background"
          >
            <span className="text-[0.6875rem] font-medium text-muted-foreground leading-tight">
              {skill.label}
            </span>
            <span
              className={`inline-flex self-start px-2 py-0.5 text-[0.6875rem] font-medium rounded-sm ${TIER_BADGE_CLASSES[skill.tier]}`}
            >
              {skill.tier}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          8 of 21 skills shown
        </span>
        <Link
          id="landing-proof-card-cta"
          href="/players"
          className="text-xs font-medium text-[#fe6d34] hover:text-[#fe6d34]/80 transition-colors"
        >
          Explore all profiles →
        </Link>
      </div>
    </>
  );
}

/* ── Live card ── */

interface LiveCardProps {
  player: PlayerWithSkills;
  fading: boolean;
}

function LiveCard({ player, fading }: LiveCardProps) {
  const skills = useMemo(
    () => topSkills(player.skills, SKILLS_PER_CARD),
    [player.skills],
  );
  const totalRated = useMemo(
    () =>
      player.skills
        ? Object.values(player.skills).filter((tier) => tier && tier !== "None")
            .length
        : 0,
    [player.skills],
  );
  const eraChip = buildEraChip(player);

  const subjectChip = player.is_legend ? "Legend" : "Current Snapshot";
  const subjectChipClass = player.is_legend
    ? "bg-violet-50 text-violet-700 border-violet-200"
    : "bg-[#fe6d34]/10 text-[#fe6d34] border-[#fe6d34]/30";

  return (
    <div
      className="transition-opacity"
      style={{
        opacity: fading ? 0 : 1,
        transitionDuration: `${FADE_MS}ms`,
      }}
    >
      <div className="flex items-center justify-between mb-5 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <PlayerHeadshot
            nba_api_id={player.nba_api_id ?? null}
            name={player.name}
            size={PORTRAIT_SIZE}
          />
          <div className="min-w-0">
            <h3
              id="landing-proof-card-name"
              className="text-base font-semibold text-foreground truncate"
            >
              {player.name}
            </h3>
            <span className="text-xs text-muted-foreground">{eraChip}</span>
          </div>
        </div>
        <span
          className={`font-mono text-[0.6875rem] tracking-[0.04em] uppercase px-2 py-0.5 rounded-sm border shrink-0 ${subjectChipClass}`}
        >
          {subjectChip}
        </span>
      </div>

      {/* Real stat readouts — MPG, GP, and rated-skill density. */}
      <div className="flex gap-6 mb-5">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[0.625rem] font-medium tracking-[0.04em] uppercase text-muted-foreground">
            MPG
          </span>
          <span className="font-mono text-sm tabular-nums text-foreground">
            {formatNumber(player.minutes_per_game)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[0.625rem] font-medium tracking-[0.04em] uppercase text-muted-foreground">
            GP
          </span>
          <span className="font-mono text-sm tabular-nums text-foreground">
            {player.games_played ?? "—"}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[0.625rem] font-medium tracking-[0.04em] uppercase text-muted-foreground">
            Skills Rated
          </span>
          <span className="font-mono text-sm tabular-nums text-foreground">
            {totalRated}/21
          </span>
        </div>
      </div>

      {/* Skill chips — real Skill Tier badge styling. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {skills.map((skill) => (
          <div
            key={skill.key}
            className="flex flex-col gap-1 p-2.5 rounded-md border border-border bg-background"
          >
            <span className="text-[0.6875rem] font-medium text-muted-foreground leading-tight">
              {skill.label}
            </span>
            <span
              className={`inline-flex self-start px-2 py-0.5 text-[0.6875rem] font-medium rounded-sm ${TIER_BADGE_CLASSES[skill.tier]}`}
            >
              {skill.tier}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {skills.length} of 21 skills shown
        </span>
        <Link
          id="landing-proof-card-cta"
          href={`/players/${player.id}`}
          className="text-xs font-medium text-[#fe6d34] hover:text-[#fe6d34]/80 transition-colors"
        >
          See full profile →
        </Link>
      </div>
    </div>
  );
}

/* ── Rotator (default export) ── */

export function ProofCardRotator() {
  const [pool, setPool] = useState<PlayerWithSkills[] | null>(null);
  const [errored, setErrored] = useState(false);
  const [index, setIndex] = useState(0);
  const [fading, setFading] = useState(false);
  const [paused, setPaused] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const cancelledRef = useRef(false);

  // Load Snapshot Players + Legends once per mount.
  useEffect(() => {
    cancelledRef.current = false;
    listPlayersWithSkills()
      .then((res) => {
        if (cancelledRef.current) return;
        if (!res.success || !res.data) {
          setErrored(true);
          return;
        }
        const eligible = res.data.filter(isEligible);
        if (eligible.length === 0) {
          setErrored(true);
          return;
        }
        setPool(shuffle(eligible));
      })
      .catch(() => {
        if (!cancelledRef.current) setErrored(true);
      });
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  // Auto-advance with fade. Skip entirely under reduced motion or while paused.
  useEffect(() => {
    if (!pool || pool.length <= 1) return;
    if (reducedMotion || paused) return;

    let swap: number | undefined;
    const tick = window.setTimeout(() => {
      setFading(true);
      swap = window.setTimeout(() => {
        setIndex((i) => (i + 1) % pool.length);
        setFading(false);
      }, FADE_MS);
    }, ROTATE_MS);

    return () => {
      window.clearTimeout(tick);
      if (swap !== undefined) window.clearTimeout(swap);
    };
  }, [pool, index, paused, reducedMotion]);

  const containerProps = {
    id: "landing-proof-card",
    className: "relative border border-border rounded-lg bg-card p-6",
    onMouseEnter: () => setPaused(true),
    onMouseLeave: () => setPaused(false),
    onFocusCapture: () => setPaused(true),
    onBlurCapture: () => setPaused(false),
  };

  if (errored || (pool && pool.length === 0)) {
    return (
      <div {...containerProps}>
        <FallbackCard />
      </div>
    );
  }

  if (!pool) {
    // Loading — render the fallback so layout stays stable and Hero never crashes.
    return (
      <div {...containerProps} aria-busy="true">
        <FallbackCard />
      </div>
    );
  }

  const player = pool[index];
  // Preload the next subject's portrait so the cross-fade swap never flashes.
  const nextPlayer = pool.length > 1 ? pool[(index + 1) % pool.length] : null;
  const nextHeadshotUrl = nextPlayer?.nba_api_id
    ? `https://ak-static.cms.nba.com/wp-content/uploads/headshots/nba/latest/260x190/${nextPlayer.nba_api_id}.png`
    : null;

  return (
    <div {...containerProps} aria-live="polite">
      <LiveCard player={player} fading={fading} />
      {nextHeadshotUrl && (
        // Warm the browser cache for the upcoming portrait. Hidden from a11y + layout.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={nextHeadshotUrl}
          alt=""
          aria-hidden="true"
          width={1}
          height={1}
          loading="eager"
          decoding="async"
          className="pointer-events-none absolute h-px w-px opacity-0"
        />
      )}
    </div>
  );
}
