"use client";

/**
 * /admin/snapshots — Index Surface.
 *
 * Three sections (40px gaps):
 *  1. ActiveReleaseCard — current published Snapshot
 *  2. DraftSummarySlot — NewDraftCTA or DraftSummaryCard
 *  3. RecentHistoryList — last 10 published Snapshots
 *
 * One primary action per Surface:
 *   If no draft → "New draft" (primary)
 *   If draft exists → "Continue draft" (primary)
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast, Toaster } from "sonner";
import { cn } from "@/lib/utils";
import {
  getActiveSnapshot,
  getDraftSnapshot,
  createDraftSnapshot,
  listSnapshotReleases,
} from "@/lib/api";
import type { SnapshotRelease, SnapshotDraftSummary } from "@/lib/types";
import { StateChip } from "./_components/StateChip";

// ---------------------------------------------------------------------------
// Loading helpers
// ---------------------------------------------------------------------------

type Load<T> = { status: "loading" } | { status: "ready"; value: T } | { status: "error" };

function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-3 w-3 border-2 border-current border-t-transparent rounded-full animate-spin",
        className,
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// ActiveReleaseCard
// ---------------------------------------------------------------------------

function ActiveReleaseCard({ release }: { release: SnapshotRelease }) {
  return (
    <section
      id="snapshot-active-card"
      className="rounded-[6px] border border-[#d9d0c9] p-6"
      style={{ backgroundColor: "#f7f7f7" }}
    >
      <div id="snapshot-active-header" className="flex items-start justify-between gap-4 mb-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider font-semibold text-neutral-400 mb-1">
            Active Snapshot
          </p>
          <h2 id="snapshot-active-label" className="text-lg font-bold text-[#0e0907]">
            {release.label}
          </h2>
        </div>
        <StateChip id="snapshot-active-chip" variant="published" />
      </div>
      <dl
        id="snapshot-active-meta"
        className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs text-neutral-500"
      >
        <div>
          <dt className="inline font-medium text-[#0e0907]">Season: </dt>
          <dd className="inline">{release.season}</dd>
        </div>
        {release.published_at && (
          <div>
            <dt className="inline font-medium text-[#0e0907]">Published: </dt>
            <dd className="inline">{new Date(release.published_at).toLocaleDateString()}</dd>
          </div>
        )}
        <div className="col-span-2">
          <dt className="inline font-medium text-[#0e0907]">ID: </dt>
          <dd className="inline font-mono text-[11px]">{release.id}</dd>
        </div>
      </dl>
      <div className="mt-4">
        <Link
          id="snapshot-active-detail-link"
          href={`/admin/snapshots/${release.id}`}
          className="text-xs text-[#a34400] hover:underline underline-offset-2"
        >
          View release details →
        </Link>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// DraftSummarySlot — NewDraftCTA or DraftSummaryCard
// ---------------------------------------------------------------------------

function NewDraftCTA({ onCreate }: { onCreate: () => void }) {
  return (
    <section
      id="snapshot-draft-cta"
      className="rounded-[6px] border border-dashed border-[#d9d0c9] p-6 flex items-center justify-between"
      style={{ backgroundColor: "#f7f7f7" }}
    >
      <div>
        <h2 id="snapshot-draft-cta-title" className="text-sm font-semibold text-[#0e0907] mb-1">
          No draft in progress
        </h2>
        <p id="snapshot-draft-cta-desc" className="text-xs text-neutral-500">
          Start a new draft to stage pipeline runs before publishing.
        </p>
      </div>
      <button
        id="snapshot-new-draft-btn"
        type="button"
        onClick={onCreate}
        className="flex-shrink-0 text-xs font-semibold px-5 py-2.5 rounded-[4px]
          bg-[#ffa05c] text-[#0e0907] hover:bg-[#fe6d34]
          focus:outline-none focus:ring-2 focus:ring-[#ffa05c] focus:ring-offset-2
          transition-colors"
      >
        New draft
      </button>
    </section>
  );
}

function DraftSummaryCard({ draft }: { draft: SnapshotDraftSummary }) {
  return (
    <section
      id="snapshot-draft-summary-card"
      className="rounded-[6px] border border-[#ffa05c]/40 p-6 flex items-center justify-between"
      style={{ backgroundColor: "#f7f7f7" }}
    >
      <div>
        <p className="text-[11px] uppercase tracking-wider font-semibold text-neutral-400 mb-1">
          Draft in progress
        </p>
        <div className="flex items-center gap-2 mb-1">
          <h2 id="snapshot-draft-label" className="text-sm font-semibold text-[#0e0907]">
            {draft.label}
          </h2>
          <StateChip
            id="snapshot-draft-chip"
            variant={draft.status as "draft" | "review"}
          />
          {draft.has_running_jobs && (
            <span id="snapshot-draft-running-badge" className="flex items-center gap-1 text-[11px] text-[#fe6d34]">
              <span className="inline-block w-2 h-2 border-2 border-[#fe6d34] border-t-transparent rounded-full animate-spin" />
              Running
            </span>
          )}
        </div>
        <p className="text-xs text-neutral-500">
          Started {new Date(draft.created_at).toLocaleDateString()}
        </p>
      </div>
      <Link
        id="snapshot-continue-draft-btn"
        href="/admin/snapshots/draft"
        className="flex-shrink-0 text-xs font-semibold px-5 py-2.5 rounded-[4px]
          bg-[#ffa05c] text-[#0e0907] hover:bg-[#fe6d34]
          focus:outline-none focus:ring-2 focus:ring-[#ffa05c] focus:ring-offset-2
          transition-colors text-center"
      >
        Continue draft
      </Link>
    </section>
  );
}

// ---------------------------------------------------------------------------
// RecentHistoryList
// ---------------------------------------------------------------------------

function RecentHistoryList({ releases }: { releases: SnapshotRelease[] }) {
  if (releases.length === 0) {
    return (
      <p id="snapshot-history-empty" className="text-xs text-neutral-400 italic">
        No published Snapshots yet.
      </p>
    );
  }

  return (
    <div id="snapshot-history-list" className="space-y-2">
      {releases.map((r) => (
        <Link
          key={r.id}
          id={`snapshot-history-item-${r.id}`}
          href={`/admin/snapshots/${r.id}`}
          className="flex items-center justify-between rounded-[6px] border border-[#d9d0c9]
            px-4 py-3 text-xs hover:border-[#ffa05c]/60 transition-colors"
          style={{ backgroundColor: "#f7f7f7" }}
        >
          <span className="font-medium text-[#0e0907]">{r.label}</span>
          <div className="flex items-center gap-4 text-neutral-500">
            <span>{r.season}</span>
            {r.published_at && (
              <span>{new Date(r.published_at).toLocaleDateString()}</span>
            )}
            {r.is_active && (
              <span className="text-[11px] font-semibold text-[#a34400]">Active</span>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SnapshotsIndexPage() {
  const [activeLoad, setActiveLoad] = useState<Load<SnapshotRelease>>({ status: "loading" });
  const [draftLoad, setDraftLoad] = useState<Load<SnapshotDraftSummary | null>>({ status: "loading" });
  const [historyLoad, setHistoryLoad] = useState<Load<SnapshotRelease[]>>({ status: "loading" });
  const [creating, setCreating] = useState(false);

  const loadAll = useCallback(async () => {
    setActiveLoad({ status: "loading" });
    setDraftLoad({ status: "loading" });
    setHistoryLoad({ status: "loading" });

    const [activeRes, draftRes, historyRes] = await Promise.all([
      getActiveSnapshot(),
      getDraftSnapshot(),
      listSnapshotReleases(10),
    ]);

    setActiveLoad(
      activeRes.success && activeRes.data
        ? { status: "ready", value: activeRes.data }
        : { status: "error" },
    );
    setDraftLoad(
      draftRes.success
        ? { status: "ready", value: draftRes.data }
        : { status: "error" },
    );
    setHistoryLoad(
      historyRes.success && historyRes.data
        ? { status: "ready", value: historyRes.data }
        : { status: "error" },
    );
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleCreateDraft = useCallback(async () => {
    setCreating(true);
    try {
      const res = await createDraftSnapshot();
      if (res.success) {
        toast.success("Draft created");
        await loadAll();
      } else {
        toast.error(res.error ?? "Failed to create draft");
      }
    } catch {
      toast.error("Failed to create draft");
    } finally {
      setCreating(false);
    }
  }, [loadAll]);

  return (
    <main id="snapshots-index-page" className="max-w-[880px] mx-auto px-4 py-8">
      <Toaster position="top-right" richColors />

      {/* Header */}
      <header id="snapshots-header" className="mb-10">
        <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-neutral-400">
          Admin · Snapshots
        </p>
        <h1 id="snapshots-title" className="text-2xl font-bold text-[#0e0907] mt-1">
          Snapshot Releases
        </h1>
        <p id="snapshots-subtitle" className="text-sm text-neutral-500 mt-1">
          Manage published Snapshot Releases and stage new pipeline runs.
        </p>
      </header>

      {/* 1 — Active Snapshot */}
      <section id="snapshots-active-section" className="mb-10">
        <h2 className="text-[11px] uppercase tracking-wider font-semibold text-neutral-400 mb-3">
          Active Release
        </h2>
        {activeLoad.status === "loading" ? (
          <div id="snapshots-active-loading" className="flex items-center gap-2 text-neutral-400 text-sm p-6">
            <Spinner /> Loading…
          </div>
        ) : activeLoad.status === "error" ? (
          <p id="snapshots-active-error" className="text-sm text-red-600">
            Failed to load active Snapshot.
          </p>
        ) : (
          <ActiveReleaseCard release={activeLoad.value} />
        )}
      </section>

      {/* 2 — Draft slot */}
      <section id="snapshots-draft-section" className="mb-10">
        <h2 className="text-[11px] uppercase tracking-wider font-semibold text-neutral-400 mb-3">
          Draft
        </h2>
        {draftLoad.status === "loading" ? (
          <div id="snapshots-draft-loading" className="flex items-center gap-2 text-neutral-400 text-sm p-6">
            <Spinner /> Loading…
          </div>
        ) : draftLoad.status === "error" ? (
          <p id="snapshots-draft-error" className="text-sm text-red-600">
            Failed to load draft status.
          </p>
        ) : draftLoad.value ? (
          <DraftSummaryCard draft={draftLoad.value} />
        ) : (
          <NewDraftCTA onCreate={creating ? () => {} : handleCreateDraft} />
        )}
      </section>

      {/* 3 — History */}
      <section id="snapshots-history-section">
        <h2 className="text-[11px] uppercase tracking-wider font-semibold text-neutral-400 mb-3">
          Release History
        </h2>
        {historyLoad.status === "loading" ? (
          <div id="snapshots-history-loading" className="flex items-center gap-2 text-neutral-400 text-sm">
            <Spinner /> Loading…
          </div>
        ) : historyLoad.status === "error" ? (
          <p id="snapshots-history-error" className="text-sm text-red-600">
            Failed to load history.
          </p>
        ) : (
          <RecentHistoryList releases={historyLoad.value} />
        )}
      </section>
    </main>
  );
}
