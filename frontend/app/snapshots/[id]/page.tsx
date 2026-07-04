"use client";

/**
 * /snapshots/[id] — public Snapshot Release diff page.
 *
 * What changed in this release vs the release published right before it.
 * Linked from the landing changelog's "See what changed" affordance.
 * No auth — the diff between two published releases is public.
 *
 * States: loading, ready (+diff), ready first-release (Empty State),
 * not-found, error.
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getPublishedReleaseDiff } from "@/lib/api";
import type { PublishedReleaseDiff } from "@/lib/types";
import { ReleaseDiffBody } from "@/components/release-diff/ReleaseDiffBody";

type LoadState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "ready"; diff: PublishedReleaseDiff }
  | { status: "error" };

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function ReleaseHeader({ diff }: { diff: PublishedReleaseDiff }) {
  const { release, previous } = diff;
  const published = formatDate(release.published_at);
  const comparedWith = previous
    ? `compared with “${previous.label}” (${formatDate(previous.published_at)})`
    : null;

  return (
    <header
      id="snapshot-diff-header"
      className="rounded-[6px] border border-[#d9d0c9] p-6 mb-6"
      style={{ backgroundColor: "#f7f7f7" }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wider font-semibold text-neutral-400 mb-1">
            Snapshot Release · {diff.release.season}
          </p>
          <h1
            id="snapshot-diff-label"
            className="text-xl font-bold text-[#0e0907]"
          >
            {release.label}
          </h1>
          <p className="text-xs text-neutral-500 mt-1">
            {published && <>Published {published}</>}
            {published && comparedWith && <> · </>}
            {comparedWith}
          </p>
        </div>
      </div>
    </header>
  );
}

function FirstReleaseEmptyState() {
  return (
    <div
      id="snapshot-diff-first-release"
      className="rounded-[6px] border border-dashed border-[#d9d0c9] px-6 py-12 text-center"
    >
      <p className="text-sm font-semibold text-[#0e0907] mb-1">
        First Snapshot Release
      </p>
      <p className="text-xs text-neutral-500 mb-4">
        This is the first published snapshot — there is no previous release to
        compare against.
      </p>
      <Link
        id="snapshot-diff-first-release-cta"
        href="/players"
        className="text-xs font-medium text-[#a34400] hover:underline underline-offset-2"
      >
        Browse the player pool →
      </Link>
    </div>
  );
}

export default function PublicSnapshotDiffPage() {
  const { id } = useParams<{ id: string }>();
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    if (!id) return;
    // Reset on id change and ignore out-of-order resolutions so rapid
    // navigation can't paint a stale release's diff.
    let ignore = false;
    setLoadState({ status: "loading" });
    getPublishedReleaseDiff(id)
      .then((res) => {
        if (ignore) return;
        if (res.success && res.data) {
          setLoadState({ status: "ready", diff: res.data });
        } else if (res.error === "not_found") {
          setLoadState({ status: "not-found" });
        } else {
          setLoadState({ status: "error" });
        }
      })
      .catch(() => {
        if (!ignore) setLoadState({ status: "error" });
      });
    return () => {
      ignore = true;
    };
  }, [id]);

  return (
    <main id="snapshot-diff-page" className="max-w-[880px] mx-auto px-4 py-8">
      {loadState.status === "loading" && (
        <div id="snapshot-diff-loading" className="space-y-3">
          <div
            className="h-24 rounded-[6px] border border-[#d9d0c9] animate-pulse"
            style={{ backgroundColor: "#fef9f5" }}
          />
          <div className="h-10 rounded-[6px] border border-[#d9d0c9] animate-pulse bg-white" />
          <div className="h-10 rounded-[6px] border border-[#d9d0c9] animate-pulse bg-white" />
        </div>
      )}

      {loadState.status === "not-found" && (
        <div id="snapshot-diff-not-found" className="text-center py-16">
          <p className="text-4xl font-bold text-neutral-200 mb-3">404</p>
          <p className="text-sm text-neutral-500 mb-6">
            Snapshot Release not found.
          </p>
          <Link
            id="snapshot-diff-home-link"
            href="/"
            className="text-xs font-medium text-[#a34400] hover:underline underline-offset-2"
          >
            ← Back home
          </Link>
        </div>
      )}

      {loadState.status === "error" && (
        <p id="snapshot-diff-error" className="text-sm text-red-600">
          Failed to load the release diff.
        </p>
      )}

      {loadState.status === "ready" && (
        <>
          <ReleaseHeader diff={loadState.diff} />
          {loadState.diff.previous === null ? (
            <FirstReleaseEmptyState />
          ) : (
            <ReleaseDiffBody
              // Remount per release so the auto-expand initializer reruns.
              key={loadState.diff.release.id}
              summary={loadState.diff.summary}
              playersAdded={loadState.diff.players_added}
              playersRemoved={loadState.diff.players_removed}
              playersChanged={loadState.diff.players_changed}
              comparedWithLabel={loadState.diff.previous.label}
            />
          )}
        </>
      )}
    </main>
  );
}
