"use client";

/**
 * CountSummary — review-state count summary panel.
 *
 * Only rendered when the draft is in 'review' status.
 *
 * When `players_missing_composite > 0`, the Missing-composite row becomes a
 * disclosure that lists every affected Player. The list body scrolls when
 * the count is large so it never pushes the action bar offscreen.
 */

import type {
  MissingCompositePlayer,
  SnapshotCountSummary,
} from "@/lib/types";

interface CountSummaryProps {
  id: string;
  summary: SnapshotCountSummary;
  missingCompositePlayers?: MissingCompositePlayer[];
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

function MissingCompositeDisclosure({
  id,
  count,
  players,
}: {
  id: string;
  count: number;
  players: MissingCompositePlayer[];
}) {
  return (
    <details
      id={id}
      className="group border-b border-[#d9d0c9] last:border-0 [&_summary::-webkit-details-marker]:hidden"
    >
      <summary
        id={`${id}-summary`}
        className="flex items-center justify-between py-2 cursor-pointer list-none
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffa05c]
          focus-visible:ring-offset-1 rounded-[2px]"
      >
        <span className="flex items-center gap-1.5 text-xs text-neutral-600">
          <svg
            aria-hidden
            width="10"
            height="10"
            viewBox="0 0 10 10"
            className="text-amber-700 transition-transform duration-150 group-open:rotate-90"
          >
            <path
              d="M3 1.5 L7 5 L3 8.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Missing composite profile
        </span>
        <span className="text-sm font-semibold tabular-nums text-amber-700">
          {count}
        </span>
      </summary>

      <div
        id={`${id}-body`}
        className="mb-2 mt-1 rounded-[4px] border border-amber-200 bg-amber-50"
      >
        <p
          id={`${id}-note`}
          className="px-3 pt-2 pb-1 text-[11px] text-amber-800 leading-snug"
        >
          These Players will be frozen with an empty Skill Profile if you publish.
          Acknowledge in the publish modal to proceed.
        </p>
        <ul
          id={`${id}-list`}
          className="border-t border-amber-200 divide-y divide-amber-200 max-h-[320px] overflow-y-auto"
        >
          {players.map((p) => (
            <li
              key={p.id}
              id={`${id}-item-${p.id}`}
              className="flex items-center justify-between gap-3 px-3 py-1.5 text-[12px]"
            >
              <span className="font-medium text-[#0e0907] truncate">
                {p.name}
              </span>
              <span className="flex items-center gap-2 font-mono text-[11px] text-amber-900/80 shrink-0">
                <span className="tabular-nums">{p.team ?? "—"}</span>
                <span className="text-amber-900/40">·</span>
                <span>{p.position ?? "—"}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

export function CountSummary({
  id,
  summary,
  missingCompositePlayers = [],
}: CountSummaryProps) {
  const hasMissing = summary.players_missing_composite > 0;

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

      {hasMissing ? (
        <MissingCompositeDisclosure
          id={`${id}-players-missing-composite`}
          count={summary.players_missing_composite}
          players={missingCompositePlayers}
        />
      ) : (
        <SummaryRow
          id={`${id}-players-missing-composite`}
          label="Missing composite profile"
          value={summary.players_missing_composite}
          tone="ok"
        />
      )}
    </section>
  );
}
