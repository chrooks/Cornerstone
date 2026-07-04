"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, ClipboardList, ScrollText, SlidersHorizontal, Users } from "lucide-react";
import { getChangelog } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ChangelogEntry, ChangelogEntryType } from "@/lib/types";

/* ── Tunables ── */
const ENTRY_LIMIT = 4;

/* ── Per-type presentation ── */

type TypeMeta = {
  label: string;
  Icon: typeof SlidersHorizontal;
  badgeClass: string;
  iconClass: string;
};

const TYPE_META: Record<ChangelogEntryType, TypeMeta> = {
  ruleset_version: {
    label: "Rule Set",
    Icon: ScrollText,
    badgeClass: "bg-[#fff1e3] text-[#a8400f] border-[#fe6d34]/30",
    iconClass: "text-[#fe6d34]",
  },
  evaluation_version: {
    label: "Evaluation Engine",
    Icon: SlidersHorizontal,
    badgeClass: "bg-[#eef2f7] text-[#3a4a5e] border-[#3a4a5e]/20",
    iconClass: "text-[#3a4a5e]",
  },
  snapshot_release: {
    label: "Player Snapshot",
    Icon: Users,
    badgeClass: "bg-[#e9f4ec] text-[#1f6b3a] border-[#1f6b3a]/25",
    iconClass: "text-[#1f6b3a]",
  },
};

/* ── Helpers ── */

/** Build a DOM-safe id fragment from a free-text version label. */
function idSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "version";
}

function formatDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/* ── States ── */

function LoadingSkeleton() {
  return (
    <ul id="landing-changelog-skeleton" className="flex flex-col gap-3" aria-hidden>
      {Array.from({ length: 3 }).map((_, i) => (
        <li
          key={i}
          className="rounded-lg border border-[#0e0907]/10 bg-[#fff8f0]/70 p-5"
        >
          <div className="flex items-center gap-3">
            <div className="h-5 w-24 animate-pulse rounded-sm bg-[#0e0907]/10" />
            <div className="h-4 w-16 animate-pulse rounded-sm bg-[#0e0907]/8" />
          </div>
          <div className="mt-3 h-4 w-2/3 animate-pulse rounded-sm bg-[#0e0907]/10" />
          <div className="mt-2 h-3 w-1/2 animate-pulse rounded-sm bg-[#0e0907]/8" />
        </li>
      ))}
    </ul>
  );
}

/**
 * Polished Empty State — shown when no Rule Set or Evaluation Version has been
 * published yet. A named acceptance requirement, not a blank placeholder: it
 * explains what the changelog will hold and points to the Lab.
 */
