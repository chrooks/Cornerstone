"use client";

/**
 * WeightsEditor — Monaco JSON editor for cohesion engine weight overrides.
 *
 * Self-contained: fetches current weights on mount, provides save/reset actions.
 */

import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { fetchCohesionWeights, updateCohesionWeights } from "@/lib/api";

interface WeightsEditorProps {
  onWeightsUpdated: () => void;
}

/** Monaco JSON editor for weight overrides with test/save/reset. */
export function WeightsEditor({ onWeightsUpdated }: WeightsEditorProps) {
  const [editorContent, setEditorContent] = useState<string>("{}");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Lazy import Monaco to avoid SSR issues
  const [MonacoEditor, setMonacoEditor] = useState<typeof import("@monaco-editor/react").default | null>(null);

  // Load Monaco lazily on mount
  useEffect(() => {
    import("@monaco-editor/react").then((mod) => setMonacoEditor(() => mod.default));
  }, []);

  // Fetch current weights on mount
  useEffect(() => {
    fetchCohesionWeights().then((res) => {
      if (res.success && res.data) {
        setEditorContent(JSON.stringify(res.data, null, 2));
      }
      setLoading(false);
    });
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const parsed = JSON.parse(editorContent);
      const res = await updateCohesionWeights(parsed);
      if (res.success) {
        toast.success("Weight overrides applied");
        onWeightsUpdated();
      } else {
        toast.error(res.error ?? "Failed to save weights");
      }
    } catch {
      toast.error("Invalid JSON");
    } finally {
      setSaving(false);
    }
  }, [editorContent, onWeightsUpdated]);

  const handleReset = useCallback(async () => {
    // Reset by sending empty overrides, then refetch
    const res = await updateCohesionWeights({});
    if (res.success && res.data) {
      setEditorContent(JSON.stringify(res.data, null, 2));
      toast.success("Weights reset to defaults");
      onWeightsUpdated();
    } else {
      toast.error(res.error ?? "Failed to reset weights");
    }
  }, [onWeightsUpdated]);

  if (loading) {
    return <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">Loading weights…</div>;
  }

  return (
    <div id="cohesion-cal-weights-editor" className="space-y-3 h-full flex flex-col">
      {/* Monaco editor */}
      <div className="flex-1 min-h-0 rounded-md border border-border overflow-hidden">
        {MonacoEditor ? (
          <MonacoEditor
            height="100%"
            language="json"
            theme="vs-dark"
            value={editorContent}
            onChange={(v) => setEditorContent(v ?? "{}")}
            options={{
              minimap: { enabled: false },
              fontSize: 11,
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              wordWrap: "on",
              tabSize: 2,
            }}
          />
        ) : (
          <textarea
            id="cohesion-cal-weights-textarea"
            value={editorContent}
            onChange={(e) => setEditorContent(e.target.value)}
            className="w-full h-full bg-background text-foreground font-mono text-xs p-3 resize-none focus:outline-none"
            spellCheck={false}
          />
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          id="cohesion-cal-weights-save-btn"
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="flex-1 text-xs font-medium py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save Overrides"}
        </button>
        <button
          id="cohesion-cal-weights-reset-btn"
          type="button"
          onClick={handleReset}
          className="text-xs font-medium py-1.5 px-3 rounded-md border border-border hover:bg-muted text-muted-foreground transition-colors cursor-pointer"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
