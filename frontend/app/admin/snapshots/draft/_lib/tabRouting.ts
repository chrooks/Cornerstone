/**
 * Tab routing Seam for the draft workspace.
 *
 * All tab-state logic (gate rules, URL resolution) lives here so it can be
 * unit-tested independently of React components.
 */

export type TabSlug =
  | "overview"
  | "pipeline"
  | "thresholds"
  | "review"
  | "diff"
  | "publish";

export const DEFAULT_TAB: TabSlug = "overview";

export const ALL_TABS: readonly TabSlug[] = [
  "overview",
  "pipeline",
  "thresholds",
  "review",
  "diff",
  "publish",
] as const;

export const TAB_LABELS: Record<TabSlug, string> = {
  overview: "Overview",
  pipeline: "Pipeline",
  thresholds: "Thresholds",
  review: "Review",
  diff: "Diff",
  publish: "Publish",
};

export interface TabGateContext {
  hasDraft: boolean;
  draftStatus: "draft" | "review" | "published" | "archived" | null;
}

/**
 * Returns false if the tab is accessible, or `{ reason }` when gated.
 * Overview is never gated — it shows the Empty State Affordance instead.
 */
export function isTabDisabled(
  slug: TabSlug,
  ctx: TabGateContext
): false | { reason: string } {
  if (slug === "overview") return false;
  if (!ctx.hasDraft) return { reason: "Open a draft to use this tab." };
  // Plan invariant: thresholds + review freeze when the draft moves to review.
  if (
    (slug === "thresholds" || slug === "review") &&
    ctx.draftStatus === "review"
  ) {
    return { reason: "Snapshot is in review. Move back to draft to edit." };
  }
  if (slug === "publish" && ctx.draftStatus !== "review") {
    return { reason: "Move the draft to review to publish." };
  }
  return false;
}

/**
 * Resolves the active tab from the URL `?tab=` search param.
 * Falls back to DEFAULT_TAB when the requested tab is unknown or gated.
 */
export function resolveActiveTab(
  searchParam: string | null,
  ctx: TabGateContext
): TabSlug {
  const requested = (searchParam ?? DEFAULT_TAB) as TabSlug;
  if (!ALL_TABS.includes(requested)) return DEFAULT_TAB;
  if (isTabDisabled(requested, ctx)) return DEFAULT_TAB;
  return requested;
}
