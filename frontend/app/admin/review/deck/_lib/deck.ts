/**
 * Swipe deck (#166) — the pure parts: card order, round counting, and the
 * words the deck shows for a call and for a failed save.
 */

import { NO_OPEN_DRAFT_ERROR, type ReviewQueueEntry } from "@/lib/api";
import type { ConditionResult } from "@/lib/types";
import { REASON_KINDS, reasonKind } from "@/lib/flag-reasons";
import { formatSkillName } from "@/lib/skills";

/** How long a call waits in the browser before it is written — the undo window. */
export const UNDO_WINDOW_MS = 5000;
/** Calls per round; a short summary sits between rounds. */
export const ROUND_SIZE = 20;
/** Threshold rows on a card's front; the back shows every row. */
export const THRESHOLD_ROWS_ON_FRONT = 4;

export type DeckAnswer = "trust_stats" | "trust_claude" | "manual_override";

/** One card the deck can show — a queue row that carries its flag. */
export type DeckCard = ReviewQueueEntry & { flag: NonNullable<ReviewQueueEntry["flag"]> };

/** A call on a card: which answer, and the tier it writes. */
export interface DeckCall {
  card: DeckCard;
  answer: DeckAnswer;
  tier: string;
}

/** One step of a session, in order. Skips are steps but not calls. */
export type DeckStep = DeckCall | { card: DeckCard; answer: "skip" };

const REASON_ORDER = Object.keys(REASON_KINDS);

function reasonRank(card: DeckCard): number {
  const i = REASON_ORDER.indexOf(reasonKind(card.flag.flag_reason ?? ""));
  return i === -1 ? REASON_ORDER.length : i;
}

/**
 * The deck in play order: the reasons that need a person most come first
 * ("Contradicts your call" leads), then players by name.
 */
export function orderDeck(entries: ReviewQueueEntry[]): DeckCard[] {
  return entries
    .filter((e): e is DeckCard => e.flag != null)
    .sort(
      (a, b) =>
        reasonRank(a) - reasonRank(b) ||
        (a.player_name ?? "").localeCompare(b.player_name ?? "")
    );
}

/**
 * A card that disputes a tier Chris set by hand. It takes no answer until it
 * has been flipped once — Transparent Friction on the calls that deserve a read.
 */
export function needsFlipFirst(card: DeckCard): boolean {
  return (card.flag.flag_reason ?? "").startsWith("human_decision_contradicted");
}

const ANSWER_SOURCE: Record<DeckAnswer, string> = {
  trust_stats:     "Stats",
  trust_claude:    "Claude",
  manual_override: "your tier",
};

/** The undo bar's line: "On-ball defense → Proficient (Stats)". */
export function describeCall(call: DeckCall): string {
  return `${formatSkillName(call.card.flag.skill_name)} → ${call.tier} (${ANSWER_SOURCE[call.answer]})`;
}

export type RoundSplit = Record<DeckAnswer | "skip", number>;

/**
 * What happened in round `round` (1-based): the steps after the previous
 * round's last call, through this round's last call.
 */
export function roundSplit(steps: DeckStep[], round: number): RoundSplit {
  const split: RoundSplit = { trust_stats: 0, trust_claude: 0, manual_override: 0, skip: 0 };
  let calls = 0;
  for (const step of steps) {
    const inRound = calls >= (round - 1) * ROUND_SIZE && calls < round * ROUND_SIZE;
    if (step.answer !== "skip") calls += 1;
    if (inRound) split[step.answer] += 1;
  }
  return split;
}

/**
 * The rows a card's front has room for. A passed volume gate says nothing a
 * reviewer needs, so it gives its place to a tier condition.
 */
export function frontRows(conditions: ConditionResult[]): ConditionResult[] {
  return conditions
    .filter((c) => !(c.section === "volume_gate" && c.passed))
    .slice(0, THRESHOLD_ROWS_ON_FRONT);
}

export interface SaveError {
  message: string;
  /** Put the card back in the deck (false: the flag is gone or replaced). */
  keepCard: boolean;
  /** The deck is out of date: offer a reload. */
  reload: boolean;
}

/** The dock's "yours" mark: the tier a contradiction flag says Chris set ("…:resolved:Elite"). */
export function yourTier(card: DeckCard): string | null {
  return needsFlipFirst(card) ? (card.flag.flag_reason ?? "").split(":").at(-1) || null : null;
}

/**
 * A failed save, in plain words. `error` is the server's error string, or
 * null when the request never got an answer.
 */
export function describeSaveError(error: string | null | undefined): SaveError {
  const e = error ?? "";
  if (e === "flag_changed") {
    return {
      message: "This flag was resolved or replaced after the deck loaded, so nothing was written. Reload the deck to see what is open now.",
      keepCard: false,
      reload: true,
    };
  }
  if (e.startsWith("No Claude tier")) {
    return { message: "Claude has no tier for this Skill. Use Stats or pick a tier.", keepCard: true, reload: false };
  }
  if (e.startsWith("No unresolved flag")) {
    return { message: "This flag was already resolved somewhere else, so it left the deck.", keepCard: false, reload: false };
  }
  if (e === NO_OPEN_DRAFT_ERROR) {
    return { message: "No draft is open, so nothing can be resolved right now.", keepCard: true, reload: false };
  }
  if (e) return { message: `It did not save: ${e}`, keepCard: true, reload: false };
  return { message: "It did not save. Check the connection and try again.", keepCard: true, reload: false };
}

/**
 * Calls that failed after the deck closed. The deck (next visit, or the next
 * deck after a switch) and the review queue both show them, so a lost write
 * never goes unseen. Stored per tab in sessionStorage; an event tells a page
 * that is already open.
 */
export const UNSAVED_KEY = "review-deck-unsaved";

/** Read and clear the notes. */
export function takeUnsaved(): string[] {
  try {
    const raw = window.sessionStorage.getItem(UNSAVED_KEY);
    window.sessionStorage.removeItem(UNSAVED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return []; // storage blocked: nothing was saved there either
  }
}

export function noteUnsaved(line: string): void {
  try {
    const raw = window.sessionStorage.getItem(UNSAVED_KEY);
    const lines = raw ? (JSON.parse(raw) as string[]) : [];
    window.sessionStorage.setItem(UNSAVED_KEY, JSON.stringify([...lines, line]));
  } catch {
    // storage blocked: the flag is still open, so it returns to the deck anyway
  }
  window.dispatchEvent(new Event(UNSAVED_KEY));
}

/** One sentence for the notes, or null when there are none. */
export function describeUnsaved(lines: string[]): string | null {
  if (lines.length === 0) return null;
  return (
    `${lines.length === 1 ? "A deck call" : `${lines.length} deck calls`} did not save: ${lines.join("; ")}. ` +
    "The flags are still open."
  );
}
