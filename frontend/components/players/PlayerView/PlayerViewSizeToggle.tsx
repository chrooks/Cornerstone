"use client";

import { LayoutGrid, PanelTop, Rows3 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlayerViewSize } from "./PlayerView";

interface PlayerViewSizeToggleProps {
  id: string;
  viewSize: PlayerViewSize;
  viewSizes: PlayerViewSize[];
  onViewSizeChange: (size: PlayerViewSize) => void;
  ready?: boolean;
  className?: string;
  activeClassName?: string;
  inactiveClassName?: string;
  borderClassName?: string;
}

const ICONS = {
  row: Rows3,
  card: LayoutGrid,
  panel: PanelTop,
} satisfies Record<PlayerViewSize, typeof Rows3>;

export function PlayerViewSizeToggle({
  id,
  viewSize,
  viewSizes,
  onViewSizeChange,
  ready = true,
  className,
  activeClassName = "bg-primary text-primary-foreground",
  inactiveClassName = "text-muted-foreground hover:text-foreground hover:bg-muted",
  borderClassName = "border-border",
}: PlayerViewSizeToggleProps) {
  if (!ready || viewSizes.length <= 1) return null;

  return (
    <div
      id={id}
      className={cn("flex w-fit rounded-md border overflow-hidden text-xs font-medium", borderClassName, className)}
    >
      {viewSizes.map((size, index) => {
        const Icon = ICONS[size];
        const active = viewSize === size;
        return (
          <button
            key={size}
            id={`${id}-${size}-btn`}
            type="button"
            onClick={() => onViewSizeChange(size)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 capitalize transition-colors",
              index > 0 && "border-l",
              index > 0 && borderClassName,
              active ? activeClassName : inactiveClassName,
            )}
          >
            <Icon aria-hidden="true" className="h-3.5 w-3.5" />
            <span>{size}</span>
          </button>
        );
      })}
    </div>
  );
}
