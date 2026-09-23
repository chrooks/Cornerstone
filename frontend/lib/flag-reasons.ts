/**
 * Review flag reasons in plain words — one source for the queue and the
 * player review page.
 *
 * A contradiction reason carries its source and tier
 * ("human_decision_contradicted:resolved:Elite"), so one player can hold
 * several strings of one kind. Order = the order a reviewer should care: a
 * call of theirs under dispute comes first. `tone` "attention" marks the kinds
 * that need a person, one flag at a time.
 */
export const REASON_KINDS: Record<string, { label: string; tone: "attention" | "neutral" }> = {
  human_decision_contradicted: { label: "Contradicts your call",  tone: "attention" },
  two_tier_disagreement:       { label: "2-tier disagree",        tone: "attention" },
  one_tier_low_confidence:     { label: "1-tier, low confidence", tone: "neutral" },
  claude_low_confidence:       { label: "Claude low confidence",  tone: "neutral" },
  low_notability:              { label: "Low notability",         tone: "neutral" },
  data_missing:                { label: "Data missing",           tone: "neutral" },
  tier_bump_applied:           { label: "Tier bump",              tone: "neutral" },
  always_flag_for_review:      { label: "Always review",          tone: "neutral" },
};
const REASON_ORDER = Object.keys(REASON_KINDS);

export function reasonKind(reason: string): string {
  return reason.split(":")[0];
}

export function formatReasonKind(kind: string): string {
  return REASON_KINDS[kind]?.label ?? kind.replace(/_/g, " ");
}

/** A contradiction's detail, "…:resolved:Elite" → "resolved Elite". */
export function formatReasonDetail(reason: string): string {
  return reason.split(":").slice(1).join(" ").replace(/_/g, " ");
}

/** "Contradicts your call · resolved Elite" — the kind plus its detail. */
export function formatReason(reason: string): string {
  const detail = formatReasonDetail(reason);
  const label = formatReasonKind(reasonKind(reason));
  return detail ? `${label} · ${detail}` : label;
}

/** One entry per kind, in review order, with each kind's details. */
export function groupReasons(reasons: string[]): { kind: string; details: string[] }[] {
  const byKind = new Map<string, string[]>();
  for (const r of reasons) {
    const kind = reasonKind(r);
    const detail = formatReasonDetail(r);
    byKind.set(kind, detail ? [...(byKind.get(kind) ?? []), detail] : byKind.get(kind) ?? []);
  }
  const rank = (k: string) => {
    const i = REASON_ORDER.indexOf(k);
    return i === -1 ? REASON_ORDER.length : i;
  };
  return Array.from(byKind, ([kind, details]) => ({ kind, details }))
    .sort((a, b) => rank(a.kind) - rank(b.kind));
}
