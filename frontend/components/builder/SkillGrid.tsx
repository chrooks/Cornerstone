"use client";

/**
 * SkillGrid.tsx — 21-row × 8-column skill tier matrix for the Team Builder.
 *
 * Rows = skills grouped by PUBLIC_SKILL_CATEGORIES order, columns = player slots
 * in their actual lineup order. The cornerstone legend appears in whichever slot
 * they currently occupy; their column uses the full LegendProfile (tier strings)
 * while active player columns use PlayerSkillMap (tier strings from evaluation).
 * Empty slots show "—". "None" tiers show "—" for cleaner display.
 */

import { cn } from "@/lib/utils";
import { PUBLIC_SKILL_CATEGORIES, SKILL_LABELS } from "@/lib/skills";
import type { PlayerWithSkills, LegendProfile } from "@/lib/types";
import { MAX_ROSTER_SLOTS } from "@/lib/builder-config";

/** Background color classes for tier squares. */
const TIER_BG_CLASSES: Record<string, string> = {
  "All-Time Great": "bg-violet-500",
  Elite:            "bg-emerald-500",
  Proficient:       "bg-sky-500",
  Capable:          "bg-amber-500",
  None:             "",
};

interface SkillGridProps {
  /** All 8 slots in lineup order. The cornerstone legend can be in any position. */
  allSlots: (PlayerWithSkills | null)[];
  /** ID of the cornerstone legend — that slot's column uses legendProfile for tiers. */
  cornerstoneId: string | null;
  /** Full legend profile (skill → tier). Null if not yet loaded. */
  legendProfile: LegendProfile | null;
  /** When true, columns with no player assigned are hidden. Default false. */
  hideEmptyColumns?: boolean;
}

/** Numeric values for computing averages across the roster. */
const TIER_NUMERIC: Record<string, number> = {
  "All-Time Great": 4,
  Elite: 3,
  Proficient: 2,
  Capable: 1,
  None: 0,
};


/** Colored square for a tier value. Shows tier name on hover via native title tooltip. */
function TierSquare({ tier }: { tier: string | null | undefined }) {
  const resolved = tier && tier !== "None" ? tier : null;
  if (!resolved) {
    // Empty / None — render a faint placeholder square
    return <span className="inline-block size-4 rounded-sm bg-muted/40" />;
  }
  return (
    <span
      className={cn("inline-block size-4 rounded-sm cursor-default", TIER_BG_CLASSES[resolved] ?? "bg-muted")}
      title={resolved}
    />
  );
}

/** Ordered tier list for mapping numeric averages to half-tier splits. */
const TIER_ORDER = ["None", "Capable", "Proficient", "Elite", "All-Time Great"] as const;

/**
 * Average tier square — supports half-tier display.
 * Whole tiers render a solid square; half-tiers render a left/right split
 * with the lower tier on the left and upper tier on the right.
 */
function AvgTierSquare({ avg }: { avg: number }) {
  if (avg < 0.25) {
    return <span className="inline-block size-4 rounded-sm bg-muted/40" />;
  }

  // Round to nearest 0.5 for half-tier granularity
  const rounded = Math.round(avg * 2) / 2;
  const lowerIdx = Math.floor(rounded);
  const isHalf = rounded % 1 !== 0;

  if (!isHalf) {
    // Solid square — exact tier
    const tier = TIER_ORDER[lowerIdx];
    return (
      <span
        className={cn("inline-block size-4 rounded-sm cursor-default", TIER_BG_CLASSES[tier] ?? "bg-muted")}
        title={tier}
      />
    );
  }

  // Half-tier — split square with lower tier left, upper tier right
  const lowerTier = TIER_ORDER[lowerIdx];
  const upperTier = TIER_ORDER[lowerIdx + 1];
  return (
    <span
      className="inline-flex size-4 rounded-sm overflow-hidden cursor-default"
      title={`${lowerTier} / ${upperTier}`}
    >
      <span className={cn("w-1/2 h-full", TIER_BG_CLASSES[lowerTier] || "bg-muted/40")} />
      <span className={cn("w-1/2 h-full", TIER_BG_CLASSES[upperTier] || "bg-muted/40")} />
    </span>
  );
}

