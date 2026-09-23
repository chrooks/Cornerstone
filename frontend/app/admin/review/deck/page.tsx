"use client";

/**
 * /admin/review/deck?skill=<skill_name> — the swipe deck (#166).
 *
 * One card per open flag on one Skill, across the league, built for one thumb
 * on a phone. ← Trust Stats · → Trust Claude · ↑ Skip, or one tap on a tier.
 *
 * A call is held in the browser for UNDO_WINDOW_MS before it is written: the
 * server cannot reopen a resolved flag, so undo only exists before the write.
 * The held call is sent early when the next call is made, when the deck
 * unmounts (back link, deck switch), or when the page is hidden.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { getReviewQueue, getSkillBreakdown, resolveFlag, resolveFlagNow } from "@/lib/api";
import { getAccessToken } from "@/lib/supabase/client";
import { ALL_SKILL_NAMES, formatSkillName } from "@/lib/skills";
import type { ConditionResult, SkillTier } from "@/lib/types";
import { FlagCard, type FlagCardHandle, type SwipeDirection } from "./_components/FlagCard";
import { DecisionDock } from "./_components/DecisionDock";
import {
  ROUND_SIZE,
  UNDO_WINDOW_MS,
  UNSAVED_KEY,
  describeCall,
  describeSaveError,
  describeUnsaved,
  needsFlipFirst,
  noteUnsaved,
  takeUnsaved,
  orderDeck,
  roundSplit,
  yourTier,
  type DeckAnswer,
  type DeckCall,
  type DeckCard,
  type DeckStep,
} from "./_lib/deck";

/** Breakdowns fetched ahead of the top card, so a card never waits for its rows. */
const PREFETCH_CARDS = 3;
/** After an answer, the dock ignores taps this long: a double tap never answers the next card. */
const SETTLE_MS = 250;
/** After a failed save puts a card back on top, taps wait this long: the thumb may already be moving. */
const RETURN_SETTLE_MS = 500;


const SPLIT_LABELS: [keyof ReturnType<typeof roundSplit>, string][] = [
  ["trust_stats", "Stats"],
  ["trust_claude", "Claude"],
  ["manual_override", "My tier"],
  ["skip", "Skipped"],
];

function SkillPicker({ value }: { value: string | null }) {
  const router = useRouter();
  return (
    <label className="flex min-w-0 items-center">
      <span className="sr-only">Deck</span>
      <select
        id="deck-picker"
        value={value ?? ""}
        onChange={(e) => router.push(`/admin/review/deck?skill=${e.target.value}`)}
        className="min-h-11 min-w-0 max-w-[15rem] truncate rounded-[4px] border border-border bg-background px-2.5 text-sm font-medium text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {value == null && <option value="" disabled>Pick a Skill…</option>}
        {ALL_SKILL_NAMES.map((s) => (
          <option key={s} value={s}>
            {formatSkillName(s)}
          </option>
        ))}
      </select>
    </label>
  );
}

function openPicker() {
  const el = document.getElementById("deck-picker") as HTMLSelectElement | null;
  el?.focus();
  try {
    el?.showPicker?.();
  } catch {
    // showPicker needs a user gesture and support; focus alone still works
  }
}

export default function DeckPage() {
  const raw = useSearchParams().get("skill") ?? "";
  const skill = ALL_SKILL_NAMES.includes(raw) ? raw : null;

  // The deck owns the whole screen under the NavBar (h-12 plus its 1px bottom
  // border): no page scroll, and no pull-to-refresh stealing a downward drag.
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.overscrollBehavior;
    root.style.overscrollBehavior = "none";
    return () => {
      root.style.overscrollBehavior = before;
    };
  }, []);

  return (
    <main
      id="review-deck-page"
      className="mx-auto flex h-[calc(100dvh-3rem-1px)] max-w-md flex-col overflow-hidden"
    >
      {skill ? <Deck key={skill} skill={skill} /> : <NoSkill />}
    </main>
  );
}

