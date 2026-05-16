/**
 * DiffDrawer — Slide-in drawer listing field-level diffs between draft and published.
 *
 * Each row shows the field path, published value, draft value, and a Revert button.
 */

"use client";

import type { DiffEntry } from "../hooks/useEvaluationVersion";
import type { JsonPatchOp } from "@/lib/types/evaluation-version";

interface DiffDrawerProps {
  open: boolean;
  entries: DiffEntry[];
  onRevert: (ops: JsonPatchOp[]) => void;
  onClose: () => void;
}

function formatValue(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function DiffDrawer({
  open,
  entries,
  onRevert,
  onClose,
}: DiffDrawerProps) {
  if (!open) return null;

  const grouped = entries.reduce<Record<string, DiffEntry[]>>((acc, entry) => {
    const group = acc[entry.section] ?? [];
    group.push(entry);
    acc[entry.section] = group;
    return acc;
  }, {});

  return (
    <div
      id="eval-version-diff-drawer"
      className="fixed inset-y-0 right-0 w-[480px] bg-background border-l border-border shadow-lg z-50 flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">
          Draft Diff ({entries.length} change{entries.length === 1 ? "" : "s"})
        </h2>
        <button
          id="eval-version-diff-close-btn"
          type="button"
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
        >
          ✕ Close
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {entries.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">
            No changes between draft and published.
          </p>
        )}

        {Object.entries(grouped).map(([section, sectionEntries]) => (
          <div key={section}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              {section}
            </p>
            <div className="space-y-1">
              {sectionEntries.map((entry) => (
                <div
                  key={entry.path}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/50 text-[10px]"
                >
                  <span className="flex-1 font-mono text-foreground truncate" title={entry.path}>
                    {entry.path}
                  </span>
                  <span className="text-red-500 line-through shrink-0 max-w-[80px] truncate" title={formatValue(entry.publishedValue)}>
                    {formatValue(entry.publishedValue)}
                  </span>
                  <span className="text-muted-foreground shrink-0">→</span>
                  <span className="text-emerald-600 shrink-0 max-w-[80px] truncate" title={formatValue(entry.draftValue)}>
                    {formatValue(entry.draftValue)}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onRevert([
                        {
                          op: "replace",
                          path: `/${entry.path.replace(/\./g, "/")}`,
                          value: entry.publishedValue,
                        },
                      ])
                    }
                    className="shrink-0 text-[9px] text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    Revert
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
