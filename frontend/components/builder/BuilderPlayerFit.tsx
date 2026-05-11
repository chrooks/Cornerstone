"use client";

import { useMemo, useState } from "react";
import {
  ImpactTraitList,
  LineupReachSection,
  ReadStatusBanner,
  SkillProfileTrace,
} from "@/components/builder/feedback-read";
import {
  buildSkillTraceEntries,
  formatScore,
  getEvaluatedImpactTraitValues,
  getImpactTraitKeysForSkill,
  getPlayerLineupRead,
  getPotentialImpactTraitValues,
  impactTraitEntriesFromValues,
  isPlayerInBuild,
  rankImpactTraitEntries,
} from "@/lib/builder-read-model";
import { IMPACT_TRAIT_DESCRIPTIONS } from "@/lib/cohesion-constants";
import type { PlayerWithSkills, RosterEvaluation } from "@/lib/types";

type BuilderPlayerFitSurface = "panel" | "profile";

interface BuilderPlayerFitProps {
  player: PlayerWithSkills;
  allSlots: (PlayerWithSkills | null)[];
  latestEval: RosterEvaluation | null;
  surface: BuilderPlayerFitSurface;
  canAddToBuild?: boolean;
  onAddToBuild?: (player: PlayerWithSkills) => void;
  onShowInFeedback?: (player: PlayerWithSkills) => void;
}

export function BuilderPlayerFit({
  player,
  allSlots,
  latestEval,
  surface,
  canAddToBuild = false,
  onAddToBuild,
  onShowInFeedback,
}: BuilderPlayerFitProps) {
  const [selectedSkillKey, setSelectedSkillKey] = useState<string | null>(null);
  const inBuild = isPlayerInBuild(allSlots, player);
  const skills = buildSkillTraceEntries(player.skills);
  const selectedSkill = skills.find((skill) => skill.skill === selectedSkillKey) ?? null;
  const affectedTraitKeys = new Set(getImpactTraitKeysForSkill(selectedSkill?.skill));
  const actualTraits = inBuild ? getEvaluatedImpactTraitValues(latestEval, player) : null;
  const traitValues = actualTraits ?? getPotentialImpactTraitValues(player.skills);
  const displayedTraits = rankImpactTraitEntries(
    impactTraitEntriesFromValues(
      traitValues,
      affectedTraitKeys,
      (value) => (inBuild ? formatScore(value) : `signal ${formatScore(value)}`),
    ),
    { includeZero: true },
  );
  const lineupRead = useMemo(() => getPlayerLineupRead(latestEval, player), [latestEval, player]);

  return (
    <div id={`builder-player-fit-${player.id}`} className="space-y-3">
      <ReadStatusBanner
        idBase={`builder-player-fit-status-${player.id}`}
        label={inBuild ? "In-Build Player" : "Pool Player"}
        copy={
          inBuild
            ? "This Player is already in the Build, so Lineup reach and Impact Traits use the current evaluated Team."
            : "Scouting read only. Add this Player to the Build to see Lineup Effects and Lineup Combination contribution."
        }
        action={inBuild
          ? {
              id: `builder-player-fit-show-feedback-${player.id}`,
              label: "Show in Feedback",
              onClick: () => onShowInFeedback?.(player),
              tone: "secondary",
            }
          : {
              id: `builder-player-fit-add-${player.id}`,
              label: "Add to Build",
              onClick: () => onAddToBuild?.(player),
              disabled: !canAddToBuild,
              title: canAddToBuild ? "Add to Build" : "No available Build slot",
              tone: "primary",
            }}
      />

      <SkillProfileTrace
        idBase={`builder-player-fit-skills-${player.id}`}
        skills={skills}
        selectedSkillKey={selectedSkillKey}
        onSelectSkill={setSelectedSkillKey}
        affectedTraitKeys={Array.from(affectedTraitKeys)}
        traceVerb={inBuild ? "feeds" : "could feed"}
        emptyText="No Skill Profile available yet."
        maxVisible={surface === "profile" ? 12 : 8}
        twoColumn
      />

      <ImpactTraitList
        idBase={`builder-player-fit-impact-traits-${player.id}`}
        label={inBuild ? "Impact Traits" : "Potential Impact Traits"}
        traits={displayedTraits}
        emptyText="Impact Traits appear once Skill Profile data exists."
        scroll
        renderTraitTooltip={(trait, trigger) => (
          <div title={IMPACT_TRAIT_DESCRIPTIONS[trait.key] ?? undefined}>{trigger}</div>
        )}
      />

      {inBuild && (
        <LineupReachSection
          idBase={`builder-player-fit-lineup-read-${player.id}`}
          label="Lineup Reach"
          copy={
            lineupRead
              ? lineupRead.viableTotal > 0
                ? `${player.name} appears in ${lineupRead.count} of ${lineupRead.viableTotal} viable Lineup Combinations, ${lineupRead.allCount} of ${lineupRead.total} total.`
                : `No viable Lineup Combinations yet. ${player.name} appears in ${lineupRead.allCount} of ${lineupRead.total} total.`
              : "Lineup Combination reads appear once the Build has at least five Players."
          }
          contexts={lineupRead?.contexts ?? []}
          subscoreLimit={4}
          compactNames={false}
        />
      )}
    </div>
  );
}
