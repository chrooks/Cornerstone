"use client";

/**
 * useAdminStatus — returns the current user's auth state and admin role.
 *
 * Uses onAuthStateChange which fires immediately with the current session
 * (INITIAL_SESSION event), so no separate getSession() call is needed.
 * Always calls setLoading(false) via finally so the loading state never
 * gets stuck if Supabase throws.
 */

import { useEffect, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";

interface AdminStatus {
  isAdmin: boolean;
  loading: boolean;
  email: string | null;
}

export function useAdminStatus(): AdminStatus {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [email, setEmail]     = useState<string | null>(null);

  useEffect(() => {
    const supabase = getBrowserSupabase();

    // onAuthStateChange fires immediately with INITIAL_SESSION so we get
    // the current session on mount without a separate getSession() call.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event: unknown, session: { user: { id: string; email?: string } } | null) => {
        void (async () => {
          try {
            if (!session) {
              setIsAdmin(false);
              setEmail(null);
              return;
            }
            setEmail(session.user.email ?? null);
            // Check whether this user has a row in user_roles
            const { data } = await supabase
              .from("user_roles")
              .select("role")
              .eq("user_id", session.user.id)
              .eq("role", "admin")
              .single();
            setIsAdmin(!!data);
          } catch {
            // Treat any error as unauthenticated / non-admin
            setIsAdmin(false);
          } finally {
            setLoading(false);
          }
        })();
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  return { isAdmin, loading, email };
}
