"use client";

/**
 * RunDiffActionBar — Commit and Discard actions for a reviewable staged run.
 *
 * Reuses the existing Modal component for the discard confirmation.
 * Single isActing flag disables both buttons during in-flight requests.
 */

import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/Modal";
import { commitPipelineRun, discardPipelineRun } from "@/lib/api";

interface RunDiffActionBarProps {
  runId: string;
  onCommitted: () => void;
  onDiscarded: () => void;
}

export function RunDiffActionBar({ runId, onCommitted, onDiscarded }: RunDiffActionBarProps) {
  const [isActing, setIsActing] = useState(false);
  const [discardModalOpen, setDiscardModalOpen] = useState(false);

  async function handleCommit() {
    setIsActing(true);
    try {
      const res = await commitPipelineRun(runId);
      if (res.success) {
        toast.success("Committed. Threshold edits unblocked.");
        onCommitted();
      } else {
        const err = res.error ?? "";
        if (err.includes("already_committed") || err.includes("run_not_in_success_state")) {
          toast.info(err);
          onCommitted();
        } else {
          toast.error(err || "Failed to commit run.");
        }
      }
    } catch {
      toast.error("Failed to commit run.");
    } finally {
      setIsActing(false);
    }
  }

  async function handleDiscard() {
    setDiscardModalOpen(false);
    setIsActing(true);
    try {
      const res = await discardPipelineRun(runId);
      if (res.success) {
        toast.success("Staged changes discarded");
        onDiscarded();
      } else {
        const err = res.error ?? "";
        if (err.includes("run_already_discarded") || err.includes("already_committed")) {
          toast.info(err);
          onDiscarded();
        } else {
          toast.error(err || "Failed to discard run.");
        }
      }
    } catch {
      toast.error("Failed to discard run.");
    } finally {
      setIsActing(false);
    }
  }

  return (
    <>
      <div
        id="diff-action-bar"
        className="flex items-center gap-3 pt-4 mt-4 border-t border-[#d9d0c9]"
      >
        <button
          id="diff-commit-btn"
          type="button"
          onClick={handleCommit}
          disabled={isActing || discardModalOpen}
          className={cn(
            "inline-flex items-center gap-2 px-5 py-2 rounded-[4px] text-xs font-semibold transition-colors",
            "bg-[#ffa05c] text-[#0e0907] hover:bg-[#fe6d34]",
            "focus:outline-none focus:ring-2 focus:ring-[#ffa05c] focus:ring-offset-2",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          {isActing ? (
            <>
              <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              Committing...
            </>
          ) : (
            "Commit"
          )}
        </button>

        <button
          id="diff-discard-btn"
          type="button"
          onClick={() => setDiscardModalOpen(true)}
          disabled={isActing}
          className={cn(
            "inline-flex items-center px-4 py-2 rounded-[4px] text-xs font-medium transition-colors",
            "border border-[#d9d0c9] bg-white text-neutral-600 hover:text-[#0e0907] hover:border-[#0e0907]",
            "focus:outline-none focus:ring-2 focus:ring-[#d9d0c9] focus:ring-offset-2",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          Discard
        </button>
      </div>

      <Modal
        id="diff-discard-modal"
        open={discardModalOpen}
        onClose={() => setDiscardModalOpen(false)}
        maxWidthClass="max-w-md"
        ariaLabelledBy="diff-discard-modal-title"
      >
        <h2 id="diff-discard-modal-title" className="text-sm font-semibold text-[#0e0907] mb-2">
          Discard staged changes?
        </h2>
        <p className="text-xs text-neutral-500 mb-5">
          Discards this run&apos;s staged changes. The draft working tables are untouched. This
          cannot be undone.
        </p>
        <div className="flex items-center justify-end gap-3">
          <button
            id="diff-discard-cancel"
            type="button"
            onClick={() => setDiscardModalOpen(false)}
            className={cn(
              "px-4 py-2 rounded-[4px] text-xs font-medium transition-colors",
              "border border-[#d9d0c9] bg-white text-neutral-600 hover:text-[#0e0907]"
            )}
          >
            Keep changes
          </button>
          <button
            id="diff-discard-confirm"
            type="button"
            onClick={handleDiscard}
            className={cn(
              "px-4 py-2 rounded-[4px] text-xs font-semibold transition-colors",
              "bg-red-600 text-white hover:bg-red-700",
              "focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
            )}
          >
            Discard changes
          </button>
        </div>
      </Modal>
    </>
  );
}
