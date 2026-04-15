"use client";

/**
 * AssistantGmNotes.tsx — Static stub for the Assistant GM Notes panel.
 *
 * Shows 3 placeholder bullet points. Real eval logic is out of scope for this phase.
 */

const STUB_NOTES = [
  "Add a spot-up shooter around your cornerstone to maximize off-ball spacing opportunities and open driving lanes.",
  "Consider pairing a rim protector with your cornerstone — a strong interior defender anchors your team's defense.",
  "You may want to fill your remaining slots with versatile, switchable defenders to give your team defensive flexibility.",
];

export function AssistantGmNotes() {
  return (
    <div id="builder-gm-notes" className="flex flex-col gap-3">
      <h3 id="builder-gm-notes-title" className="text-sm font-semibold text-foreground">
        Assistant GM Notes
      </h3>
      <ul id="builder-gm-notes-list" className="space-y-3">
        {STUB_NOTES.map((note, i) => (
          <li
            key={i}
            id={`builder-gm-note-${i + 1}`}
            className="flex gap-2 text-xs text-muted-foreground leading-relaxed"
          >
            <span className="text-foreground/40 mt-0.5 flex-shrink-0">•</span>
            <span>{note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
