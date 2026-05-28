"use client";

/**
 * PanelResizeHandle — Draggable resize handle between panels.
 *
 * Renders a thin vertical bar that the user drags to resize adjacent panels.
 * Uses pointer capture for reliable dragging even when the cursor leaves the handle.
 */

import { useCallback, useRef } from "react";

interface PanelResizeHandleProps {
  /** Called continuously during drag with the horizontal delta in pixels. */
  onResize: (deltaX: number) => void;
  id?: string;
}

export function PanelResizeHandle({ onResize, id }: PanelResizeHandleProps) {
  const startXRef = useRef(0);
  const draggingRef = useRef(false);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    startXRef.current = e.clientX;
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const delta = e.clientX - startXRef.current;
    startXRef.current = e.clientX;
    onResize(delta);
  }, [onResize]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  return (
    <div
      id={id}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className="w-[5px] flex-shrink-0 cursor-col-resize bg-transparent hover:bg-primary/10 active:bg-primary/20 transition-colors relative group"
      style={{ touchAction: "none" }}
    >
      {/* Visual indicator — subtle dots in center */}
      <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border group-hover:bg-primary/30 group-active:bg-primary/50 transition-colors" />
    </div>
  );
}
