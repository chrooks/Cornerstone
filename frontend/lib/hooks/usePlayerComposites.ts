"use client";

import { useEffect, useState } from "react";
import { getPlayerComposites } from "@/lib/api";
import type { PlayerWithSkills } from "@/lib/types";

/**
 * League-percentile composites for a Player outside the live eval, via
 * POST /api/builder/player-composites. Debounced so sweeping the cursor down
 * the PlayerPool doesn't fire a request per row, and cached per player for
 * the session. Returns null while pending/disabled — callers keep their
 * labeled raw fallback until percentiles arrive.
 */

const HOVER_DEBOUNCE_MS = 300;
const cache = new Map<string, Record<string, number>>();

export function usePlayerComposites(
  player: PlayerWithSkills | null,
  enabled: boolean,
): Record<string, number> | null {
  const playerId = enabled && player ? player.id : null;
  const [result, setResult] = useState<{ id: string; composites: Record<string, number> } | null>(null);

  useEffect(() => {
    if (!playerId || !player) return;
    const cached = cache.get(playerId);
    if (cached) {
      setResult({ id: playerId, composites: cached });
      return;
    }

    let active = true;
    const timeout = setTimeout(() => {
      const skills = (player.skills ?? {}) as Record<string, string>;
      getPlayerComposites(skills)
        .then((res) => {
          if (!active) return;
          if (res.success && res.data && res.data.normalization === "percentile") {
            cache.set(playerId, res.data.composites);
            setResult({ id: playerId, composites: res.data.composites });
          }
        })
        .catch(() => {
          // Raw fallback already on screen; percentiles just don't upgrade it.
        });
    }, HOVER_DEBOUNCE_MS);

    return () => {
      active = false;
      clearTimeout(timeout);
    };
    // player identity is captured via playerId; skills ride along with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId]);

  return result && result.id === playerId ? result.composites : null;
}
