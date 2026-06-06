"use client";

/**
 * PublishModal — publish dialog with label input, soft composite gate,
 * and hard open-flags gate with override + inline confirm panel.
 *
 * Publish button is disabled until:
 *   1. Label is non-empty
 *   2. If players_missing_composite > 0, the acknowledge checkbox is checked (soft)
 *   3. If open_flags > 0, the override is armed via the inline confirm flow (hard)
 *
 * State machine:
 *   - idle (openFlags === 0): publish enabled when label + composite ok
 *   - blocked (openFlags > 0, overrideOpenFlags false): publish DISABLED
 *   - confirmingOverride (checkbox checked, waiting for confirm): still DISABLED
 *   - armed (overrideOpenFlags true): publish enabled when all other gates ok
 *
 * Reset: all local state resets when `open` flips false.
 */

import { Modal } from "@/components/ui/Modal";
import { SEASON_FORMAT_MESSAGE } from "@/lib/season";
import { usePublishGate } from "./usePublishGate";

interface PublishModalProps {
  id: string;
  open: boolean;
  onClose: () => void;
  onPublish: (
    label: string,
    season: string,
    allowMissingComposite: boolean,
    allowOpenFlags: boolean,
  ) => Promise<void>;
  playersMissingComposite: number;
  openFlags: number;
  /**
   * Issue #72: the draft's current season, pre-filled into the editable Season
   * field. Required and validated (YYYY-YY) before publish.
   */
  initialSeason: string;
  isPublishing: boolean;
  /**
   * Issue #71: bump to disarm the override after a publish was refused because
   * the open-flags count changed under the admin (see usePublishGate).
   */
  resetSignal?: number;
  /**
   * Issue #71: true when the last publish attempt was refused with
   * open_flags_changed. Surfaces the count-changed Error State.
   */
  countChanged?: boolean;
}

export function PublishModal({
  id,
  open,
  onClose,
  onPublish,
  playersMissingComposite,
  openFlags,
  initialSeason,
  isPublishing,
  resetSignal = 0,
  countChanged = false,
}: PublishModalProps) {
  const {
    label,
    setLabel,
    season,
    setSeason,
    seasonOk,
    acknowledgedComposite,
    setAcknowledgedComposite,
    overrideOpenFlags,
    confirmingOverride,
    requiresCompositeAck,
    hasOpenFlagsGate,
    canPublish,
    onOverrideCheckboxChange,
    onConfirmOverride,
    onCancelOverride,
  } = usePublishGate({
    open,
    playersMissingComposite,
    openFlags,
    initialSeason,
    resetSignal,
  });

  const showSeasonError = season.trim().length > 0 && !seasonOk;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canPublish) return;
    await onPublish(
      label.trim(),
      season.trim(),
      acknowledgedComposite,
      overrideOpenFlags,
    );
  };

  const flagsText =
    openFlags === 1
      ? "1 open flag must be resolved before publish."
      : `${openFlags} open flags must be resolved before publish.`;

  const confirmBodyText =
    openFlags === 1
      ? `This bypasses required review. The Snapshot Release will freeze with 1 unresolved open flag. This cannot be undone.`
      : `This bypasses required review. The Snapshot Release will freeze with ${openFlags} unresolved open flags. This cannot be undone.`;

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

        {/* Issue #72: Season — required, editable, validated YYYY-YY. Pre-filled
            from the draft; the freeze + gates scope to this value. */}
        <div id={`${id}-season-group`} className="mb-4">
          <label
            id={`${id}-season-label`}
            htmlFor={`${id}-season-input`}
            className="block text-xs font-semibold text-[#0e0907] mb-1"
          >
            Season <span className="text-red-500">*</span>
          </label>
          <input
            id={`${id}-season-input`}
            type="text"
            value={season}
            onChange={(e) => setSeason(e.target.value)}
            placeholder="e.g. 2025-26"
            aria-invalid={showSeasonError}
            className="w-full rounded border border-[#d9d0c9] bg-white px-3 py-2 text-sm text-[#0e0907]
              placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-[#ffa05c] focus:ring-offset-1"
          />
          {showSeasonError ? (
            <p
              id={`${id}-season-error`}
              role="alert"
              className="text-xs text-[#fe6d34] mt-1"
            >
              {SEASON_FORMAT_MESSAGE}
            </p>
          ) : (
            <p id={`${id}-season-hint`} className="text-xs text-neutral-500 mt-1">
              The NBA season this release freezes and gates against.
            </p>
          )}
        </div>

        {/* Soft gate: Missing composite warning + acknowledge */}
        {requiresCompositeAck && (
          <div
            id={`${id}-missing-composite-section`}
            className="mb-4 rounded border border-amber-300 bg-amber-50 p-3"
          >
            <p
              id={`${id}-missing-composite-text`}
              className="text-xs text-amber-800 mb-2"
            >
              <strong>{playersMissingComposite} player(s)</strong> have no composite Skill Profile.
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
                checked={acknowledgedComposite}
                onChange={(e) => setAcknowledgedComposite(e.target.checked)}
                className="mt-0.5 rounded accent-amber-600"
              />
              I understand and want to publish anyway
            </label>
          </div>
        )}

        {/* Hard gate: Open flags gate — closest to actions */}
        {hasOpenFlagsGate && (
          <div
            id={`${id}-open-flags-section`}
            className="mb-4 rounded border border-[#fe6d34] bg-[#fef0ea] p-3"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#fe6d34]">
                Blocked
              </span>
            </div>
            <p
              id={`${id}-open-flags-text`}
              className="text-xs text-[#0e0907] mb-2"
            >
              {flagsText}
            </p>

            {/* Issue #71: count-changed Error State — the override was refused
                because more flags appeared since the dialog opened. */}
            {countChanged && (
              <p
                id={`${id}-open-flags-changed`}
                role="alert"
                className="text-xs font-semibold text-[#fe6d34] mb-2"
              >
                The open-flags count changed to {openFlags} while this dialog was
                open. Review the new count and confirm the override again.
              </p>
            )}

            <label
              id={`${id}-override-label`}
              htmlFor={`${id}-override-checkbox`}
              className="flex items-start gap-2 text-xs text-[#0e0907] cursor-pointer"
            >
              <input
                id={`${id}-override-checkbox`}
                type="checkbox"
                checked={confirmingOverride || overrideOpenFlags}
                onChange={(e) => onOverrideCheckboxChange(e.target.checked)}
                className="mt-0.5 rounded accent-[#fe6d34]"
              />
              Override and publish with unresolved open flags
            </label>

            {/* Inline confirm sub-panel */}
            {confirmingOverride && (
              <div
                id={`${id}-override-confirm`}
                className="mt-3 rounded border border-[#fe6d34]/30 bg-[#fde3d8] p-3"
              >
                <p
                  id={`${id}-override-confirm-text`}
                  className="text-xs text-[#0e0907] mb-3"
                >
                  {confirmBodyText}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    id={`${id}-override-confirm-btn`}
                    type="button"
                    onClick={onConfirmOverride}
                    className="text-xs font-semibold px-3 py-1.5 rounded-[4px]
                      bg-[#fe6d34] text-[#fef9f5] hover:bg-[#e55c24]
                      focus:outline-none focus:ring-2 focus:ring-[#fe6d34] focus:ring-offset-1
                      transition-colors"
                  >
                    Confirm override
                  </button>
                  <button
                    id={`${id}-override-cancel-btn`}
                    type="button"
                    onClick={onCancelOverride}
                    className="text-xs font-medium text-neutral-600 hover:text-[#0e0907] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
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
