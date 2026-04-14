/**
 * Browser-side Supabase client singleton.
 * Use only in Client Components ("use client") or client-side utility functions.
 * Server Components should use lib/supabase/server.ts instead.
 */

import { createBrowserClient } from "@supabase/ssr";

// Singleton — avoids creating multiple GoTrue auth listeners on the same page
let _client: ReturnType<typeof createBrowserClient> | null = null;

/** Returns the shared browser Supabase client, initialising it on first call. */
export function getBrowserSupabase() {
  if (!_client) {
    _client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _client;
}

/**
 * Returns the current user's JWT access token, or null if not authenticated.
 * Called by apiFetch to attach an Authorization header to write requests.
 */
export async function getAccessToken(): Promise<string | null> {
  const { data: { session } } = await getBrowserSupabase().auth.getSession();
  return session?.access_token ?? null;
}
