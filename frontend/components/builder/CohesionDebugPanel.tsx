"use client";

/**
 * CohesionDebugPanel.tsx — Admin debug tab for cohesion engine evaluations.
 *
 * This delegates the lineup result surface to the shared cohesion detail
 * component so Builder and calibration show the same bell curves, expandable
 * subscores, synergy chips, and Impact Traits table.
 */

import { CohesionResultDetails } from "@/components/cohesion/CohesionResultDetails";
import type { RosterEvaluation } from "@/lib/types";

interface CohesionDebugPanelProps {
  evaluation: RosterEvaluation;
}

export function CohesionDebugPanel({ evaluation }: CohesionDebugPanelProps) {
  const startingPlayers = evaluation.player_composites.slice(0, 5);

  return (
    <div id="cohesion-debug-panel" className="space-y-2">
      <CohesionResultDetails
        idPrefix="cohesion-debug-lineup-result"
        result={evaluation.starting_lineup}
        players={startingPlayers}
        compositesPlayers={evaluation.player_composites}
        starBreakdown={evaluation.star_rating_breakdown}
        lineupSummary={evaluation.lineup_summary}
      />
    </div>
  );
}
