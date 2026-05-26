"use client";

/**
 * Admin Hub — landing page for all admin Surfaces.
 *
 * Two responsibilities:
 *   1. Surface system health at a glance: Rule Set count, current Evaluation
 *      Version, pending review items.
 *   2. Provide consistent navigation to every active admin surface (RuleSets,
 *      Calibration, Cohesion Calibration, Pipeline, Review, Legends).
 *
 * Each data source is fetched independently so a slow endpoint doesn't block
 * the rest of the page from rendering.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getReviewQueue,
  listRuleSets,
} from "@/lib/api";
import { getActiveEvaluationVersion } from "@/lib/api/evaluation-versions";
import type { RuleSetSummary } from "@/lib/types";
import type { EvaluationVersion } from "@/lib/types/evaluation-version";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Loading state types
// ---------------------------------------------------------------------------

type LoadState<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "error" };

// ---------------------------------------------------------------------------
// Small UI primitives — kept inline to avoid a new component library.
// ---------------------------------------------------------------------------

function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Health stat block — one of three top-of-page status cards.
// ---------------------------------------------------------------------------

interface HealthStatProps {
  id: string;
  label: string;
  state: LoadState<{ primary: React.ReactNode; secondary?: React.ReactNode }>;
  tone?: "neutral" | "alert" | "ok";
  accentRail: string; // tailwind bg-* class for the left rail
}

function HealthStat({ id, label, state, tone = "neutral", accentRail }: HealthStatProps) {
  return (
    <div
      id={id}
      className="relative flex-1 min-w-0 overflow-hidden rounded-xl border bg-card p-5"
    >
      {/* Left accent rail — gives each health surface a distinct identity */}
      <div
        aria-hidden
        className={cn("absolute left-0 top-0 bottom-0 w-1", accentRail)}
      />
      <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
        {label}
      </p>
      {state.status === "loading" ? (
        <Spinner className="text-muted-foreground" />
      ) : state.status === "error" ? (
        <p className="text-sm text-muted-foreground italic">Unavailable</p>
      ) : (
        <>
          <p
            className={cn(
              "text-2xl font-bold tracking-tight leading-tight",
              tone === "alert" && "text-amber-700",
              tone === "ok" && "text-emerald-700",
            )}
          >
            {state.value.primary}
          </p>
          {state.value.secondary && (
            <p className="text-xs text-muted-foreground mt-1">
              {state.value.secondary}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Navigation card — one per admin Surface.
// ---------------------------------------------------------------------------

interface AdminSurfaceCardProps {
  id: string;
  href: string;
  title: string;
  description: string;
  glyph: string;        // single character used as visual mark
  hint?: React.ReactNode; // small status badge at the right
}

function AdminSurfaceCard({
  id,
  href,
  title,
  description,
  glyph,
  hint,
}: AdminSurfaceCardProps) {
  return (
    <Link
      id={id}
      href={href}
      className={cn(
        "group block rounded-xl border bg-card p-5",
        "transition-all hover:border-foreground/30 hover:shadow-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40",
      )}
    >
      <div className="flex items-start gap-4">
        {/* Glyph — square mark sized to anchor the card without being decorative */}
        <span
          aria-hidden
          className={cn(
            "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg",
            "bg-foreground/[0.04] text-base font-bold text-foreground/70",
            "transition-colors group-hover:bg-foreground/[0.08] group-hover:text-foreground",
          )}
        >
          {glyph}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-sm leading-tight">{title}</h3>
            {hint}
          </div>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            {description}
          </p>
        </div>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Hint badges shown on navigation cards
// ---------------------------------------------------------------------------

function HintBadge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "alert" | "ok";
}) {
  return (
    <span
      className={cn(
        "text-[10px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap",
        tone === "neutral" &&
          "border-border bg-muted text-muted-foreground",
        tone === "alert" &&
          "border-amber-300 bg-amber-50 text-amber-700",
        tone === "ok" &&
          "border-emerald-300 bg-emerald-50 text-emerald-700",
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminHubPage() {
  // Each data source has its own LoadState so badges resolve independently.
  const [ruleSetsState, setRuleSetsState] =
    useState<LoadState<RuleSetSummary[]>>({ status: "loading" });
  const [activeEvalState, setActiveEvalState] =
    useState<LoadState<EvaluationVersion>>({ status: "loading" });
  const [reviewState, setReviewState] =
    useState<LoadState<number>>({ status: "loading" });

  useEffect(() => {
    listRuleSets()
      .then((res) => {
        if (res.success && res.data) {
          setRuleSetsState({ status: "ready", value: res.data });
        } else {
          setRuleSetsState({ status: "error" });
        }
      })
      .catch(() => setRuleSetsState({ status: "error" }));

    getActiveEvaluationVersion()
      .then((res) => {
        if (res.success && res.data) {
          setActiveEvalState({ status: "ready", value: res.data });
        } else {
          setActiveEvalState({ status: "error" });
        }
      })
      .catch(() => setActiveEvalState({ status: "error" }));

    getReviewQueue()
      .then((res) => {
        if (res.success && res.data) {
          setReviewState({ status: "ready", value: res.data.length });
        } else {
          setReviewState({ status: "error" });
        }
      })
      .catch(() => setReviewState({ status: "error" }));
  }, []);

  // -------------------------------------------------------------------------
  // Derived values for top stat row
  // -------------------------------------------------------------------------

  const ruleSetStat: LoadState<{ primary: React.ReactNode; secondary?: React.ReactNode }> =
    ruleSetsState.status === "ready"
      ? (() => {
          const all = ruleSetsState.value;
          const active = all.filter((r) => r.status === "active").length;
          const comingSoon = all.filter((r) => r.status === "coming_soon").length;
          return {
            status: "ready",
            value: {
              primary: `${active} active`,
              secondary:
                comingSoon > 0
                  ? `${comingSoon} coming soon · ${all.length} total`
                  : `${all.length} total`,
            },
          };
        })()
      : ruleSetsState.status === "error"
        ? { status: "error" }
        : { status: "loading" };

  const evalVersionStat: LoadState<{
    primary: React.ReactNode;
    secondary?: React.ReactNode;
  }> =
    activeEvalState.status === "ready"
      ? {
          status: "ready",
          value: {
            primary: activeEvalState.value.slug,
            secondary: `Status: ${activeEvalState.value.status}`,
          },
        }
      : activeEvalState.status === "error"
        ? { status: "error" }
        : { status: "loading" };

  const pendingReviewStat: LoadState<{
    primary: React.ReactNode;
    secondary?: React.ReactNode;
  }> =
    reviewState.status === "ready"
      ? {
          status: "ready",
          value: {
            primary: `${reviewState.value} pending`,
            secondary:
              reviewState.value === 0
                ? "Queue clear"
                : "Awaiting manual resolution",
          },
        }
      : reviewState.status === "error"
        ? { status: "error" }
        : { status: "loading" };

  const reviewTone: "neutral" | "alert" | "ok" =
    reviewState.status === "ready"
      ? reviewState.value === 0
        ? "ok"
        : "alert"
      : "neutral";

  // -------------------------------------------------------------------------
  // Hint badges per surface card
  // -------------------------------------------------------------------------

  const ruleSetsHint =
    ruleSetsState.status === "loading" ? (
      <HintBadge>
        <Spinner />
      </HintBadge>
    ) : ruleSetsState.status === "error" ? (
      <HintBadge>—</HintBadge>
    ) : (
      <HintBadge>
        {ruleSetsState.value.filter((r) => r.status === "active").length} active
      </HintBadge>
    );

  const reviewHint =
    reviewState.status === "loading" ? (
      <HintBadge>
        <Spinner />
      </HintBadge>
    ) : reviewState.status === "error" ? (
      <HintBadge>—</HintBadge>
    ) : reviewState.value > 0 ? (
      <HintBadge tone="alert">{reviewState.value} pending</HintBadge>
    ) : (
      <HintBadge tone="ok">Clear</HintBadge>
    );

  const cohesionHint =
    activeEvalState.status === "loading" ? (
      <HintBadge>
        <Spinner />
      </HintBadge>
    ) : activeEvalState.status === "error" ? (
      <HintBadge>—</HintBadge>
    ) : (
      <HintBadge>{activeEvalState.value.slug}</HintBadge>
    );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <main
      id="admin-hub-page"
      className="max-w-6xl mx-auto px-4 py-10"
    >
      {/* Header — establishes that this is the admin landing page */}
      <header id="admin-hub-header" className="mb-8">
        <p
          id="admin-hub-eyebrow"
          className="text-[11px] uppercase tracking-[0.18em] font-semibold text-muted-foreground"
        >
          Cornerstone · Admin
        </p>
        <h1
          id="admin-hub-title"
          className="text-3xl font-bold tracking-tight mt-1"
        >
          System overview
        </h1>
        <p
          id="admin-hub-subtitle"
          className="text-sm text-muted-foreground mt-2 max-w-2xl"
        >
          Health at a glance and quick navigation to every admin surface.
        </p>
      </header>

      {/* Row 1 — System health stat blocks */}
      <section
        id="admin-hub-health"
        aria-labelledby="admin-hub-health-label"
        className="mb-10"
      >
        <h2
          id="admin-hub-health-label"
          className="sr-only"
        >
          System health
        </h2>
        <div
          id="admin-hub-health-row"
          className="flex flex-col sm:flex-row gap-4"
        >
          <HealthStat
            id="admin-hub-health-rulesets"
            label="Rule Sets"
            state={ruleSetStat}
            accentRail="bg-sky-400"
          />
          <HealthStat
            id="admin-hub-health-eval-version"
            label="Active Evaluation Version"
            state={evalVersionStat}
            accentRail="bg-violet-400"
          />
          <HealthStat
            id="admin-hub-health-review"
            label="Review Queue"
            state={pendingReviewStat}
            tone={reviewTone}
            accentRail={
              reviewTone === "alert"
                ? "bg-amber-400"
                : reviewTone === "ok"
                  ? "bg-emerald-400"
                  : "bg-neutral-300"
            }
          />
        </div>
      </section>

      {/* Row 2 — Admin Surface navigation */}
      <section
        id="admin-hub-surfaces"
        aria-labelledby="admin-hub-surfaces-label"
      >
        <div className="flex items-baseline justify-between mb-4">
          <h2
            id="admin-hub-surfaces-label"
            className="text-sm font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Admin Surfaces
          </h2>
        </div>

        <div
          id="admin-hub-surfaces-grid"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          <AdminSurfaceCard
            id="admin-hub-card-rulesets"
            href="/admin/rulesets"
            title="Rule Sets"
            description="Manage Rule Sets, edit drafts, and publish new versions."
            glyph="R"
            hint={ruleSetsHint}
          />
          <AdminSurfaceCard
            id="admin-hub-card-cohesion-calibration"
            href="/admin/cohesion-calibration"
            title="Cohesion Calibration"
            description="Tune the active Evaluation Version: weights, formulas, composites."
            glyph="C"
            hint={cohesionHint}
          />
          <AdminSurfaceCard
            id="admin-hub-card-calibration"
            href="/admin/calibration"
            title="Skill Calibration"
            description="Edit stat-to-skill thresholds and anchor players."
            glyph="S"
          />
          <AdminSurfaceCard
            id="admin-hub-card-snapshots"
            href="/admin/snapshots"
            title="Snapshots"
            description="Stage pipeline runs, manage draft Snapshots, and publish releases."
            glyph="S"
          />
          <AdminSurfaceCard
            id="admin-hub-card-review"
            href="/admin/review"
            title="Review Queue"
            description="Resolve flagged disagreements between stats and Claude ratings."
            glyph="Q"
            hint={reviewHint}
          />
          <AdminSurfaceCard
            id="admin-hub-card-legends"
            href="/admin/legends"
            title="Legends"
            description="Curate all-time greats and their 21-skill profiles."
            glyph="L"
          />
        </div>
      </section>
    </main>
  );
}
