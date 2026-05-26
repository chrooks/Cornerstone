"use client";

/**
 * StateChip — status pill for draft/review/published.
 *
 * Tokens:
 *  running/draft: Heat Check tint 10%-alpha bg, #fe6d34 text
 *  success/published: Deep Amber #a34400 on Warm Offwhite
 *  error: Destructive #e53e3e 10%-alpha bg
 *  review: amber-100 bg, amber-700 text
 */

type ChipVariant = "draft" | "review" | "published" | "running" | "success" | "error" | "archived";

interface StateChipProps {
  id: string;
  variant: ChipVariant;
  label?: string;
}

const VARIANT_STYLES: Record<ChipVariant, { bg: string; text: string }> = {
  draft:     { bg: "rgba(254, 109, 52, 0.10)", text: "#fe6d34" },
  running:   { bg: "rgba(254, 109, 52, 0.10)", text: "#fe6d34" },
  review:    { bg: "#fef3c7", text: "#92400e" },
  published: { bg: "#fef3c7", text: "#a34400" },
  success:   { bg: "#fef3c7", text: "#a34400" },
  error:     { bg: "rgba(229, 62, 62, 0.10)", text: "#e53e3e" },
  archived:  { bg: "#f3f4f6", text: "#6b7280" },
};

const LABELS: Record<ChipVariant, string> = {
  draft:     "Draft",
  review:    "In Review",
  published: "Published",
  running:   "Running",
  success:   "Success",
  error:     "Error",
  archived:  "Archived",
};

export function StateChip({ id, variant, label }: StateChipProps) {
  const styles = VARIANT_STYLES[variant];
  return (
    <span
      id={id}
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide"
      style={{ backgroundColor: styles.bg, color: styles.text }}
    >
      {label ?? LABELS[variant]}
    </span>
  );
}