/** Empty State: no Skill chosen. It teaches the deck before it starts. */
function NoSkill() {
  return (
    <>
      <header id="deck-header" className="flex items-center justify-between gap-3 border-b border-border px-4 py-1.5">
        <Link id="deck-back-link" href="/admin/review" className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground">
          ‹ Queue
        </Link>
        <SkillPicker value={null} />
      </header>
      <section id="deck-no-skill" className="flex flex-1 flex-col justify-center px-6 pb-16">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.01em] text-foreground text-balance">
          Pick a Skill to start a deck
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          A deck is every open flag on one Skill, one card at a time. Swipe left to keep the Stats tier, right to keep
          Claude&apos;s, up to skip — or tap a tier to set your own. You have five seconds to undo each call.
        </p>
        <button
          id="deck-no-skill-pick-btn"
          type="button"
          onClick={openPicker}
          className="mt-5 min-h-11 self-start rounded-[4px] bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-[#fe6d34] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          Choose a Skill
        </button>
      </section>
    </>
  );
}

function Deck({ skill }: { skill: string }) {
  const skillLabel = formatSkillName(skill);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cards, setCards] = useState<DeckCard[]>([]); // top card first
  const [total, setTotal] = useState(0);
  const [steps, setSteps] = useState<DeckStep[]>([]);
  const [skipped, setSkipped] = useState<DeckCard[]>([]);
  const [held, setHeld] = useState<DeckCall | null>(null);
  const [roundSeen, setRoundSeen] = useState(0); // the last round whose summary was dismissed
  const [flippedIds, setFlippedIds] = useState<ReadonlySet<string>>(new Set());
  const [saveError, setSaveError] = useState<{ text: string; reload: boolean } | null>(null);
  const [breakdowns, setBreakdowns] = useState<Record<string, ConditionResult[] | "error">>({});

  const heldRef = useRef<DeckCall | null>(null);
  const timerRef = useRef<number | null>(null);
  const mounted = useRef(true);
  const requested = useRef(new Set<string>());
  const cardRef = useRef<FlagCardHandle>(null);
  const settleUntil = useRef(0);
  // Read ahead of time: the held call must reach fetch() with no await in
  // between, or a closing tab can drop it before keepalive applies.
  const tokenRef = useRef<string | null>(null);
  const refreshToken = useCallback(() => {
    getAccessToken()
      .then((t) => {
        tokenRef.current = t;
      })
      .catch(() => {
        tokenRef.current = null;
      });
  }, []);

  const load = useCallback(async () => {
    setStatus("loading");
    const res = await getReviewQueue({ skill_name: skill }).catch(() => null);
    if (!mounted.current) return;
    if (res?.success && res.data) {
      const deck = orderDeck(res.data);
      setCards(deck);
      setTotal(deck.length);
      setStatus("ready");
    } else {
      setLoadError(res?.error ?? "The deck did not load. Check the connection.");
      setStatus("error");
    }
  }, [skill]);

  useEffect(() => {
    mounted.current = true;
    refreshToken();
    load();
  }, [load, refreshToken]);

  // A call from a closed deck can fail after this one opened: show it now.
  useEffect(() => {
    const show = () => {
      const text = describeUnsaved(takeUnsaved());
      if (text) setSaveError({ text, reload: false });
    };
    show();
    window.addEventListener(UNSAVED_KEY, show);
    return () => window.removeEventListener(UNSAVED_KEY, show);
  }, []);

  /**
   * Write one call. A failure puts the card back on top and says why; a
   * failure after the deck closed is noted for the next visit.
   */
  const send = useCallback(async (call: DeckCall) => {
    const params = {
      skill_name:     call.card.flag.skill_name,
      resolution:     call.answer,
      resolved_value: call.answer === "manual_override" ? call.tier : null,
      flag_id:        call.card.flag.id, // the exact flag the card showed
    };
    const token = tokenRef.current;
    let res = await (token
      ? resolveFlagNow(call.card.player_id, params, token)
      : resolveFlag(call.card.player_id, params)
    ).catch(() => null);
    if (res?.error === "Token expired" && mounted.current) {
      // The pre-read token aged out (a long idle); apiFetch reads a fresh one.
      res = await resolveFlag(call.card.player_id, params).catch(() => null);
    }
    if (res?.success) return;

    const { message, keepCard, reload } = describeSaveError(res?.error);
    if (!mounted.current) {
      noteUnsaved(`${call.card.player_name} (${describeCall(call)}): ${message}`);
      return;
    }
    setSteps((s) => s.filter((step) => step !== call));
    if (keepCard) {
      settleUntil.current = performance.now() + RETURN_SETTLE_MS;
      setCards((c) => [call.card, ...c]);
    } else {
      setTotal((t) => t - 1);
    }
    setSaveError({ text: `${call.card.player_name}: ${message}`, reload });
  }, []);

  /** Send the held call now, if there is one. */
  const flush = useCallback(() => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    const call = heldRef.current;
    if (!call) return;
    heldRef.current = null;
    if (mounted.current) setHeld(null);
    void send(call);
  }, [send]);

  // Leaving the deck or hiding the page must not lose a held call. pagehide
  // sends whatever the visibility says: older WebKit fires it while "visible".
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      mounted.current = false;
      flush();
    };
  }, [flush]);

  // Fetch the thresholds for the next few cards before they reach the top.
  useEffect(() => {
    for (const card of cards.slice(0, PREFETCH_CARDS)) {
      const pid = card.player_id;
      if (requested.current.has(pid)) continue;
      requested.current.add(pid);
      getSkillBreakdown(pid, skill)
        .then((res) => res.success && res.data ? res.data.condition_results : ("error" as const))
        .catch(() => "error" as const)
        .then((rows) => {
          if (mounted.current) setBreakdowns((b) => ({ ...b, [pid]: rows }));
        });
    }
  }, [cards, skill]);

  const call = (card: DeckCard, answer: DeckAnswer, tier: string) => {
    if (heldRef.current?.card.flag.id === card.flag.id) return; // one answer per card
    flush(); // the previous call is final once the next one is made
    refreshToken();
    settleUntil.current = performance.now() + SETTLE_MS;
    const next: DeckCall = { card, answer, tier };
    heldRef.current = next;
    setHeld(next);
    timerRef.current = window.setTimeout(() => flush(), UNDO_WINDOW_MS);
    setSteps((s) => [...s, next]);
    setCards((c) => c.filter((x) => x.flag.id !== card.flag.id));
    setSaveError(null);
  };

  const skip = (card: DeckCard) => {
    if (heldRef.current?.card.flag.id === card.flag.id) return; // answered, not skipped
    settleUntil.current = performance.now() + SETTLE_MS;
    setSteps((s) => [...s, { card, answer: "skip" }]);
    setSkipped((s) => [...s, card]);
    setCards((c) => c.filter((x) => x.flag.id !== card.flag.id));
  };

  const handleLeave = (card: DeckCard, dir: SwipeDirection) => {
    if (dir === "up") skip(card);
    else if (dir === "left" && card.flag.stat_rating) call(card, "trust_stats", card.flag.stat_rating);
    else if (dir === "right" && card.flag.claude_tier) call(card, "trust_claude", card.flag.claude_tier);
  };

  const undo = () => {
    const last = heldRef.current;
    if (!last) return;
    settleUntil.current = performance.now() + SETTLE_MS;
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    heldRef.current = null;
    setHeld(null);
    setSteps((s) => s.filter((step) => step !== last));
    setCards((c) => [last.card, ...c]);
  };

  const reviewSkipped = () => {
    setCards((c) => [...c, ...skipped]);
    setSkipped([]);
    setRoundSeen(Math.floor(calls / ROUND_SIZE));
  };

  /** A dock tap counts only when no card is leaving and the last answer has settled. */
  const dockReady = () => !cardRef.current?.isLeaving() && performance.now() >= settleUntil.current;

  const calls = steps.filter((s) => s.answer !== "skip").length;
  const top = cards[0] ?? null;
  // By round number, not call count: a failed save that drops `calls` back
  // below a boundary must not hide that round's summary for good.
  const roundDone = calls > 0 && calls % ROUND_SIZE === 0 && calls / ROUND_SIZE > roundSeen && cards.length > 0;
  const deckDone = status === "ready" && cards.length === 0;
  const round = Math.floor(calls / ROUND_SIZE) + (roundDone ? 0 : 1);
  const cardInRound = (calls % ROUND_SIZE) + 1;
  const locked = top != null && needsFlipFirst(top) && !flippedIds.has(top.flag.id);
  const showCard = status === "ready" && top != null && !roundDone;

  return (
    <>
      <header id="deck-header" className="border-b border-border px-4 pt-1.5 pb-2.5">
        <div className="flex items-center justify-between gap-3">
          <Link
            id="deck-back-link"
            href={`/admin/review?skill=${skill}`}
            className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground"
          >
            ‹ Queue
          </Link>
          <SkillPicker value={skill} />
        </div>
        <div id="deck-progress" className="mt-1">
          <div
            role="progressbar"
            aria-label="Flags settled in this deck"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={calls}
            className="h-1.5 overflow-hidden rounded-[2px] bg-muted"
          >
            <div
              className="h-full origin-left bg-primary transition-transform duration-200 ease-out motion-reduce:transition-none"
              style={{ transform: `scaleX(${total > 0 ? calls / total : 0})` }}
            />
          </div>
          <div className="mt-1 flex justify-between font-mono text-xs tabular-nums text-muted-foreground">
            <span id="deck-round">{status === "ready" && !deckDone ? `Round ${round} · card ${roundDone ? ROUND_SIZE : cardInRound} of ${ROUND_SIZE}` : " "}</span>
            <span id="deck-done-count">{status === "ready" ? `${calls} / ${total} done` : " "}</span>
          </div>
        </div>
      </header>

      <div id="deck-stage" className="relative min-h-0 flex-1 px-5 pt-3 pb-3">
        {status === "loading" && (
          <div aria-label="Loading the deck" className="h-full animate-pulse rounded-[6px] border border-border bg-muted/60" />
        )}

        {status === "error" && (
          <div id="deck-load-error" role="alert" className="flex h-full flex-col items-start justify-center gap-3 px-1">
            <p className="text-base font-semibold text-foreground">The {skillLabel} deck did not load.</p>
            <p className="text-sm text-muted-foreground">{loadError}</p>
            <button
              id="deck-retry-btn"
              type="button"
              onClick={load}
              className="min-h-11 rounded-[4px] bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-[#fe6d34] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              Try again
            </button>
          </div>
        )}

        {showCard && (
          <>
            {cards[1] && (
              <div
                id="card-next"
                aria-hidden
                className="absolute inset-x-8 top-6 bottom-0 rounded-[6px] border border-border bg-card/70"
              />
            )}
            <div key={top.flag.id} className="deck-card-in relative h-full">
              <FlagCard
                ref={cardRef}
                card={top}
                breakdown={breakdowns[top.player_id]}
                allowed={{
                  left:  !locked && top.flag.stat_rating != null,
                  right: !locked && top.flag.claude_tier != null,
                  up:    true,
                }}
                lockedUntilFlip={locked}
                onLeave={(dir) => handleLeave(top, dir)}
                onFlip={() => setFlippedIds((s) => new Set(s).add(top.flag.id))}
              />
            </div>
          </>
        )}

        {status === "ready" && roundDone && (
          <RoundEnd
            round={calls / ROUND_SIZE}
            left={cards.length + skipped.length}
            split={roundSplit(steps, calls / ROUND_SIZE)}
            skippedCount={skipped.length}
            onNext={() => setRoundSeen(calls / ROUND_SIZE)}
            onReviewSkipped={reviewSkipped}
          />
        )}

        {deckDone && (
          <section id="deck-empty" className="flex h-full flex-col justify-center rounded-[6px] border border-border bg-card px-6">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.01em] text-foreground text-balance">
              {skipped.length > 0 ? `${skillLabel}: ${skipped.length} skipped left` : `${skillLabel} is clear`}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {calls === 0 && skipped.length === 0
                ? "No open flags on this Skill."
                : `You settled ${calls} flag${calls === 1 ? "" : "s"} in this deck.`}
            </p>
            <div className="mt-5 grid gap-2">
              {skipped.length > 0 && (
                <button id="review-skipped-btn" type="button" onClick={reviewSkipped} className="min-h-11 rounded-[4px] bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-[#fe6d34] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
                  Review {skipped.length} skipped
                </button>
              )}
              <button id="switch-deck-btn" type="button" onClick={openPicker} className="min-h-11 rounded-[4px] border border-border bg-background px-5 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
                Switch deck
              </button>
            </div>
          </section>
        )}
      </div>

      <div id="deck-feedback-slot" className="flex min-h-11 items-center px-4 py-1">
        {held ? (
          <div id="undo-bar" role="status" className="flex w-full items-center justify-between gap-3 rounded-[4px] border border-border bg-card px-3 py-1">
            <p className="min-w-0 text-xs leading-tight">
              <span className="block truncate font-medium text-foreground">{held.card.player_name}</span>
              <span className="block truncate text-muted-foreground">{describeCall(held)}</span>
            </p>
            <button
              id="undo-bar-btn"
              type="button"
              onClick={undo}
              className="min-h-9 shrink-0 rounded-[4px] border border-foreground/30 px-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Undo
            </button>
          </div>
        ) : (
          <p id="gesture-legend" className={cn("flex w-full justify-between text-xs text-muted-foreground", !showCard && "invisible")}>
            <span>← Trust Stats</span>
            <span>↑ Skip</span>
            <span>Trust Claude →</span>
          </p>
        )}
      </div>

      {saveError && (
        <div id="deck-error" role="alert" className="mx-4 mb-1.5 flex items-start justify-between gap-3 rounded-[4px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <div className="min-w-0">
            <p>{saveError.text}</p>
            {saveError.reload && (
              <button
                id="deck-error-reload-btn"
                type="button"
                onClick={() => window.location.reload()}
                className="mt-1.5 min-h-9 rounded-[4px] border border-destructive/40 px-3 text-sm font-medium hover:bg-destructive/10"
              >
                Reload deck
              </button>
            )}
          </div>
          <button
            id="deck-error-dismiss-btn"
            type="button"
            aria-label="Dismiss"
            onClick={() => setSaveError(null)}
            className="-my-1 min-h-9 min-w-9 shrink-0 rounded-[4px] text-base leading-none hover:bg-destructive/10"
          >
            ✕
          </button>
        </div>
      )}

      <DecisionDock
        card={showCard ? top : null}
        locked={locked}
        yours={showCard && top ? yourTier(top) : null}
        canUndo={held != null}
        onStats={() => dockReady() && cardRef.current?.fling("left")}
        onClaude={() => dockReady() && cardRef.current?.fling("right")}
        onTier={(tier: SkillTier) => dockReady() && top && call(top, "manual_override", tier)}
        onUndo={undo}
        onSkip={() => dockReady() && cardRef.current?.fling("up")}
      />
    </>
  );
}

