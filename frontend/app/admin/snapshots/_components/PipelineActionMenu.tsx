"use client";

/**
 * PipelineActionMenu — split button for running pipeline stages on a selection
 * of players.
 *
 *   - Main button (default)  → Fetch stats, then composite (the common case:
 *                              fringe players usually need both)
 *   - Caret dropdown:
 *       · Fetch stats only    → populate player_stats (background run, Pipeline tab)
 *       · Run compositing only → stats → Claude → composite → persist
 *
 * A player with no stats can't be composited, so the default does both in order.
 * In `review`, the composite leg confirms + reverts to draft (handled upstream).
 * Used by the Player Pool tab footer and the Publish tab's missing-composite footer.
 */

import { useEffect, useRef, useState } from "react";

interface PipelineActionMenuProps {
  id: string;
  /** Number of selected players the action will run on. */
  count: number;
  /** Default action (main button): fetch stats, then composite. */
  onCombined: () => void;
  onStatFetch: () => void;
  onComposite: () => void;
  /** True while any action is in flight — disables the trigger. */
  busy: boolean;
  /** Optional label shown on the trigger while busy (e.g. "Running…"). */
  busyLabel?: string;
}

export function PipelineActionMenu({
  id,
  count,
  onCombined,
  onStatFetch,
  onComposite,
  busy,
  busyLabel = "Working…",
}: PipelineActionMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const disabled = busy || count === 0;

  const choose = (run: () => void) => {
    setOpen(false);
    run();
  };

  return (
    <div ref={rootRef} className="relative inline-flex">
      {/* Primary segment — default combined action */}
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={onCombined}
        title="Fetch stats, then composite the selected players"
        className="inline-flex items-center font-semibold px-3 py-1.5 rounded-l-[4px]
          border border-r-0 border-[#d9d0c9] bg-white text-[#0e0907]
          hover:text-[#fe6d34] hover:border-[#fe6d34]
          focus:outline-none focus:ring-2 focus:ring-[#ffa05c] focus:ring-offset-1
          disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {busy ? busyLabel : `Run pipeline (${count})`}
      </button>
      {/* Caret segment — open the stage menu */}
      <button
        id={`${id}-caret`}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Choose a pipeline stage"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center px-1.5 py-1.5 rounded-r-[4px]
          border border-[#d9d0c9] bg-white text-[#0e0907]
          hover:text-[#fe6d34] hover:border-[#fe6d34]
          focus:outline-none focus:ring-2 focus:ring-[#ffa05c] focus:ring-offset-1
          disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <svg
          aria-hidden
          width="9"
          height="9"
          viewBox="0 0 10 10"
          className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        >
          <path d="M1.5 3 L5 7 L8.5 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[9998]" onMouseDown={() => setOpen(false)} />
          <div
            id={`${id}-menu`}
            role="menu"
            aria-label="Pipeline actions for the selected players"
            className="absolute right-0 bottom-full mb-1 z-[9999] w-64 rounded-lg border border-[#d9d0c9]
              bg-[#fff8f4] shadow-lg py-1"
          >
            <button
              id={`${id}-stat-fetch`}
              type="button"
              role="menuitem"
              onClick={() => choose(onStatFetch)}
              className="w-full text-left px-3 py-2 hover:bg-[#f7ede5] transition-colors"
            >
              <span className="block text-xs font-semibold text-[#0e0907]">
                Fetch stats ({count})
              </span>
              <span className="block text-[11px] text-neutral-500 mt-0.5 leading-snug">
                Pull NBA stats so these players can be composited. Runs in the background.
              </span>
            </button>
            <button
              id={`${id}-composite`}
              type="button"
              role="menuitem"
              onClick={() => choose(onComposite)}
              className="w-full text-left px-3 py-2 hover:bg-[#f7ede5] transition-colors border-t border-[#efe2d8]"
            >
              <span className="block text-xs font-semibold text-[#0e0907]">
                Run compositing ({count})
              </span>
              <span className="block text-[11px] text-neutral-500 mt-0.5 leading-snug">
                Stats → Claude → composite. Needs stats first; in review this moves the snapshot back to draft.
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
