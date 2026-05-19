/**
 * EvaluationVersionHeader — Status chip + version history dropdown + actions.
 *
 * Mounted at the top of the cohesion calibration page header. Shows
 * the currently active Evaluation Version slug and status, or switches
 * to draft mode when a draft exists. Inactive published versions show
 * a "Reactivate" button with confirmation.
 */

"use client";

import { useState, useRef, useEffect } from "react";
import type { EvaluationVersion } from "@/lib/types/evaluation-version";

interface EvaluationVersionHeaderProps {
  active: EvaluationVersion | null;
  draft: EvaluationVersion | null;
  versions: EvaluationVersion[];
  loading: boolean;
  onCreateDraft: () => void;
  onDiscardDraft: () => void;
  onReactivate: (versionId: string) => Promise<boolean>;
}

export function EvaluationVersionHeader({
  active,
  draft,
  versions,
  loading,
  onCreateDraft,
  onDiscardDraft,
  onReactivate,
}: EvaluationVersionHeaderProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [reactivating, setReactivating] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setHistoryOpen(false);
        setConfirmId(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (loading) {
    return (
      <div id="eval-version-header" className="flex items-center gap-2 text-xs text-muted-foreground">
        <div className="size-3 animate-spin rounded-full border border-muted-foreground border-t-primary" />
        Loading version…
      </div>
    );
  }

  const current = draft ?? active;
  const isDraft = draft !== null;

  const publishedVersions = versions.filter(
    (v) => v.status === "published",
  );

  async function handleConfirmReactivate(versionId: string) {
    setReactivating(true);
    const ok = await onReactivate(versionId);
    setReactivating(false);
    if (ok) {
      setConfirmId(null);
      setHistoryOpen(false);
    }
  }

  return (
    <div id="eval-version-header" className="flex items-center gap-3">
      {/* Status chip */}
      <div
        id="eval-version-chip"
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
          isDraft
            ? "bg-amber-500/10 text-amber-600 border border-amber-500/30"
            : "bg-emerald-500/10 text-emerald-600 border border-emerald-500/30"
        }`}
      >
        <span
          className={`size-1.5 rounded-full ${
            isDraft ? "bg-amber-500" : "bg-emerald-500"
          }`}
        />
        {current?.slug ?? "—"}
        <span className="opacity-60">·</span>
        {isDraft ? "draft" : "published"}
        {!isDraft && " · active"}
      </div>

      {/* Version history dropdown */}
      {publishedVersions.length > 1 && (
        <div className="relative" ref={dropdownRef}>
          <button
            id="eval-version-history-btn"
            type="button"
            onClick={() => {
              setHistoryOpen((prev) => !prev);
              setConfirmId(null);
            }}
            className="text-[10px] font-medium px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            History
          </button>

          {historyOpen && (
            <div
              id="eval-version-history-dropdown"
              className="absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border border-border bg-popover shadow-lg"
            >
              <div className="p-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
                Published Versions
              </div>
              <ul className="max-h-48 overflow-y-auto">
                {publishedVersions.map((v) => {
                  const isActive = v.id === active?.id;
                  const isConfirming = confirmId === v.id;

                  return (
                    <li
                      key={v.id}
                      id={`eval-version-item-${v.slug}`}
                      className="flex items-center justify-between px-3 py-2 text-xs border-b border-border/50 last:border-0"
                    >
                      <div className="flex items-center gap-1.5">
                        {isActive && (
                          <span className="size-1.5 rounded-full bg-emerald-500" />
                        )}
                        <span className={isActive ? "font-semibold" : ""}>
                          {v.slug}
                        </span>
                      </div>

                      {isActive ? (
                        <span className="text-[10px] text-emerald-600 font-medium">
                          active
                        </span>
                      ) : isConfirming ? (
                        <div className="flex items-center gap-1">
                          <button
                            id={`eval-version-confirm-reactivate-${v.slug}`}
                            type="button"
                            disabled={reactivating}
                            onClick={() => handleConfirmReactivate(v.id)}
                            className="text-[10px] font-medium px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 border border-amber-500/30 hover:bg-amber-500/20 transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {reactivating ? "…" : "Confirm"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmId(null)}
                            className="text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          id={`eval-version-reactivate-${v.slug}`}
                          type="button"
                          onClick={() => setConfirmId(v.id)}
                          className="text-[10px] font-medium px-2 py-0.5 rounded border border-border text-muted-foreground hover:bg-muted transition-colors cursor-pointer"
                        >
                          Reactivate
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      {isDraft ? (
        <button
          id="eval-version-discard-btn"
          type="button"
          onClick={onDiscardDraft}
          className="text-[10px] font-medium px-2.5 py-1 rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
        >
          Discard draft
        </button>
      ) : (
        <button
          id="eval-version-new-draft-btn"
          type="button"
          onClick={onCreateDraft}
          className="text-[10px] font-medium px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors cursor-pointer"
        >
          New Draft
        </button>
      )}
    </div>
  );
}
