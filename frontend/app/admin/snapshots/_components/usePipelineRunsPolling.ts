"use client";

/**
 * usePipelineRunsPolling — polls a pipeline run_id.
 *
 * Polls every 2s while active, backs off to 15s when run_id is null
 * or the run has finished (success/error).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getPipelineRun } from "@/lib/api";
import type { PipelineRun } from "@/lib/types";

interface PollingState {
  run: PipelineRun | null;
  loading: boolean;
}

export function usePipelineRunsPolling(runId: string | null): PollingState {
  const [run, setRun] = useState<PipelineRun | null>(null);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async () => {
    if (!runId) return;

    setLoading(true);
    try {
      const res = await getPipelineRun(runId);
      if (res.success && res.data) {
        setRun(res.data);
      }
    } catch {
      // Transient network error — keep polling
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    if (!runId) {
      setRun(null);
      return;
    }

    // Initial fetch
    poll();

    const schedule = () => {
      const isFinished = run?.status === "success" || run?.status === "error";
      const interval = runId && !isFinished ? 2000 : 15000;
      timerRef.current = setTimeout(() => {
        poll().then(schedule);
      }, interval);
    };

    schedule();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  return { run, loading };
}
