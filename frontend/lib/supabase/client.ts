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
 *
 * With @supabase/ssr's createBrowserClient, the in-memory session may not be
 * populated yet if the page was server-rendered. getSession() reads from the
 * in-memory cache, so we fall back to refreshSession() (which reads from
 * cookies and re-hydrates the client) when getSession() returns nothing.
 */
export async function getAccessToken(): Promise<string | null> {
  const client = getBrowserSupabase();
  const { data: { session } } = await client.auth.getSession();
  if (session?.access_token) {
    return session.access_token;
  }
  // In-memory session not initialised yet — restore from cookies via a refresh
  const { data: { session: refreshed } } = await client.auth.refreshSession();
  return refreshed?.access_token ?? null;
}
