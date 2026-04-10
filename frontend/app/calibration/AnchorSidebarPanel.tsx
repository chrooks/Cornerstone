"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { deleteAnchor, createAnchor } from "@/lib/api";
import { SkillTierBadge } from "@/components/SkillTierBadge";
import { SkillTierSelector } from "@/components/SkillTierSelector";
import type { Anchor, AnchorsBySkill, SkillTestResult, Player, SkillTier } from "@/lib/types";
import { SKILL_TIERS } from "@/lib/tiers";

interface AnchorSidebarPanelProps {
  selectedSkill: string;
  anchors: AnchorsBySkill;
  testResult: SkillTestResult | null;
  selectedPlayer: Player | null;
  onAnchorClick: (anchor: Anchor) => void;
  onAnchorRemoved: () => void;
  onToast: (message: string, type: "success" | "error") => void;
}

// SKILL_TIERS imported from @/lib/tiers

/** Pass/fail status dot shown next to each anchor after running Test Against Anchors */
function PassFailBadge({ passed }: { passed: boolean | null }) {
  if (passed === null) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center size-4 rounded-full text-xs font-bold",
        passed ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
      )}
      title={passed ? "Passed" : "Failed"}
    >
      {passed ? "✓" : "✗"}
    </span>
  );
}

/**
 * Right panel — shows all anchors for the selected skill, grouped by expected tier.
 * Clicking an anchor name loads that player in the left panel.
 * Shows pass/fail status from the last test run.
 */
