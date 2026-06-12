"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, ArrowRight } from "lucide-react";
import { getEvalCompatCheck } from "@/lib/api";
import type {
  EvalCompatCheckResponse,
  TaxonomyDimensionDiff,
} from "@/lib/types";

type CompatState = "loading" | "ready" | "error";

interface EvalCompatBannerProps {
  savedTeamId: string;
  /** Called once the compat check settles, with whether taxonomy resolution is needed. */
  onResolved: (needsResolution: boolean) => void;
}

/**
 * Evaluation Version compat check shown at Lab open time (issue #33).
 *
 * Compares the taxonomy footprint the Saved Team was scored under against the
 * active Evaluation Version, then surfaces renamed Skills, removed Impact
 * Traits, and added Subscores. When only values changed (no taxonomy drift),
 * the banner renders nothing and re-evaluation proceeds without friction.
 */
export function EvalCompatBanner({ savedTeamId, onResolved }: EvalCompatBannerProps) {
  const [state, setState] = useState<CompatState>("loading");
  const [report, setReport] = useState<EvalCompatCheckResponse | null>(null);

  useEffect(() => {
    let alive = true;
    setState("loading");
    getEvalCompatCheck(savedTeamId)
      .then((res) => {
        if (!alive) return;
        if (res.success && res.data) {
          setReport(res.data);
          setState("ready");
          onResolved(res.data.needs_resolution);
        } else {
          // A failed compat check should not block re-evaluation — fail open.
          setState("error");
          onResolved(false);
        }
      })
      .catch(() => {
        if (!alive) return;
        setState("error");
        onResolved(false);
      });
    return () => {
      alive = false;
    };
  }, [savedTeamId, onResolved]);

  if (state === "loading") {
    return (
      <div
        id="eval-compat-banner-loading"
        className="flex items-center gap-2 rounded-md border border-[oklch(0.88_0.015_62)] bg-[oklch(0.96_0.006_62)] px-3 py-2.5 text-sm text-[oklch(0.42_0.02_45)]"
      >
        <Loader2 className="h-4 w-4 animate-spin text-[oklch(0.47_0.07_55)]" aria-hidden="true" />
        Checking Evaluation Version compatibility…
      </div>
    );
  }

  // Fail-open on error, and stay silent when there is no taxonomy drift.
  if (state === "error" || !report || !report.needs_resolution) {
    return null;
  }

  const { diff, stored_version, active_version } = report;

  return (
    <div
      id="eval-compat-banner"
      className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
        <div className="text-sm text-amber-900">
          <p className="font-semibold">Evaluation Version taxonomy changed</p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-amber-800">
            <span className="font-mono">{stored_version?.slug ?? "previous"}</span>
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
            <span className="font-mono">{active_version.slug}</span>
          </p>
          <p className="mt-1.5 text-xs text-amber-800">
            Re-evaluating will score this Team under the new taxonomy. Review what
            changed before you continue.
          </p>
        </div>
      </div>

      <div id="eval-compat-diff" className="space-y-2.5">
        <EvalCompatDimension id="eval-compat-skills" label="Skills" diff={diff.skills} />
        <EvalCompatDimension
          id="eval-compat-impact-traits"
          label="Impact Traits"
          diff={diff.impact_traits}
        />
        <EvalCompatDimension
          id="eval-compat-subscores"
          label="Subscores"
          diff={diff.subscores}
        />
      </div>
    </div>
  );
}

function dimensionHasChange(diff: TaxonomyDimensionDiff): boolean {
  return (
    diff.added.length > 0 || diff.removed.length > 0 || diff.renamed.length > 0
  );
}

interface EvalCompatDimensionProps {
  id: string;
  label: string;
  diff: TaxonomyDimensionDiff;
}

function EvalCompatDimension({ id, label, diff }: EvalCompatDimensionProps) {
  if (!dimensionHasChange(diff)) {
    return null;
  }

  return (
    <div id={id} className="rounded-sm border border-amber-200 bg-white/60 px-2.5 py-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">{label}</p>
      <ul className="mt-1 space-y-1 text-xs text-amber-900">
        {diff.renamed.map((entry) => (
          <li key={`renamed-${entry.key}`} className="flex items-center gap-1.5">
            <span className="inline-flex shrink-0 rounded-sm bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase">
              Renamed
            </span>
            <span>
              {entry.from_label ?? entry.key} → {entry.to_label ?? entry.key}
            </span>
          </li>
        ))}
        {diff.removed.map((entry) => (
          <li key={`removed-${entry.key}`} className="flex items-center gap-1.5">
            <span className="inline-flex shrink-0 rounded-sm bg-red-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-900">
              Removed
            </span>
            <span>{entry.label ?? entry.key}</span>
          </li>
        ))}
        {diff.added.map((entry) => (
          <li key={`added-${entry.key}`} className="flex items-center gap-1.5">
            <span className="inline-flex shrink-0 rounded-sm bg-emerald-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-900">
              Added
            </span>
            <span>{entry.label ?? entry.key}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
