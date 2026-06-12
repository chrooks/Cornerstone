"use client";

/**
 * RunPipelineConfirmDialog — confirm gate for running the compositing pipeline
 * while a snapshot is in `review`.
 *
 * The pipeline changes Skill ratings, so running it on a frozen review snapshot
 * moves it back to `draft`. This dialog surfaces that consequence before it
 * happens (Transparent Friction) rather than reverting silently.
 */

interface RunPipelineConfirmDialogProps {
  id: string;
  /** Number of selected players the run will composite. */
  count: number;
  /** "combined" prepends a Stat Fetch leg before compositing. */
  mode?: "composite" | "combined";
  isRunning: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RunPipelineConfirmDialog({
  id,
  count,
  mode = "composite",
  isRunning,
  onConfirm,
  onCancel,
}: RunPipelineConfirmDialogProps) {
  const lead =
    mode === "combined"
      ? `Fetching stats then compositing ${count} player${count !== 1 ? "s" : ""}`
      : `Compositing ${count} player${count !== 1 ? "s" : ""}`;
  return (
    <div
      id={`${id}-overlay`}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 px-4"
      onMouseDown={() => {
        if (!isRunning) onCancel();
      }}
    >
      <div
        id={id}
        role="alertdialog"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        className="w-full max-w-md rounded-[8px] border border-[#d9d0c9] bg-[#fef9f5] p-6 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={`${id}-title`} className="text-base font-semibold text-[#0e0907]">
          Run pipeline and move back to draft?
        </h2>
        <p id={`${id}-body`} className="mt-2 text-sm leading-relaxed text-neutral-600">
          {lead} changes their Skill ratings. This snapshot is in review, so it
          will move back to <strong className="text-[#0e0907]">draft</strong> and
          open the <strong className="text-[#0e0907]">Review</strong> tab so you
          can resolve any new flags. Move it back to review when you&rsquo;re
          ready to publish.
        </p>
        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            id={`${id}-cancel`}
            type="button"
            onClick={onCancel}
            disabled={isRunning}
            className="text-xs font-medium px-3 py-1.5 rounded-[4px] border border-[#d9d0c9]
              bg-white text-neutral-600 hover:text-[#0e0907] transition-colors
              disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            id={`${id}-confirm`}
            type="button"
            onClick={onConfirm}
            disabled={isRunning}
            className="text-xs font-semibold px-4 py-1.5 rounded-[4px]
              bg-[#ffa05c] text-[#0e0907] hover:bg-[#fe6d34]
              focus:outline-none focus:ring-2 focus:ring-[#ffa05c] focus:ring-offset-1
              disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isRunning ? "Running…" : "Run and move to draft"}
          </button>
        </div>
      </div>
    </div>
  );
}