export function SkillGrid({
  allSlots,
  cornerstoneId,
  legendProfile,
  hideEmptyColumns = false,
}: SkillGridProps) {
  // Determine which slot indices (0-based) are visible
  const visibleIndices = Array.from({ length: MAX_ROSTER_SLOTS }, (_, i) => i)
    .filter((i) => !hideEmptyColumns || allSlots[i] != null);

  return (
    // overflow-auto here is the scroll container; th sticky top-0 is relative to this
    <div id="builder-skill-grid" className="overflow-auto h-full">
      <table className="w-full text-xs border-collapse">
        {/* Column header row — player names in slot order */}
        <thead>
          <tr>
            {/* Skill label header — sticky top+left (corner cell) */}
            <th
              id="builder-skill-grid-skill-header"
              className="sticky top-0 left-0 z-40 bg-background text-left px-2 py-1.5 font-medium text-muted-foreground border-b border-border min-w-[120px]"
            >
              Skill
            </th>

            {visibleIndices.map((i) => {
              const slotIndex = i + 1; // 1-based for id
              const p = allSlots[i];
              const name = p?.name ?? `Slot ${slotIndex}`;
              return (
                <th
                  key={slotIndex}
                  id={`builder-skill-grid-col-${slotIndex}`}
                  // sticky top-0 so column names stay visible on vertical scroll
                  className="sticky top-0 z-30 bg-background px-1 py-1.5 text-center font-medium border-b border-border min-w-[44px] text-foreground"
                >
                  <span className="truncate block max-w-[76px] mx-auto" title={name}>
                    {name.split(" ").pop()}
                  </span>
                </th>
              );
            })}

            {/* Average column header — sticky top + right */}
            <th
              id="builder-skill-grid-col-avg"
              className="sticky top-0 right-0 z-40 bg-background px-2 py-1.5 text-center font-medium border-b border-border border-l border-border/60 min-w-[50px] text-muted-foreground"
            >
              Avg
            </th>
          </tr>
        </thead>

        <tbody>
          {Object.entries(PUBLIC_SKILL_CATEGORIES).map(([category, skills]) => (
            <>
              {/* Category divider row */}
              <tr key={`cat-${category}`} id={`builder-skill-category-${category.replace(/\s+/g, "-").toLowerCase()}`}>
                <td className="sticky left-0 z-10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 bg-muted border-y border-border/60 whitespace-nowrap">
                  {category}
                </td>
                {/* +1 for avg column */}
                <td colSpan={visibleIndices.length + 1} className="bg-muted border-y border-border/60" />
              </tr>

              {/* Skill rows within this category */}
              {skills.map((skill, rowIdx) => (
                <tr
                  key={skill}
                  id={`builder-skill-row-${skill}`}
                  className={cn(
                    "border-b border-border/40",
                    rowIdx % 2 === 0 ? "bg-background" : "bg-muted/20",
                  )}
                >
                  {/* Skill label — sticky left */}
                  <td className="sticky left-0 z-10 px-2 py-1 font-medium text-muted-foreground whitespace-nowrap bg-background">
                    {SKILL_LABELS[skill] ?? skill}
                  </td>

                  {/* One cell per visible slot — legend column uses legendProfile */}
                  {visibleIndices.map((i) => {
                    const slotIndex = i + 1;
                    const p = allSlots[i];
                    const isCornerstone = p?.id === cornerstoneId;
                    const tier = isCornerstone
                      ? legendProfile?.[skill]
                      : p?.skills?.[skill];
                    return (
                      <td
                        key={slotIndex}
                        id={`builder-skill-grid-cell-${slotIndex}-${skill}`}
                        className="px-1 py-1 text-center"
                      >
                        {!p ? (
                          <span className="inline-block size-4 rounded-sm bg-muted/20" />
                        ) : (
                          <TierSquare tier={tier} />
                        )}
                      </td>
                    );
                  })}

                  {/* Average tier across filled slots */}
                  {(() => {
                    // Include all filled slots in the average — None (0) counts toward
                    // the denominator so one Proficient + four Nones ≠ Proficient average.
                    const tiers = visibleIndices
                      .map((i) => {
                        const p = allSlots[i];
                        if (!p) return null;
                        const isCornerstone = p.id === cornerstoneId;
                        const tier = isCornerstone ? legendProfile?.[skill] : p.skills?.[skill];
                        return TIER_NUMERIC[tier ?? "None"] ?? 0;
                      })
                      .filter((v): v is number => v !== null);
                    const avg = tiers.length > 0 ? tiers.reduce((a, b) => a + b, 0) / tiers.length : 0;
                    return (
                      <td
                        id={`builder-skill-grid-avg-${skill}`}
                        className={cn("sticky right-0 z-10 px-2 py-1 text-center border-l border-border/60 bg-background", rowIdx % 2 !== 0 && "bg-muted/20")}
                      >
                        <AvgTierSquare avg={avg} />
                      </td>
                    );
                  })()}
                </tr>
              ))}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}
