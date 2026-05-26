"use client";

/**
 * Modal — portal + backdrop primitive.
 *
 * Tokens (from architect spec):
 *  backdrop: Scoreboard Black 60% alpha
 *  panel: Card White #f7f7f7, 1px Warm Border #d9d0c9, 6px radius, 24px padding, no shadow
 */

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface ModalProps {
  id: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Maximum width class, e.g. "max-w-md". Defaults to max-w-lg. */
  maxWidthClass?: string;
}

export function Modal({ id, open, onClose, children, maxWidthClass = "max-w-lg" }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Prevent body scroll while open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      id={`${id}-backdrop`}
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(14, 9, 7, 0.6)" }}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div
        id={id}
        role="dialog"
        aria-modal="true"
        className={cn(
          "w-full rounded-[6px] p-6",
          "border border-[#d9d0c9]",
          maxWidthClass,
        )}
        style={{ backgroundColor: "#f7f7f7" }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
