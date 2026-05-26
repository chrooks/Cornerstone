// Redirect legacy /admin/pipeline to /admin/snapshots/draft
// A-3: must be a Server Component (no "use client") for redirect() to work.

import { redirect } from "next/navigation";

export default function PipelineRedirect() {
  redirect("/admin/snapshots/draft");
}
