"use client";

/**
 * NotesList.tsx — Collapsible issues/suggestions/strengths section display.
 *
 * Three collapsible sections:
 *   - Issues (critical + warning) — open by default
 *   - Suggestions — collapsed by default
 *   - Strengths — collapsed by default
 *
 * IMPORTANT: Note text is rendered as plain text content, never innerHTML.
 * Note.text may contain user-supplied player names (XSS risk if rendered as HTML).
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Note } from "@/lib/types";

// ---------------------------------------------------------------------------
// Badge color helpers
// ---------------------------------------------------------------------------

function badgeClass(severity: Note["severity"]): string {
  switch (severity) {
    case "critical": return "bg-red-500/20 text-red-400 border border-red-500/30";
    case "warning":  return "bg-amber-500/20 text-amber-400 border border-amber-500/30";
    case "suggestion": return "bg-blue-500/20 text-blue-400 border border-blue-500/30";
    case "strength": return "bg-green-500/20 text-green-400 border border-green-500/30";
  }
}

// ---------------------------------------------------------------------------
// Note item
// ---------------------------------------------------------------------------

function NoteItem({ note, index }: { note: Note; index: number }) {
  return (
    <li
      id={`note-item-${note.trace_key}-${index}`}
      className="flex gap-2 items-start p-3 rounded-lg bg-muted/40"
    >
      <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide flex-shrink-0 mt-0.5", badgeClass(note.severity))}>
        {note.severity}
      </span>
      {/* Render as text — never innerHTML — note.text may contain user-supplied player names */}
      <p className="text-xs text-muted-foreground leading-relaxed">{note.text}</p>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Collapsible section
// ---------------------------------------------------------------------------

interface SectionProps {
  id: string;
  title: string;
  count: number;
  notes: Note[];
  defaultOpen?: boolean;
  titleColorClass?: string;
  emptyText?: string;
}

function CollapsibleSection({
  id,
  title,
  count,
  notes,
  defaultOpen = false,
  titleColorClass = "text-foreground",
  emptyText,
}: SectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section id={id} className="border border-border rounded-lg overflow-hidden">
      {/* Header — always visible */}
      <button
        id={`${id}-toggle`}
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-muted/30 transition-colors cursor-pointer"
        aria-expanded={isOpen}
      >
        <span className={cn("text-sm font-semibold", titleColorClass)}>
          {title}
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            ({count})
          </span>
        </span>
        <span className="text-muted-foreground text-xs font-mono" aria-hidden>
          {isOpen ? "▾" : "▸"}
        </span>
      </button>

      {/* Content — only rendered when open */}
      {isOpen && (
        <div id={`${id}-content`} className="px-4 pb-3 pt-1">
          {notes.length === 0 ? (
            <p className="text-xs text-muted-foreground">{emptyText ?? "None."}</p>
          ) : (
            <ul className="space-y-2">
              {notes.map((note, i) => (
                <NoteItem key={`${note.trace_key}-${i}`} note={note} index={i} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// NotesList
// ---------------------------------------------------------------------------

interface NotesListProps {
  issues: Note[];
  suggestions: Note[];
  strengths: Note[];
}

export function NotesList({ issues, suggestions, strengths }: NotesListProps) {
  return (
    <div id="notes-list" className="space-y-2">
      <CollapsibleSection
        id="notes-issues"
        title="Issues"
        count={issues.length}
        notes={issues}
        defaultOpen={true}
        titleColorClass="text-amber-400"
        emptyText="No critical issues found."
      />
      <CollapsibleSection
        id="notes-suggestions"
        title="Suggestions"
        count={suggestions.length}
        notes={suggestions}
        defaultOpen={false}
        titleColorClass="text-blue-400"
        emptyText="No suggestions."
      />
      <CollapsibleSection
        id="notes-strengths"
        title="Strengths"
        count={strengths.length}
        notes={strengths}
        defaultOpen={false}
        titleColorClass="text-green-400"
        emptyText="No standout strengths identified."
      />
    </div>
  );
}
