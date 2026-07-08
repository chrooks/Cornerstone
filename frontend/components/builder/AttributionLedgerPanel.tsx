"use client";

import { cn } from "@/lib/utils";
import { SKILL_LABELS } from "@/lib/skills";
import type { AttributionLedger, AttributionLedgerLine } from "@/lib/types";

/**
 * Attribution Ledger (#93, ADR 0006) — one subscore explained as per-player
 * input lines plus labeled engine adjustments that reconcile to the total.
 * Player rows are selectable to drive the Contribution Overlay on the
 * Team Shape; "context" lines are informational and sit outside the sum.
 */

const ROLE_LABELS: Record<string, string> = {
  primary: "Primary",
  secondary: "Secondary",
  depth: "Depth",
};

function formatSigned(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded >= 0 ? "+" : "−"}${Math.abs(rounded).toFixed(2)}`;
}

interface AttributionLedgerPanelProps {
  id: string;
  subscoreLabel: string;
  ledger: AttributionLedger;
  /** #103: Rotation Median context read — informational, outside the sum
   * (the ledger reconciles the Starting Lineup subscore only, ADR 0006). */
  rotationMedian?: { value: number; explainer?: string } | null;
  selectedPlayerId?: string | null;
  onSelectPlayer?: (playerId: string, playerName: string) => void;
}

function PlayerLine({
  id,
  line,
  isSelected,
  onSelect,
}: {
  id: string;
  line: AttributionLedgerLine;
  isSelected: boolean;
  onSelect?: () => void;
}) {
  const skillLabel = line.skill ? SKILL_LABELS[line.skill] ?? line.skill : null;
  return (
    <button
      id={id}
      type="button"
      onClick={onSelect}
      disabled={!onSelect}
      aria-pressed={isSelected}
      className={cn(
        "grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-3 px-2 py-1 text-left transition-colors",
        onSelect && "cursor-pointer hover:bg-[#ffa05c]/10",
        isSelected && "bg-[#ffa05c]/15 outline outline-1 outline-[#ffa05c]/60",
      )}
    >
      <span className="min-w-0 truncate text-[0.75rem] text-[#0e0907]">
        <span className="font-medium">{line.player_name}</span>
        {skillLabel && (
          <span className="ml-1.5 text-[0.6875rem] text-[#0e0907]/50">{skillLabel}</span>
        )}
      </span>
      <span className="font-mono text-[0.625rem] uppercase tracking-wide text-[#0e0907]/40">
        {line.role ? ROLE_LABELS[line.role] : ""}
      </span>
      <span className="font-mono text-[0.75rem] font-semibold tabular-nums text-[#0e0907]">
        {formatSigned(line.value)}
      </span>
    </button>
  );
}

function AdjustmentLine({ line }: { line: AttributionLedgerLine }) {
  const isContext = line.kind === "context";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 px-2 py-1">
      <span className={cn("min-w-0 text-[0.71875rem] italic", isContext ? "text-[#0e0907]/45" : "text-[#7e2c0c]")}>
        {line.label}
      </span>
      <span
        className={cn(
          "font-mono text-[0.75rem] tabular-nums",
          isContext ? "text-[#0e0907]/45" : "font-semibold text-[#7e2c0c]",
        )}
      >
        {isContext ? line.value.toFixed(2) : formatSigned(line.value)}
      </span>
    </div>
  );
}

export function AttributionLedgerPanel({
  id,
  subscoreLabel,
  ledger,
  rotationMedian = null,
  selectedPlayerId,
  onSelectPlayer,
}: AttributionLedgerPanelProps) {
  const playerLines = ledger.lines.filter((line) => line.kind === "player");
  const otherLines = ledger.lines.filter((line) => line.kind !== "player");
  const playerSubtotal = playerLines.reduce((sum, line) => sum + line.value, 0);

  return (
    <div id={id} className="border border-[#d9d0c9] bg-[#f0f0f0]/60 px-2 py-2">
      {playerLines.length > 0 && (
        <div id={`${id}-players`} className="space-y-0.5">
          <p className="px-2 text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-[#0e0907]/40">
            Player inputs
          </p>
          {playerLines.map((line, index) => (
            <PlayerLine
              key={`${line.player_id}-${index}`}
              id={`${id}-player-${line.player_id}`}
              line={line}
              isSelected={line.player_id === selectedPlayerId}
              onSelect={
                onSelectPlayer && line.player_id && line.player_name
                  ? () => onSelectPlayer(line.player_id!, line.player_name!)
                  : undefined
              }
            />
          ))}
          {otherLines.length > 0 && (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-t border-[#d9d0c9]/70 px-2 py-1">
              <span className="text-[0.6875rem] text-[#0e0907]/50">Player subtotal</span>
              <span className="font-mono text-[0.75rem] tabular-nums text-[#0e0907]/70">
                {playerSubtotal.toFixed(2)}
              </span>
            </div>
          )}
        </div>
      )}

      {otherLines.length > 0 && (
        <div id={`${id}-adjustments`} className={cn("space-y-0.5", playerLines.length > 0 && "mt-1.5")}>
          <p className="px-2 text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-[#0e0907]/40">
            Engine adjustments
          </p>
          {otherLines.map((line, index) => (
            <AdjustmentLine key={`${line.label}-${index}`} line={line} />
          ))}
        </div>
      )}

      <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-t border-[#0e0907]/20 px-2 pt-1.5">
        <span className="text-[0.75rem] font-semibold text-[#0e0907]">{subscoreLabel} — Starting Lineup</span>
        <span className="font-mono text-[0.8125rem] font-bold tabular-nums text-[#0e0907]">
          {ledger.total.toFixed(1)}
        </span>
      </div>
      {rotationMedian && (
        <div
          id={`${id}-rotation-median`}
          className={cn(
            "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-2 pt-0.5",
            rotationMedian.explainer && "cursor-help",
          )}
          title={rotationMedian.explainer}
        >
          <span className="text-[0.6875rem] italic text-[#0e0907]/45">
            Rotation Median (bench Lineup Combinations included — not part of this sum)
          </span>
          <span className="font-mono text-[0.75rem] tabular-nums text-[#0e0907]/45">
            {rotationMedian.value.toFixed(1)}
          </span>
        </div>
      )}
      {onSelectPlayer && playerLines.length > 0 && (
        <p className="mt-1 px-2 text-[0.625rem] text-[#0e0907]/40">
          Select a Player to mark their inputs on the Team Shape.
        </p>
      )}
    </div>
  );
}
