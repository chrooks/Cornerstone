"use client";

import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PlayerProfileView } from "./PlayerProfileView";
import type { PlayerProfile } from "@/lib/types";

interface PlayerProfileModalProps {
  profile: PlayerProfile | null;
  boxStats?: Record<string, number | null> | null;
  loading?: boolean;
  error?: string | null;
  fitContent?: ReactNode;
  onDismiss: () => void;
}

export function PlayerProfileModal({
  profile,
  boxStats,
  loading = false,
  error = null,
  fitContent,
  onDismiss,
}: PlayerProfileModalProps) {
  const [activeTab, setActiveTab] = useState<"player" | "build-fit">("player");

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
          className="max-h-[calc(100vh-2rem)] md:max-h-[calc(100vh-3rem)] w-full overflow-y-auto rounded-md border border-[#d9d0c9] bg-[#f7f7f7] px-4 pt-4 pb-8 md:px-6 md:pt-5 md:pb-10"
        >
          <div id="player-profile-modal-toolbar" className="mb-3 flex justify-end">
            <button
              id="player-profile-modal-close"
              type="button"
              onClick={onDismiss}
              className="flex h-8 w-8 items-center justify-center rounded-sm border border-transparent text-[#0e0907]/45 transition-colors hover:border-[#d9d0c9] hover:bg-[#0e0907]/[0.04] hover:text-[#0e0907]"
              aria-label="Close Profile"
              title="Close Profile"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

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
            </div>
          )}

          {profile && (
            <div id="player-profile-modal-body" className={loading ? "opacity-95" : undefined}>
              {fitContent && (
                <div id="player-profile-modal-tabs" className="mb-5 flex border border-[#d9d0c9]">
                  {[
                    { id: "player" as const, label: "Player" },
                    { id: "build-fit" as const, label: "Build Fit" },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      id={`player-profile-modal-tab-${tab.id}`}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        "flex-1 px-3 py-2 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] transition-colors",
                        activeTab === tab.id
                          ? "bg-[#0e0907] text-[#f8f3f1]"
                          : "text-[#0e0907]/45 hover:bg-[#0e0907]/[0.04] hover:text-[#0e0907]/70",
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              )}
              {fitContent && activeTab === "build-fit" ? (
                <div id="player-profile-modal-build-fit">{fitContent}</div>
              ) : (
                <PlayerProfileView
                  profile={profile}
                  boxStats={boxStats}
                  isModal
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
