"use client";

import { useEffect } from "react";
import { PlayerProfileView } from "./PlayerProfileView";
import type { PlayerProfile } from "@/lib/types";

interface PlayerProfileModalProps {
  profile: PlayerProfile | null;
  boxStats?: Record<string, number | null> | null;
  loading?: boolean;
  error?: string | null;
  onDismiss: () => void;
}

export function PlayerProfileModal({
  profile,
  boxStats,
  loading = false,
  error = null,
  onDismiss,
}: PlayerProfileModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);

  return (
    <div
      id="player-profile-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Player profile"
      className="fixed inset-0 z-[9990] bg-[#0e0907]/25 backdrop-blur-sm p-4 md:p-6"
      onMouseDown={onDismiss}
    >
      <div
        id="player-profile-modal-shell"
        className="mx-auto flex h-full max-w-6xl items-center"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div
          id="player-profile-modal-content"
          className="max-h-[calc(100vh-2rem)] md:max-h-[calc(100vh-3rem)] w-full overflow-y-auto rounded-md border border-[#d9d0c9] bg-[#f7f7f7] px-4 py-6 md:px-6 md:py-8"
        >
          {loading && !profile && (
            <div id="player-profile-modal-loading" className="space-y-4 animate-pulse">
              <div className="h-8 w-56 bg-[#0e0907]/[0.04] rounded-sm" />
              <div className="h-4 w-40 bg-[#0e0907]/[0.04] rounded-sm" />
              <div className="h-48 bg-[#0e0907]/[0.04] rounded-md" />
            </div>
          )}

          {error && (
            <div id="player-profile-modal-error" className="rounded-md bg-[#e53e3e]/10 border border-[#e53e3e]/20 p-4 text-sm text-[#e53e3e]">
              {error}
              <button
                id="player-profile-modal-error-dismiss"
                type="button"
                onClick={onDismiss}
                className="ml-3 text-[#0e0907]/60 hover:text-[#0e0907]"
              >
                Close
              </button>
            </div>
          )}

          {profile && (
            <div id="player-profile-modal-body" className={loading ? "opacity-95" : undefined}>
              <PlayerProfileView
                profile={profile}
                boxStats={boxStats}
                isModal
                onDismiss={onDismiss}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
