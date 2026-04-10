"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { getPlayerSkills, getPlayerStats, createAnchor, deleteAnchor } from "@/lib/api";
import { PlayerSearchCombobox } from "@/components/PlayerSearchCombobox";
import { PlayerStatDisplay } from "@/components/PlayerStatDisplay";
import { SkillProfileCard } from "@/components/SkillProfileCard";
import { SkillTierSelector } from "@/components/SkillTierSelector";
import type { Player, PlayerSkills, AnchorsBySkill, SkillTier } from "@/lib/types";

interface PlayerExplorerPanelProps {
  selectedPlayer: Player | null;
  playerSkills: PlayerSkills | null;
  previousPlayerSkills: PlayerSkills | null;
  selectedSkill: string;
  anchors: AnchorsBySkill;
  /** Stat keys (in "section.key" format) used by the selected skill's threshold rule */
  skillStatKeys?: Set<string>;
  onPlayerSelect: (player: Player) => void;
  onSkillClick: (skillName: string) => void;
  onSkillsLoaded: (skills: PlayerSkills) => void;
  onAnchorsChanged: () => void;
  onToast: (message: string, type: "success" | "error") => void;
}

/** Inline anchor form that appears when "Set as Anchor" is clicked */
function AnchorForm({
  player,
  skillName,
  onSubmit,
  onCancel,
}: {
  player: Player;
  skillName: string;
  onSubmit: (tier: SkillTier, notes: string) => void;
  onCancel: () => void;
}) {
  const [tier, setTier] = useState<SkillTier>("Capable");
  const [notes, setNotes] = useState("");

  return (
    <div className="mt-2 rounded-lg border border-border bg-muted/20 p-3 space-y-3">
      <p className="text-xs text-muted-foreground">
        Set <strong>{player.name}</strong> as an anchor for{" "}
        <strong>
          {skillName
            .split("_")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ")}
        </strong>
      </p>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Expected Tier</label>
        <SkillTierSelector value={tier} onChange={setTier} />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Why is this player a good anchor for this tier?"
          className={cn(
            "w-full resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-xs",
            "focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
          )}
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onSubmit(tier, notes)}
          className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Save Anchor
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Left panel — player search, stat display, skill profile, and anchor controls.
 * Occupies a fixed ~400px column in the calibration layout.
 */
export function PlayerExplorerPanel({
  selectedPlayer,
  playerSkills,
  previousPlayerSkills,
  selectedSkill,
  anchors,
  skillStatKeys,
  onPlayerSelect,
  onSkillClick,
  onSkillsLoaded,
  onAnchorsChanged,
  onToast,
}: PlayerExplorerPanelProps) {
  const [showStabilized, setShowStabilized] = useState(true);
  const [showAnchorForm, setShowAnchorForm] = useState(false);
  const [skillsLoading, setSkillsLoading] = useState(false);
  // Track in-flight refreshes per player ID so multiple players can refresh concurrently
  const [refreshingPlayers, setRefreshingPlayers] = useState<Set<string>>(new Set());
  // Incrementing key forces PlayerStatDisplay to remount and re-fetch after a stats refresh
  const [statsVersion, setStatsVersion] = useState(0);

  // Reset anchor form when skill or player changes
  useEffect(() => {
    setShowAnchorForm(false);
  }, [selectedPlayer?.id, selectedSkill]);

  // Check if the selected player is already an anchor for the selected skill
  const existingAnchor = anchors[selectedSkill]?.find(
    (a) => a.player_id === selectedPlayer?.id
  );

  const handlePlayerSelect = async (player: Player) => {
    onPlayerSelect(player);
    setSkillsLoading(true);
    try {
      const res = await getPlayerSkills(player.id);
      if (res.success && res.data) {
        onSkillsLoaded(res.data);
      } else {
        onToast(res.error ?? "Failed to load skills", "error");
      }
    } catch {
      onToast("Failed to load skills", "error");
    } finally {
      setSkillsLoading(false);
    }
  };

  const handleRefreshStats = async () => {
    if (!selectedPlayer) return;
    const { id: playerId, name: playerName } = selectedPlayer;

    // Add this player to the in-flight set — doesn't block other players
    setRefreshingPlayers((prev) => new Set(prev).add(playerId));
    try {
      // Force a fresh NBA API fetch, bypassing the 24-hour cache
      const res = await getPlayerStats(playerId, undefined, true);
      if (res.success) {
        // Re-fetch skills so the profile card updates with fresh data
        const skillsRes = await getPlayerSkills(playerId);
        if (skillsRes.success && skillsRes.data) onSkillsLoaded(skillsRes.data);
        // Bump version so PlayerStatDisplay remounts and re-fetches with the new cached data
        setStatsVersion((v) => v + 1);
        onToast(`${playerName} stats refreshed`, "success");
      } else {
        onToast(res.error ?? `Failed to refresh ${playerName}`, "error");
      }
    } catch {
      onToast(`Failed to refresh ${playerName}`, "error");
    } finally {
      // Remove only this player from the in-flight set
      setRefreshingPlayers((prev) => {
        const next = new Set(prev);
        next.delete(playerId);
        return next;
      });
    }
  };

  const handleSetAnchor = async (tier: SkillTier, notes: string) => {
    if (!selectedPlayer) return;
    try {
      const res = await createAnchor({
        player_id: selectedPlayer.id,
        skill_name: selectedSkill,
        expected_tier: tier,
        notes,
      });
      if (res.success) {
        onToast("Anchor saved", "success");
        setShowAnchorForm(false);
        onAnchorsChanged();
      } else {
        onToast(res.error ?? "Failed to save anchor", "error");
      }
    } catch {
      onToast("Failed to save anchor", "error");
    }
  };

  const handleRemoveAnchor = async () => {
    if (!existingAnchor) return;
    try {
      const res = await deleteAnchor(existingAnchor.id);
      if (res.success) {
        onToast("Anchor removed", "success");
        onAnchorsChanged();
      } else {
        onToast(res.error ?? "Failed to remove anchor", "error");
      }
    } catch {
      onToast("Failed to remove anchor", "error");
    }
  };

  return (
    <aside className="flex flex-col h-full overflow-hidden border-r border-border bg-background">
      {/* Panel header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold mb-2">Player Explorer</h2>
        <PlayerSearchCombobox
          onSelect={handlePlayerSelect}
          placeholder="Search players by name…"
        />
      </div>

      {/* Panel body — scrollable */}
      <div className="flex-1 overflow-y-auto">
        {!selectedPlayer ? (
          <div className="flex flex-col items-center justify-center h-40 text-sm text-muted-foreground px-4 text-center">
            Search for a player to see their stats and skill profile.
          </div>
        ) : (
          <>
            {/* Player header — sticky so the name is always visible when scrolling through stats */}
            <div className="sticky top-0 z-10 bg-background border-b border-border px-4 py-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold text-base text-foreground truncate">
                  {selectedPlayer.name}
                </h3>
                <button
                  type="button"
                  onClick={handleRefreshStats}
                  disabled={refreshingPlayers.has(selectedPlayer.id)}
                  title="Force re-fetch stats from NBA API (bypasses cache)"
                  className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors flex-shrink-0"
                >
                  {refreshingPlayers.has(selectedPlayer.id) ? "Refreshing…" : "↻ Refresh"}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {[selectedPlayer.team, selectedPlayer.position, selectedPlayer.season]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>

          <div className="px-4 py-3 space-y-4">
            {/* Stabilized / Raw toggle */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Stats view:</span>
              <button
                type="button"
                onClick={() => setShowStabilized((v) => !v)}
                className={cn(
                  "relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors",
                  showStabilized
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                )}
              >
                {showStabilized ? "Stabilized" : "Raw"}
              </button>
            </div>

            {/* Stats display */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Statistics
              </h4>
              <PlayerStatDisplay
                key={`${selectedPlayer.id}-${statsVersion}`}
                playerId={selectedPlayer.id}
                showStabilized={showStabilized}
                highlightedStats={skillStatKeys}
                skillStabilizedVals={
                  selectedSkill && playerSkills?.[selectedSkill]?.stabilized_vals
                    ? playerSkills[selectedSkill].stabilized_vals
                    : undefined
                }
              />
            </div>

            {/* Skill profile */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Skill Profile
              </h4>
              {skillsLoading ? (
                <div className="space-y-2 animate-pulse">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-16 bg-muted rounded-md" />
                  ))}
                </div>
              ) : (
                <SkillProfileCard
                  playerId={selectedPlayer.id}
                  onSkillClick={onSkillClick}
                  highlightSkill={selectedSkill}
                  externalSkills={playerSkills ?? undefined}
                  previousSkills={previousPlayerSkills ?? undefined}
                />
              )}
            </div>

            {/* Anchor controls */}
            {selectedSkill && (
              <div className="border-t border-border pt-3">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Anchor for{" "}
                  {selectedSkill
                    .split("_")
                    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                    .join(" ")}
                </h4>

                {showAnchorForm && selectedPlayer ? (
                  <AnchorForm
                    player={selectedPlayer}
                    skillName={selectedSkill}
                    onSubmit={handleSetAnchor}
                    onCancel={() => setShowAnchorForm(false)}
                  />
                ) : existingAnchor ? (
                  <div className="space-y-2">
                    <div className="rounded-md bg-muted/30 border border-border px-3 py-2 text-xs">
                      <span className="text-muted-foreground">
                        Currently set as{" "}
                        <strong>{existingAnchor.expected_tier}</strong> anchor
                      </span>
                      {existingAnchor.notes && (
                        <p className="mt-0.5 text-muted-foreground/70 italic">
                          {existingAnchor.notes}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setShowAnchorForm(true)}
                        className="text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground"
                      >
                        Update
                      </button>
                      <button
                        type="button"
                        onClick={handleRemoveAnchor}
                        className="text-xs px-2.5 py-1.5 rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        Remove Anchor
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowAnchorForm(true)}
                    className={cn(
                      "w-full text-xs px-3 py-2 rounded-md border border-dashed border-border",
                      "hover:bg-muted/40 hover:border-primary/50 transition-colors text-muted-foreground hover:text-foreground"
                    )}
                  >
                    + Set {selectedPlayer.name.split(" ").pop()} as Anchor
                  </button>
                )}
              </div>
            )}
          </div>
          </>
        )}
      </div>
    </aside>
  );
}
