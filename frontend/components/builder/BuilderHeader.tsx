"use client";

/**
 * BuilderHeader — Top bar for the Build page in the Lab flow.
 *
 * Single header area with two rows:
 *   Row 1: Breadcrumb
 *   Row 2: ★ Title (left), SalaryCap gauge (center-right), Evaluate CTA (right)
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import type { PlayerWithSkills } from "@/lib/types";

interface BuilderHeaderProps {
  cornerstone: PlayerWithSkills | null;
  /** RuleSet slug from the route */
  ruleset: string;
  /** Team label from rules_json (e.g. "Lineup", "Rotation", "Roster") */
  teamLabel?: string;
  allSlotsFilled: boolean;
}

/* ── Breadcrumb ── */
function Breadcrumb({ ruleset, teamLabel, hasCornerstone, teamSize }: { ruleset: string; teamLabel: string; hasCornerstone: boolean; teamSize: string | null }) {
  const rulesetName = ruleset
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  const legendsHref = `/lab/${ruleset}/legends${teamSize ? `?team_size=${teamSize}` : ""}`;

  return (
    <nav id="builder-breadcrumb" aria-label="Lab navigation" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem]">
      <Link href="/lab" className="text-[#0e0907]/45 hover:text-[#0e0907]/70 transition-colors">Lab</Link>
      <span className="text-[#0e0907]/25" aria-hidden="true">/</span>
      <Link href="/lab" className="text-[#0e0907]/45 hover:text-[#0e0907]/70 transition-colors">{rulesetName}</Link>
      {hasCornerstone && (
        <>
          <span className="text-[#0e0907]/25" aria-hidden="true">/</span>
          <Link href={legendsHref} className="text-[#0e0907]/45 hover:text-[#0e0907]/70 transition-colors">
            Pick Your Cornerstone
          </Link>
        </>
      )}
      <span className="text-[#0e0907]/25" aria-hidden="true">/</span>
      <span className="text-[#0e0907] font-medium" aria-current="page">Build Your {teamLabel}</span>
    </nav>
  );
}

export function BuilderHeader({
  cornerstone,
  ruleset,
  teamLabel = "Rotation",
  allSlotsFilled,
}: BuilderHeaderProps) {
  const searchParams = useSearchParams();
  const teamSize = searchParams.get("team_size");

  return (
    <div id="builder-header" className="mb-3 flex flex-shrink-0 flex-col gap-1.5">
      {/* Row 1: Breadcrumb */}
      <Breadcrumb ruleset={ruleset} teamLabel={teamLabel} hasCornerstone={cornerstone !== null} teamSize={teamSize} />

      {/* Row 2: Title + salary gauge + Evaluate CTA */}
      <div id="builder-header-main-row" className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center sm:gap-4">
        {/* Title */}
        <h1
          id="builder-title"
          className="min-w-0 shrink font-display text-[clamp(1.125rem,1.5vw+0.25rem,1.5rem)] font-semibold leading-[1.15] tracking-[-0.01em] text-[#0e0907]"
        >
          <span className="text-[#ffa05c] mr-1">★</span>
          {cornerstone ? (
            <>
              {cornerstone.peak_year != null && (
                <span className="mr-1">{cornerstone.peak_year}</span>
              )}
              {cornerstone.name} {teamLabel}
            </>
          ) : (
            <>Build Your {teamLabel}</>
          )}
        </h1>

        {/* Evaluate CTA */}
        <div id="builder-header-actions" className="flex shrink-0 items-center gap-4">
          <Link
            id="builder-evaluate-btn"
            href={allSlotsFilled ? `/lab/${ruleset}/eval?${searchParams.toString()}` : "#"}
            aria-disabled={!allSlotsFilled}
            onClick={(e) => { if (!allSlotsFilled) e.preventDefault(); }}
            className={cn(
              "inline-flex items-center px-5 py-2 rounded-md text-[0.8125rem] font-medium tracking-[0.01em] transition-all duration-150",
              !allSlotsFilled
                ? "bg-[#d9d0c9]/50 text-[#0e0907]/30 cursor-not-allowed"
                : "bg-[#ffa05c] text-[#0e0907] hover:bg-[#fe6d34] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ffa05c]",
            )}
          >
            Evaluate {teamLabel} →
          </Link>
        </div>
      </div>
    </div>
  );
}
