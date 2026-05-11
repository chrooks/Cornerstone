import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { qualityTextColor, type QualityValueKind } from "@/lib/cohesion-colors";
import { BuilderReadSection } from "./BuilderReadSection";
import { LineupCombinationSwitcher } from "./LineupCombinationSwitcher";
import type { ImpactTraitReadEntry, LineupReadContext } from "@/lib/builder-read-model";

interface LineupReachSectionProps {
  idBase: string;
  label: string;
  copy: string;
  status?: ReactNode;
  metric?: { value: string; label: string; qualityValue?: number; qualityKind?: QualityValueKind };
  contexts: LineupReadContext[];
  subscoreLimit?: number;
  compactNames?: boolean;
  playerAdds?: ImpactTraitReadEntry[];
  renderContextTooltip?: (context: LineupReadContext, trigger: ReactNode) => ReactNode;
}

export function LineupReachSection({
  idBase,
  label,
  copy,
  status,
  metric,
  contexts,
  subscoreLimit,
  compactNames,
  playerAdds,
  renderContextTooltip,
}: LineupReachSectionProps) {
  return (
    <BuilderReadSection idBase={idBase} label={label} headerClassName="items-start gap-4">
      <div id={`${idBase}-body`} className={metric ? "mt-2 grid gap-x-4 gap-y-3 sm:grid-cols-[minmax(0,1fr)_auto]" : "mt-2"}>
        <p id={`${idBase}-copy`} className="max-w-[65ch] text-[0.8125rem] leading-snug text-[#0e0907]/55">
          {copy}
        </p>
        {metric && (
          <div id={`${idBase}-value`} className="row-span-2 shrink-0 border border-[#d9d0c9]/70 bg-[#f0f0f0]/45 px-3 py-2 text-right">
            <p className={cn(
              "font-mono text-[1rem] font-semibold tabular-nums text-[#0e0907]",
              metric.qualityValue != null && qualityTextColor(metric.qualityValue, metric.qualityKind),
            )}>{metric.value}</p>
            <p className="text-[0.625rem] uppercase tracking-[0.14em] text-[#0e0907]/40">{metric.label}</p>
          </div>
        )}
        {status && (
          <p id={`${idBase}-status`} className="text-[0.75rem] text-[#0e0907]/50">
            {status}
          </p>
        )}
      </div>
      {contexts.length > 0 && (
        <LineupCombinationSwitcher
          idBase={`${idBase}-lineup-selector`}
          contexts={contexts}
          subscoreLimit={subscoreLimit}
          compactNames={compactNames}
          playerAdds={playerAdds}
          renderContextTooltip={renderContextTooltip}
        />
      )}
    </BuilderReadSection>
  );
}
