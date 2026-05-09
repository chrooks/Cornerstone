"use client";

import { useRouter } from "next/navigation";
import { PlayerCardView } from "@/components/players/PlayerView";
import type { PlayerWithSkills } from "@/lib/types";

interface PlayerCardProps {
  player: PlayerWithSkills;
  isAdmin?: boolean;
}

export function PlayerCard({ player, isAdmin }: PlayerCardProps) {
  const router = useRouter();
  const profilePath = isAdmin ? `/admin/players/${player.id}` : `/players/${player.id}`;

  return (
    <PlayerCardView
      player={player}
      onOpenProfile={
        player.is_legend
          ? undefined
          : () => {
              router.push(profilePath);
            }
      }
    />
  );
}
