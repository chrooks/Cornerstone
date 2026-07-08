"use client";

import { useEffect, useRef, useState } from "react";
import { evaluateRoster } from "@/lib/api";
import { placeCandidate } from "@/lib/candidate-placement";
import { buildEvalPayload } from "@/lib/hooks/useBuilderEvaluation";
import type { LegendDetail, PlayerWithSkills, RosterEvaluation } from "@/lib/types";

/**
 * Eval-impact hover preview (#92, feedforward) — after a deliberate hover
 * pause on a picker candidate, run the exact live evaluate the click would
 * trigger (same endpoint, same payload builder, same slot via placeCandidate)
 * so the previewed numbers equal the committed ones (ADR 0005).
 *
 * Skims cost nothing: nothing fetches until the pointer rests HOVER_INTENT_MS.
 * Results cache per roster + candidate; errors degrade to "no preview".
 */

const HOVER_INTENT_MS = 275;
const CACHE_CAP = 50;

interface UseEvalPreviewArgs {
  allSlots: (PlayerWithSkills | null)[];
  legendDetail: LegendDetail | null;
  cornerstoneId: string | null;
  /** Currently selected slot (1-based) — placement must mirror the click. */
  selectedSlot: number | null;
  hoveredPlayer: PlayerWithSkills | null;
}

export interface EvalPreview {
  evaluation: RosterEvaluation;
  forPlayerId: string;
}

function rosterFingerprint(
  allSlots: (PlayerWithSkills | null)[],
  legendDetail: LegendDetail | null,
  cornerstoneId: string | null,
  selectedSlot: number | null,
): string {
  // cornerstoneId changes both the payload (is_cornerstone/slot 0) and
  // placement in FFA mode, so it must be part of the cache identity.
  const legendPart = legendDetail ? `legend:${legendDetail.id}` : "legend:none";
  const slotIds = allSlots.map((player) => player?.id ?? "-").join(",");
  return `${legendPart}|cs:${cornerstoneId ?? "-"}|sel:${selectedSlot ?? "-"}|${slotIds}`;
}

export function useEvalPreview({
  allSlots,
  legendDetail,
  cornerstoneId,
  selectedSlot,
  hoveredPlayer,
}: UseEvalPreviewArgs): { preview: EvalPreview | null } {
  const [preview, setPreview] = useState<EvalPreview | null>(null);
  const cacheRef = useRef(new Map<string, RosterEvaluation>());
  const requestIdRef = useRef(0);

  useEffect(() => {
    // Any hover change invalidates whatever was pending or shown.
    requestIdRef.current += 1;
    setPreview(null);
    if (!hoveredPlayer) return;

    const candidateSlots = placeCandidate(allSlots, hoveredPlayer, { selectedSlot, cornerstoneId });
    if (!candidateSlots) return; // full roster or already rostered — nothing to preview

    // ponytail: cache survives an admin publishing a new evaluation version
    // mid-session; add a version id to the key if that ever bites.
    const cacheKey = `${rosterFingerprint(allSlots, legendDetail, cornerstoneId, selectedSlot)}|cand:${hoveredPlayer.id}`;
    const requestId = requestIdRef.current;

    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setPreview({ evaluation: cached, forPlayerId: hoveredPlayer.id });
      return;
    }

    const timer = setTimeout(() => {
      const players = buildEvalPayload(candidateSlots, legendDetail, cornerstoneId);
      evaluateRoster({ players, mode: "live", debug: false })
        .then((res) => {
          if (!res.success || !res.data) return; // degrade silently (AC5)
          const cache = cacheRef.current;
          cache.set(cacheKey, res.data);
          if (cache.size > CACHE_CAP) {
            const oldest = cache.keys().next().value;
            if (oldest !== undefined) cache.delete(oldest);
          }
          if (requestIdRef.current !== requestId) return; // hover moved on
          setPreview({ evaluation: res.data, forPlayerId: hoveredPlayer.id });
        })
        .catch(() => {
          // degrade silently — the preview simply never appears (AC5)
        });
    }, HOVER_INTENT_MS);

    return () => clearTimeout(timer);
  }, [hoveredPlayer, allSlots, legendDetail, cornerstoneId, selectedSlot]);

  return { preview };
}
