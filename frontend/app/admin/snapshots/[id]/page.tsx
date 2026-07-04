"use client";

/**
 * /admin/snapshots/[id] — Read-only Snapshot Release detail.
 *
 * 880px column. Shows ReleaseDetailCard + Reactivate Affordance for
 * published, non-active Releases (#53).
 * Returns 404-style message for non-published IDs.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast, Toaster } from "sonner";
import { cn } from "@/lib/utils";
import {
  apiFetch,
  getPublishedReleaseDiff,
  reactivateSnapshotRelease,
} from "@/lib/api";
import type {
  ApiResponse,
  PublishedReleaseDiff,
  SnapshotRelease,
} from "@/lib/types";
import { StateChip } from "../_components/StateChip";
import { ReactivateModal } from "../_components/ReactivateModal";
import { ReleaseDiffBody } from "@/components/release-diff/ReleaseDiffBody";

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

interface ReleaseDetailCardProps {
  release: SnapshotRelease;
  onReactivateClick: () => void;
}

function ReleaseDetailCard({ release, onReactivateClick }: ReleaseDetailCardProps) {
  const canReactivate = release.status === "published" && !release.is_active;

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

      {canReactivate && (
        <div
          id="snapshot-detail-reactivate-row"
          className="mt-6 pt-6 border-t border-[#d9d0c9] flex items-center justify-between gap-4"
        >
          <p
            id="snapshot-detail-reactivate-help"
            className="text-xs text-neutral-500 leading-relaxed"
          >
            Roll back to this Release. The current active Snapshot will be deactivated.
          </p>
          <button
            id="snapshot-detail-reactivate-btn"
            type="button"
            onClick={onReactivateClick}
            className="shrink-0 text-xs font-semibold px-4 py-2 rounded-[4px] transition-colors
              bg-[#ffa05c] text-[#0e0907] hover:bg-[#fe6d34]
              focus:outline-none focus:ring-2 focus:ring-[#ffa05c] focus:ring-offset-2"
          >
            Reactivate this Release
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * "What changed vs previous release" — the same public release diff the
 * /snapshots/[id] page shows, embedded below the detail card (#84 follow-up).
 */
function ReleaseDiffSection({ releaseId }: { releaseId: string }) {
  const [diff, setDiff] = useState<PublishedReleaseDiff | null>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    // Reset on release change and ignore out-of-order resolutions — the page
    // stays mounted across /admin/snapshots/A → B navigations.
    let ignore = false;
    setDiff(null);
    setHasError(false);
    getPublishedReleaseDiff(releaseId)
      .then((res) => {
        if (ignore) return;
        if (res.success && res.data) {
          setDiff(res.data);
        } else {
          setHasError(true);
        }
      })
      .catch(() => {
        if (!ignore) setHasError(true);
      });
    return () => {
      ignore = true;
    };
  }, [releaseId]);

  if (hasError) {
    return (
      <p id="snapshot-detail-diff-error" className="mt-8 text-xs text-neutral-500">
        Couldn&apos;t load the diff vs the previous release.
      </p>
    );
  }

  return (
    <section id="snapshot-detail-diff" className="mt-8" aria-label="Release diff">
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <p className="text-[12px] uppercase tracking-[0.18em] font-semibold text-[#0e0907]">
          What changed vs previous release
        </p>
        {diff?.previous && (
          <span className="text-xs text-neutral-500">
            vs &ldquo;{diff.previous.label}&rdquo;
          </span>
        )}
      </div>
      {diff === null ? (
        <div
          id="snapshot-detail-diff-loading"
          className="h-16 rounded-[6px] border border-[#d9d0c9] animate-pulse"
          style={{ backgroundColor: "#fef9f5" }}
        />
      ) : diff.previous === null ? (
        <p id="snapshot-detail-diff-first" className="text-xs text-neutral-500">
          First Snapshot Release — there is no previous release to compare
          against.
        </p>
      ) : (
        <ReleaseDiffBody
          // Remount per release so the auto-expand initializer reruns.
          key={diff.release.id}
          summary={diff.summary}
          playersAdded={diff.players_added}
          playersRemoved={diff.players_removed}
          playersChanged={diff.players_changed}
          comparedWithLabel={diff.previous.label}
        />
      )}
    </section>
  );
}

export default function SnapshotDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [modalOpen, setModalOpen] = useState(false);
  const [isReactivating, setIsReactivating] = useState(false);

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

  const handleReactivateConfirm = async () => {
    if (!id) return;
    setIsReactivating(true);
    try {
      const res = await reactivateSnapshotRelease(id);
      if (!res.success || !res.data) {
        const code = res.error ?? "unknown_error";
        const message =
          code === "draft_in_flight"
            ? "Cannot reactivate while a draft is open. Discard or publish the draft first."
            : code === "not_published"
              ? "Only published Releases can be reactivated."
              : `Reactivation failed: ${code}`;
        toast.error(message);
        return;
      }
      toast.success(`Reactivated '${res.data.label}'`);
      setModalOpen(false);
      router.push(`/admin/snapshots/${res.data.id}`);
    } finally {
      setIsReactivating(false);
    }
  };

  const handleModalClose = useCallback(() => {
    if (!isReactivating) setModalOpen(false);
  }, [isReactivating]);

  return (
    <main id="snapshot-detail-page" className="max-w-[880px] mx-auto px-4 py-8">
      <Toaster richColors position="top-right" />
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
        <>
          <ReleaseDetailCard
            release={loadState.release}
            onReactivateClick={() => setModalOpen(true)}
          />
          <ReleaseDiffSection releaseId={loadState.release.id} />
          <ReactivateModal
            id="snapshot-detail-reactivate-modal"
            open={modalOpen}
            label={loadState.release.label}
            onClose={handleModalClose}
            onConfirm={handleReactivateConfirm}
            isSubmitting={isReactivating}
          />
        </>
      )}
    </main>
  );
}
