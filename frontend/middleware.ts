/**
 * Next.js edge middleware — runs before every request matching /admin/:path*.
 *
 * Responsibilities:
 * 1. Refresh the Supabase session token if it's near expiry (cookie update)
 * 2. Redirect unauthenticated users to /login, preserving their intended destination
 *
 * Role verification (admin vs regular user) is deferred to app/admin/layout.tsx,
 * which runs as a Server Component and can query the user_roles table.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createMiddlewareSupabase } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  // Create a base response — any refreshed session cookies are written onto this
  const response = NextResponse.next({ request });
  const supabase = createMiddlewareSupabase(request, response);

  // getUser() verifies the JWT and refreshes the session if it's near expiry.
  // Using getUser() (not getSession()) is the recommended pattern because it
  // validates the token with the Supabase auth server rather than trusting
  // the local cookie value alone.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Capture the original destination so the login page can redirect back after sign-in
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirectTo", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  // User is authenticated — pass through with (possibly refreshed) session cookies
  return response;
}

// Middleware only runs on admin routes — avoids unnecessary overhead on public pages
export const config = {
  matcher: ["/admin/:path*"],
};
