"use client";

/**
 * PublishModal — publish dialog with label input + acknowledge checkbox.
 *
 * Publish button is disabled until:
 *   1. Label is non-empty
 *   2. If players_missing_composite > 0, the acknowledge checkbox is checked
 */

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";

interface PublishModalProps {
  id: string;
  open: boolean;
  onClose: () => void;
  onPublish: (label: string, allowMissingComposite: boolean) => Promise<void>;
  playersMissingComposite: number;
  isPublishing: boolean;
}

export function PublishModal({
  id,
  open,
  onClose,
  onPublish,
  playersMissingComposite,
  isPublishing,
}: PublishModalProps) {
  const [label, setLabel] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  const requiresAcknowledge = playersMissingComposite > 0;
  const canPublish =
    label.trim().length > 0 &&
    (!requiresAcknowledge || acknowledged);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canPublish) return;
    await onPublish(label.trim(), acknowledged);
  };

  return (
    <Modal id={id} open={open} onClose={onClose} maxWidthClass="max-w-md">
      <form id={`${id}-form`} onSubmit={handleSubmit}>
        <h2 id={`${id}-heading`} className="text-base font-semibold text-[#0e0907] mb-1">
          Publish Snapshot
        </h2>
        <p id={`${id}-subtitle`} className="text-xs text-neutral-500 mb-5">
          Publishing freezes the current live player state into an immutable Snapshot Release.
          This cannot be undone.
        </p>

        {/* Label input */}
        <div id={`${id}-label-group`} className="mb-4">
          <label
            id={`${id}-label-label`}
            htmlFor={`${id}-label-input`}
            className="block text-xs font-semibold text-[#0e0907] mb-1"
          >
            Release label <span className="text-red-500">*</span>
          </label>
          <input
            id={`${id}-label-input`}
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. 2025-26 Nov refresh"
            className="w-full rounded border border-[#d9d0c9] bg-white px-3 py-2 text-sm text-[#0e0907]
              placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-[#ffa05c] focus:ring-offset-1"
          />
        </div>

        {/* Missing composite warning + acknowledge */}
        {requiresAcknowledge && (
          <div
            id={`${id}-missing-composite-section`}
            className="mb-4 rounded border border-amber-300 bg-amber-50 p-3"
          >
            <p
              id={`${id}-missing-composite-text`}
              className="text-xs text-amber-800 mb-2"
            >
              <strong>{playersMissingComposite} player(s)</strong> have no composite profile.
              They will be frozen with an empty skill profile.
            </p>
            <label
              id={`${id}-acknowledge-label`}
              htmlFor={`${id}-acknowledge-checkbox`}
              className="flex items-start gap-2 text-xs text-amber-800 cursor-pointer"
            >
              <input
                id={`${id}-acknowledge-checkbox`}
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5 rounded accent-amber-600"
              />
              I understand and want to publish anyway
            </label>
          </div>
        )}

        {/* Actions */}
        <div id={`${id}-actions`} className="flex items-center justify-end gap-3 mt-6">
          <button
            id={`${id}-cancel-btn`}
            type="button"
            onClick={onClose}
            disabled={isPublishing}
            className="text-xs font-medium text-neutral-600 hover:text-[#0e0907] transition-colors
              disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            id={`${id}-publish-btn`}
            type="submit"
            disabled={!canPublish || isPublishing}
            className="text-xs font-semibold px-5 py-2 rounded-[4px] transition-colors
              bg-[#ffa05c] text-[#0e0907] hover:bg-[#fe6d34]
              focus:outline-none focus:ring-2 focus:ring-[#ffa05c] focus:ring-offset-2
              disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPublishing ? "Publishing…" : "Publish"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
