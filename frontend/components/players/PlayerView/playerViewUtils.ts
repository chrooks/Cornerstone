"use client";

import { SKILL_TYPE_PRIORITY } from "@/lib/skills";
import type {
  CompositeSkillResult,
  LegendDetail,
  PlayerProfile,
  PlayerWithSkills,
  SkillTier,
} from "@/lib/types";
import { tierToNum } from "@/components/players/playerFilters";

export interface SkillEntry {
  name: string;
  tier: string;
}

export type SimpleSkillProfile = Record<string, string | null | undefined>;

export function getTopSkills(skills: SimpleSkillProfile | null | undefined): SkillEntry[] {
  if (!skills) return [];
  return Object.entries(skills)
    .filter(([, tier]) => tier != null && tier !== "None")
    .sort(([nameA, tierA], [nameB, tierB]) => {
      const tierDiff = tierToNum(tierB ?? "None") - tierToNum(tierA ?? "None");
      if (tierDiff !== 0) return tierDiff;
      return (SKILL_TYPE_PRIORITY[nameA] ?? 1) - (SKILL_TYPE_PRIORITY[nameB] ?? 1);
    })
    .map(([name, tier]) => ({ name, tier: tier ?? "None" }));
}

export function skillCountAtOrAbove(player: PlayerWithSkills, minTier: number): number {
  if (!player.skills) return 0;
  return Object.values(player.skills).filter((tier) => tierToNum(tier) >= minTier).length;
}

export function formatPlayerSalary(salary: number | null | undefined): string {
  if (salary == null) return "--";
  if (salary >= 1_000_000) return `$${(salary / 1_000_000).toFixed(1)}m`;
  return `$${Math.round(salary / 1000)}k`;
}

export function profileSkillsToSimple(
  skills: Record<string, CompositeSkillResult> | null | undefined,
): Record<string, SkillTier> | null {
  if (!skills) return null;
  return Object.fromEntries(
    Object.entries(skills).map(([skillName, result]) => [
      skillName,
      (result.final_tier ?? "None") as SkillTier,
    ]),
  );
}

function toComposite(tier: string | null | undefined): CompositeSkillResult {
  return {
    final_tier: tier ?? "None",
    stat_tier: null,
    claude_tier: null,
    source: "player_view",
    flagged: false,
    flag_reason: null,
    stat_confidence: null,
    claude_confidence: null,
    agreement: null,
  };
}

export function legendDetailToPlayerProfile(
  player: PlayerWithSkills,
  detail: LegendDetail | null,
): PlayerProfile {
  const skills = detail?.profile
    ? Object.fromEntries(
        Object.entries(detail.profile).map(([skillName, tier]) => [
          skillName,
          toComposite(tier),
        ]),
      )
    : simplePlayerSkillsToComposite(player);

  return {
    player: playerWithSkillsToProfilePlayer(player),
    skills,
    flag_summary: player.flag_summary,
  };
}

export function playerWithSkillsToProfile(player: PlayerWithSkills): PlayerProfile {
  return {
    player: playerWithSkillsToProfilePlayer(player),
    skills: simplePlayerSkillsToComposite(player),
    flag_summary: player.flag_summary,
  };
}

function playerWithSkillsToProfilePlayer(player: PlayerWithSkills): PlayerProfile["player"] {
  return {
    id: player.id,
    name: player.name,
    team: player.team,
    position: player.position,
    age: player.age,
    games_played: player.games_played,
    minutes_per_game: player.minutes_per_game,
    salary: player.salary,
    height: player.height,
    weight: player.weight,
    season: player.peak_year != null ? String(player.peak_year) : player.season,
    nba_api_id: player.nba_api_id ?? null,
    manually_included: player.manually_included,
  };
}

function simplePlayerSkillsToComposite(
  player: PlayerWithSkills,
): PlayerProfile["skills"] {
  if (!player.skills) return null;
  return Object.fromEntries(
    Object.entries(player.skills).map(([skillName, tier]) => [
      skillName,
      toComposite(tier),
    ]),
  );
}
