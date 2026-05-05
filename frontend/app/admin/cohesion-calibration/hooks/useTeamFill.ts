/**
 * useTeamFill — Loads the active player list and derives team options for the team-fill feature.
 */

import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { listPlayersWithSkills } from "@/lib/api";
import type { PlayerWithSkills } from "@/lib/types";

export function useTeamFill() {
  const [teamFillPlayers, setTeamFillPlayers] = useState<PlayerWithSkills[]>([]);
  const [teamFillLoading, setTeamFillLoading] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState("");

  // Derived: sorted list of unique team names
  const teamOptions = useMemo(
    () => Array.from(new Set(
      teamFillPlayers
        .filter((player) => !player.is_legend && player.team)
        .map((player) => player.team as string),
    )).sort((a, b) => a.localeCompare(b)),
    [teamFillPlayers],
  );

  /** Load active player rows for team-fill shortcuts on mount. */
  useEffect(() => {
    let cancelled = false;

    listPlayersWithSkills()
      .then((res) => {
        if (cancelled) return;
        if (res.success && res.data) {
          setTeamFillPlayers(res.data.filter((player) => !player.is_legend));
        } else {
          toast.error(res.error ?? "Failed to load team list");
        }
      })
      .catch(() => {
        if (!cancelled) toast.error("Failed to load team list");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    teamFillPlayers,
    teamFillLoading,
    setTeamFillLoading,
    selectedTeam,
    setSelectedTeam,
    teamOptions,
  };
}
