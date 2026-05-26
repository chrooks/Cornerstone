"use client";

/**
 * CountSummary — review-state count summary panel.
 *
 * Only rendered when the draft is in 'review' status.
 */

import type { SnapshotCountSummary } from "@/lib/types";

interface CountSummaryProps {
  id: string;
  summary: SnapshotCountSummary;
}

function SummaryRow({
  id,
  label,
  value,
  tone = "neutral",
}: {
  id: string;
  label: string;
  value: number;
  tone?: "neutral" | "alert" | "ok";
}) {
  const valueColor =
    tone === "alert" ? "text-amber-700" :
    tone === "ok" ? "text-emerald-700" :
    "text-[#0e0907]";

  return (
    <div id={id} className="flex items-center justify-between py-2 border-b border-[#d9d0c9] last:border-0">
      <span className="text-xs text-neutral-600">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${valueColor}`}>{value}</span>
    </div>
  );
}

export function CountSummary({ id, summary }: CountSummaryProps) {
  return (
    <section
      id={id}
      className="rounded-[6px] border border-[#d9d0c9] p-6"
      style={{ backgroundColor: "#f7f7f7" }}
    >
      <h3 id={`${id}-title`} className="text-sm font-semibold text-[#0e0907] mb-3">
        What will be published
      </h3>

      <SummaryRow
        id={`${id}-players-total`}
        label="Total players"
        value={summary.players_total}
      />
      <SummaryRow
        id={`${id}-players-changed`}
        label="Changed since active Snapshot"
        value={summary.players_changed_since_active}
        tone={summary.players_changed_since_active > 0 ? "neutral" : "ok"}
      />
      <SummaryRow
        id={`${id}-players-missing-composite`}
        label="Missing composite profile"
        value={summary.players_missing_composite}
        tone={summary.players_missing_composite > 0 ? "alert" : "ok"}
      />

      {summary.players_missing_composite > 0 && (
        <p
          id={`${id}-missing-composite-warn`}
          className="mt-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2"
        >
          {summary.players_missing_composite} player(s) lack a composite profile.
          Publishing without them will freeze empty skill profiles. You must
          acknowledge this in the publish modal.
        </p>
      )}
    </section>
  );
}
