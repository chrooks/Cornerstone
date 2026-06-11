"use client";

/**
 * ExcludedSection — collapsible "Excluded from snapshot (N)" panel.
 *
 * Source of truth is getDraftPlayerPool(): rows with
 * excluded_from_snapshot === true. Each row offers an "Include" action that
 * un-excludes the player (setPlayersExcludedFromSnapshot([id], false)) and then
 * re-fetches both the local pool and — via onChanged — the publish validation,
 * so the missing-composite count and this list stay authoritative.
 *
 * Renders nothing when N === 0 (no empty-state clutter).
 *
 * Shared by the Publish tab and the Player Pool tab. Both pass an onChanged
 * callback wired to the shell's validation reload.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getDraftPlayerPool,
  setPlayersExcludedFromSnapshot,
} from "@/lib/api";
import type { PlayerWithSkills } from "@/lib/types";

export interface ExcludedSectionProps {
  id: string;
  /** Re-fetch the authoritative validation/summary after an include. */
  onChanged: () => Promise<void> | void;
  /** Bumped by the parent to force a re-fetch (e.g. after a bulk exclude). */
  refreshKey?: number;
}

export function ExcludedSection({ id, onChanged, refreshKey = 0 }: ExcludedSectionProps) {
  const [excluded, setExcluded] = useState<PlayerWithSkills[]>([]);
  const [loading, setLoading] = useState(true);
  const [includingId, setIncludingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getDraftPlayerPool();
      if (res.success && res.data) {
        setExcluded(res.data.filter((p) => p.excluded_from_snapshot === true));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const handleInclude = useCallback(
    async (playerId: string) => {
      setIncludingId(playerId);
      // Optimistic: drop the row immediately, re-fetch authoritative after.
      const prev = excluded;
      setExcluded((rows) => rows.filter((p) => p.id !== playerId));
      try {
        const res = await setPlayersExcludedFromSnapshot([playerId], false);
        if (!res.success) {
          setExcluded(prev);
          toast.error(res.error ?? "Failed to include player");
          return;
        }
        toast.success("Player re-included in snapshot");
        await Promise.all([load(), onChanged()]);
      } catch {
        setExcluded(prev);
        toast.error("Failed to include player");
      } finally {
        setIncludingId(null);
      }
    },
    [excluded, load, onChanged],
  );

  // No clutter when nothing is excluded (and not mid-load).
  if (!loading && excluded.length === 0) return null;

  return (
    <details
      id={id}
      className="group rounded-[6px] border border-[#d9d0c9] [&_summary::-webkit-details-marker]:hidden"
      style={{ backgroundColor: "#fff8f4" }}
    >
      <summary
        id={`${id}-summary`}
        className="flex items-center justify-between gap-3 px-5 py-3 cursor-pointer list-none
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffa05c]
          focus-visible:ring-offset-1 rounded-[6px]"
      >
        <span className="flex items-center gap-2">
          <svg
            aria-hidden
            width="10"
            height="10"
            viewBox="0 0 10 10"
            className="text-neutral-500 transition-transform duration-150 group-open:rotate-90"
          >
            <path
              d="M3 1.5 L7 5 L3 8.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Excluded from snapshot
          </span>
          <span className="text-sm font-semibold tabular-nums text-[#0e0907]">
            {loading ? "…" : excluded.length}
          </span>
        </span>
      </summary>

      <ul
        id={`${id}-list`}
        className="border-t border-[#d9d0c9] divide-y divide-[#e3d9cf] max-h-[320px] overflow-y-auto"
      >
        {excluded.map((p) => (
          <li
            key={p.id}
            id={`${id}-item-${p.id}`}
            className="flex items-center justify-between gap-3 px-5 py-2 text-[12px]"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className="font-medium text-[#0e0907] truncate">{p.name}</span>
              <span className="font-mono text-[11px] text-neutral-500 shrink-0">
                {p.team ?? "—"} · {p.position ?? "—"}
              </span>
            </span>
            <button
              id={`${id}-include-${p.id}`}
              type="button"
              onClick={() => handleInclude(p.id)}
              disabled={includingId === p.id}
              className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-[4px]
                border border-[#d9d0c9] text-[#fe6d34] hover:text-[#0e0907] hover:border-[#fe6d34]
                focus:outline-none focus:ring-2 focus:ring-[#ffa05c] focus:ring-offset-1
                disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {includingId === p.id ? "Including…" : "Include"}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
