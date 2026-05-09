"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useAdminStatus } from "@/lib/hooks/useAdminStatus";
import { getBrowserSupabase } from "@/lib/supabase/client";

// Admin dropdown items
const ADMIN_LINKS = [
  { href: "/admin/pipeline",              label: "Pipeline"    },
  { href: "/admin/review",                label: "Review"      },
  { href: "/admin/calibration",           label: "Calibration" },
  { href: "/admin/cohesion-calibration",  label: "Cohesion"    },
  { href: "/admin/legends",               label: "Legends"     },
];

export function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { isAdmin, loading, email } = useAdminStatus();

  const [adminOpen, setAdminOpen]     = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const adminRef   = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (adminRef.current && !adminRef.current.contains(e.target as Node)) {
        setAdminOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleLogout = async () => {
    const supabase = getBrowserSupabase();
    await supabase.auth.signOut();
    setProfileOpen(false);
    router.push("/");
    router.refresh();
  };

  const publicNav = [
    { href: "/lab", label: "Lab" },
    { href: "/players", label: "Players" },
    { href: "/players?f=Legend|Yes|AND|0", label: "Legends" },
  ];

  const adminActive = pathname.startsWith("/admin");

  return (
    <nav
      id="navbar"
      className="sticky top-0 z-50 border-b border-[#0e0907]/10 bg-[#ffa05c] backdrop-blur supports-[backdrop-filter]:bg-[#ffa05c]/95"
    >
      <div className="max-w-screen-2xl mx-auto px-4 flex h-12 items-center justify-between">

        {/* ── Left: brand + public links + admin dropdown ── */}
        <div className="flex items-center gap-6">
          <Link
            id="navbar-home-link"
            href="/"
            className="font-semibold text-sm text-foreground hover:text-foreground/80 transition-colors"
          >
            Cornerstone
          </Link>

          <div id="navbar-links" className="flex items-center gap-5">
            {/* Public links */}
            {publicNav.map(({ href, label }) => {
              const isActive = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  id={`navbar-link-${label.toLowerCase()}`}
                  href={href}
                  className={cn(
                    "relative text-sm font-medium transition-colors",
                    isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                  {isActive && (
                    <span className="absolute -bottom-[calc(0.75rem+1px)] left-0 right-0 h-0.5 bg-primary rounded-t-full" />
                  )}
                </Link>
              );
            })}

            {/* Admin dropdown — only for admins */}
            {isAdmin && (
              <div id="navbar-admin-menu" ref={adminRef} className="relative">
                <button
                  id="navbar-admin-btn"
                  type="button"
                  onClick={() => setAdminOpen((v) => !v)}
                  className={cn(
                    "relative flex items-center gap-1 text-sm font-medium transition-colors",
                    adminActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Admin
                  {/* Chevron */}
                  <svg
                    className={cn("w-3 h-3 transition-transform", adminOpen && "rotate-180")}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                  {/* Active underline when on any /admin/* page */}
                  {adminActive && (
                    <span className="absolute -bottom-[calc(0.75rem+1px)] left-0 right-0 h-0.5 bg-primary rounded-t-full" />
                  )}
                </button>

                {adminOpen && (
                  <div
                    id="navbar-admin-dropdown"
                    className="absolute left-0 top-full mt-2 w-44 rounded-lg border border-border bg-popover shadow-lg z-20 py-1 overflow-hidden"
                  >
                    {ADMIN_LINKS.map(({ href, label }) => (
                      <Link
                        key={href}
                        id={`navbar-admin-link-${label.toLowerCase()}`}
                        href={href}
                        onClick={() => setAdminOpen(false)}
                        className={cn(
                          "block px-3 py-2 text-sm transition-colors",
                          pathname.startsWith(href)
                            ? "text-foreground font-medium bg-muted/60"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        )}
                      >
                        {label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: profile (logged in) or Log in link ── */}
        {!loading && (
          <div id="navbar-auth" className="flex items-center">
            {email ? (
              /* Profile button — circle initial + email text, dropdown on click */
              <div id="navbar-profile-menu" ref={profileRef} className="relative">
                <button
                  id="navbar-profile-btn"
                  type="button"
                  onClick={() => setProfileOpen((v) => !v)}
                  className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                >
                  {/* Circle with first letter */}
                  <span className="flex items-center justify-center w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold uppercase select-none flex-shrink-0">
                    {email.charAt(0)}
                  </span>
                  {/* Email text — hidden on small screens */}
                  <span className="text-sm text-muted-foreground max-w-[180px] truncate hidden sm:block">
                    {email}
                  </span>
                </button>

                {profileOpen && (
                  <div
                    id="navbar-profile-dropdown"
                    className="absolute right-0 top-full mt-2 w-48 rounded-lg border border-border bg-popover shadow-lg z-20 py-1 overflow-hidden"
                  >
                    <Link
                      id="navbar-saved-teams-link"
                      href="/saved-teams"
                      onClick={() => setProfileOpen(false)}
                      className="block px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      Saved Teams
                    </Link>
                    <button
                      id="navbar-logout-btn"
                      type="button"
                      onClick={handleLogout}
                      className="w-full text-left px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      Log out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link
                id="navbar-login-link"
                href="/login"
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Log in
              </Link>
            )}
          </div>
        )}

      </div>
    </nav>
  );
}
