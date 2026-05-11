import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { BuilderReadSection } from "./BuilderReadSection";
import { qualityBarFill, qualityTextColor } from "@/lib/cohesion-colors";
import type { ImpactTraitReadEntry } from "@/lib/builder-read-model";

interface ImpactTraitListProps {
  idBase: string;
  label: string;
  traits: ImpactTraitReadEntry[];
  emptyText: string;
  scroll?: boolean;
  renderTraitTooltip?: (trait: ImpactTraitReadEntry, trigger: ReactNode) => ReactNode;
}

export function ImpactTraitList({
  idBase,
  label,
  traits,
  emptyText,
  scroll = false,
  renderTraitTooltip,
}: ImpactTraitListProps) {
  return (
    <BuilderReadSection idBase={idBase} label={label}>
      <div
        id={`${idBase}-list`}
        className={cn(
          "mt-2 grid gap-2",
          scroll && "max-h-[420px] overflow-y-auto pr-1 [scrollbar-color:rgba(14,9,7,0.18)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-sm [&::-webkit-scrollbar-thumb]:bg-[#0e0907]/15 hover:[&::-webkit-scrollbar-thumb]:bg-[#0e0907]/25",
        )}
      >
        {traits.length > 0 ? traits.map((trait) => {
          const trigger = (
            <div
              id={`${idBase}-trait-${trait.key}`}
              className={cn(
                "w-full border px-2.5 py-1.5 transition-colors",
                trait.affected ? "border-[#ffa05c]/70 bg-[#ffa05c]/10" : "border-[#d9d0c9]/55 bg-[#f0f0f0]/45",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-[0.75rem] font-medium text-[#0e0907]/70">{trait.label}</span>
                <span className={cn("font-mono text-[0.6875rem] font-semibold tabular-nums", qualityTextColor(trait.value, "impactTrait"))}>{trait.valueLabel}</span>
              </div>
              <div className="mt-1.5 h-1 bg-[#d9d0c9]/50">
                <div className={cn("h-full", qualityBarFill(trait.value, "impactTrait"))} style={{ width: `${Math.min(100, Math.max(0, trait.value * 10))}%` }} />
              </div>
            </div>
          );
          return (
            <div key={trait.key} id={`${idBase}-trait-wrap-${trait.key}`}>
              {renderTraitTooltip ? renderTraitTooltip(trait, trigger) : trigger}
            </div>
          );
        }) : (
          <p id={`${idBase}-empty`} className="text-[0.8125rem] text-[#0e0907]/50">
            {emptyText}
          </p>
        )}
      </div>
    </BuilderReadSection>
  );
}
