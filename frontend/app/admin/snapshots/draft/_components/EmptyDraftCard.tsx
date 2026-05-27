"use client";

/**
 * EmptyDraftCard — shown in the workspace shell when no draft exists.
 *
 * Visual commitment (architect-locked):
 *  - Left-aligned card in max-w-[1180px].
 *  - Background #fef9f5, border 1px solid #d9d0c9, rounded-[6px], padding 48px 56px.
 *  - Eyebrow + heading + body + primary CTA + secondary link.
 *  - Banned: centered card, gradient blob, hero-metric template.
 */

import Link from "next/link";

export interface EmptyDraftCardProps {
  id: string;
  onCreateDraft: () => Promise<void>;
  isCreating: boolean;
}

export function EmptyDraftCard({
  id,
  onCreateDraft,
  isCreating,
}: EmptyDraftCardProps) {
  return (
    <div
      id={id}
      className="rounded-[6px] border border-[#d9d0c9]"
      style={{ backgroundColor: "#fef9f5", padding: "48px 56px" }}
    >
      <p
        id={`${id}-eyebrow`}
        className="text-[11px] uppercase tracking-[0.18em] font-semibold text-neutral-400 mb-3"
      >
        No draft open
      </p>
      <h2
        id={`${id}-heading`}
        className="text-xl font-bold text-[#0e0907] mb-2"
      >
        No draft snapshot open
      </h2>
      <p
        id={`${id}-body`}
        className="text-sm text-neutral-600 mb-8 max-w-md leading-relaxed"
      >
        Create a new draft to start a skill mapping cycle. Drafts let you stage
        threshold edits, run pipelines, and review composite profiles before
        publishing a release.
      </p>
      <div className="flex items-center gap-4">
        <button
          id={`${id}-create-btn`}
          type="button"
          onClick={onCreateDraft}
          disabled={isCreating}
          className="text-sm font-semibold px-5 py-2 rounded-[4px]
            bg-[#ffa05c] text-[#0e0907] hover:bg-[#fe6d34]
            focus:outline-none focus:ring-2 focus:ring-[#ffa05c] focus:ring-offset-2
            disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isCreating ? "Creating…" : "Create draft"}
        </button>
        <Link
          id={`${id}-releases-link`}
          href="/admin/snapshots"
          className="text-sm text-neutral-500 underline hover:text-[#0e0907] transition-colors"
        >
          View published releases
        </Link>
      </div>
    </div>
  );
}
