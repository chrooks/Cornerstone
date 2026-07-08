"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getLineupLedger } from "@/lib/api";
import { SUBSCORE_LABELS } from "@/lib/cohesion-constants";
import { subscoreColor } from "@/lib/cohesion-colors";
import { AttributionLedgerPanel } from "@/components/builder/AttributionLedgerPanel";
import type {
  AttributionLedger,
  CohesionLineupCombination,
  EvaluatePayload,
} from "@/lib/types";

/**
 * Lineup Combinations explorer (#104, ADR 0007) — the Final Eval's ranked
 * combination list. Selecting a combo fetches its Attribution Ledgers on
 * demand via the exact evaluate path (ADR 0006: no second source of truth),
 * so bench players get honest attribution in the combos they play in.
 * Combos stay score-only until selected — no default payload bloat.
 */

interface LineupCombinationsSectionProps {
  combinations: CohesionLineupCombination[];
  /** The evaluate request players — the combo's five are matched by name. */
  players: EvaluatePayload["players"];
}

type LedgerState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; breakdowns: Record<string, AttributionLedger> };

function comboPlayers(
  combo: CohesionLineupCombination,
  players: EvaluatePayload["players"],
): EvaluatePayload["players"] {
  // Consume matches so duplicate names map to distinct roster entries,
  // preserving the slot-subset order the /evaluate sweep used.
  const pool = [...players];
  return combo.player_names
    .map((name) => {
      const index = pool.findIndex((player) => player.name === name);
      return index === -1 ? undefined : pool.splice(index, 1)[0];
    })
    .filter((player): player is EvaluatePayload["players"][number] => !!player);
}

function comboLabel(combo: CohesionLineupCombination): string {
  return combo.is_starting_lineup
    ? "Starting Lineup"
    : `Lineup Combination #${combo.rank}`;
}

