"use client";

/**
 * SkillPickerBar — dense, collapsible skill selector shared by the Threshold
 * Editor and Stat Leaders views.
 *
 * Replaces the old three-stacked-group block (which ate 4-6 rows of vertical
 * space). Skills flow inline across the full width with small confidence
 * dividers, bounded by a max height. Collapsing reduces it to a single row
 * showing just the active skill. Collapse state persists in localStorage so it
 * stays consistent across the editor/stat-leaders toggle and across sessions.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { SKILL_CATEGORIES, formatSkillName } from "@/lib/skills";

const COLLAPSE_KEY = "calibration-skill-picker-collapsed";

// Short confidence labels for the inline dividers (full labels are verbose).
const GROUP_SHORT: Record<string, string> = {
  "High Confidence": "HIGH",
  Moderate: "MOD",
  "Low Confidence": "LOW",
};

export interface SkillBadge {
  label: string;
  tone: "pass" | "fail" | "neutral";
}

export interface SkillPickerBarProps {
  selectedSkill: string;
  onSelect: (skill: string) => void;
  hasRule: (skill: string) => boolean;
  /** Optional per-skill badge (anchor counts / pass-fail) — editor view only. */
  getBadge?: (skill: string) => SkillBadge | null;
  /** Optional control rendered on the right of the header (e.g. Raw/Stabilized). */
  rightSlot?: React.ReactNode;
}

export function SkillPickerBar({
  selectedSkill,
  onSelect,
  hasRule,
  getBadge,
  rightSlot,
}: SkillPickerBarProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Hydrate collapse state from localStorage after mount (avoids SSR mismatch).
  useEffect(() => {
    if (typeof window === "undefined") return;
    setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* private mode — non-fatal */
      }
      return next;
    });
  };

  const groups = Object.entries(SKILL_CATEGORIES);

  return (
    <div className="flex-shrink-0 border-b border-border bg-background">
      {/* Header row: collapse toggle + label (+ active skill when collapsed) + right slot */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button
          id="calibration-skill-picker-toggle"
          type="button"
          onClick={toggle}
          title={collapsed ? "Show all skills" : "Collapse skill picker"}
          className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <span className="leading-none">{collapsed ? "▸" : "▾"}</span>
          Skill
        </button>

        {collapsed && (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-primary text-primary-foreground whitespace-nowrap">
            {formatSkillName(selectedSkill)}
          </span>
        )}

        <div className="flex-1 min-w-0" />
        {rightSlot}
      </div>

      {/* Expanded: dense inline chip flow, bounded height */}
      {!collapsed && (
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1 px-3 pb-2 max-h-[148px] overflow-y-auto">
          {groups.map(([category, skills], gi) => (
            <span key={category} className="contents">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 pr-0.5">
                {GROUP_SHORT[category] ?? category}
              </span>
              {skills.map((skill) => {
                const enabled = hasRule(skill);
                const isSelected = skill === selectedSkill;
                const badge = getBadge?.(skill) ?? null;
                return (
                  <button
                    key={skill}
                    type="button"
                    disabled={!enabled}
                    title={!enabled ? "No threshold rule configured yet" : undefined}
                    onClick={() => enabled && onSelect(skill)}
                    className={cn(
                      "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs whitespace-nowrap transition-colors",
                      isSelected
                        ? "bg-primary text-primary-foreground"
                        : enabled
                          ? "hover:bg-muted text-muted-foreground hover:text-foreground"
                          : "text-muted-foreground/40 cursor-not-allowed",
                      enabled && !isSelected && badge?.tone === "fail" && "text-red-600",
                      enabled && !isSelected && badge?.tone === "pass" && "text-emerald-600",
                    )}
                  >
                    {formatSkillName(skill)}
                    {badge?.label && (
                      <span
                        className={cn(
                          "text-[9px] px-1 rounded-full",
                          isSelected
                            ? "bg-primary-foreground/20 text-primary-foreground"
                            : badge.tone === "fail"
                              ? "bg-red-100 text-red-700"
                              : badge.tone === "pass"
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-muted-foreground/20",
                        )}
                      >
                        {badge.label}
                      </span>
                    )}
                  </button>
                );
              })}
              {gi < groups.length - 1 && (
                <span className="w-px h-3 bg-border mx-1 self-center" aria-hidden />
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