function EmptyState() {
  return (
    <div
      id="landing-changelog-empty"
      className="flex flex-col items-center rounded-lg border border-dashed border-[#0e0907]/20 bg-[#fff8f0]/60 px-6 py-12 text-center"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[#0e0907]/15 bg-[#fff1e3]">
        <ClipboardList className="h-5 w-5 text-[#fe6d34]" aria-hidden />
      </div>
      <h3
        id="landing-changelog-empty-heading"
        className="mt-4 font-display text-lg font-semibold tracking-[-0.01em] text-[#0e0907]"
      >
        No updates published yet
      </h3>
      <p className="mt-2 max-w-sm text-[0.875rem] leading-relaxed text-[#0e0907]/65">
        When a new Rule Set version, evaluation engine update, or player snapshot
        ships, it shows up here — what changed, when, and which part of the Lab it
        touches.
      </p>
      <Link
        id="landing-changelog-empty-cta"
        href="/lab"
        className="mt-5 inline-flex items-center gap-1 text-[0.875rem] font-medium text-[#0e0907] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0e0907]"
      >
        Head to the Lab
        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </div>
  );
}

/* ── Entry row ── */

function ChangelogRow({ entry }: { entry: ChangelogEntry }) {
  const meta = TYPE_META[entry.type];
  const { Icon } = meta;
  const date = formatDate(entry.date);
  const domId = `landing-changelog-entry-${entry.type}-${idSlug(entry.version_label)}`;

  const inner = (
    <>
      {/* Header row: type badge + version + date */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-mono text-[0.6875rem] font-medium uppercase tracking-[0.06em]",
            meta.badgeClass,
          )}
        >
          <Icon className={cn("h-3 w-3", meta.iconClass)} aria-hidden />
          {meta.label}
        </span>
        <span className="font-mono text-[0.75rem] font-semibold text-[#0e0907]/80">
          {entry.version_label}
        </span>
        {date && (
          <time
            dateTime={entry.date}
            className="ml-auto font-mono text-[0.6875rem] tabular-nums text-[#0e0907]/50"
          >
            {date}
          </time>
        )}
      </div>

      {/* Title */}
      <h3 className="mt-3 font-display text-base font-semibold leading-snug tracking-[-0.01em] text-[#0e0907]">
        {entry.title}
      </h3>

      {/* Summary */}
      <p className="mt-1 text-[0.875rem] leading-relaxed text-[#0e0907]/65">
        {entry.summary}
      </p>

      {entry.link && (
        <span className="mt-3 inline-flex items-center gap-1 font-mono text-[0.75rem] font-medium text-[#0e0907] transition-transform duration-150 group-hover/entry:translate-x-0.5">
          {entry.type === "snapshot_release" ? "See what changed" : "Open"}
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </span>
      )}
    </>
  );

  const baseClass =
    "block rounded-lg border border-[#0e0907]/10 bg-[#fff8f0]/95 p-5 shadow-[0_1px_0_0_rgba(14,9,7,0.05)] transition-all duration-200";

  if (entry.link) {
    return (
      <Link
        id={domId}
        href={entry.link}
        className={cn(
          "group/entry",
          baseClass,
          "hover:border-[#0e0907]/25 hover:shadow-[0_1px_0_0_rgba(14,9,7,0.08),0_8px_20px_-12px_rgba(14,9,7,0.3)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0e0907]",
        )}
      >
        {inner}
      </Link>
    );
  }

  return (
    <div
      id={domId}
      className={baseClass}
    >
      {inner}
    </div>
  );
}

/* ── Container ── */

/**
 * Landing page changelog section. Fetches the public `/api/changelog` feed and
 * renders published Rule Set Version + Evaluation Version events newest-first.
 * Auto-updates with the data — no hardcoded entries live here.
 */
export function Changelog() {
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getChangelog(ENTRY_LIMIT)
      .then((res) => {
        if (cancelled) return;
        if (res.success && res.data) {
          setEntries(res.data);
        } else {
          setIsError(true);
        }
      })
      .catch(() => {
        if (!cancelled) setIsError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  let body: React.ReactNode;
  if (isError) {
    // Failure folds into the Empty State rather than shouting an error on the
    // brand surface — the changelog is supplementary, not load-bearing.
    body = <EmptyState />;
  } else if (entries === null) {
    body = <LoadingSkeleton />;
  } else if (entries.length === 0) {
    body = <EmptyState />;
  } else {
    body = (
      <ul id="landing-changelog-list" className="flex flex-col gap-3">
        {entries.map((entry) => (
          <li key={`${entry.type}-${entry.version_label}-${entry.date}`}>
            <ChangelogRow entry={entry} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section
      id="landing-changelog"
      aria-labelledby="landing-changelog-heading"
      className="border-t border-border bg-background"
    >
      <div className="max-w-screen-xl mx-auto px-6 py-20 md:py-28">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-12 lg:gap-16 items-start">
          {/* Left column — section intro */}
          <div className="max-w-sm">
            <span className="font-mono text-xs tracking-[0.08em] uppercase text-muted-foreground">
              Changelog
            </span>
            <h2
              id="landing-changelog-heading"
              className="font-display text-[clamp(1.5rem,2vw+0.5rem,2.25rem)] font-semibold leading-[1.15] tracking-[-0.01em] mt-3"
            >
              The rules keep
              <br />
              getting sharper.
            </h2>
            <p className="mt-4 text-[0.9375rem] leading-relaxed text-muted-foreground">
              Every published Rule Set version and evaluation engine update lands
              here automatically. See what changed, when, and where it shows up in
              the Lab.
            </p>
          </div>

          {/* Right column — feed */}
          <div className="w-full">{body}</div>
        </div>
      </div>
    </section>
  );
}
