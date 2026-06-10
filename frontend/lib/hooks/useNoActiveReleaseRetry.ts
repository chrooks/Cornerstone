"use client";

/**
 * useNoActiveReleaseRetry — shared retry state for the no_active_release
 * Error State across Lab surfaces (#62).
 *
 * Owns the pieces every surface was hand-rolling separately:
 * - `noActiveRelease` — true once a load detects the no_active_release error
 * - `retryToken` — counter pages put in their load-effect deps so a retry
 *   re-runs the load (effects stay mount + retryToken only)
 * - `retrying` — true from the retry click until the page reports the next
 *   load settled; drives the "Checking…" label on NoActiveReleaseError
 *
 * Pages keep owning their load effects and `cancelled`-flag stale-response
 * guards — this hook only centralizes detection + retry bookkeeping.
 */

import { useCallback, useRef, useState } from "react";
import { isNoActiveRelease } from "@/lib/api";
import type { ApiResponse } from "@/lib/types";

interface NoActiveReleaseRetry {
  /** True once a load detected the no_active_release error. */
  noActiveRelease: boolean;
  /** Bumps on each retry — include in the load effect's deps. */
  retryToken: number;
  /** True from retry click until settleRetry() — pass to NoActiveReleaseError. */
  retrying: boolean;
  /** Detection helper: marks the Error State and returns true on a no_active_release response. */
  detectNoActiveRelease: <T>(res: ApiResponse<T>) => boolean;
  /** Retry the load: clears the Error State, runs onRetry, bumps retryToken. */
  retry: () => void;
  /** Report that a load attempt settled (success or failure) — clears `retrying`. */
  settleRetry: () => void;
}

/**
 * @param onRetry Optional page-specific reset run on retry click
 *                (e.g. setLoading(true), clearing page error state).
 */
export function useNoActiveReleaseRetry(onRetry?: () => void): NoActiveReleaseRetry {
  const [noActiveRelease, setNoActiveRelease] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [retrying, setRetrying] = useState(false);

  /* Ref keeps the latest onRetry without destabilizing the retry callback,
     so pages can pass inline resets while effect deps stay mount + retryToken. */
  const onRetryRef = useRef(onRetry);
  onRetryRef.current = onRetry;

  const detectNoActiveRelease = useCallback(<T,>(res: ApiResponse<T>): boolean => {
    if (!isNoActiveRelease(res)) return false;
    setNoActiveRelease(true);
    return true;
  }, []);

  const retry = useCallback(() => {
    setNoActiveRelease(false);
    setRetrying(true);
    onRetryRef.current?.();
    setRetryToken((token) => token + 1);
  }, []);

  const settleRetry = useCallback(() => {
    setRetrying(false);
  }, []);

  return { noActiveRelease, retryToken, retrying, detectNoActiveRelease, retry, settleRetry };
}
