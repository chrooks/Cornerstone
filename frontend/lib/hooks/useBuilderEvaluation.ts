"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { evaluateRoster } from "@/lib/api";
import type { LegendDetail, PlayerWithSkills, RosterEvaluation } from "@/lib/types";

type BuilderEvaluationState = "idle" | "analyzing" | "ready" | "error";

interface UseBuilderEvaluationArgs {
  allSlots: (PlayerWithSkills | null)[];
  legendDetail: LegendDetail | null;
  isAdmin: boolean;
}

interface UseBuilderEvaluationResult {
  state: BuilderEvaluationState;
  latestEval: RosterEvaluation | null;
  error: string | null;
}

const STARTER_BOUNDARY = 5;

function buildPlayerPayload(
  allSlots: (PlayerWithSkills | null)[],
  legendDetail: LegendDetail,
) {
  const result: Array<{
    id?: string;
    player_id?: string;
    name: string;
    slot: number;
    is_cornerstone: boolean;
    height: string | null;
    skills: Record<string, string>;
  }> = [
    {
      id: legendDetail.id,
      name: legendDetail.name,
      slot: 0,
      is_cornerstone: true,
      height: legendDetail.height,
      skills: Object.fromEntries(
        Object.entries(legendDetail.profile).map(([key, value]) => [key, value ?? "None"]),
      ),
    },
  ];

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

  return result;
}

export function useBuilderEvaluation({
  allSlots,
  legendDetail,
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

  const runEval = useCallback(async () => {
    if (!legendDetail) {
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
      const players = buildPlayerPayload(slotsRef.current, legendDetail);
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
  }, [isAdmin, legendDetail]);

  useEffect(() => {
    if (!legendDetail) {
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
  }, [legendDetail, rosterKey, runEval]);

  return { state, latestEval, error };
}
