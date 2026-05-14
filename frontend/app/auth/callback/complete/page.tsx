"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * /auth/callback/complete
 *
 * Thin client page that fires after the server-side auth callback
 * exchanges the Supabase code for a session. Reads the stored
 * `redirectTo` from localStorage (set during signup) and navigates
 * the user to their original destination.
 */
export default function AuthCallbackComplete() {
  const router = useRouter();

  useEffect(() => {
    const stored = localStorage.getItem("authRedirectTo");
    localStorage.removeItem("authRedirectTo");

    const destination =
      stored && stored.startsWith("/") && !stored.startsWith("//")
        ? stored
        : "/";

    router.replace(destination);
    router.refresh();
  }, [router]);

  return (
    <main
      id="auth-callback-page"
      className="min-h-[calc(100vh-3rem)] flex items-center justify-center"
    >
      <p className="text-sm text-muted-foreground animate-pulse">
        Signing you in…
      </p>
    </main>
  );
}
