"use client";

/**
 * DiscardActions — "Other actions" ghost trigger with dropdown.
 *
 * Actions:
 *  1. Discard draft — single confirm modal
 *  2. Reset working state from active Snapshot — confirm requires typing RESET
 *
 * Transparent Friction: discard is simple confirm; reset requires typing RESET.
 */

import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { discardDraft, resetWorkingState } from "@/lib/api";

interface DiscardActionsProps {
  id: string;
  draftId: string;
  onDiscarded: () => void;
}

export function DiscardActions({ id, draftId, onDiscarded }: DiscardActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [discardModalOpen, setDiscardModalOpen] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetInput, setResetInput] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const handleDiscard = async () => {
    setIsWorking(true);
    try {
      const res = await discardDraft(draftId);
      if (res.success) {
        toast.success("Draft discarded");
        setDiscardModalOpen(false);
        onDiscarded();
      } else {
        toast.error(res.error ?? "Failed to discard draft");
      }
    } catch {
      toast.error("Failed to discard draft");
    } finally {
      setIsWorking(false);
    }
  };

  const handleReset = async () => {
    if (resetInput !== "RESET") return;
    setIsWorking(true);
    try {
      const res = await resetWorkingState();
      if (res.success) {
        toast.success("Working state reset from active Snapshot");
        setResetModalOpen(false);
        setResetInput("");
      } else {
        toast.error(res.error ?? "Failed to reset working state");
      }
    } catch {
      toast.error("Failed to reset working state");
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <div id={id} className="relative" ref={menuRef}>
      {/* Ghost trigger */}
      <button
        id={`${id}-trigger`}
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="text-xs font-medium text-neutral-500 hover:text-[#0e0907] transition-colors
          border border-[#d9d0c9] rounded-[4px] px-3 py-1.5"
      >
        Other actions ▾
      </button>

      {/* Dropdown */}
      {menuOpen && (
        <div
          id={`${id}-menu`}
          className="absolute right-0 bottom-full mb-1 w-64 rounded-[6px] border border-[#d9d0c9] bg-white
            shadow-lg z-10 overflow-hidden"
        >
          <button
            id={`${id}-discard-item`}
            type="button"
            onClick={() => { setMenuOpen(false); setDiscardModalOpen(true); }}
            className="w-full px-4 py-2.5 text-left text-xs text-[#0e0907] hover:bg-neutral-50
              transition-colors"
          >
            Discard draft
            <span className="block text-[11px] text-neutral-400 mt-0.5">
              Deletes the draft row. Live tables are untouched.
            </span>
          </button>
          <div className="border-t border-[#d9d0c9]" />
          <button
            id={`${id}-reset-item`}
            type="button"
            onClick={() => { setMenuOpen(false); setResetModalOpen(true); }}
            className="w-full px-4 py-2.5 text-left text-xs text-red-700 hover:bg-red-50
              transition-colors"
          >
            Reset working state from active Snapshot
            <span className="block text-[11px] text-neutral-400 mt-0.5">
              Overwrites live draft_skill_profiles and player salaries.
            </span>
          </button>
        </div>
      )}

      {/* Discard confirm modal */}
      <Modal id={`${id}-discard-modal`} open={discardModalOpen} onClose={() => setDiscardModalOpen(false)}>
        <h2 id={`${id}-discard-heading`} className="text-base font-semibold text-[#0e0907] mb-2">
          Discard this draft?
        </h2>
        <p id={`${id}-discard-body`} className="text-xs text-neutral-600 mb-5">
          The draft row will be permanently deleted. Live tables are untouched — any
          pipeline output from this draft remains in <code className="font-mono">draft_skill_profiles</code>.
          A new draft can be created immediately.
        </p>
        <div id={`${id}-discard-actions`} className="flex justify-end gap-3">
          <button
            id={`${id}-discard-cancel`}
            type="button"
            onClick={() => setDiscardModalOpen(false)}
            className="text-xs font-medium text-neutral-600 hover:text-[#0e0907] transition-colors"
          >
            Keep draft
          </button>
          <button
            id={`${id}-discard-confirm`}
            type="button"
            onClick={handleDiscard}
            disabled={isWorking}
            className="text-xs font-semibold px-4 py-1.5 rounded-[4px] bg-red-600 text-white
              hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            {isWorking ? "Discarding…" : "Discard draft"}
          </button>
        </div>
      </Modal>

      {/* Reset confirm modal — requires typing RESET (Transparent Friction) */}
      <Modal id={`${id}-reset-modal`} open={resetModalOpen} onClose={() => { setResetModalOpen(false); setResetInput(""); }}>
        <h2 id={`${id}-reset-heading`} className="text-base font-semibold text-red-700 mb-2">
          Reset working state from active Snapshot
        </h2>
        <p id={`${id}-reset-body`} className="text-xs text-neutral-600 mb-3">
          This will <strong>overwrite</strong> all live{" "}
          <code className="font-mono">composite</code> and{" "}
          <code className="font-mono">stats</code> draft_skill_profiles for the current season,
          and reset player salary/team/position to the values frozen in the active published Snapshot.
          Any pipeline output from this draft will be lost.
        </p>
        <p id={`${id}-reset-instruction`} className="text-xs font-semibold text-[#0e0907] mb-2">
          Type <span className="font-mono bg-neutral-100 px-1 rounded">RESET</span> to confirm:
        </p>
        <input
          id={`${id}-reset-input`}
          type="text"
          value={resetInput}
          onChange={(e) => setResetInput(e.target.value)}
          placeholder="RESET"
          className="w-full rounded border border-[#d9d0c9] bg-white px-3 py-2 text-sm
            font-mono text-[#0e0907] placeholder:text-neutral-300
            focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-1 mb-5"
        />
        <div id={`${id}-reset-actions`} className="flex justify-end gap-3">
          <button
            id={`${id}-reset-cancel`}
            type="button"
            onClick={() => { setResetModalOpen(false); setResetInput(""); }}
            className="text-xs font-medium text-neutral-600 hover:text-[#0e0907] transition-colors"
          >
            Cancel
          </button>
          <button
            id={`${id}-reset-confirm`}
            type="button"
            onClick={handleReset}
            disabled={resetInput !== "RESET" || isWorking}
            className="text-xs font-semibold px-4 py-1.5 rounded-[4px] bg-red-600 text-white
              hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isWorking ? "Resetting…" : "Reset working state"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
