"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getPipelineStatus } from "@/lib/api";

/**
 * Global navigation bar shown on all pages (except calibration, which has its
 * own layout concern). Displays route links and a live badge on the Review link
 * showing the number of players with unresolved flags.
 */
export function NavBar() {
  const pathname = usePathname();
  // Flagged-player count drives the Review badge — poll on mount only
  const [flaggedPlayers, setFlaggedPlayers] = useState<number | null>(null);

  // Fetch the flagged-player count once on mount so the badge stays fresh
  useEffect(() => {
    getPipelineStatus()
      .then((res) => {
        if (res.success && res.data) {
          setFlaggedPlayers(res.data.flagged_players);
        }
      })
      .catch(() => {
        // Badge is informational — silently ignore fetch failures
      });
  }, []);

  const navItems: { href: string; label: string; badge?: number | null }[] = [
    { href: "/pipeline", label: "Pipeline" },
    { href: "/review",   label: "Review", badge: flaggedPlayers },
    { href: "/calibration", label: "Calibration" },
  ];

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-screen-2xl mx-auto px-4 flex h-12 items-center gap-6">
        {/* Logo / home link */}
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
              {/* Badge showing unresolved-flag count */}
              {badge != null && badge > 0 && (
                <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold tabular-nums">
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
              {/* Active underline */}
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
