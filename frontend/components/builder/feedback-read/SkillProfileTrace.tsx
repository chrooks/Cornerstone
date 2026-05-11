import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { getImpactTraitLabels } from "@/lib/builder-read-model";
import { TIER_BADGE_CLASSES } from "@/lib/tiers";
import { BuilderReadSection } from "./BuilderReadSection";
import type { SkillTraceEntry } from "@/lib/builder-read-model";
import type { SkillTier } from "@/lib/types";

interface SkillProfileTraceProps {
  idBase: string;
  skills: SkillTraceEntry[];
  selectedSkillKey: string | null;
  onSelectSkill: (skillKey: string | null) => void;
  affectedTraitKeys: string[];
  traceVerb: "feeds" | "could feed";
  emptyText: string;
  maxVisible?: number;
  scroll?: boolean;
  twoColumn?: boolean;
  renderSkillTooltip?: (skill: SkillTraceEntry, trigger: ReactNode) => ReactNode;
}

export function SkillProfileTrace({
  idBase,
  skills,
  selectedSkillKey,
  onSelectSkill,
  affectedTraitKeys,
  traceVerb,
  emptyText,
  maxVisible,
  scroll = false,
  twoColumn = false,
  renderSkillTooltip,
}: SkillProfileTraceProps) {
  const visibleSkills = maxVisible == null ? skills : skills.slice(0, maxVisible);
  const selectedSkill = skills.find((skill) => skill.skill === selectedSkillKey) ?? null;
  const affectedLabels = getImpactTraitLabels(affectedTraitKeys);

  return (
    <BuilderReadSection idBase={idBase} label="Skill Profile" count={skills.length > 0 ? `${skills.length} rated` : null}>
      <div
        id={`${idBase}-list`}
        className={cn(
          "mt-2 grid gap-2",
          twoColumn && "sm:grid-cols-2",
          scroll && "max-h-[238px] overflow-y-auto pr-1 [scrollbar-color:rgba(14,9,7,0.18)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-sm [&::-webkit-scrollbar-thumb]:bg-[#0e0907]/15 hover:[&::-webkit-scrollbar-thumb]:bg-[#0e0907]/25",
        )}
      >
        {visibleSkills.length > 0 ? visibleSkills.map((skill) => {
          const trigger = (
            <button
              id={`${idBase}-skill-${skill.skill}`}
              type="button"
              onClick={() => onSelectSkill(selectedSkill?.skill === skill.skill ? null : skill.skill)}
              className={cn(
                "flex w-full items-center justify-between gap-3 border px-2.5 py-1.5 text-left transition-colors",
                selectedSkill?.skill === skill.skill
                  ? "border-[#ffa05c]/70 bg-[#ffa05c]/10"
                  : "border-[#d9d0c9]/55 bg-[#f0f0f0]/45 hover:border-[#ffa05c]/45",
              )}
            >
              <span className="truncate text-[0.75rem] font-medium text-[#0e0907]/70">{skill.label}</span>
              <span className={cn("shrink-0 rounded-sm px-1.5 py-0.5 text-[0.625rem] font-semibold", TIER_BADGE_CLASSES[(skill.tier as SkillTier) ?? "None"] ?? TIER_BADGE_CLASSES.None)}>
                {skill.tier}
              </span>
            </button>
          );
          return (
            <div key={skill.skill} id={`${idBase}-skill-wrap-${skill.skill}`}>
              {renderSkillTooltip ? renderSkillTooltip(skill, trigger) : trigger}
            </div>
          );
        }) : (
          <p id={`${idBase}-empty`} className="text-[0.8125rem] text-[#0e0907]/50">
            {emptyText}
          </p>
        )}
      </div>
      {selectedSkill && (
        <p id={`${idBase}-trace`} className="mt-3 border border-[#d9d0c9]/60 bg-[#f0f0f0]/45 px-2.5 py-2 text-[0.75rem] leading-snug text-[#0e0907]/55">
          {selectedSkill.label} {traceVerb}{" "}
          <span className="font-medium text-[#0e0907]/75">
            {affectedLabels.join(", ") || "no mapped Impact Trait yet"}
          </span>
          .
        </p>
      )}
    </BuilderReadSection>
  );
}
