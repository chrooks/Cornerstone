"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getLegend, listLegends, updateLegendSkills, getLegendClaudeSuggestion } from "@/lib/api";
import type {
  LegendDetail,
  LegendSummary,
  LegendProfile,
  LegendTier,
  ClaudeSkillSuggestion,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { SKILL_TIERS, TIER_SELECTOR_STYLES } from "@/lib/tiers";

// Total skills in the legend profile — must match backend ALL_SKILLS
const TOTAL_SKILLS = 20;

// Skill categories matching backend ALL_SKILLS grouping
const SKILL_GROUPS: { label: string; skills: string[] }[] = [
  {
    label: "Additive Skills",
    skills: [
      "spot_up_shooter",
      "off_dribble_shooter",
      "isolation_scorer",
      "movement_shooter",
      "cutter",
      "transition_threat",
      "pnr_ball_handler",
      "pnr_finisher",
      "crafty_finisher",
      "passer",
      "offensive_rebounder",
      "vertical_spacer",
    ],
  },
  {
    label: "Threshold-Based Skills",
    skills: [
      "rebounder",
      "rim_protector",
      "screen_setter",
      "mid_post_player",
      "low_post_player",
    ],
  },
  {
    label: "Zero-Sum Skills",
    skills: [
      "switchable_defender",
      "point_of_attack_defender",
      "high_flyer",
    ],
  },
];

// SKILL_TIERS and TIER_SELECTOR_STYLES imported from @/lib/tiers

/** Format a snake_case skill key to Title Case display name. */
function formatSkillName(key: string): string {
  return key.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** Count how many skills have been deliberately rated (any non-null value). */
function countRated(profile: LegendProfile): number {
  return Object.values(profile).filter((v) => v !== null).length;
}

// ---------------------------------------------------------------------------
// Tier selector control (supports null / unset state distinct from "None")
// ---------------------------------------------------------------------------

interface TierSelectorProps {
  skillKey: string;
  value: LegendTier;
  onChange: (tier: LegendTier) => void;
  aiSuggested?: boolean;
  disabled?: boolean;
}

function TierSelector({ skillKey, value, onChange, aiSuggested, disabled }: TierSelectorProps) {
  return (
    <div
      className="inline-flex rounded-md border border-border overflow-hidden"
      role="radiogroup"
      aria-label={`Tier for ${formatSkillName(skillKey)}`}
    >
      {/* Unset button — shown as a dash, represents null */}
      <button
        type="button"
        role="radio"
        aria-checked={value === null}
        disabled={disabled}
        onClick={() => onChange(null)}
        title="Unset (not yet rated)"
        className={cn(
          "px-2 py-1.5 text-sm border-r transition-colors rounded-l-md",
          value === null
            ? "bg-muted text-muted-foreground font-semibold"
            : "border-muted-foreground/20 text-muted-foreground/40 hover:bg-muted/50",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        —
      </button>

      {/* Tier buttons */}
      {SKILL_TIERS.map((tier, i) => {
        const isActive = value === tier;
        const styles = TIER_SELECTOR_STYLES[tier];
        return (
          <button
            key={tier}
            type="button"
            role="radio"
            aria-checked={isActive}
            disabled={disabled}
            onClick={() => onChange(tier)}
            className={cn(
              "px-2.5 py-1.5 text-xs border-r last:border-r-0 transition-colors",
              isActive ? styles.active : styles.base,
              disabled && "opacity-50 cursor-not-allowed",
              i === SKILL_TIERS.length - 1 && "rounded-r-md"
            )}
          >
            {tier}
          </button>
        );
      })}

      {/* AI badge shown when this value came from Claude's suggestion */}
      {aiSuggested && (
        <span className="ml-1 self-center text-[10px] font-bold text-violet-600 bg-violet-50 border border-violet-200 rounded px-1">
          AI
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diff row shown when Claude has a suggestion for a skill
// ---------------------------------------------------------------------------

interface DiffRowProps {
  skillKey: string;
  currentTier: LegendTier;
  suggestion: ClaudeSkillSuggestion;
  onAccept: () => void;
}

function DiffRow({ skillKey, currentTier, suggestion, onAccept }: DiffRowProps) {
  const agrees = currentTier !== null && currentTier === suggestion.tier;
  const isUnrated = currentTier === null;

  if (agrees) {
    return (
      <p className="text-xs text-emerald-600 mt-1">
        Claude agrees: {suggestion.tier}
      </p>
    );
  }

  // Disagreement or unrated — show Claude's suggestion with justification + accept button
  return (
    <div className="mt-1.5 rounded bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="text-amber-700 font-medium">
          {isUnrated ? "Claude suggests:" : "Claude disagrees:"}{" "}
          <span className="font-semibold">{suggestion.tier}</span>
        </span>
        <button
          onClick={onAccept}
          className="flex-shrink-0 text-xs text-white bg-amber-500 hover:bg-amber-600 rounded px-2 py-0.5 transition-colors"
        >
          Accept
        </button>
      </div>
      <p className="text-amber-600/80 mt-0.5 italic">{suggestion.justification}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function LegendEditorPage() {
  const params = useParams();
  const legendId = params.legend_id as string;

  // Legend data + list for navigation
  const [legend, setLegend] = useState<LegendDetail | null>(null);
  const [allLegends, setAllLegends] = useState<LegendSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Local profile state (client-side, updated optimistically before saves)
  const [profile, setProfile] = useState<LegendProfile>({});
  // Track which skills came from Claude's suggestion (show AI badge)
  const [aiSkills, setAiSkills] = useState<Set<string>>(new Set());

  // Notes field
  const [notes, setNotes] = useState("");

  // Save state
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Accumulates dirty skill changes across debounce re-arms so rapid changes are never lost
  const pendingSaveRef = useRef<Partial<LegendProfile>>({});
  // Tracks the last successfully persisted notes value (for stale-comparison guard)
  const savedNotesRef = useRef<string>("");

  // Claude suggestion state
  const [claudeLoading, setClaudeLoading] = useState(false);
  const [claudeSuggestions, setClaudeSuggestions] = useState<
    Record<string, ClaudeSkillSuggestion> | null
  >(null);
  const [claudeError, setClaudeError] = useState<string | null>(null);

  // Collapsible sections — all open by default
  const [openSections, setOpenSections] = useState<Set<string>>(
    new Set(SKILL_GROUPS.map((g) => g.label))
  );

  // Accept All Disagreements confirmation dialog
  const [showAcceptAllDialog, setShowAcceptAllDialog] = useState(false);

  // Load legend data + all legends for navigation
  useEffect(() => {
    setLoading(true);
    Promise.all([getLegend(legendId), listLegends()]).then(([legendRes, listRes]) => {
      if (legendRes.success && legendRes.data) {
        setLegend(legendRes.data);
        setProfile(legendRes.data.profile);
        const initialNotes = legendRes.data.notes ?? "";
        setNotes(initialNotes);
        // Seed the saved-notes ref so the first blur guard works correctly
        savedNotesRef.current = initialNotes;
      } else {
        setError(legendRes.error ?? "Failed to load legend");
      }
      if (listRes.success && listRes.data) {
        setAllLegends(listRes.data);
      }
      setLoading(false);
    }).catch(() => {
      setError("Failed to load legend");
      setLoading(false);
    });
  }, [legendId]);

  // Clean up the debounce timer on unmount to avoid setState on an unmounted component
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // Navigation: previous / next legend (sorted alphabetically, same as default grid)
  const sortedIds = useMemo(() => allLegends.map((l) => l.id), [allLegends]);
  const currentIndex = sortedIds.indexOf(legendId);
  const prevLegend = currentIndex > 0 ? allLegends[currentIndex - 1] : null;
  const nextLegend = currentIndex < allLegends.length - 1 ? allLegends[currentIndex + 1] : null;

  // Debounced save — fires 500ms after the last skill change.
  // Merges incoming changes into a pending batch so rapid clicks never lose an intermediate value
  // (e.g., user taps skill then immediately clicks "Accept All").
  const debouncedSave = useCallback(
    (updatedProfile: Partial<LegendProfile>) => {
      // Merge new changes into the pending batch — last-write-wins per skill key
      pendingSaveRef.current = { ...pendingSaveRef.current, ...updatedProfile };

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        const payload = pendingSaveRef.current;
        pendingSaveRef.current = {};   // clear the batch before the await to avoid double-send
        const res = await updateLegendSkills(legendId, { profile: payload });
        if (res.success) {
          setSaveToast("Saved");
          setTimeout(() => setSaveToast(null), 1500);
        } else {
          // Surface save failures so the user knows to retry (auto-save guarantee broken)
          setSaveToast("Save failed — please retry");
          setTimeout(() => setSaveToast(null), 3000);
        }
      }, 500);
    },
    [legendId]
  );

  // Handle skill tier change from the selector
  const handleSkillChange = useCallback(
    (skillKey: string, tier: LegendTier) => {
      setProfile((prev) => {
        const updated = { ...prev, [skillKey]: tier };
        // Schedule debounced save for this single skill
        debouncedSave({ [skillKey]: tier });
        return updated;
      });
      // Clear AI badge if the user manually changes this skill
      setAiSkills((prev) => {
        const next = new Set(prev);
        next.delete(skillKey);
        return next;
      });
    },
    [debouncedSave]
  );

  // Accept a single Claude suggestion
  const acceptSuggestion = useCallback(
    (skillKey: string, tier: Exclude<LegendTier, null>) => {
      setProfile((prev) => {
        const updated = { ...prev, [skillKey]: tier };
        debouncedSave({ [skillKey]: tier });
        return updated;
      });
    },
    [debouncedSave]
  );

  // Auto-save notes on blur.
  // Compares against savedNotesRef (last persisted value) rather than legend.notes
  // (which only reflects the value at initial load) to avoid duplicate saves.
  const handleNotesBlur = useCallback(async () => {
    if (notes === savedNotesRef.current) return;
    const res = await updateLegendSkills(legendId, { notes });
    if (res.success) {
      savedNotesRef.current = notes;
      setSaveToast("Notes saved");
      setTimeout(() => setSaveToast(null), 1500);
    } else {
      setSaveToast("Notes save failed — please retry");
      setTimeout(() => setSaveToast(null), 3000);
    }
  }, [legendId, notes]);

  // Get Claude's suggestions
  const handleClaudeSuggestion = useCallback(async () => {
    setClaudeLoading(true);
    setClaudeError(null);
    setClaudeSuggestions(null);

    const res = await getLegendClaudeSuggestion(legendId);
    setClaudeLoading(false);

    if (!res.success || !res.data) {
      setClaudeError(res.error ?? "Claude suggestion failed. Please try again.");
      return;
    }

    const suggestions = res.data.skills;
    const rated = countRated(profile);

    if (rated === 0) {
      // Blank profile: pre-fill all skills with Claude's suggestions
      const newProfile: LegendProfile = { ...profile };
      const newAiSkills = new Set<string>();
      const batchUpdate: Partial<LegendProfile> = {};

      for (const skill of Object.keys(suggestions)) {
        const tier = suggestions[skill].tier as LegendTier;
        newProfile[skill] = tier;
        newAiSkills.add(skill);
        batchUpdate[skill] = tier;
      }

      setProfile(newProfile);
      setAiSkills(newAiSkills);
      setClaudeSuggestions(suggestions);
      debouncedSave(batchUpdate);
    } else {
      // Existing profile: enter diff mode
      setClaudeSuggestions(suggestions);
    }
  }, [legendId, profile, debouncedSave]);

  // Accept all disagreements (skills where Claude differs from current rating)
  const acceptAllDisagreements = useCallback(() => {
    if (!claudeSuggestions) return;
    const batchUpdate: Partial<LegendProfile> = {};
    const newProfile = { ...profile };

    for (const [skill, suggestion] of Object.entries(claudeSuggestions)) {
      const current = profile[skill];
      if (current === null || current !== suggestion.tier) {
        newProfile[skill] = suggestion.tier as LegendTier;
        batchUpdate[skill] = suggestion.tier as LegendTier;
      }
    }

    setProfile(newProfile);
    debouncedSave(batchUpdate);
    setClaudeSuggestions(null);
    setShowAcceptAllDialog(false);
    setSaveToast("All suggestions accepted");
    setTimeout(() => setSaveToast(null), 1500);
  }, [claudeSuggestions, profile, debouncedSave]);

  // Compute diff summary stats for the diff view header
  const diffSummary = useMemo(() => {
    if (!claudeSuggestions) return null;
    let agrees = 0, disagrees = 0, unrated = 0;
    for (const [skill, suggestion] of Object.entries(claudeSuggestions)) {
      const current = profile[skill];
      if (current === null) {
        unrated++;
      } else if (current === suggestion.tier) {
        agrees++;
      } else {
        disagrees++;
      }
    }
    return { agrees, disagrees, unrated };
  }, [claudeSuggestions, profile]);

  // Toggle section collapsed/expanded
  const toggleSection = (label: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  // Rated count for completion progress
  const ratedCount = countRated(profile);
  const completionPct = Math.round((ratedCount / TOTAL_SKILLS) * 100);

  if (loading) {
    return (
      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-64" />
          <div className="grid grid-cols-[35%_65%] gap-6 mt-6">
            <div className="h-96 bg-muted rounded-lg" />
            <div className="h-96 bg-muted rounded-lg" />
          </div>
        </div>
      </main>
    );
  }

  if (error || !legend) {
    return (
      <main className="max-w-6xl mx-auto px-4 py-8">
        <p className="text-destructive">{error ?? "Legend not found"}</p>
        <Link href="/legends" className="text-sm text-muted-foreground hover:underline mt-2 inline-block">
          ← Back to Legends
        </Link>
      </main>
    );
  }

  // Check if we're in "blank profile + pre-filled" mode (AI suggestions showing in selectors)
  const isPreFillMode = claudeSuggestions !== null && countRated(profile) > 0 && aiSkills.size > 0;
  // Diff mode = Claude suggestions are showing but user already had existing ratings
  const isDiffMode = claudeSuggestions !== null && !isPreFillMode;

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      {/* Navigation row */}
      <div className="flex items-center justify-between mb-6">
        <Link href="/legends" className="text-sm text-muted-foreground hover:underline">
          ← Back to Legends
        </Link>
        <div className="flex items-center gap-4">
          {prevLegend && (
            <Link
              href={`/legends/${prevLegend.id}`}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              ← {prevLegend.name}
            </Link>
          )}
          {nextLegend && (
            <Link
              href={`/legends/${nextLegend.id}`}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {nextLegend.name} →
            </Link>
          )}
        </div>
      </div>

      {/* Save toast */}
      {saveToast && (
        <div className="fixed top-4 right-4 z-50 bg-emerald-600 text-white text-xs font-medium px-3 py-2 rounded shadow-lg">
          {saveToast}
        </div>
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 md:grid-cols-[35%_65%] gap-6">

        {/* Left Column — Legend context */}
        <div className="space-y-4">
          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{legend.name}</h1>
            <p className="text-muted-foreground text-sm mt-0.5">{legend.peak_era}</p>
          </div>

          {/* Notes textarea */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={handleNotesBlur}
              placeholder="Add context about this player's peak abilities, era, playing style..."
              rows={6}
              className="w-full text-sm rounded-md border border-border bg-background px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
            />
          </div>

          {/* Get Claude's Take button */}
          <div>
            <button
              onClick={handleClaudeSuggestion}
              disabled={claudeLoading}
              className="w-full flex items-center justify-center gap-2 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {claudeLoading ? (
                <>
                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Asking Claude...
                </>
              ) : (
                "✦ Get Claude's Take"
              )}
            </button>
            {claudeError && (
              <p className="text-xs text-destructive mt-1">{claudeError}</p>
            )}
          </div>
        </div>

        {/* Right Column — Skill editor */}
        <div className="space-y-4">
          {/* Completion progress */}
          <div className="rounded-md border bg-card px-4 py-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-medium">{ratedCount} / {TOTAL_SKILLS} skills rated</span>
              <span className="text-xs text-muted-foreground">{completionPct}%</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  completionPct === 100 ? "bg-emerald-500" : "bg-amber-400"
                )}
                style={{ width: `${completionPct}%` }}
              />
            </div>
          </div>

          {/* Diff view header (shown when Claude suggestions exist with existing ratings) */}
          {isDiffMode && diffSummary && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-sm font-medium text-amber-800">
                Claude agrees on {diffSummary.agrees} skills, disagrees on {diffSummary.disagrees},
                {diffSummary.unrated > 0 && ` ${diffSummary.unrated} unrated`}
              </p>
              <div className="flex gap-2 mt-2">
                {diffSummary.disagrees + diffSummary.unrated > 0 && (
                  <button
                    onClick={() => setShowAcceptAllDialog(true)}
                    className="text-xs bg-amber-600 hover:bg-amber-700 text-white px-3 py-1 rounded transition-colors"
                  >
                    Accept All Disagreements
                  </button>
                )}
                <button
                  onClick={() => setClaudeSuggestions(null)}
                  className="text-xs border border-amber-400 text-amber-700 hover:bg-amber-100 px-3 py-1 rounded transition-colors"
                >
                  Dismiss Suggestions
                </button>
              </div>
            </div>
          )}

          {/* Pre-fill mode header */}
          {isPreFillMode && (
            <div className="rounded-md border border-violet-200 bg-violet-50 px-4 py-3">
              <p className="text-sm font-medium text-violet-800">
                Claude's suggestions pre-filled. Adjust as needed, then continue.
              </p>
              <button
                onClick={() => {
                  // Reset all AI-suggested skills back to null
                  const aiSkillList = Array.from(aiSkills);
                  const reset: LegendProfile = { ...profile };
                  aiSkillList.forEach((skill) => { reset[skill] = null; });
                  setProfile(reset);
                  setAiSkills(new Set());
                  setClaudeSuggestions(null);
                  debouncedSave(
                    Object.fromEntries(aiSkillList.map((s) => [s, null]))
                  );
                }}
                className="text-xs text-violet-600 hover:underline mt-1 inline-block"
              >
                Clear All Suggestions
              </button>
            </div>
          )}

          {/* Skill groups */}
          {SKILL_GROUPS.map(({ label, skills }) => (
            <div key={label} className="rounded-md border border-border overflow-hidden">
              {/* Section header (collapsible) */}
              <button
                type="button"
                onClick={() => toggleSection(label)}
                className="w-full flex items-center justify-between px-3 py-2 bg-muted/40 hover:bg-muted/60 transition-colors text-left"
              >
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {label} ({skills.length})
                </span>
                <span className="text-muted-foreground text-xs">
                  {openSections.has(label) ? "▲" : "▼"}
                </span>
              </button>

              {openSections.has(label) && (
                <div className="divide-y divide-border">
                  {skills.map((skillKey) => {
                    const tier = profile[skillKey] ?? null;
                    const isAi = aiSkills.has(skillKey);
                    const suggestion = claudeSuggestions?.[skillKey];

                    return (
                      <div key={skillKey} className="px-3 py-2.5">
                        {/* Skill name + selector */}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-medium text-foreground">
                            {formatSkillName(skillKey)}
                          </span>
                          <TierSelector
                            skillKey={skillKey}
                            value={tier}
                            onChange={(newTier) => handleSkillChange(skillKey, newTier)}
                            aiSuggested={isAi}
                          />
                        </div>

                        {/* Claude justification in pre-fill mode */}
                        {isPreFillMode && isAi && suggestion && (
                          <p className="text-xs text-muted-foreground italic mt-1.5">
                            {suggestion.justification}
                          </p>
                        )}

                        {/* Diff row in diff mode */}
                        {isDiffMode && suggestion && (
                          <DiffRow
                            skillKey={skillKey}
                            currentTier={tier}
                            suggestion={suggestion}
                            onAccept={() => acceptSuggestion(skillKey, suggestion.tier as Exclude<LegendTier, null>)}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Accept All Disagreements confirmation dialog */}
      {showAcceptAllDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-background rounded-lg border shadow-xl p-6 max-w-sm w-full mx-4">
            <h2 className="text-base font-semibold mb-2">Accept All Disagreements?</h2>
            <p className="text-sm text-muted-foreground mb-4">
              This will apply Claude's suggested tier to every skill where Claude disagrees with
              your current rating, as well as all unrated skills. This action can be reversed by
              manually changing individual skills.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowAcceptAllDialog(false)}
                className="text-sm px-3 py-1.5 rounded border border-border hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={acceptAllDisagreements}
                className="text-sm px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white transition-colors"
              >
                Accept All
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
