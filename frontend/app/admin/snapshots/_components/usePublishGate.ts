"use client";

/**
 * usePublishGate — the publish-dialog gate state machine, extracted from
 * PublishModal so the logic is testable in isolation and the component stays
 * presentational. Behavior is identical to the prior inline implementation.
 *
 * States:
 *   - idle (openFlags === 0): canPublish once label + composite ack ok
 *   - blocked (openFlags > 0, override not armed): canPublish false
 *   - confirmingOverride (checkbox checked, awaiting confirm): still false
 *   - armed (overrideOpenFlags true): canPublish once other gates ok
 *
 * All state resets when `open` flips false so a cancelled override never
 * persists into the next open.
 */

import { useEffect, useState } from "react";

export interface UsePublishGateParams {
  open: boolean;
  playersMissingComposite: number;
  openFlags: number;
  /**
   * Issue #71: bump this to force the open-flags override to disarm without
   * closing the modal. Used when the publish attempt is refused because the live
   * open-flags count changed under the admin — they must re-confirm against the
   * new count. The label is preserved so the admin doesn't retype it.
   */
  resetSignal?: number;
}

export interface PublishGate {
  label: string;
  setLabel: (value: string) => void;
  acknowledgedComposite: boolean;
  setAcknowledgedComposite: (value: boolean) => void;
  overrideOpenFlags: boolean;
  confirmingOverride: boolean;
  requiresCompositeAck: boolean;
  hasOpenFlagsGate: boolean;
  canPublish: boolean;
  onOverrideCheckboxChange: (checked: boolean) => void;
  onConfirmOverride: () => void;
  onCancelOverride: () => void;
}

export function usePublishGate({
  open,
  playersMissingComposite,
  openFlags,
  resetSignal = 0,
}: UsePublishGateParams): PublishGate {
  const [label, setLabel] = useState("");
  const [acknowledgedComposite, setAcknowledgedComposite] = useState(false);
  const [overrideOpenFlags, setOverrideOpenFlags] = useState(false);
  const [confirmingOverride, setConfirmingOverride] = useState(false);

  // Reset all local state when the modal closes.
  useEffect(() => {
    if (!open) {
      setLabel("");
      setAcknowledgedComposite(false);
      setOverrideOpenFlags(false);
      setConfirmingOverride(false);
    }
  }, [open]);

  // Issue #71: when resetSignal changes (count moved under the admin), disarm the
  // override so they must re-acknowledge the new count. Skip the initial mount
  // (resetSignal === 0) and never touch the label.
  useEffect(() => {
    if (resetSignal === 0) return;
    setOverrideOpenFlags(false);
    setConfirmingOverride(false);
  }, [resetSignal]);

  const requiresCompositeAck = playersMissingComposite > 0;
  const hasOpenFlagsGate = openFlags > 0;

  const labelOk = label.trim().length > 0;
  const compositeOk = !requiresCompositeAck || acknowledgedComposite;
  const openFlagsOk = !hasOpenFlagsGate || overrideOpenFlags;
  const canPublish = labelOk && compositeOk && openFlagsOk;

  const onOverrideCheckboxChange = (checked: boolean) => {
    if (checked) {
      // Checking starts the confirmation flow — override is NOT yet armed.
      setConfirmingOverride(true);
    } else {
      // Unchecking collapses the confirm panel and disarms.
      setConfirmingOverride(false);
      setOverrideOpenFlags(false);
    }
  };

  const onConfirmOverride = () => {
    setOverrideOpenFlags(true);
    setConfirmingOverride(false);
  };

  const onCancelOverride = () => {
    setConfirmingOverride(false);
    setOverrideOpenFlags(false);
  };

  return {
    label,
    setLabel,
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
  };
}
