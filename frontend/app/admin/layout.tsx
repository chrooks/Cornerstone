/**
 * Admin route group layout — Server Component.
 *
 * Middleware ensures a session exists before this runs (unauthenticated users
 * are already redirected to /login). This layout handles the second check:
 * confirming the authenticated user has an admin role in the user_roles table.
 *
 * Non-admin authenticated users are redirected to the public home page.
 */

import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = getServerSupabase();

  // Belt-and-suspenders: middleware should catch missing sessions, but guard here too
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Check for an admin role row — anon key + user session satisfies the RLS policy
  const { data: roleData } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!roleData) {
    // Authenticated but not an admin — explain rather than silently redirect
    redirect("/unauthorized");
  }

  return <>{children}</>;
}
