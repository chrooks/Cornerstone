import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatScore, lineupNames, topLineupSubscores } from "@/lib/builder-read-model";
import { qualityTextColor } from "@/lib/cohesion-colors";
import type { ImpactTraitReadEntry, LineupReadContext } from "@/lib/builder-read-model";

interface LineupCombinationSwitcherProps {
  idBase: string;
  contexts: LineupReadContext[];
  subscoreLimit?: number;
  compactNames?: boolean;
  playerAdds?: ImpactTraitReadEntry[];
  renderContextTooltip?: (context: LineupReadContext, trigger: ReactNode) => ReactNode;
}

export function LineupCombinationSwitcher({
  idBase,
  contexts,
  subscoreLimit = 3,
  compactNames = true,
  playerAdds = [],
  renderContextTooltip,
}: LineupCombinationSwitcherProps) {
  const [selectedId, setSelectedId] = useState(contexts[0]?.id ?? "");
  const selected = contexts.find((context) => context.id === selectedId) ?? contexts[0];

  if (!selected) return null;

  return (
    <div id={idBase} className="mt-3 border border-[#d9d0c9]/60 bg-[#f0f0f0]/45">
      <div id={`${idBase}-tabs`} className="flex border-b border-[#d9d0c9]/60">
        {contexts.map((context) => {
          const tab = (
            <button
              id={`${idBase}-tab-${context.id}`}
              type="button"
              onClick={() => setSelectedId(context.id)}
              className={cn(
                "flex-1 px-2.5 py-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] transition-colors",
                selected.id === context.id
                  ? "bg-[#0e0907] text-[#f8f3f1]"
                  : "text-[#0e0907]/40 hover:bg-[#0e0907]/[0.04] hover:text-[#0e0907]/65",
              )}
            >
              {context.label}
            </button>
          );

          return (
            <div key={context.id} id={`${idBase}-tab-wrap-${context.id}`} className="flex flex-1">
              {renderContextTooltip ? renderContextTooltip(context, tab) : tab}
            </div>
          );
        })}
      </div>
      <div id={`${idBase}-${selected.id}-card`} className="flex h-full w-full flex-col px-2.5 py-2 transition-colors">
        <div className="flex min-h-[48px] items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-[#0e0907]/35">{selected.eyebrow}</p>
            <p className="mt-1 text-[0.6875rem] leading-snug text-[#0e0907]/55">{lineupNames(selected.lineup, compactNames)}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-[0.8125rem] font-semibold tabular-nums text-[#0e0907]">{selected.lineup.cohesion_score.toFixed(2)}</p>
            <p className="text-[0.5625rem] uppercase tracking-[0.12em] text-[#0e0907]/35">rank {selected.lineup.rank}</p>
          </div>
        </div>
        <div className="mt-3 grid flex-1 grid-rows-[minmax(78px,auto)_auto] gap-2">
          <div className="min-h-[78px]">
            <p className="text-[0.5625rem] font-semibold uppercase tracking-[0.14em] text-[#0e0907]/35">{selected.worksLabel ?? selected.label}</p>
            <div className="mt-1 grid gap-1">
              {topLineupSubscores(selected.lineup, subscoreLimit).map((subscore) => (
                <div key={subscore.key} id={`${idBase}-${selected.id}-subscore-${subscore.key}`} className="flex items-center justify-between gap-2">
                  <span className="truncate text-[0.625rem] text-[#0e0907]/50">{subscore.label}</span>
                  <span className={cn("font-mono text-[0.625rem] font-semibold tabular-nums", qualityTextColor(subscore.value, "lineupSubscore"))}>{formatScore(subscore.value)}</span>
                </div>
              ))}
            </div>
          </div>
          {selected.addsLabel && playerAdds.length > 0 && (
            <div id={`${idBase}-${selected.id}-player-adds`}>
              <p className="text-[0.5625rem] font-semibold uppercase tracking-[0.14em] text-[#0e0907]/35">{selected.addsLabel}</p>
              <div className="mt-1 grid gap-1">
                {playerAdds.map((trait) => (
                  <div key={trait.key} id={`${idBase}-${selected.id}-player-add-${trait.key}`} className="flex items-center justify-between gap-2">
                    <span className="truncate text-[0.625rem] text-[#0e0907]/50">{trait.label}</span>
                    <span className={cn("font-mono text-[0.625rem] font-semibold tabular-nums", qualityTextColor(trait.value, "impactTrait"))}>{formatScore(trait.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
