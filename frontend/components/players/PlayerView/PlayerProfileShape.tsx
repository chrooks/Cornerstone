"use client";

import { useEffect, useMemo, useState } from "react";
import { getPlayerComposites } from "@/lib/api";
import { getActiveEvaluationVersion } from "@/lib/api/evaluation-versions";
import { theoreticalMaxFromEvaluationValues } from "@/lib/cohesion-constants";
import { computeRawCompositeBreakdowns, rawToTenPointScale } from "@/lib/player-composites";
import type { CompositeKey } from "@/lib/player-composites";
import { PlayerShapeGlyph } from "@/components/builder/PlayerShapeGlyph";
import { TEAM_SHAPE_AXES } from "@/components/builder/TeamShapeGlyph";
import type { PlayerShapeAxisValue } from "@/components/builder/PlayerShapeGlyph";
import type { CompositeSkillResult, PlayerSkillMap } from "@/lib/types";

/**
 * Player Shape on the profile surface. Values come from the backend's
 * league-percentile normalization (POST /api/builder/player-composites) — the
 * same 0-10 scale the cohesion engine uses. Raw/theoretical-max scaling is the
 * labeled fallback when percentile distributions are unavailable.
 */

// Active Evaluation Version fetched once per session, shared across profiles.
let theoreticalMaxPromise: Promise<Record<string, number>> | null = null;

function loadTheoreticalMax(): Promise<Record<string, number>> {
  theoreticalMaxPromise ??= getActiveEvaluationVersion()
    .then((res) => theoreticalMaxFromEvaluationValues(res.success ? res.data?.payload.values : undefined))
    .catch(() => {
      theoreticalMaxPromise = null; // allow a retry on the next profile open
      return theoreticalMaxFromEvaluationValues(undefined);
    });
  return theoreticalMaxPromise;
}

interface PlayerProfileShapeProps {
  playerName: string;
  skills: Record<string, CompositeSkillResult>;
}

function toSkillMap(skills: Record<string, CompositeSkillResult>): PlayerSkillMap {
  return Object.fromEntries(
    Object.entries(skills).map(([skill, result]) => [skill, result.final_tier ?? "None"]),
  );
}

export function PlayerProfileShape({ playerName, skills }: PlayerProfileShapeProps) {
  const [percentiles, setPercentiles] = useState<Record<string, number> | null>(null);
  const [rawFallbackMax, setRawFallbackMax] = useState<Record<string, number> | null>(null);

  const skillMap = useMemo(() => toSkillMap(skills), [skills]);

  useEffect(() => {
    let active = true;
    getPlayerComposites(skillMap)
      .then((res) => {
        if (!active) return;
        if (res.success && res.data && res.data.normalization === "percentile") {
          setPercentiles(res.data.composites);
          return;
        }
        // Distributions not ready (or request shape failed) → labeled raw fallback.
        loadTheoreticalMax().then((max) => {
          if (active) setRawFallbackMax(max);
        });
      })
      .catch(() => {
        loadTheoreticalMax().then((max) => {
          if (active) setRawFallbackMax(max);
        });
      });
    return () => {
      active = false;
    };
  }, [skillMap]);

  const axisValues = useMemo<PlayerShapeAxisValue[] | null>(() => {
    if (percentiles) {
      return TEAM_SHAPE_AXES.map((axis) => ({
        key: axis.key,
        value: percentiles[axis.key] ?? null,
        isRaw: false,
      }));
    }
    if (rawFallbackMax) {
      const breakdowns = computeRawCompositeBreakdowns(skillMap);
      return TEAM_SHAPE_AXES.map((axis) => {
        const raw = breakdowns[axis.key as CompositeKey]?.raw;
        return {
          key: axis.key,
          value: raw == null ? null : rawToTenPointScale(axis.key as CompositeKey, raw, rawFallbackMax),
          isRaw: true,
        };
      });
    }
    return null;
  }, [percentiles, rawFallbackMax, skillMap]);

  if (!axisValues) return null;

  return (
    <div id="player-profile-shape" className="mx-auto w-full max-w-sm border border-[#d9d0c9] bg-[#f7f7f7] px-4 py-3">
      <p className="text-xs font-semibold text-[#0e0907]/50">Player Shape</p>
      <PlayerShapeGlyph playerName={playerName} axisValues={axisValues} className="mt-2 max-w-[280px]" />
    </div>
  );
}
