"use client";

/**
 * FlagCard — one open flag in the swipe deck (#166).
 *
 * Front: the player, both tiers, the tier now, the reason, one line of
 * Claude's reason, and the first threshold rows. A tap flips it to the full
 * reason and every threshold row.
 *
 * Swipe: left = Stats, right = Claude, up = Skip. The dock's buttons call
 * `fling()` so a tap and a swipe leave the same way through one code path.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SkillTierBadge } from "@/components/SkillTierBadge";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { ConditionBreakdown, fmtValue } from "@/components/ConditionBreakdown";
import { ReasonChip } from "@/components/ReasonChip";
import { formatReason, reasonKind } from "@/lib/flag-reasons";
import { formatSkillName } from "@/lib/skills";
import { getStatLabel } from "@/lib/stat-keys";
import type { ConditionResult, SkillTier } from "@/lib/types";
import { frontRows, THRESHOLD_ROWS_ON_FRONT, type DeckCard } from "../_lib/deck";

export type SwipeDirection = "left" | "right" | "up";

/** A move shorter than this is a tap, not a drag. */
const TAP_SLOP_PX = 8;
/** Share of the card's width (or height, going up) a drag must travel to count. */
const SWIPE_DISTANCE_RATIO = 0.3;
/** Card leaves the screen over this long. */
const FLING_MS = 200;

export interface FlagCardHandle {
  /** Send the card off in `dir`, then report it — the dock's buttons use this. */
  fling: (dir: SwipeDirection) => void;
  /** True from the start of a fling until the card is gone. */
  isLeaving: () => boolean;
}

interface FlagCardProps {
  card: DeckCard;
  /** undefined = loading, "error" = the breakdown request failed */
  breakdown: ConditionResult[] | "error" | undefined;
  /** Which directions may leave; a blocked drag springs back. */
  allowed: Record<SwipeDirection, boolean>;
  /** The card must be flipped before it takes an answer (a disputed call). */
  lockedUntilFlip: boolean;
  onLeave: (dir: SwipeDirection) => void;
  onFlip: () => void;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function Tier({ tier }: { tier: string | null }) {
  return tier ? (
    <SkillTierBadge tier={tier as SkillTier} size="lg" />
  ) : (
    <span className="text-sm text-muted-foreground">no tier</span>
  );
}

export const FlagCard = forwardRef<FlagCardHandle, FlagCardProps>(function FlagCard(
  { card, breakdown, allowed, lockedUntilFlip, onLeave, onFlip },
  ref
) {
  const { flag } = card;
  const [flipped, setFlipped] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [phase, setPhase] = useState<"rest" | "drag" | "fling">("rest");
  const cardRef = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const leaving = useRef<SwipeDirection | null>(null);
  const flingTimer = useRef<number | null>(null);

  // A card that unmounts mid-fling (deck switch, back link) must not answer.
  useEffect(() => () => {
    if (flingTimer.current != null) window.clearTimeout(flingTimer.current);
  }, []);

  const fling = (dir: SwipeDirection) => {
    // One exit per card, and only in a direction that may answer: buttons and
    // swipes share this guard.
    if (leaving.current || !allowed[dir]) return;
    leaving.current = dir;
    if (prefersReducedMotion()) {
      onLeave(dir);
      return;
    }
    const box = cardRef.current?.getBoundingClientRect();
    const w = (box?.width ?? 360) * 1.4;
    const h = (box?.height ?? 600) * 1.2;
    setPhase("fling");
    setOffset(dir === "up" ? { x: 0, y: -h } : { x: dir === "left" ? -w : w, y: 0 });
    flingTimer.current = window.setTimeout(() => onLeave(dir), FLING_MS);
  };

  useImperativeHandle(ref, () => ({ fling, isLeaving: () => leaving.current != null }));

  const flip = () => {
    setFlipped((f) => !f);
    onFlip();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (leaving.current || (e.target as HTMLElement).closest("a, button")) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
    setPhase("drag");
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!start.current || start.current.id !== e.pointerId) return;
    setOffset({ x: e.clientX - start.current.x, y: Math.min(0, e.clientY - start.current.y) });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!start.current || start.current.id !== e.pointerId) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    start.current = null;
    setPhase("rest");

    if (Math.hypot(dx, dy) < TAP_SLOP_PX) {
      setOffset({ x: 0, y: 0 });
      flip();
      return;
    }
    const box = e.currentTarget.getBoundingClientRect();
    const dir: SwipeDirection | null =
      Math.abs(dx) >= Math.abs(dy)
        ? Math.abs(dx) > box.width * SWIPE_DISTANCE_RATIO ? (dx < 0 ? "left" : "right") : null
        : -dy > box.height * SWIPE_DISTANCE_RATIO ? "up" : null;

    if (dir && allowed[dir]) fling(dir);
    else setOffset({ x: 0, y: 0 }); // springs back: too short, or an answer this card cannot take
  };

