"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FeedbackTooltipProps {
  id: string;
  children: ReactNode;
  content: ReactNode;
  className?: string;
  tooltipClassName?: string;
  align?: "left" | "right";
  as?: "span" | "div";
}

export function FeedbackTooltip({
  id,
  children,
  content,
  className,
  tooltipClassName,
  align = "left",
}: FeedbackTooltipProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 352, placement: "top" as "top" | "bottom" });

  useEffect(() => {
    if (!isVisible || !anchorRef.current) return;

    const updatePosition = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;

      const width = Math.min(352, window.innerWidth - 32);
      const preferredLeft = align === "right" ? rect.right - width : rect.left;
      const left = Math.min(Math.max(16, preferredLeft), window.innerWidth - width - 16);
      const placement = rect.top > 180 ? "top" : "bottom";
      const top = placement === "top" ? rect.top - 8 : rect.bottom + 8;

      setPosition({ left, top, width, placement });
    };

    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [align, isVisible]);

  return (
    <div
      ref={anchorRef}
      className={cn(
        "relative flex cursor-help focus-within:outline-none",
        className,
      )}
      tabIndex={0}
      aria-describedby={id}
      onBlur={() => setIsVisible(false)}
      onFocus={() => setIsVisible(true)}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      {isVisible && typeof document !== "undefined" && createPortal(
        <div
          id={id}
          role="tooltip"
          className={cn(
            "pointer-events-none fixed z-[9999] border border-[#d9d0c9] bg-[#f8f3f1] p-3 text-left text-[0.75rem] leading-snug text-[#0e0907]/70 shadow-[0_4px_16px_rgba(14,9,7,0.08),0_1px_4px_rgba(14,9,7,0.04)]",
            position.placement === "top" ? "-translate-y-full" : "translate-y-0",
            tooltipClassName,
          )}
          style={{
            left: position.left,
            top: position.top,
            width: position.width,
          }}
        >
          {content}
        </div>,
        document.body,
      )}
    </div>
  );
}
