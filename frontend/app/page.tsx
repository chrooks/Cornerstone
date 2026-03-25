/**
 * Placeholder homepage — confirms the Next.js + Tailwind + shadcn/ui stack is working.
 * Replace this with real app content as features are built.
 */

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8 bg-background text-foreground">
      <div className="text-center space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">Cornerstone</h1>
        <p className="text-muted-foreground text-lg">NBA analytics platform</p>
      </div>

      {/* Stack confirmation badges */}
      <div className="flex flex-wrap justify-center gap-3 text-sm font-medium">
        {[
          "Next.js 14",
          "TypeScript",
          "Tailwind CSS",
          "shadcn/ui",
          "Supabase",
          "Flask API",
        ].map((tech) => (
          <span
            key={tech}
            className="rounded-full border border-border bg-muted px-4 py-1.5"
          >
            {tech}
          </span>
        ))}
      </div>

      <p className="text-muted-foreground text-sm">
        Stack verified. Start the Flask backend at{" "}
        <code className="bg-muted rounded px-1 py-0.5 font-mono">
          http://localhost:5001/api/health
        </code>
      </p>
    </main>
  );
}
