"use client";

import { useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

// Inline silhouette SVG — same as PlayerCard.tsx's Silhouette component
function Silhouette({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("w-full h-full", className)}
      aria-hidden="true"
    >
      <rect width="80" height="80" rx="8" fill="currentColor" className="text-muted/60" />
      <circle cx="40" cy="28" r="12" fill="currentColor" className="text-muted-foreground/30" />
      <path
        d="M16 72c0-13.255 10.745-24 24-24s24 10.745 24 24"
        fill="currentColor"
        className="text-muted-foreground/30"
      />
    </svg>
  );
}

interface PlayerHeadshotProps {
  /** NBA.com player ID — used to construct the headshot URL. If null/undefined, shows silhouette. */
  nba_api_id?: number | null;
  /** Square size in pixels (both width and height). Default: 48 */
  size?: number;
  /** Player name for alt text */
  name?: string;
  className?: string;
}

/**
 * Renders an NBA.com headshot for a player using their nba_api_id.
 * Falls back to a silhouette SVG if nba_api_id is missing or the image fails to load.
 */
export function PlayerHeadshot({ nba_api_id, size = 48, name, className }: PlayerHeadshotProps) {
  const [failed, setFailed] = useState(false);

  if (!nba_api_id || failed) {
    return (
      <div style={{ width: size, height: size }} className={cn("flex-shrink-0", className)}>
        <Silhouette />
      </div>
    );
  }

  const url = `https://ak-static.cms.nba.com/wp-content/uploads/headshots/nba/latest/260x190/${nba_api_id}.png`;

  return (
    <div
      id={`player-headshot-${nba_api_id}`}
      style={{ width: size, height: size }}
      className={cn("flex-shrink-0 overflow-hidden rounded-lg", className)}
    >
      <Image
        src={url}
        alt={name ? `${name} headshot` : "Player headshot"}
        width={size}
        height={size}
        className="w-full h-full object-cover"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
