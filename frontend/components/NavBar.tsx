"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useAdminStatus } from "@/lib/hooks/useAdminStatus";
import { getBrowserSupabase } from "@/lib/supabase/client";

// Admin dropdown items. Pipeline/Review/Calibration/Legends consolidated into
// the Snapshots draft workspace; their standalone routes still resolve as
// thin wrappers for legacy deep-links.
const ADMIN_LINKS = [
  // The review queue also lives in the Snapshots draft workspace; the direct
  // link is the phone path to it (flags get resolved one-handed there).
  { href: "/admin/review",                label: "Review"      },
  { href: "/admin/snapshots/draft",       label: "Snapshots"   },
  { href: "/admin/evaluator-calibration", label: "Evaluator"   },
  { href: "/admin/rulesets",              label: "RuleSets"    },
];

export function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { isAdmin, loading, email } = useAdminStatus();

  const [adminOpen, setAdminOpen]     = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  // Below md the links do not fit a phone, so they live in a menu panel.
  const [menuOpen, setMenuOpen]       = useState(false);

  const adminRef   = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const menuRef    = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  // Any navigation closes the phone menu.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Escape closes the phone menu and hands focus back to its button.
  useEffect(() => {
    if (!menuOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        menuBtnRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [menuOpen]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (adminRef.current && !adminRef.current.contains(e.target as Node)) {
        setAdminOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
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
    { href: "/community", label: "Community" },
    { href: "/faq", label: "FAQ" },
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
            className="font-display font-semibold text-sm tracking-[-0.01em] text-foreground hover:text-foreground/80 transition-colors"
          >
            Cornerstone
          </Link>

          <div id="navbar-links" className="hidden md:flex items-center gap-5">
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

        <div ref={menuRef} className="flex items-center gap-2">
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
                      id="navbar-profile-link"
                      href="/profile"
                      onClick={() => setProfileOpen(false)}
                      className="block px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      Profile
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
                className="flex min-h-11 items-center px-1 text-sm font-medium text-foreground hover:text-foreground/80 transition-colors md:min-h-0 md:px-0 md:text-muted-foreground md:hover:text-foreground"
              >
                Log in
              </Link>
            )}
          </div>
        )}

        {/* ── Phone menu button (below md) ── */}
        <button
          id="navbar-menu-btn"
          ref={menuBtnRef}
          type="button"
          aria-expanded={menuOpen}
          aria-controls="navbar-mobile-panel"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          onClick={() => setMenuOpen((v) => !v)}
          className="-mr-2 flex h-11 w-11 items-center justify-center rounded-md text-foreground hover:bg-[#0e0907]/5 md:hidden"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            {menuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
            )}
          </svg>
        </button>

        {/* ── Phone menu panel: every link as a full-width, thumb-sized row ── */}
        {menuOpen && (
          <div
            id="navbar-mobile-panel"
            className="absolute inset-x-0 top-full border-b border-border bg-popover shadow-lg md:hidden motion-safe:animate-[navbar-panel-in_160ms_cubic-bezier(0.16,1,0.3,1)]"
          >
            <ul className="mx-auto max-w-screen-2xl px-2 py-2">
              {publicNav.map(({ href, label }) => {
                const isActive = pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <li key={href}>
                    <Link
                      id={`navbar-mobile-link-${label.toLowerCase()}`}
                      href={href}
                      aria-current={isActive ? "page" : undefined}
                      onClick={() => setMenuOpen(false)}
                      className={cn(
                        "flex min-h-12 items-center rounded-md px-3 text-base transition-colors",
                        isActive
                          ? "bg-primary/15 font-semibold text-foreground"
                          : "text-foreground hover:bg-muted"
                      )}
                    >
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
            {isAdmin && (
              <div className="mx-auto max-w-screen-2xl border-t border-border px-2 py-2">
                <p className="px-3 pb-1 pt-1 text-xs font-medium text-muted-foreground">Admin</p>
                <ul>
                  {ADMIN_LINKS.map(({ href, label }) => {
                    const isActive = pathname.startsWith(href);
                    return (
                      <li key={href}>
                        <Link
                          id={`navbar-mobile-admin-link-${label.toLowerCase()}`}
                          href={href}
                          aria-current={isActive ? "page" : undefined}
                          onClick={() => setMenuOpen(false)}
                          className={cn(
                            "flex min-h-12 items-center rounded-md px-3 text-base transition-colors",
                            isActive
                              ? "bg-primary/15 font-semibold text-foreground"
                              : "text-foreground hover:bg-muted"
                          )}
                        >
                          {label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
        </div>

      </div>
    </nav>
  );
}
