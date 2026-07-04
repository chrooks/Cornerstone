/**
 * releaseDiffFormat.ts — tiny pure helpers for the release diff Surface (#8).
 */

import type { ReleaseDiffContractChange } from "@/lib/types";

/** Human-communicatable id fragment from a player name. */
export function nameSlug(name: string | null): string {
  return (name ?? "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function formatSalary(value: number | null | undefined): string {
  return `$${(value ?? 0).toLocaleString()}`;
}

const CONTRACT_FIELD_LABELS: Record<ReleaseDiffContractChange["field"], string> = {
  name: "Name",
  team: "Team",
  position: "Position",
  salary: "Salary",
};

export function formatContractChange(change: ReleaseDiffContractChange): {
  label: string;
  oldValue: string;
  newValue: string;
} {
  const fmt = (v: string | number | null): string => {
    if (v === null || v === "") return "—";
    if (change.field === "salary" && typeof v === "number") return formatSalary(v);
    return String(v);
  };
  return {
    label: CONTRACT_FIELD_LABELS[change.field],
    oldValue: fmt(change.old),
    newValue: fmt(change.new),
  };
}
