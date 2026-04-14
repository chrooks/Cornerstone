/**
 * Temporary placeholder — the admin hub will be moved here in Phase 2.
 * The layout (app/admin/layout.tsx) handles auth/role checks before this renders.
 */

import { redirect } from "next/navigation";

// Until Phase 2 moves the hub dashboard here, send admins to the current hub at /
export default function AdminIndexPage() {
  redirect("/");
}
