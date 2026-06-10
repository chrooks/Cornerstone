"use client";

/**
 * NoActiveReleaseError — shared Lab Error State for the 503 no_active_release
 * response (#62).
 *
 * Shown when no Snapshot Release is active (the admin is between snapshots).
 * Calm, non-alarming tone: this is a scheduled-maintenance moment, not a
 * failure the user caused. One primary action: retry the load.
 *
 * Pages own the retry mechanics (re-running their load effects); this
 * component is purely presentational plus the retry Affordance.
 */

type NoActiveReleaseErrorProps = {
  /** Re-run the page's data load. */
  onRetry: () => void;
  /** True while a retry is in flight — disables the button and swaps its label. */
  retrying?: boolean;
};

export function NoActiveReleaseError({ onRetry, retrying = false }: NoActiveReleaseErrorProps) {
  return (
    <section
      id="lab-no-active-release-error"
      aria-live="polite"
      className="mx-auto max-w-screen-md px-6 py-10"
    >
      <div className="rounded-md border border-[#d9d0c9] bg-[#f7f7f7] p-6">
        <p
          id="lab-no-active-release-kicker"
          className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-[#a34400]"
        >
          Between snapshots
        </p>
        <h2
          id="lab-no-active-release-title"
          className="mt-2 font-display text-[1.5rem] font-semibold leading-[1.15] tracking-[-0.01em] text-[#0e0907]"
        >
          No active release
        </h2>
        <p
          id="lab-no-active-release-message"
          className="mt-2 max-w-prose text-[0.9375rem] leading-relaxed text-[#0e0907]/60"
        >
          The admin is preparing the next snapshot. The Lab reopens the moment
          it&apos;s published — your builds and saved teams are untouched.
        </p>
        <button
          id="lab-error-retry-button"
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="mt-5 inline-flex items-center rounded-md bg-[#ffa05c] px-5 py-2 text-[0.8125rem] font-medium text-[#0e0907] transition-colors hover:bg-[#fe6d34] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ffa05c] disabled:cursor-default disabled:opacity-60 disabled:hover:bg-[#ffa05c]"
        >
          {retrying ? "Checking…" : "Check again"}
        </button>
      </div>
    </section>
  );
}
