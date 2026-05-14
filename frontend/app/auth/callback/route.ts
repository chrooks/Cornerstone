import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * GET /auth/callback
 *
 * Supabase redirects here after email confirmation. Exchanges the auth code
 * for a session, then forwards to /auth/callback/complete (a client page)
 * which reads the stored `redirectTo` from localStorage and navigates the
 * user back to their original destination (e.g. the eval page).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          },
        },
      }
    );

    await supabase.auth.exchangeCodeForSession(code);
  }

  // Server route can't read sessionStorage, so we redirect to a thin
  // client page that reads it and does the final redirect
  return NextResponse.redirect(
    new URL("/auth/callback/complete", request.url)
  );
}
