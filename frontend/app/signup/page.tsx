"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getBrowserSupabase } from "@/lib/supabase/client";

/**
 * Inner form — extracted so useSearchParams() can be wrapped in Suspense,
 * required by Next.js 14 App Router for client-side search param reads.
 */
function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? "/";

  // Redirect already-authenticated users away from the signup page
  useEffect(() => {
    const supabase = getBrowserSupabase();
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: unknown } }) => {
      if (session) router.replace("/admin");
    });
  }, [router]);

  const [email, setEmail]           = useState("");
  const [password, setPassword]     = useState("");
  const [confirm, setConfirm]       = useState("");
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [success, setSuccess]       = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    setError(null);

    const supabase = getBrowserSupabase();
    const { error: authError } = await supabase.auth.signUp({ email, password });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // Supabase sends a confirmation email by default.
    // If email confirmation is disabled in your Supabase project settings,
    // the user is logged in immediately and we redirect them.
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      router.push(redirectTo);
      router.refresh();
    } else {
      // Email confirmation required — show a success message instead of redirecting
      setSuccess(true);
    }
    setLoading(false);
  };

  if (success) {
    return (
      <div
        id="signup-success"
        className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-800 space-y-1"
      >
        <p className="font-medium">Check your email</p>
        <p className="text-emerald-700">
          We sent a confirmation link to <span className="font-medium">{email}</span>.
          Click it to activate your account.
        </p>
      </div>
    );
  }

  return (
    <form id="signup-form" onSubmit={handleSubmit} className="space-y-4">
      <div id="signup-email-field">
        <label
          htmlFor="signup-email-input"
          className="block text-sm font-medium text-foreground mb-1"
        >
          Email
        </label>
        <input
          id="signup-email-input"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div id="signup-password-field">
        <label
          htmlFor="signup-password-input"
          className="block text-sm font-medium text-foreground mb-1"
        >
          Password
        </label>
        <input
          id="signup-password-input"
          type="password"
          required
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div id="signup-confirm-field">
        <label
          htmlFor="signup-confirm-input"
          className="block text-sm font-medium text-foreground mb-1"
        >
          Confirm password
        </label>
        <input
          id="signup-confirm-input"
          type="password"
          required
          autoComplete="new-password"
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {error && (
        <p id="signup-error" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <button
        id="signup-submit-btn"
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-foreground text-background py-2 text-sm font-medium hover:opacity-80 disabled:opacity-40 transition-opacity"
      >
        {loading ? "Creating account…" : "Create account"}
      </button>

      <p id="signup-login-link" className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="underline hover:text-foreground transition-colors">
          Sign in
        </Link>
      </p>
    </form>
  );
}

/**
 * /signup — Public account registration page.
 * Creates a regular Supabase user account. No admin role is granted —
 * admin access is managed separately via the user_roles table.
 */
export default function SignUpPage() {
  return (
    <main
      id="signup-page"
      className="min-h-[calc(100vh-3rem)] flex items-center justify-center px-4"
    >
      <div id="signup-card" className="w-full max-w-sm space-y-6">
        <div id="signup-header" className="space-y-1">
          <h1 id="signup-title" className="text-2xl font-bold text-foreground">
            Create account
          </h1>
          <p id="signup-subtitle" className="text-sm text-muted-foreground">
            Sign up to access Cornerstone
          </p>
        </div>

        <Suspense
          fallback={
            <div className="h-64 animate-pulse bg-muted rounded-lg" />
          }
        >
          <SignUpForm />
        </Suspense>
      </div>
    </main>
  );
}
