"use client";

/**
 * NotesList.tsx — Three-column Strengths/Weaknesses/Suggestions display.
 *
 * Matches the Claude Design handoff: S/W/S rendered side-by-side with colored
 * sign indicators (+, −, ★), vertical dividers between columns. Stacks
 * vertically on narrow viewports.
 *
 * IMPORTANT: Note text is rendered as plain text content, never innerHTML.
 * Note.text may contain user-supplied player names (XSS risk if rendered as HTML).
 */

import { cn } from "@/lib/utils";
import type { Note } from "@/lib/types";
import { mapNoteToFilter, type SuggestionFilter } from "@/lib/noteFilters";

// ---------------------------------------------------------------------------
// Column configuration — sign, colors, empty state per category
// ---------------------------------------------------------------------------

interface ColumnConfig {
  sign: string;
  label: string;
  emailLabel: string;
  /** Text color for the sign and label */
  fg: string;
  /** Light background for the header chip */
  chipBg: string;
  /** Border color for the header chip */
  chipBd: string;
  emptyText: string;
}

const COLUMNS: Record<"strengths" | "issues" | "suggestions", ColumnConfig> = {
  strengths: {
    sign: "+",
    label: "Strengths",
    emailLabel: "Positive Returns",
    fg: "text-green-600 dark:text-green-400",
    chipBg: "bg-green-500/10",
    chipBd: "border-green-500/30",
    emptyText: "Add players to unlock synergies.",
  },
  issues: {
    sign: "−",
    label: "Weaknesses",
    emailLabel: "Pressure Points",
    fg: "text-red-600 dark:text-red-400",
    chipBg: "bg-red-500/10",
    chipBd: "border-red-500/30",
    emptyText: "No weaknesses identified.",
  },
  suggestions: {
    sign: "★",
    label: "Suggestions",
    emailLabel: "Action Items",
    fg: "text-amber-600 dark:text-amber-400",
    chipBg: "bg-amber-500/10",
    chipBd: "border-amber-500/30",
    emptyText: "No suggestions.",
  },
};

// ---------------------------------------------------------------------------
// SwsColumn — single column with header + note list
// ---------------------------------------------------------------------------