export function AnchorSidebarPanel({
  selectedSkill,
  anchors,
  testResult,
  selectedPlayer,
  onAnchorClick,
  onAnchorRemoved,
  onToast,
}: AnchorSidebarPanelProps) {
  // Inline anchor form state — lives in the sidebar so it's always visible
  const [showAnchorForm, setShowAnchorForm] = useState(false);
  const [anchorTier, setAnchorTier] = useState<SkillTier>("Capable");
  const [anchorNotes, setAnchorNotes] = useState("");
  const [savingAnchor, setSavingAnchor] = useState(false);

  const skillAnchors = anchors[selectedSkill] ?? [];

  // Build a map of player_id → pass/fail from the last test run
  const testMap: Record<string, boolean> = {};
  if (testResult) {
    for (const r of testResult.results) {
      testMap[r.player_id] = r.passed;
    }
  }

  // Group anchors by expected tier — built from SKILL_TIERS so new tiers are included automatically
  const grouped = Object.fromEntries(
    SKILL_TIERS.map((tier) => [tier, skillAnchors.filter((a) => a.expected_tier === tier)])
  ) as Record<SkillTier, Anchor[]>;

  // Compute summary stats for the anchor summary header
  const totalAnchors = skillAnchors.length;
  const testedCount = Object.keys(testMap).length;
  const passingCount = testedCount > 0 ? Object.values(testMap).filter(Boolean).length : 0;
  const passRate = testedCount > 0 ? Math.round((passingCount / testedCount) * 100) : null;

  const handleSaveAnchor = async () => {
    if (!selectedPlayer) return;
    setSavingAnchor(true);
    try {
      const res = await createAnchor({
        player_id: selectedPlayer.id,
        skill_name: selectedSkill,
        expected_tier: anchorTier,
        notes: anchorNotes,
      });
      if (res.success) {
        onToast("Anchor saved", "success");
        setShowAnchorForm(false);
        setAnchorNotes("");
        setAnchorTier("Capable");
        onAnchorRemoved(); // triggers a full anchors reload in the parent
      } else {
        onToast(res.error ?? "Failed to save anchor", "error");
      }
    } catch {
      onToast("Failed to save anchor", "error");
    } finally {
      setSavingAnchor(false);
    }
  };

  const handleRemove = async (anchor: Anchor) => {
    try {
      const res = await deleteAnchor(anchor.id);
      if (res.success) {
        onToast("Anchor removed", "success");
        onAnchorRemoved();
      } else {
        onToast(res.error ?? "Failed to remove anchor", "error");
      }
    } catch {
      onToast("Failed to remove anchor", "error");
    }
  };

  return (
    <aside className="flex flex-col h-full overflow-hidden">
      {/* Anchor summary header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold mb-2">Anchors</h2>
        {totalAnchors === 0 ? (
          <p className="text-xs text-muted-foreground">No anchors set for this skill.</p>
        ) : passRate !== null ? (
          <div
            className={cn(
              "text-sm font-medium rounded-md px-2 py-1 border",
              passRate === 100
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : passRate > 75
                  ? "bg-amber-50 text-amber-700 border-amber-200"
                  : "bg-red-50 text-red-700 border-red-200"
            )}
          >
            {passingCount}/{testedCount} passing ({passRate}%)
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            {totalAnchors} anchor{totalAnchors !== 1 ? "s" : ""} — run Test to see results
          </div>
        )}
      </div>

      {/* Add from current player — inline form in the sidebar */}
      {selectedPlayer && (() => {
        // Check if this player is already an anchor for the selected skill so we
        // show the existing tier instead of silently allowing an overwrite
        const existingAnchor = skillAnchors.find((a) => a.player_id === selectedPlayer.id);
        return (
          <div className="flex-shrink-0 px-4 py-2 border-b border-border">
            {showAnchorForm ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {existingAnchor ? "Update" : "Add"} <strong>{selectedPlayer.name}</strong> as anchor for{" "}
                  <strong>
                    {selectedSkill
                      .split("_")
                      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                      .join(" ")}
                  </strong>
                </p>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Expected Tier</label>
                  <SkillTierSelector value={anchorTier} onChange={setAnchorTier} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Notes (optional)</label>
                  <textarea
                    value={anchorNotes}
                    onChange={(e) => setAnchorNotes(e.target.value)}
                    rows={2}
                    placeholder="Why is this a good anchor?"
                    className={cn(
                      "w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-xs",
                      "focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
                    )}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleSaveAnchor}
                    disabled={savingAnchor}
                    className="text-xs px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {savingAnchor ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowAnchorForm(false); setAnchorNotes(""); }}
                    className="text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : existingAnchor ? (
              /* Show existing anchor status instead of a misleading "Add" button */
              <div className="space-y-1.5">
                <div className="rounded-md bg-muted/30 border border-border px-2 py-1.5 text-xs">
                  <span className="text-muted-foreground">
                    {selectedPlayer.name} is a <strong>{existingAnchor.expected_tier}</strong> anchor
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    // Pre-fill with the current tier so update is non-destructive by default
                    setAnchorTier(existingAnchor.expected_tier);
                    setAnchorNotes(existingAnchor.notes ?? "");
                    setShowAnchorForm(true);
                  }}
                  className="w-full text-xs text-left px-2 py-1 rounded-md border border-dashed border-border hover:bg-muted/40 transition-colors text-muted-foreground hover:text-foreground"
                >
                  Update anchor
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setAnchorTier("Capable"); setShowAnchorForm(true); }}
                className="w-full text-xs text-left px-2 py-1.5 rounded-md border border-dashed border-border hover:bg-muted/40 transition-colors text-muted-foreground hover:text-foreground"
              >
                + Add {selectedPlayer.name} as anchor
              </button>
            )}
          </div>
        );
      })()}

      {/* Anchor list grouped by tier */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
        {SKILL_TIERS.map((tier) => {
          const tierAnchors = grouped[tier];
          if (!tierAnchors || tierAnchors.length === 0) return null;

          return (
            <div key={tier}>
              <div className="flex items-center gap-2 mb-1.5">
                <SkillTierBadge tier={tier} size="sm" />
                <span className="text-xs text-muted-foreground">
                  {tierAnchors.length} anchor{tierAnchors.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="space-y-1">
                {tierAnchors.map((anchor) => {
                  const testStatus = testMap[anchor.player_id];
                  return (
                    <div
                      key={anchor.id}
                      className={cn(
                        "flex items-center gap-2 px-2 py-1.5 rounded-md border text-xs",
                        testStatus === false
                          ? "bg-red-50 border-red-200"
                          : testStatus === true
                            ? "bg-emerald-50 border-emerald-200"
                            : "bg-background border-border"
                      )}
                    >
                      {/* Player name — loads player in left panel and scrolls to their
                          result card in the anchors tested section if a test has been run */}
                      <button
                        type="button"
                        className="flex-1 text-left font-medium hover:underline truncate"
                        onClick={() => {
                          onAnchorClick(anchor);
                          const card = document.getElementById(`anchor-result-${anchor.player_id}`);
                          card?.scrollIntoView({ behavior: "smooth", block: "center" });
                        }}
                        title={anchor.player_name}
                      >
                        {anchor.player_name}
                      </button>

                      {/* Pass/fail indicator from last test */}
                      {anchor.player_id in testMap && (
                        <PassFailBadge passed={testMap[anchor.player_id]} />
                      )}

                      {/* Remove button */}
                      <button
                        type="button"
                        onClick={() => handleRemove(anchor)}
                        className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                        title="Remove anchor"
                        aria-label="Remove anchor"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {totalAnchors === 0 && (
          <p className="text-xs text-muted-foreground text-center py-6">
            No anchors yet. Search for a player and use &ldquo;Set as Anchor&rdquo; to add one.
          </p>
        )}
      </div>
    </aside>
  );
}
