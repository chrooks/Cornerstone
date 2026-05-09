"use client";

import { cn } from "@/lib/utils";
import type { PlayerWithSkills } from "@/lib/types";

const FONT_AWESOME_SHUFFLE_PATH =
  "M403.8 34.4c12-5 25.7-2.2 34.9 6.9l64 64c6 6 9.4 14.1 9.4 22.6s-3.4 16.6-9.4 22.6l-64 64c-9.2 9.2-22.9 11.9-34.9 6.9S384 204.9 384 192l0-32-32 0c-10.1 0-19.6 4.7-25.6 12.8l-32.4 43.2-40-53.3 21.2-28.3C293.3 110.2 321.8 96 352 96l32 0 0-32c0-12.9 7.8-24.6 19.8-29.6zM154 296l40 53.3-21.2 28.3C154.7 401.8 126.2 416 96 416l-64 0c-17.7 0-32-14.3-32-32s14.3-32 32-32l64 0c10.1 0 19.6-4.7 25.6-12.8L154 296zM438.6 470.6c-9.2 9.2-22.9 11.9-34.9 6.9S384 460.9 384 448l0-32-32 0c-30.2 0-58.7-14.2-76.8-38.4L121.6 172.8c-6-8.1-15.5-12.8-25.6-12.8l-64 0c-17.7 0-32-14.3-32-32S14.3 96 32 96l64 0c30.2 0 58.7 14.2 76.8 38.4L326.4 339.2c6 8.1 15.5 12.8 25.6 12.8l32 0 0-32c0-12.9 7.8-24.6 19.8-29.6s25.7-2.2 34.9 6.9l64 64c6 6 9.4 14.1 9.4 22.6s-3.4 16.6-9.4 22.6l-64 64z";

interface RandomPlayerButtonProps {
  id: string;
  players: PlayerWithSkills[];
  label: string;
  emptyLabel?: string;
  className?: string;
  onPick: (player: PlayerWithSkills) => void;
}

export function RandomPlayerButton({
  id,
  players,
  label,
  emptyLabel = label,
  className,
  onPick,
}: RandomPlayerButtonProps) {
  const hasPlayers = players.length > 0;

  return (
    <button
      id={id}
      type="button"
      disabled={!hasPlayers}
      onClick={() => {
        if (!hasPlayers) return;
        // Pick from caller-provided PlayerPool so active filters and sort define eligibility.
        const index = Math.floor(Math.random() * players.length);
        onPick(players[index]);
      }}
      className={cn(
        "inline-flex items-center gap-2 rounded-md border border-[#d9d0c9] bg-[#f7f7f7] px-3 py-2 text-[0.8125rem] font-medium text-[#0e0907] transition-colors",
        "hover:border-[#0e0907]/30 hover:bg-[#f0f0f0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ffa05c]",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[#d9d0c9] disabled:hover:bg-[#f7f7f7]",
        className,
      )}
    >
      <svg
        id={`${id}-icon`}
        viewBox="0 0 512 512"
        className="h-3.5 w-3.5"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d={FONT_AWESOME_SHUFFLE_PATH} />
      </svg>
      <span id={`${id}-label`}>{hasPlayers ? label : emptyLabel}</span>
    </button>
  );
}
