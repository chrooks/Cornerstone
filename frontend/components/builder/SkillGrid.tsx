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

/** Tier color classes for inline cell text (compact, no badge border needed). */
const TIER_TEXT_CLASSES: Record<string, string> = {
  "All-Time Great": "text-violet-700 font-semibold",
  Elite:            "text-emerald-700 font-semibold",
  Proficient:       "text-sky-700",
  Capable:          "text-amber-700",
  None:             "text-muted-foreground/40",
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

/** Return display text for a tier value (collapse "None" and null to "—"). */
function tierLabel(tier: string | null | undefined): string {
  if (!tier || tier === "None") return "—";
  return tier;
}

function tierClass(tier: string | null | undefined): string {
  if (!tier || tier === "None") return "text-muted-foreground/30";
  return TIER_TEXT_CLASSES[tier] ?? "text-foreground";
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
                  className="sticky top-0 z-30 bg-background px-2 py-1.5 text-center font-medium border-b border-border min-w-[80px] text-foreground"
                >
                  <span className="truncate block max-w-[76px] mx-auto" title={name}>
                    {name.split(" ").pop()}
                  </span>
                </th>
              );
            })}
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
                <td colSpan={visibleIndices.length} className="bg-muted border-y border-border/60" />
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
                        className="px-2 py-1 text-center"
                      >
                        {!p ? (
                          <span className="text-muted-foreground/20">—</span>
                        ) : (
                          <span className={cn("whitespace-nowrap", tierClass(tier))}>
                            {tierLabel(tier)}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}
