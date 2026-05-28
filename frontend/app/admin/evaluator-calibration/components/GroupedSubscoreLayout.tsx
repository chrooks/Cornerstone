/**
 * GroupedSubscoreLayout — Renders Subscores grouped by Subscore Tree category.
 *
 * Shared by ResultsPanel (compact text rows) and LineupTester (expandable
 * equation rows). Consumers pass a render function for each Subscore entry
 * and for the two accentuation values.
 */

import { cn } from "@/lib/utils";
import { SUBSCORE_GROUPS, HEADING_TO_CATEGORY_KEY, HEADING_SHOWS_SCORE, categoryScoreColor } from "@/lib/cohesion-constants";

interface Accentuation {
  strength_amplification: number;
  weakness_coverage: number;
}

interface GroupedSubscoreLayoutProps {
  id?: string;
  subscores: Record<string, number>;
  categoryScores?: Record<string, number>;
  accentuation: Accentuation;
  /** Spacing between category groups. */
  groupGap?: string;
  /** Spacing below the category header. */
  headerGap?: string;
  /** Tailwind classes for the 2-column grid within each group. */
  gridClassName?: string;
  /** Render one Subscore entry. */
  renderEntry: (key: string, value: number) => React.ReactNode;
  /** Render one accentuation entry (key is "accentuation_strength" or "accentuation_weakness"). */
  renderAccentuation: (key: string, value: number) => React.ReactNode;
}

export function GroupedSubscoreLayout({
  id,
  subscores,
  categoryScores,
  accentuation,
  groupGap = "space-y-2",
  headerGap = "mb-0.5",
  gridClassName = "grid grid-cols-2 gap-x-2 gap-y-0.5",
  renderEntry,
  renderAccentuation,
}: GroupedSubscoreLayoutProps) {
  return (
    <div id={id} className={groupGap}>
      {SUBSCORE_GROUPS.map((group) => {
        const entries = group.entries.filter(({ key }) => subscores[key] !== undefined);
        if (entries.length === 0) return null;
        const catKey = HEADING_TO_CATEGORY_KEY[group.heading];
        const showScore = HEADING_SHOWS_SCORE[group.heading] && categoryScores && catKey;
        const catScore = showScore ? categoryScores[catKey] : undefined;
        return (
          <div key={group.heading}>
            <div className={`flex items-center justify-between ${headerGap}`}>
              <p className="text-[7px] uppercase tracking-wider text-muted-foreground/50">
                {group.heading}
              </p>
              {catScore !== undefined && (
                <span className={cn("text-[8px] font-mono tabular-nums font-semibold", categoryScoreColor(catScore))}>
                  {(catScore * 100).toFixed(0)}%
                </span>
              )}
            </div>
            <div className={gridClassName}>
              {entries.map(({ key }) => renderEntry(key, subscores[key]))}
            </div>
          </div>
        );
      })}
      <div>
        <p className={`text-[7px] uppercase tracking-wider text-muted-foreground/50 ${headerGap}`}>
          Accentuation
        </p>
        <div className={gridClassName}>
          {renderAccentuation("accentuation_strength", accentuation.strength_amplification)}
          {renderAccentuation("accentuation_weakness", accentuation.weakness_coverage)}
        </div>
      </div>
    </div>
  );
}
