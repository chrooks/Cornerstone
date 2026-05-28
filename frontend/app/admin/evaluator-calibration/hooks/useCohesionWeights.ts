/**
 * useCohesionWeights — Fetches and normalizes cohesion engine weights from the API.
 */

import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { fetchCohesionWeights } from "@/lib/api";
import {
  DEFAULT_COHESION_WEIGHTS,
  normalizeCohesionExplanationWeights,
} from "@/lib/cohesion-weights";
import type { CohesionExplanationWeights } from "@/lib/cohesion-weights";

export function useCohesionWeights() {
  const [cohesionWeights, setCohesionWeights] = useState<CohesionExplanationWeights>(DEFAULT_COHESION_WEIGHTS);

  /** Load backend engine weights so explanation math mirrors weights.py and runtime overrides. */
  const loadCohesionWeights = useCallback(async () => {
    const res = await fetchCohesionWeights();
    if (res.success) {
      setCohesionWeights(normalizeCohesionExplanationWeights(res.data));
    } else {
      toast.error(res.error ?? "Failed to load cohesion weights");
    }
  }, []);

  // Fetch weights on mount
  useEffect(() => {
    loadCohesionWeights();
  }, [loadCohesionWeights]);

  return {
    cohesionWeights,
    reloadWeights: loadCohesionWeights,
  };
}
