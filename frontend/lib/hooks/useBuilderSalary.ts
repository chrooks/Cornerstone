/**
 * useBuilderSalary — Salary computation and cap-related state for the roster builder.
 *
 * Derives total salary usage, computes highlight ranges for the salary gauge,
 * and manages the picker hover preview state.
 */

import { useMemo, useState } from "react";
import { DEFAULT_SALARY_CAP, DEFAULT_LEGEND_SALARY } from "@/lib/builder-config";
import type { PlayerWithSkills } from "@/lib/types";

export interface UseBuilderSalaryReturn {
  /** Total salary consumed by the current lineup. */
  usedSalary: number;
  /** Remaining cap space (null when no cap). */
  remainingSalary: number | null;
  /** Active salary cap (null when uncapped, e.g. Free For All). */
  salaryCap: number | null;
  /** Active legend salary (from RuleSet or default). */
  legendSalary: number;
  /** Highlight range (as fractions of cap) for the hovered slot in the salary gauge. */
  highlightRange: { startFrac: number; endFrac: number } | null;
  /** Salary cap filter trigger value (set when user clicks remaining in gauge). */
  salaryCapFilter: number | null;
  setSalaryCapFilter: (max: number | null) => void;
  /** Salary of the player currently hovered in the picker (for gauge preview). */
  pickerHoveredSalary: number | null;
  setPickerHoveredSalary: (salary: number | null) => void;
}

export interface UseBuilderSalaryOptions {
  /** Salary cap from rules_json (falls back to DEFAULT_salaryCap). */
  salaryCap?: number;
  /** Cornerstone legend salary from rules_json (falls back to DEFAULT_legendSalary). */
  legendSalary?: number;
}

/**
 * Computes salary-related derived state for the builder.
 *
 * @param allSlots - Current 8-slot lineup
 * @param cornerstoneId - UUID of the cornerstone legend
 * @param hoveredSlotIndex - 1-based index of the currently hovered slot (or null)
 * @param options - Optional overrides from the active RuleSet's rules_json
 */
export function useBuilderSalary(
  allSlots: (PlayerWithSkills | null)[],
  cornerstoneId: string | null,
  hoveredSlotIndex: number | null,
  options?: UseBuilderSalaryOptions,
): UseBuilderSalaryReturn {
  const salaryCap = options?.salaryCap ?? null;
  const legendSalary = options?.legendSalary ?? DEFAULT_LEGEND_SALARY;
  // ── Salary cap filter for player picker ──────────────────────────────────
  const [salaryCapFilter, setSalaryCapFilter] = useState<number | null>(null);

  // ── Picker hover salary (for gauge preview) ──────────────────────────────
  const [pickerHoveredSalary, setPickerHoveredSalary] = useState<number | null>(null);

  // ── Derived total salary ─────────────────────────────────────────────────
  const usedSalary = useMemo(() => {
    return allSlots.reduce((sum, p) => {
      if (!p) return sum;
      // Cornerstone legend has a fixed cap cost regardless of market salary
      if (p.id === cornerstoneId) return sum + legendSalary;
      return sum + (p.salary ?? 0);
    }, 0);
  }, [allSlots, cornerstoneId, legendSalary]);

  const remainingSalary = salaryCap !== null ? salaryCap - usedSalary : null;

  // ── Highlight range for hovered slot ─────────────────────────────────────
  const highlightRange = useMemo((): { startFrac: number; endFrac: number } | null => {
    if (hoveredSlotIndex === null || salaryCap === null) return null;

    const orderedSalaries = allSlots.map((p) => {
      if (!p) return 0;
      if (p.id === cornerstoneId) return legendSalary;
      return p.salary ?? 0;
    });

    const idx = hoveredSlotIndex - 1;
    const slotSalary = orderedSalaries[idx] ?? 0;
    if (slotSalary === 0) return null;

    const startDollars = orderedSalaries.slice(0, idx).reduce((a, b) => a + b, 0);
    const endDollars = startDollars + slotSalary;

    return { startFrac: startDollars / salaryCap, endFrac: endDollars / salaryCap };
  }, [hoveredSlotIndex, allSlots, cornerstoneId, legendSalary, salaryCap]);

  return {
    usedSalary,
    remainingSalary,
    salaryCap,
    legendSalary,
    highlightRange,
    salaryCapFilter,
    setSalaryCapFilter,
    pickerHoveredSalary,
    setPickerHoveredSalary,
  };
}
