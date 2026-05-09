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
    fg: "text-green-600 dark:text-green-400",
    chipBg: "bg-green-500/10",
    chipBd: "border-green-500/30",
    emptyText: "Add players to unlock synergies.",
  },
  issues: {
    sign: "−",
    label: "Weaknesses",
    fg: "text-red-600 dark:text-red-400",
    chipBg: "bg-red-500/10",
    chipBd: "border-red-500/30",
    emptyText: "No weaknesses identified.",
  },
  suggestions: {
    sign: "★",
    label: "Suggestions",
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
  onSuggestionFilter,
  showDebug = false,
}: {
  config: ColumnConfig;
  notes: Note[];
  /** If provided, suggestion note text becomes a clickable link that injects a player-search filter. */
  onSuggestionFilter?: (filter: SuggestionFilter, note: Note) => void;
  /** Show engine debug info per note (admin only). */
  showDebug?: boolean;
}) {
  return (
    <div
      className="min-w-0 border border-[#d9d0c9]/70 bg-[#f7f7f7] px-3 py-3"
    >
      {/* Column header — sign chip + label + count */}
      <div className="mb-2.5 flex items-center gap-1.5">
        <span
          className={cn(
            "w-[18px] h-[18px] rounded-sm flex items-center justify-center text-[11px] font-bold border flex-shrink-0",
            config.chipBg,
            config.chipBd,
            config.fg,
          )}
        >
          {config.sign}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={cn("text-[13px] font-semibold tracking-tight", config.fg)}>
              {config.label}
            </span>
            <span className="text-[11px] text-muted-foreground ml-0.5">
              ({notes.length})
            </span>
          </div>
        </div>
      </div>

      {/* Note items */}
      {notes.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/60 italic">
          {config.emptyText}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notes.map((note, i) => {
            // Only suggestion notes with a mappable filter become clickable
            const filter = onSuggestionFilter ? mapNoteToFilter(note) : null;
            return (
              <li
                key={`${note.trace_key}-${i}`}
                id={`note-sws-${note.trace_key}-${i}`}
                className="flex gap-1.5 text-[12px] leading-snug"
              >
                <span className={cn("font-bold flex-shrink-0 mt-px", config.fg)} aria-hidden>
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
                      )}
                      title="Filter player search by this need"
                    >
                      {note.text}
                    </button>
                  ) : (
                    <span className="text-muted-foreground">{note.text}</span>
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
  /** Called when a suggestion note is clicked — parent injects the filter into the player picker. */
  onSuggestionFilter?: (filter: SuggestionFilter, note: Note) => void;
  /** Show engine debug info per note (admin only). */
  showDebug?: boolean;
}

export function NotesList({
  issues,
  suggestions,
  strengths,
  onSuggestionFilter,
  showDebug = false,
}: NotesListProps) {
  return (
    <div id="notes-list">
      {/* Three-column S/W/S layout — stacks on narrow viewports */}
      <div className="grid gap-3 xl:grid-cols-3">
        <SwsColumn config={COLUMNS.strengths} notes={strengths} showDebug={showDebug} />

        <SwsColumn config={COLUMNS.issues} notes={issues} showDebug={showDebug} />

        {/* Only the suggestions column exposes clickable filter links. */}
        <SwsColumn
          config={COLUMNS.suggestions}
          notes={suggestions}
          onSuggestionFilter={onSuggestionFilter}
          showDebug={showDebug}
        />
      </div>
    </div>
  );
}
