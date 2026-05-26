"use client";

/**
 * ReactivateModal — Transparent Friction confirm dialog for reactivating a
 * previously published Snapshot Release.
 *
 * Names the target Release so the admin sees what they are activating, and
 * explains the consequence: the current active Snapshot is deactivated, and
 * Saved Teams that referenced it continue to render against their frozen
 * skill_profile_snapshot.
 */

import { Modal } from "@/components/ui/Modal";

interface ReactivateModalProps {
  id: string;
  open: boolean;
  label: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  isSubmitting: boolean;
}

export function ReactivateModal({
  id,
  open,
  label,
  onClose,
  onConfirm,
  isSubmitting,
}: ReactivateModalProps) {
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    await onConfirm();
  };

  return (
    <Modal
      id={id}
      open={open}
      onClose={onClose}
      maxWidthClass="max-w-md"
      ariaLabelledBy={`${id}-heading`}
    >
      <form id={`${id}-form`} onSubmit={handleSubmit}>
        <h2
          id={`${id}-heading`}
          className="text-base font-semibold text-[#0e0907] mb-1"
        >
          Reactivate &lsquo;{label}&rsquo;?
        </h2>
        <p
          id={`${id}-subtitle`}
          className="text-xs text-neutral-600 leading-relaxed mb-5"
        >
          The currently active Snapshot will be deactivated. Saved Teams that
          referenced the deactivated Snapshot continue to render against their
          frozen <code className="font-mono text-[11px]">skill_profile_snapshot</code>.
        </p>

        <div
          id={`${id}-actions`}
          className="flex items-center justify-end gap-3 mt-6"
        >
          <button
            id={`${id}-cancel-btn`}
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="text-xs font-medium text-neutral-600 hover:text-[#0e0907] transition-colors
              disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            id={`${id}-confirm-btn`}
            type="submit"
            disabled={isSubmitting}
            className="text-xs font-semibold px-5 py-2 rounded-[4px] transition-colors
              bg-[#ffa05c] text-[#0e0907] hover:bg-[#fe6d34]
              focus:outline-none focus:ring-2 focus:ring-[#ffa05c] focus:ring-offset-2
              disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Reactivating…" : "Reactivate"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
