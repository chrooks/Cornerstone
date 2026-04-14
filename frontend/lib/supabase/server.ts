/**
 * Server-side Supabase client factory.
 * Creates a new per-request client using Next.js cookies() — safe for Server Components
 * and Route Handlers. Cannot set cookies (use the middleware client for that).
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Create a Supabase client for use in Server Components and Route Handlers.
 * Reads session cookies from the incoming request. Cookie writes are no-ops
 * here — session refreshes propagate through the middleware client instead.
 */
export function getServerSupabase(): SupabaseClient {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // Server Components cannot mutate cookies — refreshes happen in middleware
        },
      },
    }
  );
}
