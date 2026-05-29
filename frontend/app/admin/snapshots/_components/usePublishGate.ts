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
