/**
 * Supabase client factory for Next.js middleware.
 * This variant can both read and write cookies, which is necessary for
 * refreshing the user's JWT before it expires on every request.
 */

import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";

/**
 * Creates a Supabase client bound to the current middleware request/response pair.
 * Any refreshed session cookies are written back to the response so the browser
 * stays in sync with the server session.
 *
 * @param response - The NextResponse to forward updated cookies onto
 */
export function createMiddlewareSupabase(
  request: NextRequest,
  response: NextResponse
) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Propagate refreshed session cookies to both the request (for downstream
          // Server Components) and the response (for the browser).
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );
}
