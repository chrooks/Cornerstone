import { cn } from "@/lib/utils";
import { REASON_KINDS, formatReasonKind } from "@/lib/flag-reasons";

/**
 * A flag reason as a small chip. The kinds that need a person, one flag at a
 * time, carry the attention tone. Used by the review queue and the swipe deck.
 */
export function ReasonChip({
  kind,
  label,
  details = [],
  id,
}: {
  kind: string;
  /** Text to show; defaults to the kind's label. */
  label?: string;
  /** The tiers under dispute, one hover away rather than in the row itself. */
  details?: string[];
  id?: string;
}) {
  const text = label ?? formatReasonKind(kind);
  return (
    <span
      id={id}
      title={details.length > 0 ? `${text}: ${details.join(", ")}` : text}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-sm border px-1.5 py-px text-[11px] font-medium leading-4",
        REASON_KINDS[kind]?.tone === "attention"
          ? "border-primary/60 bg-primary/15 text-foreground"
          : "border-border bg-transparent text-muted-foreground"
      )}
    >
      {text}
    </span>
  );
}
