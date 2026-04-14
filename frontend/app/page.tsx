import { redirect } from "next/navigation";

// Temporary redirect — Phase 3 will replace this with the public landing page.
export default function RootPage() {
  redirect("/admin");
}
