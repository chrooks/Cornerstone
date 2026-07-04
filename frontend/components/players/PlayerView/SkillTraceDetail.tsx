import { Check, X as XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { getStatLabel } from "@/lib/stat-keys";
import { SkillTierBadge } from "@/components/SkillTierBadge";
import type { ConditionResult, SkillOverride, SkillTier } from "@/lib/types";

interface SkillTraceDetailProps {
  conditions: ConditionResult[];
  override: SkillOverride | null;
  /** The skill's actual final tier — used to highlight which gate the player
   * cleared. Tiers are checked hardest-first (a player who clears Elite never
   * has their Proficient/Capable gates evaluated), so this is the one section
   * whose pass/fail the badge above actually reflects. */
  finalTier: SkillTier;
}

const RESOLUTION_LABELS: Record<string, string> = {
  trust_stats: "Confirmed by the numbers",
  trust_claude: "Confirmed by review",
  manual_override: "Manually reviewed",
};

/** Hierarchy order matches the evaluator's own tier-checking order (hardest
 * first): backend/services/skill_engine/evaluator.py checks "all-time great"
 * → "elite" → "proficient" → "capable", stopping at the first one that
 * passes. Volume Gate is a prerequisite, not a tier; Tier Bump is a bonus
 * check after a tier is already assigned — neither is "harder" or "easier"
 * than the tier sections, so they're excluded from the above/below logic. */
const TIER_SECTION_ORDER = ["all-time great", "elite", "proficient", "capable"];
const SECTION_ORDER = ["volume_gate", ...TIER_SECTION_ORDER, "tier_bump"];

const SECTION_LABELS: Record<string, string> = {
  volume_gate: "Volume Gate",
  "all-time great": "All-Time Great",
  elite: "Elite",
  proficient: "Proficient",
  capable: "Capable",
  tier_bump: "Tier Bump",
};

/** Section key a given final tier corresponds to — "None" clears no tier
 * section, so nothing gets highlighted (only Volume Gate/individual
 * conditions explain a "None" result, and those still render normally). */
const TIER_TO_SECTION: Partial<Record<SkillTier, string>> = {
  "All-Time Great": "all-time great",
  Elite: "elite",
  Proficient: "proficient",
  Capable: "capable",
};

/** Light background wash per tier, reusing the same hue family as
 * SkillTierBadge (lib/tiers.ts) so "this section is tinted violet" and "the
 * Elite badge is emerald" stay part of one consistent tier vocabulary. */
const TIER_SECTION_TINT: Partial<Record<SkillTier, string>> = {
  "All-Time Great": "bg-violet-50 border-violet-200",
  Elite: "bg-emerald-50 border-emerald-200",
  Proficient: "bg-sky-50 border-sky-200",
  Capable: "bg-amber-50 border-amber-200",
};

/** Strip the "Section › " prefix getStatLabel adds — the section header
 * below already carries that context, so the row only needs the stat name. */
function shortLabel(rawStat: string): string {
  const full = getStatLabel(rawStat);
  const parts = full.split(" › ");
  return parts.length > 1 ? parts[parts.length - 1] : full;
}

/** Round to 3 decimal places and drop trailing zeros (4 stays "4", 6.8 stays
 * "6.8", 0.3409134063641106 becomes "0.341"). Raw backend floats are never
 * pre-rounded, so this is the only place display precision is decided. */
function fmtNumber(value: number | null): string {
  if (value === null) return "—";
  return String(Math.round(value * 1000) / 1000);
}

/**
 * How far past (or short of) the target the actual value is, normalized so
 * 1.0 always means "exactly at the threshold" and >1.0 always means "more
 * compliant" — regardless of whether the condition wants higher or lower.
 * ">="/">"  (higher is better): actual / threshold.
 * "<="/"<"  (lower is better):  threshold / actual — inverting the ratio is
 * what makes "over the cap" read as *below* 1.0 instead of a bigger number.
 * Returns null for "==" / "!=" (no meaningful "toward compliance" direction)
 * or when the math can't produce a finite ratio (e.g. dividing by zero).
 */
function complianceRatio(condition: ConditionResult): number | null {
  const { actual_value, threshold, operator } = condition;
  if (actual_value === null) return null;

  let ratio: number;
  if (operator === ">=" || operator === ">") {
    if (threshold === 0) return actual_value >= 0 ? 1 : 0;
    ratio = actual_value / threshold;
  } else if (operator === "<=" || operator === "<") {
    if (actual_value === 0) return threshold >= 0 ? 2 : 0;
    ratio = threshold / actual_value;
  } else {
    return null; // "==" / "!=" — a bar has no direction to show here
  }

  return Number.isFinite(ratio) ? ratio : null;
}

/** A bullet-style meter: a fixed reference line at "1.0 = target" (same
 * position on every row, so a reader can scan down the list and use
 * position as a shortcut), filling right of it when compliant and left of
 * it when not — so "more fill toward the good side" means the same thing
 * on every row, no matter which direction that condition's target points. */
function ConditionMeter({ condition }: { condition: ConditionResult }) {
  const ratio = complianceRatio(condition);
  const { passed } = condition;

  if (ratio === null) {
    return (
      <div
        id={`skill-trace-meter-${condition.stat}`}
        className="h-2 w-full rounded-sm bg-[#0e0907]/8"
      />
    );
  }

  const clamped = Math.min(2, Math.max(0, ratio));
  const positionPct = (clamped / 2) * 100; // 0 -> 0%, 1.0 (target) -> 50%, 2.0+ -> 100%
  const fillColor = passed === true ? "bg-emerald-600" : passed === false ? "bg-[#e53e3e]" : "bg-[#0e0907]/25";
  const widthPct = Math.abs(positionPct - 50);
  const onGoodSide = positionPct >= 50;

  // Anchor the fill's edge AT the center line and let the far edge grow
  // outward from there — a `min(3px, …)` floor keeps a razor-thin margin
  // (a value that just barely passed or failed) visible instead of
  // rendering as an invisible sliver, without ever bleeding across the
  // center line into the other side (which growing symmetrically would do).
  const edgeStyle = onGoodSide
    ? { left: "50%", width: `max(${widthPct}%, 3px)` }
    : { right: "50%", width: `max(${widthPct}%, 3px)` };

  return (
    <div
      id={`skill-trace-meter-${condition.stat}`}
      className="relative h-2 w-full rounded-sm bg-[#0e0907]/8"
      title={`Target: ${fmtNumber(condition.threshold)}`}
    >
      <div
        className={cn("absolute inset-y-0 rounded-sm transition-[width]", fillColor)}
        style={edgeStyle}
      />
      <div className="absolute inset-y-[-2px] left-1/2 w-px -translate-x-1/2 bg-[#0e0907]/45" />
    </div>
  );
}

const DIRECTIONAL_OPERATORS = new Set([">=", ">", "<=", "<"]);

function ConditionRow({ condition }: { condition: ConditionResult }) {
  const label = shortLabel(condition.stat);
  const showMeter = DIRECTIONAL_OPERATORS.has(condition.operator);
  const icon =
    condition.passed === true ? (
      <Check className="h-3 w-3 shrink-0 text-emerald-700" aria-label="Passed" />
    ) : condition.passed === false ? (
      <XIcon className="h-3 w-3 shrink-0 text-[#e53e3e]" aria-label="Did not pass" />
    ) : (
      <span className="h-3 w-3 shrink-0 text-center text-[10px] leading-3 text-[#0e0907]/35" aria-label="No data">
        ?
      </span>
    );

  return (
    <div id={`skill-trace-row-${condition.stat}`} className="flex flex-col gap-1.5 py-2">
      <div className="flex items-center gap-2">
        {icon}
        <span className="flex-1 truncate text-[12px] text-[#0e0907]/70" title={label}>
          {label}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-[#0e0907]">
          {fmtNumber(condition.actual_value)}
        </span>
        <span className="text-[10px] text-[#0e0907]/35">{condition.operator}</span>
        <span className="font-mono text-[11px] tabular-nums text-[#0e0907]/55">
          {fmtNumber(condition.threshold)}
        </span>
      </div>
      {showMeter && <ConditionMeter condition={condition} />}
    </div>
  );
}

/**
 * Per-condition stat-to-skill breakdown for the public player profile —
 * the "why" behind a skill's tier. Conditions are grouped by section
 * (Volume Gate / Elite / Capable / ...) with generous space between groups
 * and tight space within one, so 15-25 conditions read as a few short
 * chunks instead of one undifferentiated wall of rows.
 *
 * Public-facing sibling of components/ConditionBreakdown.tsx (the admin
 * calibration/review tool): same underlying data shape, different visual
 * register — Cornerstone's branded tokens here instead of the admin's
 * shadcn utility classes, and real value-vs-threshold meters instead of a
 * dense text list, since a public audience reads a bar faster than a table.
 */
export function SkillTraceDetail({ conditions, override, finalTier }: SkillTraceDetailProps) {
  if (conditions.length === 0 && !override) {
    return (
      <p id="skill-trace-empty" className="py-2 text-[12px] text-[#0e0907]/45">
        No stat conditions on record for this skill.
      </p>
    );
  }

  const unknownSections = Array.from(new Set(conditions.map((c) => c.section))).filter(
    (s) => !SECTION_ORDER.includes(s)
  );
  const grouped = [...SECTION_ORDER, ...unknownSections]
    .map((section) => ({ section, items: conditions.filter((c) => c.section === section) }))
    .filter((g) => g.items.length > 0);

  const achievedSection = TIER_TO_SECTION[finalTier];
  const achievedIndex = achievedSection ? TIER_SECTION_ORDER.indexOf(achievedSection) : -1;

  return (
    <div id="skill-trace-detail" className="flex flex-col gap-3">
      {override && (
        <div
          id="skill-trace-override-banner"
          className={cn(
            "flex items-center gap-2 rounded-md border px-2.5 py-2",
            TIER_SECTION_TINT[finalTier] ?? "border-[#d9d0c9] bg-[#f7f7f7]"
          )}
        >
          <span className="text-[12px] font-medium text-[#0e0907]">
            {RESOLUTION_LABELS[override.resolution] ?? "Manually reviewed"}
          </span>
          <SkillTierBadge tier={finalTier} size="sm" />
        </div>
      )}
      {grouped.map(({ section, items }) => {
        const isAchieved = section === achievedSection;
        const tierIndex = TIER_SECTION_ORDER.indexOf(section);
        // A tier section the evaluator checked and rejected before reaching
        // the one the player actually cleared (harder tiers only — a tier
        // easier than the achieved one was never even evaluated).
        const notMet = tierIndex !== -1 && (achievedIndex === -1 || tierIndex < achievedIndex);

        return (
          <div
            key={section}
            id={`skill-trace-section-${section.replace(/\s+/g, "-")}`}
            className={cn(
              "flex flex-col rounded-md border border-transparent px-2 py-1.5 -mx-2",
              isAchieved && cn(TIER_SECTION_TINT[finalTier], "border"),
              notMet && "opacity-50"
            )}
          >
            <div className="mb-0.5 flex items-center gap-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#0e0907]/40">
                {SECTION_LABELS[section] ?? section}
              </p>
              {isAchieved && <SkillTierBadge tier={finalTier} size="sm" />}
              {notMet && <span className="text-[10px] text-[#0e0907]/40">Not met</span>}
            </div>
            <div className="flex flex-col divide-y divide-[#d9d0c9]/60">
              {items.map((condition, i) => (
                <ConditionRow key={`${condition.stat}-${i}`} condition={condition} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