function SwsColumn({
  config,
  notes,
  variant = "default",
  onSuggestionFilter,
  showDebug = false,
}: {
  config: ColumnConfig;
  notes: Note[];
  variant?: "default" | "email";
  /** If provided, suggestion note text becomes a clickable link that injects a player-search filter. */
  onSuggestionFilter?: (filter: SuggestionFilter, note: Note) => void;
  /** Show engine debug info per note (admin only). */
  showDebug?: boolean;
}) {
  const isEmail = variant === "email";

  return (
    <div
      className={cn(
        "flex-1 min-w-0",
        isEmail && "rounded-2xl border border-border/70 bg-background/90 px-4 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)]",
      )}
    >
      {/* Column header — sign chip + label + count */}
      <div className={cn("flex items-center gap-1.5 mb-2.5", isEmail && "mb-3.5")}>
        <span
          className={cn(
            "w-[18px] h-[18px] rounded-full flex items-center justify-center text-[11px] font-bold border flex-shrink-0",
            config.chipBg,
            config.chipBd,
            config.fg,
            isEmail && "w-6 h-6 text-xs",
          )}
        >
          {config.sign}
        </span>
        <div className="min-w-0">
          {isEmail && (
            <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground/80">
              Internal Section
            </p>
          )}
          <div className="flex items-center gap-1.5">
            <span className={cn("text-[13px] font-semibold tracking-tight", config.fg, isEmail && "font-serif text-[15px] tracking-[0.01em]")}>
              {isEmail ? config.emailLabel : config.label}
            </span>
            <span className="text-[11px] text-muted-foreground ml-0.5">
              ({notes.length})
            </span>
          </div>
        </div>
      </div>

      {/* Note items */}
      {notes.length === 0 ? (
        <p className={cn("text-[11px] text-muted-foreground/60 italic", isEmail && "rounded-xl border border-dashed border-border/70 bg-muted/20 px-3 py-3")}>
          {config.emptyText}
        </p>
      ) : (
        <ul className={cn("flex flex-col gap-2", isEmail && "gap-2.5")}>
          {notes.map((note, i) => {
            // Only suggestion notes with a mappable filter become clickable
            const filter = onSuggestionFilter ? mapNoteToFilter(note) : null;
            return (
              <li
                key={`${note.trace_key}-${i}`}
                id={`note-sws-${note.trace_key}-${i}`}
                className={cn(
                  "flex gap-1.5 text-[12px] leading-snug",
                  isEmail && "rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5",
                )}
              >
                <span className={cn("font-bold flex-shrink-0 mt-px", config.fg, isEmail && "mt-0.5")} aria-hidden>
                  {config.sign}
                </span>
                {/* Render as text — never innerHTML — note.text may contain player names */}
                <div className="min-w-0">
                  {filter && onSuggestionFilter ? (
                    <button
                      type="button"
                      id={`note-suggestion-link-${note.trace_key}-${i}`}
                      onClick={() => onSuggestionFilter(filter, note)}
                      className={cn(
                        "text-left underline decoration-dashed underline-offset-[3px] decoration-amber-500/50 hover:decoration-amber-500 transition-colors cursor-pointer",
                        "text-muted-foreground hover:text-amber-600 dark:hover:text-amber-400",
                        isEmail && "leading-6",
                      )}
                      title="Filter player search by this need"
                    >
                      {note.text}
                    </button>
                  ) : (
                    <span className={cn("text-muted-foreground", isEmail && "leading-6")}>{note.text}</span>
                  )}
                  {showDebug && note.engine_category != null && (
                    <p
                      id={`note-debug-${note.trace_key}-${i}`}
                      className="mt-0.5 font-mono text-[9px] text-muted-foreground/50"
                    >
                      {note.engine_category} · sev {note.engine_severity?.toFixed(2)} · raw {note.engine_raw_value?.toFixed(2)}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NotesList — three-column layout
// ---------------------------------------------------------------------------

interface NotesListProps {
  issues: Note[];
  suggestions: Note[];
  strengths: Note[];
  variant?: "default" | "email";
  /** Called when a suggestion note is clicked — parent injects the filter into the player picker. */
  onSuggestionFilter?: (filter: SuggestionFilter, note: Note) => void;
  /** Show engine debug info per note (admin only). */
  showDebug?: boolean;
}

export function NotesList({
  issues,
  suggestions,
  strengths,
  variant = "default",
  onSuggestionFilter,
  showDebug = false,
}: NotesListProps) {
  const isEmail = variant === "email";

  return (
    <div id="notes-list">
      {/* Three-column S/W/S layout — stacks on narrow viewports */}
      <div className={cn("flex flex-col sm:flex-row gap-4 sm:gap-5 items-stretch", isEmail && "gap-3 sm:gap-3")}>
        <SwsColumn config={COLUMNS.strengths} notes={strengths} variant={variant} showDebug={showDebug} />

        {/* Vertical divider (hidden when stacked) */}
        <div className={cn("hidden sm:block w-px bg-border/60 flex-shrink-0", isEmail && "bg-border/40")} />

        <SwsColumn config={COLUMNS.issues} notes={issues} variant={variant} showDebug={showDebug} />

        {/* Vertical divider */}
        <div className={cn("hidden sm:block w-px bg-border/60 flex-shrink-0", isEmail && "bg-border/40")} />

        {/* Only the suggestions column exposes clickable filter links. */}
        <SwsColumn
          config={COLUMNS.suggestions}
          notes={suggestions}
          variant={variant}
          onSuggestionFilter={onSuggestionFilter}
          showDebug={showDebug}
        />
      </div>
    </div>
  );
}
