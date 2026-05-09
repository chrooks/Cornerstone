"use client";

/**
 * Public player profile — read-only, no admin controls.
 * Skills are displayed as 7 horizontal category columns (grid-cols-7 on lg),
 * each sorted highest tier first. Every skill is always shown, even "None".
 *
 * Admin version with tier overrides and delete is at /admin/players/[player_id].
 */

import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getPlayerProfile, getPlayerStats } from "@/lib/api";
import { PlayerProfileView } from "@/components/players/PlayerView";
import type { PlayerProfile } from "@/lib/types";

const CURRENT_SEASON = "2025-26";

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function PublicPlayerProfilePage() {
  const { player_id } = useParams<{ player_id: string }>();
  const searchParams = useSearchParams();
  // When navigated from the builder (right-click → open profile), link back there
  const fromBuilder = searchParams.get("from") === "builder";

  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [boxStats, setBoxStats] = useState<Record<string, number | null> | null>(null);

  useEffect(() => {
    if (!player_id) return;
    setLoading(true);
    setError(null);
    // Fetch profile and box stats in parallel
    Promise.all([
      getPlayerProfile(player_id, CURRENT_SEASON),
      getPlayerStats(player_id, CURRENT_SEASON),
    ])
      .then(([profileRes, statsRes]) => {
        if (profileRes.success && profileRes.data) {
          setProfile(profileRes.data);
        } else {
          setError(profileRes.error ?? "Failed to load player profile");
        }
        if (statsRes.success && statsRes.data?.box_score) {
          setBoxStats(statsRes.data.box_score);
        }
      })
      .catch(() => setError("Failed to load player profile"))
      .finally(() => setLoading(false));
  }, [player_id]);

  if (loading) {
    return (
      <main className="max-w-screen-xl mx-auto px-4 py-8">
        <div className="space-y-4 animate-pulse">
          <div className="h-8 w-56 bg-muted rounded" />
          <div className="h-4 w-40 bg-muted rounded" />
          <div className="h-48 bg-muted rounded-lg" />
        </div>
      </main>
    );
  }

  if (error || !profile) {
    return (
      <main className="max-w-screen-xl mx-auto px-4 py-8">
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive">
          {error ?? "Player not found"}
        </div>
        <Link href="/players" className="mt-3 inline-block text-sm text-muted-foreground hover:text-foreground">
          ← Back to Players
        </Link>
      </main>
    );
  }

  return (
    <main id="public-player-profile-page" className="max-w-screen-xl mx-auto px-4 py-8">
      <PlayerProfileView profile={profile} boxStats={boxStats} fromBuilder={fromBuilder} />
    </main>
  );
}
