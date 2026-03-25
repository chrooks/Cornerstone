/**
 * Supabase client singleton for use in browser/client components.
 * Import this wherever you need to query Supabase from the frontend.
 */

import { createBrowserClient } from "@supabase/ssr";

// These are safe to expose publicly — they're scoped by Supabase Row Level Security.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Returns a Supabase browser client.
 * Uses @supabase/ssr for SSR-safe cookie handling.
 */
export function createClient() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