export function LineupCombinationsSection({ combinations, players }: LineupCombinationsSectionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [expandedSubscore, setExpandedSubscore] = useState<string | null>(null);
  const [ledgers, setLedgers] = useState<Record<number, LedgerState>>({});

  // A re-run evaluation (#62 retry path) invalidates cached ledgers —
  // the same combination_index can now mean a different five.
  useEffect(() => {
    setLedgers({});
    setSelectedIndex(null);
    setExpandedSubscore(null);
  }, [combinations]);

  if (combinations.length === 0) return null;

  const fetchLedger = (combo: CohesionLineupCombination) => {
    const five = comboPlayers(combo, players);
    if (five.length !== 5) {
      setLedgers((current) => ({ ...current, [combo.combination_index]: { status: "error" } }));
      return;
    }
    setLedgers((current) => ({ ...current, [combo.combination_index]: { status: "loading" } }));
    getLineupLedger(five)
      .then((res) => {
        const breakdowns = res.success ? res.data?.subscore_breakdowns : null;
        setLedgers((current) => ({
          ...current,
          [combo.combination_index]: breakdowns
            ? { status: "ready", breakdowns }
            : { status: "error" },
        }));
      })
      .catch(() => {
        setLedgers((current) => ({ ...current, [combo.combination_index]: { status: "error" } }));
      });
  };

  const selectCombo = (combo: CohesionLineupCombination) => {
    if (selectedIndex === combo.combination_index) {
      // An errored selection retries in place instead of collapsing.
      if (ledgers[combo.combination_index]?.status === "error") {
        fetchLedger(combo);
        return;
      }
      setSelectedIndex(null);
      return;
    }
    setSelectedIndex(combo.combination_index);
    setExpandedSubscore(null);
    const existing = ledgers[combo.combination_index];
    if (!existing || existing.status === "error") fetchLedger(combo);
  };

  return (
    <section id="eval-lineup-combinations" className="border border-[#d9d0c9] bg-[#f7f7f7]">
      <button
        id="eval-lineup-combinations-toggle"
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div>
          <p className="text-xs font-semibold text-[#0e0907]/50">Rotation Ledger</p>
          <h2 className="mt-1 text-base font-semibold text-[#0e0907]">Every Lineup Combination</h2>
          <p className="mt-1 text-[0.6875rem] text-[#0e0907]/50">
            Select a Lineup Combination to read its Attribution Ledgers — where bench players name their bite.
          </p>
        </div>
        <span className="text-[0.75rem] text-[#0e0907]/40">{isOpen ? "−" : "+"}</span>
      </button>

      {isOpen && (
        <div id="eval-lineup-combinations-list" className="max-h-[420px] space-y-1 overflow-y-auto border-t border-[#d9d0c9] px-3 py-3">
          {combinations.map((combo) => {
            const isSelected = selectedIndex === combo.combination_index;
            const ledger = ledgers[combo.combination_index];
            return (
              <div key={combo.combination_index} id={`eval-combo-${combo.combination_index}`}>
                <button
                  id={`eval-combo-${combo.combination_index}-row`}
                  type="button"
                  onClick={() => selectCombo(combo)}
                  aria-expanded={isSelected}
                  className={cn(
                    "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-3 px-2 py-1.5 text-left transition-colors hover:bg-[#ffa05c]/10",
                    isSelected && "bg-[#ffa05c]/15 outline outline-1 outline-[#ffa05c]/60",
                  )}
                >
                  <span className="font-mono text-[0.625rem] tabular-nums text-[#0e0907]/40">#{combo.rank}</span>
                  <span className="min-w-0 truncate text-[0.75rem] text-[#0e0907]">
                    {combo.player_names.join(" · ")}
                    {combo.is_starting_lineup && (
                      <span className="ml-1.5 text-[0.625rem] font-semibold uppercase tracking-wide text-[#7e2c0c]">Starting</span>
                    )}
                  </span>
                  <span
                    className={cn(
                      "font-mono text-[0.75rem] font-semibold tabular-nums",
                      combo.is_viable ? "text-[#0e0907]" : "text-[#0e0907]/35",
                    )}
                    title={combo.is_viable ? "Viable Lineup Combination" : "Below the viability floor"}
                  >
                    {combo.cohesion_score.toFixed(2)}
                  </span>
                </button>

                {isSelected && (
                  <div id={`eval-combo-${combo.combination_index}-detail`} className="mt-1 border border-[#d9d0c9]/70 bg-[#f0f0f0]/50 px-2 py-2">
                    {(!ledger || ledger.status === "loading") && (
                      <p className="px-1 text-[0.6875rem] italic text-[#0e0907]/45">Reading the ledger…</p>
                    )}
                    {ledger?.status === "error" && (
                      <p className="px-1 text-[0.6875rem] text-[#7e2c0c]">
                        Could not load this Lineup Combination&apos;s ledger. Select it again to retry.
                      </p>
                    )}
                    {ledger?.status === "ready" && (
                      <>
                        <div id={`eval-combo-${combo.combination_index}-subscores`} className="flex flex-wrap gap-1">
                          {Object.entries(combo.subscores)
                            .filter(([key]) => ledger.breakdowns[key])
                            .sort(([, a], [, b]) => b - a)
                            .map(([key, value]) => (
                              <button
                                key={key}
                                id={`eval-combo-${combo.combination_index}-subscore-${key}`}
                                type="button"
                                onClick={() => setExpandedSubscore((current) => (current === key ? null : key))}
                                aria-pressed={expandedSubscore === key}
                                className={cn(
                                  "flex items-baseline gap-1.5 border px-2 py-0.5 text-[0.6875rem] transition-colors",
                                  expandedSubscore === key
                                    ? "border-[#0e0907] bg-[#0e0907] text-[#f8f3f1]"
                                    : "border-[#d9d0c9] text-[#0e0907]/70 hover:border-[#0e0907]/40",
                                )}
                              >
                                <span>{SUBSCORE_LABELS[key] ?? key}</span>
                                <span
                                  className="font-mono font-semibold tabular-nums"
                                  style={expandedSubscore === key ? undefined : { color: subscoreColor(value) }}
                                >
                                  {value.toFixed(1)}
                                </span>
                              </button>
                            ))}
                        </div>
                        {expandedSubscore && ledger.breakdowns[expandedSubscore] && (
                          <div className="mt-2">
                            <AttributionLedgerPanel
                              id={`eval-combo-${combo.combination_index}-ledger-${expandedSubscore}`}
                              subscoreLabel={SUBSCORE_LABELS[expandedSubscore] ?? expandedSubscore}
                              ledger={ledger.breakdowns[expandedSubscore]}
                              totalSuffix={comboLabel(combo)}
                            />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
