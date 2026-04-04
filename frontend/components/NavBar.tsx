"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getPipelineStatus, listLegends } from "@/lib/api";

/**
 * Global navigation bar shown on all pages.
 * Displays route links, a live badge on Review showing unresolved flag count,
 * and a live badge on Legends showing completion count (e.g. "12/36").
 */
export function NavBar() {
  const pathname = usePathname();

  // Flagged-player count drives the Review badge
  const [flaggedPlayers, setFlaggedPlayers] = useState<number | null>(null);
  // Legends completion badge — "12/36"
  const [legendsComplete, setLegendsComplete] = useState<number | null>(null);
  const [legendsTotal, setLegendsTotal] = useState<number>(36);

  useEffect(() => {
    // Fetch pipeline status for the review badge
    getPipelineStatus()
      .then((res) => {
        if (res.success && res.data) {
          setFlaggedPlayers(res.data.flagged_players);
        }
      })
      .catch(() => {
        // Silently ignore — badge is informational
      });

    // Fetch legends list for the completion badge
    listLegends()
      .then((res) => {
        if (res.success && res.data) {
          const complete = res.data.filter((l) => l.completion >= 20).length;
          setLegendsComplete(complete);
          setLegendsTotal(res.data.length);
        }
      })
      .catch(() => {
        // Silently ignore — badge is informational
      });
  }, []);

  interface NavItem {
    href: string;
    label: string;
    badge?: React.ReactNode;
  }

  const navItems: NavItem[] = [
    { href: "/pipeline",    label: "Pipeline" },
    {
      href: "/review",
      label: "Review",
      // Show red count badge when there are unresolved flags
      badge: flaggedPlayers != null && flaggedPlayers > 0 ? (
        <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold tabular-nums">
          {flaggedPlayers > 99 ? "99+" : flaggedPlayers}
        </span>
      ) : undefined,
    },
    { href: "/calibration", label: "Calibration" },
    { href: "/players",     label: "Players" },
    {
      href: "/legends",
      label: "Legends",
      // Show completion progress badge (e.g. "12/36")
      badge: legendsComplete != null ? (
        <span className="inline-flex items-center justify-center h-4 px-1.5 rounded-full bg-muted text-muted-foreground text-[10px] font-medium tabular-nums">
          {legendsComplete}/{legendsTotal}
        </span>
      ) : undefined,
    },
  ];

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-screen-2xl mx-auto px-4 flex h-12 items-center gap-6">
        {/* App name / home link — "Cornerstone" links to the hub dashboard */}
        <Link
          href="/"
          className="font-semibold text-sm text-foreground hover:text-foreground/80 transition-colors mr-2"
        >
          Cornerstone
        </Link>

        {/* Nav links */}
        {navItems.map(({ href, label, badge }) => {
          const isActive = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex items-center gap-1.5 text-sm font-medium transition-colors",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
              {badge}
              {/* Active underline indicator */}
              {isActive && (
                <span className="absolute -bottom-[calc(0.75rem+1px)] left-0 right-0 h-0.5 bg-foreground rounded-t-full" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
