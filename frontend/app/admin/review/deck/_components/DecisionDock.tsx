"use client";

/**
 * DecisionDock — the swipe deck's bottom panel (#166), in thumb reach.
 *
 * Every swipe has a button here (WCAG 2.5.1): Stats mirrors a left swipe,
 * Claude a right swipe, Skip an up swipe. The tier strip sets any tier in one
 * tap, and marks where Stats and Claude put the player.
 */

import { cn } from "@/lib/utils";
import { SKILL_TIERS, TIER_SELECTOR_STYLES, TIER_TEXT_CLASSES } from "@/lib/tiers";
import type { SkillTier } from "@/lib/types";
import type { DeckCard } from "../_lib/deck";

/** The strip has five slots on a 390px screen; the long tier gets a short label. */
const STRIP_LABEL: Record<SkillTier, string> = {
  "All-Time Great": "ATG",
  Elite:            "Elite",
  Proficient:       "Prof",
  Capable:          "Cap",
  None:             "None",
};

const MARK_LABEL = { yours: "your earlier tier", stats: "Stats's tier", claude: "Claude's tier" } as const;

export function tierSlug(tier: string): string {
  return tier.toLowerCase().replace(/[^a-z]+/g, "-");
}

interface DecisionDockProps {
  /** The card on top, or null when no card takes an answer (round end, deck end). */
  card: DeckCard | null;
  /** The card disputes Chris's own tier and has not been flipped yet. */
  locked: boolean;
  /** The tier Chris set before, on a card that disputes it — marked "yours". */
  yours: string | null;
  canUndo: boolean;
  onStats: () => void;
  onClaude: () => void;
  onTier: (tier: SkillTier) => void;
  onUndo: () => void;
  onSkip: () => void;
}

function TierWord({ tier }: { tier: string | null }) {
  return tier ? (
    <span className={cn("font-semibold", TIER_TEXT_CLASSES[tier as SkillTier])}>{tier}</span>
  ) : (
    <span className="font-normal text-muted-foreground">no tier</span>
  );
}

export function DecisionDock({ card, locked, yours, canUndo, onStats, onClaude, onTier, onUndo, onSkip }: DecisionDockProps) {
  const flag = card?.flag;
  const answerable = card != null && !locked;
  const statsTier = flag?.stat_rating ?? null;
  const claudeTier = flag?.claude_tier ?? null;

  return (
    <div
      id="decision-dock"
      className="border-t border-border bg-background px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
    >
      <div id="dock-sources" className="grid grid-cols-2 gap-2">
        {/* Same blue / purple as the player page's Trust buttons: one vocabulary across the review screens. */}
        <button
          id="trust-stats-btn"
          type="button"
          disabled={!answerable || !statsTier}
          onClick={onStats}
          className="min-h-12 rounded-[4px] border border-blue-200 bg-blue-50 px-2 text-sm font-medium text-blue-800 transition-colors hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {card ? <>◀ Stats · <TierWord tier={statsTier} /></> : "◀ Stats"}
        </button>
        <button
          id="trust-claude-btn"
          type="button"
          disabled={!answerable || !claudeTier}
          onClick={onClaude}
          className="min-h-12 rounded-[4px] border border-purple-200 bg-purple-50 px-2 text-sm font-medium text-purple-800 transition-colors hover:bg-purple-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {!card ? "Claude ▶" : claudeTier ? <>Claude · <TierWord tier={claudeTier} /> ▶</> : "Claude · no tier"}
        </button>
      </div>

      <p id="tier-strip-label" className="mt-2 mb-1 text-xs text-muted-foreground">Or set my own tier</p>
      <div id="tier-strip" role="group" aria-labelledby="tier-strip-label" className="grid grid-cols-5 gap-1.5">
        {SKILL_TIERS.map((tier) => {
          // "yours" first: on a disputed card, Chris's own earlier call is the one to see.
          const mark = tier === yours ? "yours" : tier === statsTier ? "stats" : tier === claudeTier ? "claude" : null;
          return (
            <button
              key={tier}
              id={`tier-strip-${tierSlug(tier)}`}
              type="button"
              disabled={!answerable}
              onClick={() => onTier(tier)}
              aria-label={`Set ${tier}${mark ? ` (${MARK_LABEL[mark]})` : ""}`}
              className={cn(
                "flex min-h-11 flex-col items-center justify-center rounded-[4px] border bg-background text-xs font-medium leading-tight transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40",
                TIER_SELECTOR_STYLES[tier].base
              )}
            >
              {STRIP_LABEL[tier]}
              {mark && <span className="font-mono text-[10px] font-normal opacity-80">{mark}</span>}
            </button>
          );
        })}
      </div>

      <div className="mt-1.5 grid grid-cols-2 gap-2">
        <button
          id="undo-btn"
          type="button"
          disabled={!canUndo}
          onClick={onUndo}
          className="min-h-11 rounded-[4px] border border-border bg-background text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Undo last
        </button>
        <button
          id="skip-btn"
          type="button"
          disabled={card == null}
          onClick={onSkip}
          className="min-h-11 rounded-[4px] border border-border bg-background text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Skip for later
        </button>
      </div>
    </div>
  );
}
