"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getBrowserSupabase } from "@/lib/supabase/client";

/**
 * Guard against open-redirect attacks: the redirectTo param must be a
 * relative path starting with /admin. Any external URL or unexpected path
 * falls back to the safe default /admin.
 */
function sanitizeAdminRedirect(raw: string | null): string {
  // Must start with /admin and must not start with // (protocol-relative URL)
  if (raw && raw.startsWith("/admin") && !raw.startsWith("//")) {
    return raw;
  }
  return "/admin";
}

/**
 * Inner form — extracted so useSearchParams() can be wrapped in Suspense,
 * which is required by Next.js 14 for pages that read search params client-side.
 */
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Validate the redirectTo param before trusting it — prevents open-redirect attacks
  const redirectTo = sanitizeAdminRedirect(searchParams.get("redirectTo"));

  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // Redirect already-authenticated users away from the login page
  useEffect(() => {
    const supabase = getBrowserSupabase();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace("/");
    });
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = getBrowserSupabase();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // router.refresh() re-runs all Server Components so the new session is reflected
    router.push(redirectTo);
    router.refresh();
  };

  return (
    <form id="login-form" onSubmit={handleSubmit} className="space-y-4">
      <div id="login-email-field">
        <label
          htmlFor="login-email-input"
          className="block text-sm font-medium text-foreground mb-1"
        >
          Email
        </label>
        <input
          id="login-email-input"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div id="login-password-field">
        <label
          htmlFor="login-password-input"
          className="block text-sm font-medium text-foreground mb-1"
        >
          Password
        </label>
        <input
          id="login-password-input"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {error && (
        <p id="login-error" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <button
        id="login-submit-btn"
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-foreground text-background py-2 text-sm font-medium hover:opacity-80 disabled:opacity-40 transition-opacity"
      >
        {loading ? "Signing in…" : "Sign in"}
      </button>

      <p id="login-signup-link" className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="underline hover:text-foreground transition-colors">
          Sign up
        </Link>
      </p>
    </form>
  );
}

/**
 * /login — Email/password sign-in page.
 * On success, redirects to /admin (or the original destination captured by middleware).
 */
export default function LoginPage() {
  return (
    <main
      id="login-page"
      className="min-h-[calc(100vh-3rem)] flex items-center justify-center px-4"
    >
      <div id="login-card" className="w-full max-w-sm space-y-6">
        <div id="login-header" className="space-y-1">
          <h1 id="login-title" className="text-2xl font-bold text-foreground">
            Cornerstone
          </h1>
          <p id="login-subtitle" className="text-sm text-muted-foreground">
            Sign in to access admin tools
          </p>
        </div>

        {/* Suspense required because LoginForm reads useSearchParams() */}
        <Suspense
          fallback={
            <div className="h-48 animate-pulse bg-muted rounded-lg" />
          }
        >
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
