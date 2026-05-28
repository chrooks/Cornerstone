"use client";

/**
 * TabStrip — segmented underline nav for the draft workspace.
 *
 * Visual commitment (architect-locked):
 *  - Horizontal nav, left-aligned, full-width row, beneath header.
 *  - Active: 2px bottom border #fe6d34, font-semibold, text-[#0e0907].
 *  - Inactive: text-neutral-500, border-b-transparent, hover text-[#0e0907].
 *  - Disabled: text-neutral-300, cursor-not-allowed, native `title` tooltip.
 *  - Container: border-b border-[#d9d0c9].
 *  - 14px font, 16px vertical padding, 20px gap.
 *  - Tab change: instant (no transition).
 */

import { cn } from "@/lib/utils";
import {
  ALL_TABS,
  TAB_LABELS,
  isTabDisabled,
  type TabSlug,
  type TabGateContext,
} from "../_lib/tabRouting";

export interface TabStripProps {
  id: string;
  activeTab: TabSlug;
  gateContext: TabGateContext;
  onTabChange: (slug: TabSlug) => void;
}

export function TabStrip({
  id,
  activeTab,
  gateContext,
  onTabChange,
}: TabStripProps) {
  return (
    <nav
      id={id}
      aria-label="Draft workspace tabs"
      className="border-b border-[#d9d0c9] flex gap-5 mb-4"
    >
      {ALL_TABS.map((slug) => {
        const disabled = isTabDisabled(slug, gateContext);
        const isActive = activeTab === slug;

        return (
          <button
            key={slug}
            id={`${id}-tab-${slug}`}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-disabled={disabled !== false}
            disabled={disabled !== false}
            title={disabled ? (disabled as { reason: string }).reason : undefined}
            onClick={() => {
              if (!disabled) onTabChange(slug);
            }}
            className={cn(
              "text-[14px] py-2.5 border-b-2 -mb-px whitespace-nowrap transition-none",
              isActive
                ? "border-[#fe6d34] font-semibold text-[#0e0907]"
                : "border-transparent font-normal",
              !isActive && !disabled && "text-neutral-500 hover:text-[#0e0907]",
              disabled && "text-neutral-300 cursor-not-allowed"
            )}
          >
            {TAB_LABELS[slug]}
          </button>
        );
      })}
    </nav>
  );
}
