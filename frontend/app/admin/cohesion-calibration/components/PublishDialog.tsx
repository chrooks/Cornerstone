/**
 * PublishDialog — Modal for publishing a draft Evaluation Version.
 *
 * Contains a slug input (regex-validated, pre-filled), changelog note textarea,
 * publish gate output, and confirm button.
 */

"use client";

import { useState, useCallback, useEffect } from "react";
import type { PublishGateResult } from "@/lib/types/evaluation-version";

const SLUG_REGEX = /^cohesion-[a-z0-9-]+$/;

interface PublishDialogProps {
  open: boolean;
  suggestedSlug: string;
  onValidate: (changelogNote: string) => Promise<PublishGateResult | null>;
  onPublish: (slug: string, changelogNote: string) => Promise<boolean>;
  onClose: () => void;
}

export function PublishDialog({
  open,
  suggestedSlug,
  onValidate,
  onPublish,
  onClose,
}: PublishDialogProps) {
  const [slug, setSlug] = useState(suggestedSlug);
  const [changelogNote, setChangelogNote] = useState("");
  const [gateResult, setGateResult] = useState<PublishGateResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setSlug(suggestedSlug);
      setChangelogNote("");
      setGateResult(null);
    }
  }, [open, suggestedSlug]);

  const handleValidate = useCallback(async () => {
    setValidating(true);
    const result = await onValidate(changelogNote);
    setGateResult(result);
    setValidating(false);
  }, [changelogNote, onValidate]);

  const handlePublish = useCallback(async () => {
    setPublishing(true);
    const ok = await onPublish(slug, changelogNote);
    setPublishing(false);
    if (ok) onClose();
  }, [slug, changelogNote, onPublish, onClose]);

  const slugValid = SLUG_REGEX.test(slug);
  const canPublish =
    slugValid &&
    changelogNote.trim().length > 0 &&
    gateResult?.ok === true &&
    !publishing;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        id="eval-version-publish-dialog"
        className="bg-background rounded-lg border border-border shadow-xl w-[480px] max-h-[80vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">
            Publish Evaluation Version
          </h2>
          <button
            id="eval-version-publish-close-btn"
            type="button"
            onClick={onClose}
            className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Slug input */}
          <div>
            <label htmlFor="eval-version-slug-input" className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Version Slug
            </label>
            <input
              id="eval-version-slug-input"
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="cohesion-v2-..."
              className={`mt-1 w-full px-3 py-2 text-xs rounded-md border bg-background ${
                slug && !slugValid
                  ? "border-destructive text-destructive"
                  : "border-border text-foreground"
              }`}
            />
            {slug && !slugValid && (
              <p className="mt-1 text-[10px] text-destructive">
                Must match ^cohesion-[a-z0-9-]+$
              </p>
            )}
          </div>

          {/* Changelog note */}
          <div>
            <label htmlFor="eval-version-changelog-input" className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Changelog Note
            </label>
            <textarea
              id="eval-version-changelog-input"
              value={changelogNote}
              onChange={(e) => setChangelogNote(e.target.value)}
              placeholder="Describe what changed and why…"
              rows={3}
              className="mt-1 w-full px-3 py-2 text-xs rounded-md border border-border bg-background text-foreground resize-none"
            />
          </div>

          {/* Validate button */}
          <button
            id="eval-version-validate-btn"
            type="button"
            onClick={handleValidate}
            disabled={validating || changelogNote.trim().length === 0}
            className="w-full text-xs font-medium py-2 rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {validating ? "Validating…" : "Run Publish Gate"}
          </button>

          {/* Gate result */}
          {gateResult && (
            <div
              id="eval-version-gate-result"
              className={`px-3 py-2 rounded-md text-xs ${
                gateResult.ok
                  ? "bg-emerald-500/10 text-emerald-700 border border-emerald-500/30"
                  : "bg-red-500/10 text-red-700 border border-red-500/30"
              }`}
            >
              {gateResult.ok ? (
                <p className="font-medium">All checks passed</p>
              ) : (
                <div>
                  <p className="font-medium mb-1">
                    {gateResult.violations.length} violation
                    {gateResult.violations.length === 1 ? "" : "s"}
                  </p>
                  <ul className="space-y-0.5">
                    {gateResult.violations.map((v, i) => (
                      <li key={i} className="text-[10px]">
                        [{v.layer}] {v.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-medium px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            id="eval-version-confirm-publish-btn"
            type="button"
            onClick={handlePublish}
            disabled={!canPublish}
            className="text-xs font-medium px-3 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {publishing ? "Publishing…" : "Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}
