"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { evaluateRoster } from "@/lib/api";
import type { LegendDetail, PlayerWithSkills, RosterEvaluation } from "@/lib/types";

type BuilderEvaluationState = "idle" | "analyzing" | "ready" | "error";

interface UseBuilderEvaluationArgs {
  allSlots: (PlayerWithSkills | null)[];
  legendDetail: LegendDetail | null;
  cornerstoneId: string | null;
  isAdmin: boolean;
}

interface UseBuilderEvaluationResult {
  state: BuilderEvaluationState;
  latestEval: RosterEvaluation | null;
  error: string | null;
}

const STARTER_BOUNDARY = 5;

// Exported for the eval-impact hover preview (#92): the preview must build a
// byte-identical payload to the one the post-add live eval sends.
export function buildEvalPayload(
  allSlots: (PlayerWithSkills | null)[],
  legendDetail: LegendDetail | null,
  cornerstoneId: string | null,
) {
  const result: Array<{
    id?: string;
    player_id?: string;
    name: string;
    slot: number;
    is_cornerstone: boolean;
    height: string | null;
    skills: Record<string, string>;
  }> = [];

  if (legendDetail) {
    // Legend cornerstone — extract from legendDetail, skip legends in allSlots
    result.push({
      id: legendDetail.id,
      name: legendDetail.name,
      slot: 0,
      is_cornerstone: true,
      height: legendDetail.height,
      skills: Object.fromEntries(
        Object.entries(legendDetail.profile).map(([key, value]) => [key, value ?? "None"]),
      ),
    });

    allSlots.forEach((player, index) => {
      if (!player || player.is_legend) return;
      result.push({
        id: player.id,
        player_id: player.id,
        name: player.name,
        slot: index + 1,
        is_cornerstone: false,
        height: player.height,
        skills: (player.skills ?? {}) as Record<string, string>,
      });
    });
  } else {
    // No Legend cornerstone (FFA) — all players from allSlots
    // Slot 1 is treated as cornerstone for eval purposes
    allSlots.forEach((player, index) => {
      if (!player) return;
      const isCornerstone = cornerstoneId
        ? player.id === cornerstoneId
        : index === 0;
      result.push({
        id: player.id,
        player_id: player.id,
        name: player.name,
        slot: isCornerstone ? 0 : index + 1,
        is_cornerstone: isCornerstone,
        height: player.height,
        skills: (player.skills ?? {}) as Record<string, string>,
      });
    });
  }

  return result;
}

export function useBuilderEvaluation({
  allSlots,
  legendDetail,
  cornerstoneId,
  isAdmin,
}: UseBuilderEvaluationArgs): UseBuilderEvaluationResult {
  const [state, setState] = useState<BuilderEvaluationState>("idle");
  const [latestEval, setLatestEval] = useState<RosterEvaluation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const slotsRef = useRef(allSlots);
  const requestIdRef = useRef(0);

  useEffect(() => {
    slotsRef.current = allSlots;
  }, [allSlots]);

  const rosterKey = useMemo(() => {
    const legendPart = legendDetail ? `legend:${legendDetail.id}` : "legend:none";
    const starterIds = allSlots
      .slice(0, STARTER_BOUNDARY)
      .filter(Boolean)
      .map((player) => player!.id)
      .sort()
      .join(",");
    const benchIds = allSlots
      .slice(STARTER_BOUNDARY)
      .filter(Boolean)
      .map((player) => player!.id)
      .sort()
      .join(",");
    return `${legendPart}|s:${starterIds}|b:${benchIds}`;
  }, [allSlots, legendDetail]);

  // Need at least some filled slots to evaluate
  const hasPlayers = allSlots.some((p) => p !== null);

  const runEval = useCallback(async () => {
    if (!hasPlayers) {
      setState("idle");
      setLatestEval(null);
      setError(null);
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setState("analyzing");
    setError(null);

    try {
      const players = buildEvalPayload(slotsRef.current, legendDetail, cornerstoneId);
      const res = await evaluateRoster({ players, mode: "live", debug: isAdmin });
      if (requestIdRef.current !== requestId) return;

      if (res.success && res.data) {
        setLatestEval(res.data);
        setState("ready");
        return;
      }

      setError(res.error ?? "Evaluation failed");
      setState("error");
    } catch {
      if (requestIdRef.current !== requestId) return;
      setError("Failed to reach the server");
      setState("error");
    }
  }, [isAdmin, legendDetail, cornerstoneId, hasPlayers]);

  useEffect(() => {
    if (!hasPlayers) {
      requestIdRef.current += 1;
      setState("idle");
      setLatestEval(null);
      setError(null);
      return;
    }

    const timeout = setTimeout(() => {
      void runEval();
    }, 500);

    return () => clearTimeout(timeout);
  }, [hasPlayers, rosterKey, runEval]);

  return { state, latestEval, error };
}
