"use client";

import { PlayerCardView } from "./PlayerCardView";
import { PlayerPanelView } from "./PlayerPanelView";
import type { ReactNode } from "react";
import type { PlayerWithSkills } from "@/lib/types";
import type { RuleSetCurrency } from "@/lib/builder-config";

export type PlayerViewSize = "row" | "card" | "panel";

interface PlayerViewProps {
  size: Exclude<PlayerViewSize, "row">;
  player: PlayerWithSkills;
  skills?: Record<string, string | null | undefined> | null;
  disabled?: boolean;
  /** Dimmed but still interactive (e.g. excluded from snapshot). */
  muted?: boolean;
  highlighted?: boolean;
  primaryActionLabel?: string;
  onPrimaryAction?: (player: PlayerWithSkills) => void;
  onOpenProfile?: (player: PlayerWithSkills) => void;
  onHover?: (player: PlayerWithSkills) => void;
  onHoverEnd?: () => void;
  onDragStart?: (event: React.DragEvent, player: PlayerWithSkills) => void;
  onContextMenu?: (event: React.MouseEvent, player: PlayerWithSkills) => void;
  fitContent?: ReactNode;
  /** Pricing currency for the displayed price (#124). Defaults to "market". */
  currency?: RuleSetCurrency;
}

export function PlayerView({ size, skills, ...props }: PlayerViewProps) {
  if (size === "panel") {
    return <PlayerPanelView {...props} skills={skills} />;
  }
  return <PlayerCardView {...props} />;
}
