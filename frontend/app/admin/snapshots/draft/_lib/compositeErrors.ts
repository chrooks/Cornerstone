/**
 * compositeErrors — one recovery sentence per error code the compositing
 * endpoints return, shared by every caller of `runCompositeBatchScoped`.
 *
 * The API answers with a bare code. A code on its own names no cause and no
 * way forward, so each caller would otherwise invent its own wording — or,
 * as happened with M2.19's 409, show the raw token.
 */

const COMPOSITE_ERROR_LABELS: Record<string, string> = {
  /* M2.19 (#120): the whole-profile rebuild would overwrite tiers a person
     decided by hand, so it refuses the request rather than part of it. */
  human_decisions_present:
    "This selection holds Skill tiers you decided by hand, and compositing would " +
    "overwrite all of them. Use the Pipeline tab's Skill-scoped run instead — it " +
    "keeps your decisions and flags only the ones a fresh rating contradicts.",
};

/** The sentence to show for a compositing failure, or a sensible fallback. */
export function compositeErrorText(
  code: string | null | undefined,
  fallback = "Failed to run the compositing pipeline",
): string {
  if (!code) return fallback;
  return COMPOSITE_ERROR_LABELS[code] ?? code;
}
