"use client";

/**
 * /admin/snapshots/[id] — Read-only Snapshot Release detail.
 *
 * 880px column. Shows ReleaseDetailCard only.
 * Returns 404-style message for non-published IDs.
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import type { ApiResponse, SnapshotRelease } from "@/lib/types";
import { StateChip } from "../_components/StateChip";

type LoadState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "ready"; release: SnapshotRelease }
  | { status: "error" };

function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin",
        className,
      )}
    />
  );
}

function ReleaseDetailCard({ release }: { release: SnapshotRelease }) {
  return (
    <section
      id="snapshot-detail-card"
      className="rounded-[6px] border border-[#d9d0c9] p-6"
      style={{ backgroundColor: "#f7f7f7" }}
    >
      <div id="snapshot-detail-header" className="flex items-start justify-between gap-4 mb-6">
        <div>
          <p className="text-[11px] uppercase tracking-wider font-semibold text-neutral-400 mb-1">
            Snapshot Release
          </p>
          <h2 id="snapshot-detail-label" className="text-xl font-bold text-[#0e0907]">
            {release.label}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <StateChip id="snapshot-detail-status-chip" variant="published" />
          {release.is_active && (
            <span
              id="snapshot-detail-active-badge"
              className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
              style={{ backgroundColor: "#fef3c7", color: "#a34400" }}
            >
              Active
            </span>
          )}
        </div>
      </div>

      <dl
        id="snapshot-detail-meta"
        className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm"
      >
        <div id="snapshot-detail-season">
          <dt className="text-[11px] uppercase tracking-wider font-semibold text-neutral-400 mb-0.5">
            Season
          </dt>
          <dd className="font-medium text-[#0e0907]">{release.season}</dd>
        </div>

        {release.published_at && (
          <div id="snapshot-detail-published-at">
            <dt className="text-[11px] uppercase tracking-wider font-semibold text-neutral-400 mb-0.5">
              Published
            </dt>
            <dd className="font-medium text-[#0e0907]">
              {new Date(release.published_at).toLocaleString()}
            </dd>
          </div>
        )}

        <div id="snapshot-detail-created-at">
          <dt className="text-[11px] uppercase tracking-wider font-semibold text-neutral-400 mb-0.5">
            Created
          </dt>
          <dd className="font-medium text-[#0e0907]">
            {new Date(release.created_at).toLocaleString()}
          </dd>
        </div>

        <div id="snapshot-detail-id" className="col-span-2">
          <dt className="text-[11px] uppercase tracking-wider font-semibold text-neutral-400 mb-0.5">
            Release ID
          </dt>
          <dd className="font-mono text-xs text-neutral-600">{release.id}</dd>
        </div>
      </dl>
    </section>
  );
}

export default function SnapshotDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    if (!id) return;
    apiFetch<SnapshotRelease>(`/api/snapshots/releases/${id}`)
      .then((res: ApiResponse<SnapshotRelease>) => {
        if (res.success && res.data) {
          setLoadState({ status: "ready", release: res.data });
        } else if (res.error === "not_found" || res.error?.includes("404")) {
          setLoadState({ status: "not-found" });
        } else {
          setLoadState({ status: "error" });
        }
      })
      .catch(() => setLoadState({ status: "error" }));
  }, [id]);

  return (
    <main id="snapshot-detail-page" className="max-w-[880px] mx-auto px-4 py-8">
      <div id="snapshot-detail-breadcrumb" className="flex items-center gap-2 text-xs text-neutral-500 mb-6">
        <Link href="/admin/snapshots" className="hover:text-[#0e0907] transition-colors">
          Snapshots
        </Link>
        <span>/</span>
        <span className="font-mono">{id?.slice(0, 8)}…</span>
      </div>

      {loadState.status === "loading" && (
        <div id="snapshot-detail-loading" className="flex items-center gap-2 text-neutral-400 text-sm">
          <Spinner /> Loading…
        </div>
      )}

      {loadState.status === "not-found" && (
        <div id="snapshot-detail-not-found" className="text-center py-16">
          <p className="text-4xl font-bold text-neutral-200 mb-3">404</p>
          <p className="text-sm text-neutral-500 mb-6">
            Snapshot Release not found or not yet published.
          </p>
          <Link
            id="snapshot-detail-back-link"
            href="/admin/snapshots"
            className="text-xs font-medium text-[#a34400] hover:underline underline-offset-2"
          >
            ← Back to Snapshots
          </Link>
        </div>
      )}

      {loadState.status === "error" && (
        <p id="snapshot-detail-error" className="text-sm text-red-600">
          Failed to load Snapshot Release.
        </p>
      )}

      {loadState.status === "ready" && (
        <ReleaseDetailCard release={loadState.release} />
      )}
    </main>
  );
}
