"use client";

/**
 * DebugPanel.tsx — Admin-only raw trace view for the evaluation pipeline.
 *
 * Shows two sections:
 *   - Player Traces: per-player slot-weighted skill contribution breakdown
 *   - Aggregate Traces: pre/post modifier scores and fired modifier list
 *
 * Each section has a copy-to-clipboard button.
 * Both sections are collapsed by default to avoid overwhelming the UI.
 *
 * Only render this component when the user is an admin — the parent component
 * is responsible for admin gating; this component does not check auth itself.
 */

import { useCallback, useState } from "react";
import { HeightCoverageChart } from "./HeightCoverageChart";
import type { HeightCoverageData } from "@/lib/types";

// ---------------------------------------------------------------------------
// Sub-section component
// ---------------------------------------------------------------------------

interface TraceSectionProps {
  id: string;
  title: string;
  data: Record<string, unknown> | null;
}

function TraceSection({ id, title, data }: TraceSectionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const json = data != null ? JSON.stringify(data, null, 2) : "null";

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [json]);

  return (
    <div id={id} className="border border-border/50 rounded">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <button
          id={`${id}-toggle`}
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors font-mono cursor-pointer"
        >
          {isOpen ? "▾" : "▸"} {title}
        </button>
        <button
          id={`${id}-copy`}
          type="button"
          onClick={handleCopy}
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors font-mono cursor-pointer"
          title={`Copy ${title} to clipboard`}
        >
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>

      {/* Content — only when expanded */}
      {isOpen && (
        <pre
          id={`${id}-content`}
          className="px-3 pb-3 text-[10px] text-muted-foreground overflow-auto max-h-80 font-mono"
        >
          {json}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DebugPanel
// ---------------------------------------------------------------------------

interface DebugPanelProps {
  playerTraces: Record<string, unknown> | null;
  aggregateTraces: Record<string, unknown> | null;
  /** Height coverage data — always populated by the backend, shown regardless of debug flag */
  heightCoverage?: HeightCoverageData | null;
}

export function DebugPanel({ playerTraces, aggregateTraces, heightCoverage }: DebugPanelProps) {
  return (
    <div id="debug-panel" className="rounded-lg border border-border/60 bg-muted/10 p-3 space-y-2">
      {/* Panel header */}
      <p id="debug-panel-header" className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest">
        Debug Traces (Admin Only)
      </p>

      {/* Player traces section */}
      <TraceSection
        id="debug-panel-player-traces"
        title="Player Traces"
        data={playerTraces}
      />

      {/* Aggregate traces section */}
      <TraceSection
        id="debug-panel-aggregate-traces"
        title="Aggregate Traces"
        data={aggregateTraces}
      />

      {/* Height coverage chart — always rendered when data is available */}
      {heightCoverage && (
        <HeightCoverageChart data={heightCoverage} />
      )}
    </div>
  );
}
