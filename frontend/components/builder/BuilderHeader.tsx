/**
 * BuilderHeader — Top bar for the builder mode.
 *
 * Shows back-to-picker button, centered roster title with cornerstone name,
 * evaluate button, and mobile player-picker toggle.
 */

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { PlayerWithSkills } from "@/lib/types";

interface BuilderHeaderProps {
  cornerstone: PlayerWithSkills;
  allSlotsFilled: boolean;
  pickerOpen: boolean;
  onPickerToggle: () => void;
  onBackToPicker: () => void;
}

/** Navigates to the final evaluation page for the current roster. */
function EvaluateButton({ disabled, href }: { disabled?: boolean; href: string }) {
  const router = useRouter();
  return (
    <button
      id="builder-save-btn"
      type="button"
      onClick={() => router.push(href)}
      disabled={disabled}
      title={disabled ? "Fill all 8 slots to evaluate" : undefined}
      className="text-sm font-medium rounded-md border border-border px-3 py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-muted"
    >
      Evaluate Roster
    </button>
  );
}

export function BuilderHeader({
  cornerstone,
  allSlotsFilled,
  pickerOpen,
  onPickerToggle,
  onBackToPicker,
}: BuilderHeaderProps) {
  const searchParams = useSearchParams();

  return (
    <div id="builder-header" className="relative flex items-center mb-3 flex-shrink-0">
      <button
        id="builder-back-btn"
        type="button"
        onClick={onBackToPicker}
        className="text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
      >
        ← Change legend
      </button>
      <h1 id="builder-title" className="absolute left-1/2 -translate-x-1/2 text-lg font-bold text-foreground whitespace-nowrap pointer-events-none">
        <span className="text-amber-500 mr-1">★</span>
        {cornerstone.peak_year != null && (
          <span className="mr-1">{cornerstone.peak_year}</span>
        )}
        {cornerstone.name} Rotation
      </h1>
      {/* Right side: Evaluate button + mobile picker toggle */}
      <div className="ml-auto flex items-center gap-2 shrink-0">
        <EvaluateButton
          disabled={!allSlotsFilled}
          href={`/builder/evaluate?${searchParams.toString()}`}
        />
        <button
          id="builder-picker-toggle-btn"
          type="button"
          onClick={onPickerToggle}
          className="lg:hidden text-sm font-medium rounded-md border border-border px-3 py-1.5 hover:bg-muted transition-colors"
        >
          {pickerOpen ? "✕ Close" : "+ Players"}
        </button>
      </div>
    </div>
  );
}