  const onPointerCancel = () => {
    start.current = null;
    setPhase("rest");
    setOffset({ x: 0, y: 0 });
  };

  // Which answer the drag is heading for, so the target tier box lights up.
  const leaning: SwipeDirection | null =
    phase === "drag" && Math.abs(offset.x) > TAP_SLOP_PX * 2 && Math.abs(offset.x) >= -offset.y
      ? offset.x < 0 ? "left" : "right"
      : null;

  const rows = Array.isArray(breakdown) ? frontRows(breakdown) : [];
  const hiddenRows = Array.isArray(breakdown) ? breakdown.length - rows.length : 0;
  const meta = [
    card.team,
    card.position,
    card.games_played != null ? `${card.games_played} GP` : null,
    card.minutes_per_game != null ? `${card.minutes_per_game.toFixed(1)} MPG` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div
      ref={cardRef}
      id="flag-card"
      data-flag-id={flag.id}
      data-face={flipped ? "back" : "front"}
      role="group"
      aria-roledescription="flag card"
      aria-label={`${card.player_name}, ${formatSkillName(flag.skill_name)}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      style={{
        transform: `translate(${offset.x}px, ${offset.y}px) rotate(${offset.x / 24}deg)`,
        opacity: phase === "fling" ? 0 : 1,
        transition:
          phase === "drag"
            ? "none"
            : `transform ${FLING_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${FLING_MS}ms ease-out`,
      }}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        if ((e.target as HTMLElement) !== e.currentTarget) return;
        e.preventDefault();
        flip();
      }}
      className={cn(
        "relative flex h-full select-none flex-col overflow-hidden rounded-[6px] border border-border bg-card",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        // The back scrolls vertically; left/right drags still reach the card.
        flipped ? "touch-pan-y" : "touch-none"
      )}
    >
      {!flipped ? (
        <div id="flag-card-front" className="flex min-h-0 flex-1 flex-col px-4 pt-4 pb-3">
          <div id="card-player" className="flex items-center gap-3">
            <PlayerHeadshot nba_api_id={card.nba_api_id ?? null} size={52} name={card.player_name} />
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-foreground">{card.player_name}</p>
              {meta && <p className="font-mono text-xs tabular-nums text-muted-foreground">{meta}</p>}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 id="card-skill" className="font-display text-xl font-semibold tracking-[-0.01em] text-foreground">
              {formatSkillName(flag.skill_name)}
            </h2>
            <ReasonChip
              id="card-reason"
              kind={reasonKind(flag.flag_reason ?? "")}
              label={formatReason(flag.flag_reason ?? "")}
            />
          </div>

          <div id="card-tiers" className="mt-3 grid grid-cols-2 gap-2">
            <div
              id="card-stats-tier"
              className={cn(
                "flex items-center justify-between gap-1.5 rounded-[4px] border px-2 py-2 transition-colors",
                leaning === "left" ? "border-foreground bg-muted/50" : "border-border"
              )}
            >
              <span className="whitespace-nowrap text-xs text-muted-foreground">← Stats</span>
              <Tier tier={flag.stat_rating} />
            </div>
            <div
              id="card-claude-tier"
              className={cn(
                "flex items-center justify-between gap-1.5 rounded-[4px] border px-2 py-2 transition-colors",
                leaning === "right" && allowed.right ? "border-foreground bg-muted/50" : "border-border"
              )}
            >
              <Tier tier={flag.claude_tier} />
              <span className="whitespace-nowrap text-xs text-muted-foreground">Claude →</span>
            </div>
          </div>
          <p id="card-tier-now" className="mt-1.5 text-center text-xs text-muted-foreground">
            Tier now: <span className="font-medium text-foreground">{flag.tier_now ?? "—"}</span>
          </p>

          <div id="card-thresholds" className="mt-3 border-t border-border pt-2">
            <p className="text-xs text-muted-foreground">Stats vs thresholds</p>
            {breakdown === undefined ? (
              <div className="mt-1.5 space-y-1.5" aria-hidden>
                {Array.from({ length: THRESHOLD_ROWS_ON_FRONT }).map((_, i) => (
                  <div key={i} className="h-4 animate-pulse rounded-[2px] bg-muted" />
                ))}
              </div>
            ) : breakdown === "error" ? (
              <p className="mt-1 text-xs text-muted-foreground">Could not load the thresholds.</p>
            ) : rows.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">No threshold rows for this Skill.</p>
            ) : (
              <table className="mt-1 w-full table-fixed font-mono text-xs tabular-nums">
                <thead className="sr-only">
                  <tr><th>Stat</th><th>His</th><th>Needs</th></tr>
                </thead>
                <tbody>
                  {rows.map((c, i) => (
                    <tr key={i} className="h-5">
                      <td className="truncate pr-2 font-sans text-foreground" title={getStatLabel(c.stat)}>
                        {getStatLabel(c.stat).split(" › ").pop()}
                      </td>
                      <td className={cn("w-12 text-right", c.passed === false ? "text-destructive" : "text-foreground")}>
                        {fmtValue(c, c.actual_value)}
                      </td>
                      <td className="w-[4.25rem] text-right text-muted-foreground">
                        {c.operator} {fmtValue(c, c.threshold)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {hiddenRows > 0 && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">+{hiddenRows} more on the back</p>
            )}
          </div>

          {flag.claude_justification && (
            <p id="card-claude-line" className="mt-2 line-clamp-2 shrink-0 text-sm text-muted-foreground">
              <span className="text-foreground">Claude:</span> {flag.claude_justification}
            </p>
          )}

          {lockedUntilFlip && (
            <p
              id="card-lock-note"
              className="mt-2 rounded-[4px] border border-primary/60 bg-primary/15 px-2.5 py-1.5 text-xs text-foreground"
            >
              This disputes a tier you set. Flip it and read Claude&apos;s reason before you call it.
            </p>
          )}

          <p id="card-flip-hint" className="mt-auto shrink-0 pt-2 text-center text-xs text-muted-foreground">
            Tap the card for the full reason
          </p>
        </div>
      ) : (
        <div id="flag-card-back" className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pt-4 pb-3">
          <p className="text-base font-semibold text-foreground">
            {card.player_name} · {formatSkillName(flag.skill_name)}
          </p>
          {meta && <p className="font-mono text-xs tabular-nums text-muted-foreground">{meta}</p>}

          <p className="mt-4 text-xs text-muted-foreground">Claude&apos;s reason</p>
          <p id="card-back-claude" className="mt-1 text-sm leading-relaxed text-foreground">
            {flag.claude_justification ?? "Claude gave no reason for this Skill."}
          </p>

          <div id="card-back-thresholds" className="mt-3">
            {Array.isArray(breakdown) ? (
              <ConditionBreakdown conditions={breakdown} forceOpen />
            ) : (
              <p className="text-xs text-muted-foreground">
                {breakdown === "error" ? "Could not load the thresholds." : "Loading the thresholds…"}
              </p>
            )}
          </div>

          <Link
            id="card-player-link"
            href={`/admin/review/${card.player_id}?skill=${flag.skill_name}`}
            className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-foreground underline underline-offset-4 hover:text-primary"
          >
            Open the player page →
          </Link>
          <p className="text-xs text-muted-foreground">All Skills, overrides for Skills with no flag, and Delete live there.</p>

          <p className="mt-auto pt-3 text-center text-xs text-muted-foreground">Tap to flip back · swipe left or right here too</p>
        </div>
      )}
    </div>
  );
});
