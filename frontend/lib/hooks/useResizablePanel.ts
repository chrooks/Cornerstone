/**
 * useResizablePanel — Generic drag-to-resize logic for split panel layouts.
 *
 * Handles both horizontal (col-resize) and vertical (row-resize) drag interactions.
 * Returns refs for the container elements and mouse-down handlers for resize handles.
 */

import React, { useCallback, useRef, useState } from "react";

export interface UseResizablePanelReturn {
  /** Fraction of container width allocated to the right panel (0.0–1.0). */
  rightPanelFrac: number;
  /** Fraction of container height allocated to the top section (0.0–1.0). */
  topPanelFrac: number;
  /** Ref for the horizontal split container (needed for width measurement). */
  splitRef: React.RefObject<HTMLDivElement>;
  /** Ref for the left/top panel container (needed for height measurement). */
  leftPanelRef: React.RefObject<HTMLDivElement>;
  /** Mouse-down handler for the horizontal (col) resize handle. */
  handleResizeStart: (e: React.MouseEvent) => void;
  /** Mouse-down handler for the vertical (row) resize handle. */
  handleVerticalResizeStart: (e: React.MouseEvent) => void;
}

interface UseResizablePanelOptions {
  /** Initial right panel width fraction. Default: 0.27 */
  initialRightFrac?: number;
  /** Min right panel fraction. Default: 0.20 */
  minRightFrac?: number;
  /** Max right panel fraction. Default: 0.55 */
  maxRightFrac?: number;
  /** Initial top panel height fraction. Default: 0.42 */
  initialTopFrac?: number;
  /** Min top panel fraction. Default: 0.28 */
  minTopFrac?: number;
  /** Max top panel fraction. Default: 0.42 */
  maxTopFrac?: number;
}

export function useResizablePanel(options: UseResizablePanelOptions = {}): UseResizablePanelReturn {
  const {
    initialRightFrac = 0.27,
    minRightFrac = 0.20,
    maxRightFrac = 0.55,
    initialTopFrac = 0.42,
    minTopFrac = 0.28,
    maxTopFrac = 0.42,
  } = options;

  const [rightPanelFrac, setRightPanelFrac] = useState(initialRightFrac);
  const [topPanelFrac, setTopPanelFrac] = useState(initialTopFrac);

  const splitRef = useRef<HTMLDivElement>(null) as React.RefObject<HTMLDivElement>;
  const leftPanelRef = useRef<HTMLDivElement>(null) as React.RefObject<HTMLDivElement>;
  const isDraggingRef = useRef(false);
  const isVerticalDraggingRef = useRef(false);

  // ── Horizontal resize (right panel width) ────────────────────────────────
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    const startX = e.clientX;
    const startFrac = rightPanelFrac;

    const onMove = (moveEvent: MouseEvent) => {
      if (!splitRef.current || !isDraggingRef.current) return;
      const containerWidth = splitRef.current.getBoundingClientRect().width;
      const dx = moveEvent.clientX - startX;
      const deltaFrac = dx / containerWidth;
      // Right panel grows when handle moves left (subtract delta)
      const newFrac = Math.max(minRightFrac, Math.min(maxRightFrac, startFrac - deltaFrac));
      setRightPanelFrac(newFrac);
    };

    const onUp = () => {
      isDraggingRef.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [rightPanelFrac, minRightFrac, maxRightFrac]);

  // ── Vertical resize (top panel height) ───────────────────────────────────
  const handleVerticalResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isVerticalDraggingRef.current = true;
    const startY = e.clientY;
    const startFrac = topPanelFrac;

    const onMove = (moveEvent: MouseEvent) => {
      if (!leftPanelRef.current || !isVerticalDraggingRef.current) return;
      const containerHeight = leftPanelRef.current.getBoundingClientRect().height;
      const dy = moveEvent.clientY - startY;
      const deltaFrac = dy / containerHeight;
      const newFrac = Math.max(minTopFrac, Math.min(maxTopFrac, startFrac + deltaFrac));
      setTopPanelFrac(newFrac);
    };

    const onUp = () => {
      isVerticalDraggingRef.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, [topPanelFrac, minTopFrac, maxTopFrac]);

  return {
    rightPanelFrac,
    topPanelFrac,
    splitRef,
    leftPanelRef,
    handleResizeStart,
    handleVerticalResizeStart,
  };
}
