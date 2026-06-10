"use client";

/**
 * ReleaseDiffView — draft-vs-published diff Surface (#8).
 *
 * Fetches GET /api/snapshots/diff and renders:
 *  1. #diff-summary-strip — lead band: total change count, prose breakdown vs
 *     the active release label, quiet unchanged line.
 *  2. #diff-changed-section — expandable per-Player rows (the star).
 *  3. #diff-added-section / #diff-removed-section — simple rows.
 *  4. #diff-empty-state — calm "no changes vs published" card.
 *
 * Read-only; changed Players carry the Hierarchy, unchanged is one quiet line.
 */

import { useCallback, useEffect, useState } from "react";
import { getSnapshotDiff } from "@/lib/api";
import type { ReleaseDiff, ReleaseDiffEntity } from "@/lib/types";
import {
  ReleaseDiffPlayerRow,
  LegendMarker,
} from "./ReleaseDiffPlayerRow";
import { formatSalary, nameSlug } from "./releaseDiffFormat";

/** Auto-expand changed rows when the list is small enough to scan whole. */
const AUTO_EXPAND_MAX = 5;

type ViewState = "loading" | "error" | "ready";

function SectionHeader({
  id,
  label,
  count,
  accentClass,
  dominant = false,
}: {
  id: string;
  label: string;
  count: number;
  accentClass: string;
  dominant?: boolean;
}) {
  // The "changed" section carries the Hierarchy — heavier size + darker ink so
  // it reads as the star, while added/removed stay muted.
  return (
    <p
      id={id}
      className={
        dominant
          ? "text-[12px] uppercase tracking-[0.18em] font-semibold text-[#0e0907] mb-2"
          : "text-[11px] uppercase tracking-[0.18em] font-semibold text-neutral-400 mb-2"
      }
    >
      {label} <span className={accentClass}>({count})</span>
    </p>
  );
}

function EntityRow({
  entity,
  idPrefix,
  muted,
}: {
  entity: ReleaseDiffEntity;
  idPrefix: string;
  muted?: boolean;
}) {
  const meta = [entity.team, entity.position].filter(Boolean).join(" · ");
  return (
    <div
      id={`${idPrefix}-${nameSlug(entity.name)}`}
      className="flex items-center gap-2.5 rounded-[6px] border border-[#d9d0c9] bg-white px-4 py-2"
    >
      <span
        className={
          muted
            ? "text-sm font-medium text-neutral-400 line-through"
            : "text-sm font-semibold text-[#0e0907]"
        }
      >
        {entity.name}
      </span>
      {entity.is_legend && <LegendMarker />}
      {meta && <span className="text-xs text-neutral-400">{meta}</span>}
      {!entity.is_legend && (
        <span className="ml-auto text-xs text-neutral-500 tabular-nums">
          {formatSalary(entity.salary)}
        </span>
      )}
    </div>
  );
}

export interface ReleaseDiffViewProps {
  /** Refetch key — the open draft's id. */
  draftId: string;
}

