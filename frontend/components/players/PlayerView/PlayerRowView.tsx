"use client";

import { cn } from "@/lib/utils";
import { ALL_SKILL_NAMES } from "@/lib/skills";
import type { PlayerWithSkills } from "@/lib/types";

interface PlayerRowColumn {
  key: string;
  label: string;
  sticky?: boolean;
  defaultWidth: number;
  minWidth: number;
}

interface PlayerRowViewProps {
  player: PlayerWithSkills;
  columns: PlayerRowColumn[];
  columnWidths: Record<string, number>;
  disabled?: boolean;
  /** Dimmed but still interactive (e.g. excluded from snapshot). */
  muted?: boolean;
  highlighted?: boolean;
  clickable?: boolean;
  legend?: boolean;
  onClick?: (event: React.MouseEvent) => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  onDragStart?: (event: React.DragEvent) => void;
  onHover?: () => void;
  onHoverEnd?: () => void;
  onSkillContextMenu?: (event: React.MouseEvent, player: PlayerWithSkills, skillKey: string) => void;
  onSkillOverrideEnabled?: boolean;
  renderCell: (player: PlayerWithSkills, column: PlayerRowColumn) => React.ReactNode;
}

export function PlayerRowView({
  player,
  columns,
  columnWidths,
  disabled = false,
  muted = false,
  highlighted = false,
  clickable = false,
  legend = false,
  onClick,
  onContextMenu,
  onDragStart,
  onHover,
  onHoverEnd,
  onSkillContextMenu,
  onSkillOverrideEnabled = false,
  renderCell,
}: PlayerRowViewProps) {
  return (
    <tr
      id={`player-row-view-${player.id}`}
      draggable={!!onDragStart && !disabled}
      onDragStart={onDragStart && !disabled ? onDragStart : undefined}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={onHover}
      onMouseLeave={onHoverEnd}
      className={cn(
        "border-b border-border transition-colors group",
        disabled
          ? "opacity-40 cursor-not-allowed"
          : clickable
          ? "cursor-pointer hover:bg-blue-50/60 dark:hover:bg-blue-950/20"
          : legend
          ? "bg-amber-50/30 dark:bg-amber-950/10 cursor-default"
          : "hover:bg-muted/40 cursor-pointer",
        // Muted (e.g. excluded from snapshot): dimmed + desaturated, still interactive.
        muted && !disabled && "opacity-55 grayscale-[0.4]",
        highlighted && "!opacity-100 bg-amber-100/70 dark:bg-amber-900/30 outline outline-2 outline-amber-400/80 outline-offset-[-2px]",
      )}
    >
      {columns.map((column) => {
        const isSkillColumn = ALL_SKILL_NAMES.includes(column.key);
        return (
          <td
            key={column.key}
            style={{ width: columnWidths[column.key] ?? column.defaultWidth }}
            className={cn(
              "px-2 py-1.5 whitespace-nowrap overflow-hidden text-ellipsis",
              column.sticky && "sticky left-0 z-10 bg-background group-hover:bg-muted border-r border-border transition-colors",
              column.sticky && highlighted && "!bg-amber-100/70 dark:!bg-amber-900/30",
              isSkillColumn && onSkillOverrideEnabled && "cursor-context-menu",
            )}
            onContextMenu={
              isSkillColumn && onSkillContextMenu
                ? (event) => onSkillContextMenu(event, player, column.key)
                : undefined
            }
          >
            {renderCell(player, column)}
          </td>
        );
      })}
    </tr>
  );
}
