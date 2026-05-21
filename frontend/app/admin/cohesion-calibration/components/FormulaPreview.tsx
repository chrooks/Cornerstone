"use client";

/**
 * FormulaPreview — Live preview of how formula changes affect reference players.
 *
 * Uses the client-side formula evaluator for instant recalculation — no API
 * round-trip per coefficient change.
 */

import { useMemo } from "react";
import { computeRawFromFormulas } from "@/lib/formula-evaluator";
import { COMPOSITE_COLUMNS } from "@/lib/cohesion-constants";
import type { CompositeFormula, ReferencePlayer } from "../types";

const COMPOSITE_LABELS: Record<string, string> = Object.fromEntries(
  COMPOSITE_COLUMNS.map((c) => [c.key, c.label]),
);

interface FormulaPreviewProps {
  formulas: Record<string, CompositeFormula>;
  baseFormulas: Record<string, CompositeFormula>;
  tierValues: Record<string, number>;
  referencePlayers: ReferencePlayer[];
  selectedComposite: string;
  onRemovePlayer: (playerId: string) => void;
}

export function FormulaPreview({
  formulas,
  baseFormulas,
  tierValues,
  referencePlayers,
  selectedComposite,
  onRemovePlayer,
}: FormulaPreviewProps) {
  const previews = useMemo(() => {
    return referencePlayers.map((player) => {
      const baseRaw = computeRawFromFormulas(player.skills, baseFormulas, tierValues);
      const draftRaw = computeRawFromFormulas(player.skills, formulas, tierValues);
      const oldVal = baseRaw[selectedComposite] ?? 0;
      const newVal = draftRaw[selectedComposite] ?? 0;
      const delta = newVal - oldVal;

      return { player, oldVal, newVal, delta };
    });
  }, [referencePlayers, formulas, baseFormulas, tierValues, selectedComposite]);

  return (
    <section>
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        Reference Players — {COMPOSITE_LABELS[selectedComposite] ?? selectedComposite}
      </h4>
      <div className="rounded-sm border border-border overflow-hidden">
        <table id="formula-preview-table" className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Player</th>
              <th className="text-right px-3 py-1.5 font-medium text-muted-foreground w-20">Base</th>
              <th className="text-right px-3 py-1.5 font-medium text-muted-foreground w-20">Draft</th>
              <th className="text-right px-3 py-1.5 font-medium text-muted-foreground w-20">Δ</th>
              <th className="w-8 px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {previews.map(({ player, oldVal, newVal, delta }) => (
              <tr key={player.player_id} className="border-b border-border last:border-0 hover:bg-muted/20">
                <td className="px-3 py-1.5 text-foreground">{player.name}</td>
                <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                  {oldVal.toFixed(2)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-foreground">
                  {newVal.toFixed(2)}
                </td>
                <td className={`px-3 py-1.5 text-right font-mono ${
                  delta > 0.01 ? "text-green-600" : delta < -0.01 ? "text-red-500" : "text-muted-foreground"
                }`}>
                  {delta > 0 ? "+" : ""}{delta.toFixed(2)}
                </td>
                <td className="px-2 py-1.5 text-center">
                  <button
                    type="button"
                    onClick={() => onRemovePlayer(player.player_id)}
                    className="text-[10px] text-destructive hover:text-destructive/80 transition-colors cursor-pointer"
                    title="Unpin"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