function RoundEnd({
  round,
  left,
  split,
  skippedCount,
  onNext,
  onReviewSkipped,
}: {
  round: number;
  left: number;
  split: ReturnType<typeof roundSplit>;
  skippedCount: number;
  onNext: () => void;
  onReviewSkipped: () => void;
}) {
  const most = Math.max(1, ...Object.values(split));
  return (
    <section id="round-end-card" className="deck-card-in flex h-full flex-col rounded-[6px] border border-border bg-card px-5 py-6">
      <h2 className="font-display text-2xl font-semibold tracking-[-0.01em] text-foreground">Round {round} done</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {ROUND_SIZE} flags settled · {left} left in this deck
      </p>

      <dl id="round-end-split" className="mt-5 grid grid-cols-[5.5rem_1fr_2rem] items-center gap-x-3 gap-y-2 text-sm">
        {SPLIT_LABELS.map(([key, label]) => (
          <div key={key} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="h-2 overflow-hidden rounded-[2px] bg-muted">
              <div className="h-full origin-left bg-foreground/70" style={{ transform: `scaleX(${split[key] / most})` }} />
            </dd>
            <dd className="text-right font-mono tabular-nums text-foreground">{split[key]}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-auto grid gap-2 pt-6">
        <button id="next-round-btn" type="button" onClick={onNext} className="min-h-11 rounded-[4px] bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-[#fe6d34] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
          Next round ›
        </button>
        <button id="switch-deck-btn" type="button" onClick={openPicker} className="min-h-11 rounded-[4px] border border-border bg-background px-5 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
          Switch deck
        </button>
        {skippedCount > 0 && (
          <button id="review-skipped-btn" type="button" onClick={onReviewSkipped} className="min-h-11 rounded-[4px] border border-border bg-background px-5 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
            Review {skippedCount} skipped
          </button>
        )}
      </div>
    </section>
  );
}
