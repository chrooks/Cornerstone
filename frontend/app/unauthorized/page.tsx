import Link from "next/link";

/**
 * /unauthorized — Shown when an authenticated user tries to access /admin
 * but has no admin role in user_roles.
 */
export default function UnauthorizedPage() {
  return (
    <main
      id="unauthorized-page"
      className="min-h-[calc(100vh-3rem)] flex items-center justify-center px-4"
    >
      <div id="unauthorized-card" className="w-full max-w-sm space-y-4 text-center">
        <h1 id="unauthorized-title" className="text-2xl font-bold text-foreground">
          Access denied
        </h1>
        <p id="unauthorized-body" className="text-sm text-muted-foreground">
          Your account doesn&apos;t have admin access. If you think this is a
          mistake, contact the site administrator.
        </p>
        <Link
          id="unauthorized-home-link"
          href="/"
          className="inline-block text-sm underline text-muted-foreground hover:text-foreground transition-colors"
        >
          Go home
        </Link>
      </div>
    </main>
  );
}
