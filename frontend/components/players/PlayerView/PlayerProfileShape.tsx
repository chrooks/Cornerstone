"use client";

import { useEffect, useMemo, useState } from "react";
import { getActiveEvaluationVersion } from "@/lib/api/evaluation-versions";
import { theoreticalMaxFromEvaluationValues } from "@/lib/cohesion-constants";
import { computeRawCompositeBreakdowns, rawToTenPointScale } from "@/lib/player-composites";
import type { CompositeKey } from "@/lib/player-composites";
import { PlayerShapeGlyph } from "@/components/builder/PlayerShapeGlyph";
import { TEAM_SHAPE_AXES } from "@/components/builder/TeamShapeGlyph";
import type { CompositeSkillResult, PlayerSkillMap } from "@/lib/types";

/**
 * Player Shape on the profile surface. No eval context here, so every value is
 * a raw formula read scaled to the shared 0-10 axes — the glyph labels it so.
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

export function PlayerProfileShape({ playerName, skills }: PlayerProfileShapeProps) {
  const [theoreticalMax, setTheoreticalMax] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    let active = true;
    loadTheoreticalMax().then((max) => {
      if (active) setTheoreticalMax(max);
    });
    return () => {
      active = false;
    };
  }, []);

  const axisValues = useMemo(() => {
    if (!theoreticalMax) return null;
    const skillMap: PlayerSkillMap = Object.fromEntries(
      Object.entries(skills).map(([skill, result]) => [skill, result.final_tier ?? "None"]),
    );
    const breakdowns = computeRawCompositeBreakdowns(skillMap);
    return TEAM_SHAPE_AXES.map((axis) => {
      const raw = breakdowns[axis.key as CompositeKey]?.raw;
      return {
        key: axis.key,
        value: raw == null ? null : rawToTenPointScale(axis.key as CompositeKey, raw, theoreticalMax),
        isRaw: true,
      };
    });
  }, [skills, theoreticalMax]);

  if (!axisValues) return null;

  return (
    <div id="player-profile-shape" className="mx-auto w-full max-w-sm border border-[#d9d0c9] bg-[#f7f7f7] px-4 py-3">
      <p className="text-xs font-semibold text-[#0e0907]/50">Player Shape</p>
      <PlayerShapeGlyph playerName={playerName} axisValues={axisValues} className="mt-2 max-w-[280px]" />
    </div>
  );
}
