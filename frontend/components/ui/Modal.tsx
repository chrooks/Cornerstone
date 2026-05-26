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
  /** Element id of the dialog's heading, wired to `aria-labelledby`. */
  ariaLabelledBy?: string;
}

// Tabbable selector — matches the canonical focus-trap set without pulling in a
// dependency. Filtering for `:not([disabled])` and `[tabindex='-1']` handles
// disabled and programmatically-focused-only nodes.
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "object",
  "embed",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1,
  );
}

export function Modal({
  id,
  open,
  onClose,
  children,
  maxWidthClass = "max-w-lg",
  ariaLabelledBy,
}: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // Close on Escape + trap Tab/Shift-Tab inside the dialog
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusable = getFocusable(panel);
      if (focusable.length === 0) {
        // Nothing tabbable inside — keep focus on the panel itself
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !panel.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Prevent body scroll, capture the opener, move focus into the dialog, and
  // restore focus to the opener on close.
  useEffect(() => {
    if (open) {
      openerRef.current = (document.activeElement as HTMLElement) ?? null;
      document.body.style.overflow = "hidden";

      // Defer focus to next tick so the portal has mounted children
      const id = window.requestAnimationFrame(() => {
        const panel = panelRef.current;
        if (!panel) return;
        const focusable = getFocusable(panel);
        if (focusable.length > 0) {
          focusable[0].focus();
        } else {
          panel.tabIndex = -1;
          panel.focus();
        }
      });
      return () => {
        window.cancelAnimationFrame(id);
        document.body.style.overflow = "";
        openerRef.current?.focus?.();
        openerRef.current = null;
      };
    }
    return;
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
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
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
