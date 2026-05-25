"use client";

/**
 * FormulaDistribution — CSS bar chart showing raw composite value distribution.
 *
 * Calls POST /api/cohesion/distribution-preview with optional formula override.
 * Debounced at 500ms to avoid hammering the server during rapid edits.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { fetchDistributionPreview } from "@/lib/api";
import { COMPOSITE_COLUMNS } from "@/lib/cohesion-constants";
import type { CompositeFormula, DistributionPreviewData } from "../types";

const COMPOSITE_LABELS: Record<string, string> = Object.fromEntries(
  COMPOSITE_COLUMNS.map((c) => [c.key, c.label]),
);

interface FormulaDistributionProps {
  compositeKey: string;
  formula: CompositeFormula;
  hasChanges: boolean;
}

export function FormulaDistribution({ compositeKey, formula, hasChanges }: FormulaDistributionProps) {
  const [data, setData] = useState<DistributionPreviewData | null>(null);
  const [baselineData, setBaselineData] = useState<DistributionPreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [showBaseline, setShowBaseline] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch baseline (no override) on composite change.
  useEffect(() => {
    let cancelled = false;
    setBaselineData(null);
    fetchDistributionPreview(compositeKey).then((res) => {
      if (cancelled) return;
      if (res.success && res.data) {
        setBaselineData(res.data);
        if (!hasChanges) setData(res.data);
      }
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compositeKey]);

  // Debounced fetch with formula override when changes exist.
  const fetchWithOverride = useCallback(() => {
    if (!hasChanges) {
      if (baselineData) setData(baselineData);
      return;
    }
    setLoading(true);
    fetchDistributionPreview(compositeKey, formula)
      .then((res) => {
        if (res.success && res.data) setData(res.data);
      })
      .finally(() => setLoading(false));
  }, [compositeKey, formula, hasChanges, baselineData]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchWithOverride, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchWithOverride]);

  if (!data || data.bins.length === 0) {
    return (
      <section>
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Distribution
        </h4>
        <div className="text-[10px] text-muted-foreground/40 text-center py-4">
          {loading ? "Loading distribution…" : "No distribution data"}
        </div>
      </section>
    );
  }

  const maxCount = Math.max(...data.bins.map((b) => b.count), 1);
  const baselineMaxCount = baselineData ? Math.max(...baselineData.bins.map((b) => b.count), 1) : 1;

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Distribution — {COMPOSITE_LABELS[compositeKey] ?? compositeKey}
          {loading && <span className="ml-2 text-muted-foreground/40">(updating…)</span>}
        </h4>
        {baselineData && hasChanges && (
          <button
            id="formula-distribution-baseline-toggle"
            type="button"
            onClick={() => setShowBaseline((prev) => !prev)}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            {showBaseline ? "Hide" : "Show"} baseline
          </button>
        )}
      </div>

      {/* Bar chart */}
      <div id="formula-distribution-chart" className="flex items-end gap-px h-24 rounded-sm border border-border bg-muted/10 p-2">
        {data.bins.map((bin, i) => {
          const height = (bin.count / maxCount) * 100;
          const isMeanBin = data.mean >= bin.min && data.mean < bin.max;
          const baselineBin = showBaseline && baselineData ? baselineData.bins[i] : null;
          const baselineHeight = baselineBin ? (baselineBin.count / baselineMaxCount) * 100 : 0;

          return (
            <div key={i} className="flex-1 relative flex items-end h-full" title={`${bin.min.toFixed(1)}–${bin.max.toFixed(1)}: ${bin.count} players`}>
              {/* Baseline ghost */}
              {showBaseline && baselineHeight > 0 && (
                <div
                  className="absolute bottom-0 w-full border border-muted-foreground/20 rounded-t-[1px]"
                  style={{ height: `${baselineHeight}%` }}
                />
              )}
              {/* Draft bar */}
              <div
                className={`w-full rounded-t-[1px] transition-all duration-150 ${
                  isMeanBin ? "bg-[#ffa05c]" : "bg-[#ffa05c]/30"
                }`}
                style={{ height: `${height}%`, minHeight: bin.count > 0 ? "2px" : "0px" }}
              />
            </div>
          );
        })}
      </div>

      {/* Summary stats */}
      <div className="flex gap-4 mt-1.5 text-[10px] font-mono text-muted-foreground">
        <span>{data.total_players} players</span>
        <span>Mean: {data.mean.toFixed(1)}</span>
        <span>Median: {data.median.toFixed(1)}</span>
        <span>P90: {data.p90.toFixed(1)}</span>
      </div>
    </section>
  );
}
