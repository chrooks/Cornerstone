import {
  evalFilterEntries,
  parseHeight,
  POSITION_ORDER,
  tierToNum,
  type FilterEntry,
} from "@/components/players/playerFilters";
import type { SortKey } from "@/components/players/SortControls";
import type { PlayerWithSkills } from "@/lib/types";

function compareByKey(a: PlayerWithSkills, b: PlayerWithSkills, key: SortKey): number {
  const dir = key.direction === "asc" ? 1 : -1;

  const getVal = (player: PlayerWithSkills): number | string | null => {
    switch (key.field) {
      case "name": return player.name;
      case "team": return player.team ?? "";
      case "position": return POSITION_ORDER[player.position ?? ""] ?? 99;
      case "age": return player.age;
      case "height": return parseHeight(player.height);
      case "weight": return player.weight;
      case "salary": return player.salary;
      case "games_played": return player.games_played;
      case "minutes_per_game": return player.minutes_per_game;
      case "peak_year": return player.peak_year ?? null;
      case "capable_plus_count":
        return player.skills ? Object.values(player.skills).filter((tier) => tierToNum(tier) >= 1).length : 0;
      case "proficient_plus_count":
        return player.skills ? Object.values(player.skills).filter((tier) => tierToNum(tier) >= 2).length : 0;
      case "elite_plus_count":
        return player.skills ? Object.values(player.skills).filter((tier) => tierToNum(tier) >= 3).length : 0;
      case "alltime_plus_count":
        return player.skills ? Object.values(player.skills).filter((tier) => tierToNum(tier) >= 4).length : 0;
      default:
        return player.skills ? tierToNum(player.skills[key.field]) : 0;
    }
  };

  const av = getVal(a);
  const bv = getVal(b);

  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;

  if (typeof av === "string" && typeof bv === "string") {
    return av.localeCompare(bv) * dir;
  }

  return ((av as number) - (bv as number)) * dir;
}

export function stableMultiSort(players: PlayerWithSkills[], keys: SortKey[]): PlayerWithSkills[] {
  if (keys.length === 0) return players;
  return [...players].sort((a, b) => {
    for (const key of keys) {
      const cmp = compareByKey(a, b, key);
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
}

export function filterPlayerPool(
  players: PlayerWithSkills[],
  filterEntries: FilterEntry[],
): PlayerWithSkills[] {
  if (filterEntries.length === 0) return players;
  return players.filter((player) => evalFilterEntries(player, filterEntries));
}

export function paginatePlayerPool(
  players: PlayerWithSkills[],
  page: number,
  pageSize: number,
): PlayerWithSkills[] {
  const start = (page - 1) * pageSize;
  return players.slice(start, start + pageSize);
}