export function ReleaseDiffView({ draftId }: ReleaseDiffViewProps) {
  const [viewState, setViewState] = useState<ViewState>("loading");
  const [diff, setDiff] = useState<ReleaseDiff | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setViewState("loading");
    try {
      const res = await getSnapshotDiff();
      if (res.success && res.data) {
        setDiff(res.data);
        // Small change sets read best fully open.
        setExpandedIds(
          res.data.players_changed.length <= AUTO_EXPAND_MAX
            ? new Set(
                res.data.players_changed.map(
                  (p) => `${p.canonical_player_id}:${p.is_legend}`
                )
              )
            : new Set()
        );
        setViewState("ready");
      } else {
        setErrorMessage(res.error ?? "Failed to load diff");
        setViewState("error");
      }
    } catch {
      setErrorMessage("Failed to load diff");
      setViewState("error");
    }
  }, []);

  useEffect(() => {
    void load();
    // draftId is the refetch key: a new draft means a new diff.
  }, [load, draftId]);

  const toggleExpanded = useCallback((key: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  if (viewState === "loading") {
    return (
      <div id="diff-loading" className="space-y-3">
        <div
          className="h-20 rounded-[6px] border border-[#d9d0c9] animate-pulse"
          style={{ backgroundColor: "#fef9f5" }}
        />
        <div className="h-10 rounded-[6px] border border-[#d9d0c9] animate-pulse bg-white" />
        <div className="h-10 rounded-[6px] border border-[#d9d0c9] animate-pulse bg-white" />
      </div>
    );
  }

  if (viewState === "error" || !diff) {
    return (
      <div
        id="diff-error-state"
        className="rounded-[6px] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800"
      >
        <p className="mb-2">
          Couldn&apos;t compute the diff: {errorMessage ?? "unknown error"}
        </p>
        <button
          id="diff-error-retry-btn"
          type="button"
          onClick={() => void load()}
          className="text-xs font-medium border border-amber-300 rounded-[4px] px-3 py-1.5 bg-white hover:bg-amber-100 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  const { summary, active_release } = diff;
  const totalChanges = summary.added + summary.removed + summary.changed;

  const proseParts: string[] = [];
  if (summary.added > 0) proseParts.push(`${summary.added} added`);
  if (summary.removed > 0) proseParts.push(`${summary.removed} removed`);
  if (summary.changed > 0) proseParts.push(`${summary.changed} changed`);

  if (totalChanges === 0) {
    return (
      <div
        id="diff-empty-state"
        className="rounded-[6px] border border-[#d9d0c9] px-5 py-6 text-center"
        style={{ backgroundColor: "#fef9f5" }}
      >
        <p className="text-sm font-medium text-[#0e0907] mb-1">
          <span className="text-green-600" aria-hidden="true">✓</span> No changes vs published release
        </p>
        <p className="text-xs text-neutral-500">
          Publishing this draft would freeze the same {summary.unchanged} player
          {summary.unchanged !== 1 ? "s" : ""} as &ldquo;{active_release.label}
          &rdquo;.
        </p>
      </div>
    );
  }

  return (
    <div id="diff-content" className="space-y-6">
      {/* Lead band */}
      <div
        id="diff-summary-strip"
        className="px-4 py-3 rounded-[6px] border border-[#d9d0c9]"
        style={{ backgroundColor: "#fef9f5" }}
      >
        <div className="flex items-baseline gap-3 flex-wrap">
          <span
            id="diff-summary-total"
            className="text-2xl font-bold text-[#0e0907]"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            {totalChanges}
          </span>
          <span className="text-sm text-neutral-500">
            {proseParts.join(", ")} vs &ldquo;{active_release.label}&rdquo;
          </span>
        </div>
        <p id="diff-summary-unchanged" className="text-[11px] text-neutral-400 mt-1">
          {summary.unchanged} player{summary.unchanged !== 1 ? "s" : ""} unchanged
        </p>
      </div>

      {/* Changed players — the star */}
      {summary.changed > 0 && (
        <section id="diff-changed-section" aria-label="Players changed">
          <SectionHeader
            id="diff-changed-header"
            label="Players changed"
            count={summary.changed}
            accentClass="text-[#fe6d34]"
            dominant
          />
          <div className="space-y-1.5">
            {diff.players_changed.map((player) => {
              const key = `${player.canonical_player_id}:${player.is_legend}`;
              return (
                <ReleaseDiffPlayerRow
                  key={key}
                  player={player}
                  isExpanded={expandedIds.has(key)}
                  onToggle={() => toggleExpanded(key)}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* Added */}
      {summary.added > 0 && (
        <section id="diff-added-section" aria-label="Players added">
          <SectionHeader
            id="diff-added-header"
            label="Players added"
            count={summary.added}
            accentClass="text-green-700"
          />
          <div className="space-y-1.5">
            {diff.players_added.map((entity) => (
              <EntityRow
                key={`${entity.canonical_player_id}:${entity.is_legend}`}
                entity={entity}
                idPrefix="diff-added-row"
              />
            ))}
          </div>
        </section>
      )}

      {/* Removed */}
      {summary.removed > 0 && (
        <section id="diff-removed-section" aria-label="Players removed">
          <SectionHeader
            id="diff-removed-header"
            label="Players removed"
            count={summary.removed}
            accentClass="text-red-700"
          />
          <div className="space-y-1.5">
            {diff.players_removed.map((entity) => (
              <EntityRow
                key={`${entity.canonical_player_id}:${entity.is_legend}`}
                entity={entity}
                idPrefix="diff-removed-row"
                muted
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
