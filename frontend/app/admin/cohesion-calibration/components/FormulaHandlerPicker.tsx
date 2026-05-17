"use client";

/**
 * FormulaHandlerPicker — Add/remove Formula Handler mappings in the draft Evaluation Version.
 *
 * Shows current formula_refs (Impact Trait → handler), lets admin add new
 * mappings from registered handlers, and remove existing ones. All mutations
 * go through JSON Patch ops via onPatchDraft.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { getRegisteredHandlers } from "@/lib/api/evaluation-versions";
import type {
  EvaluationVersion,
  JsonPatchOp,
  HandlerInfo,
} from "@/lib/types/evaluation-version";

interface FormulaHandlerPickerProps {
  draft?: EvaluationVersion | null;
  onPatchDraft?: (ops: JsonPatchOp[]) => Promise<void>;
}

export function FormulaHandlerPicker({ draft, onPatchDraft }: FormulaHandlerPickerProps) {
  const [handlers, setHandlers] = useState<HandlerInfo[]>([]);
  const [loadingHandlers, setLoadingHandlers] = useState(true);

  // Add form state
  const [selectedHandler, setSelectedHandler] = useState("");
  const [traitKey, setTraitKey] = useState("");
  const [categoryKey, setCategoryKey] = useState("");

  // Load registered handlers on mount
  useEffect(() => {
    getRegisteredHandlers().then((res) => {
      if (res.success && res.data) {
        setHandlers(res.data);
      } else {
        toast.error(res.error ?? "Failed to load handlers");
      }
      setLoadingHandlers(false);
    });
  }, []);

  // Derive current state from draft payload (memoized to stabilize hook deps)
  const formulaRefs = useMemo(() => draft?.payload.formula_refs ?? {}, [draft]);
  const subscoreTree = useMemo(() => draft?.payload.taxonomy.subscore_tree ?? [], [draft]);
  const impactTraits = useMemo(() => draft?.payload.taxonomy.impact_traits ?? [], [draft]);

  const mappedHandlerNames = useMemo(
    () => new Set(Object.values(formulaRefs)),
    [formulaRefs],
  );

  const availableHandlers = useMemo(
    () => handlers.filter((h) => !mappedHandlerNames.has(h.name)),
    [handlers, mappedHandlerNames],
  );

  const categories = useMemo(
    () => subscoreTree.map((c) => ({ key: c.category_key, label: c.category_label })),
    [subscoreTree],
  );

  // Reset category to first available when categories load
  useEffect(() => {
    if (categories.length > 0 && !categoryKey) {
      setCategoryKey(categories[0].key);
    }
  }, [categories, categoryKey]);

  const handleAdd = useCallback(async () => {
    if (!draft || !onPatchDraft) {
      toast.error("Create a draft before adding handlers");
      return;
    }
    if (!selectedHandler || !traitKey.trim() || !categoryKey) {
      toast.error("Select a handler, enter a trait key, and pick a category");
      return;
    }

    const cleanKey = traitKey.trim().toLowerCase().replace(/\s+/g, "_");

    // Check for duplicate trait key
    if (formulaRefs[cleanKey]) {
      toast.error(`Trait key '${cleanKey}' already mapped`);
      return;
    }

    // Find the target category index and compute next order
    const catIndex = subscoreTree.findIndex((c) => c.category_key === categoryKey);
    if (catIndex < 0) {
      toast.error("Category not found");
      return;
    }
    const nextOrder = subscoreTree[catIndex].subscores.length;

    // Build label from key
    const label = cleanKey
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

    const ops: JsonPatchOp[] = [
      // Add formula_ref entry
      { op: "add", path: `/formula_refs/${cleanKey}`, value: selectedHandler },
      // Add Impact Trait
      {
        op: "add",
        path: `/taxonomy/impact_traits/-`,
        value: { key: cleanKey, label, order: impactTraits.length },
      },
      // Add subscore to the tree category
      {
        op: "add",
        path: `/taxonomy/subscore_tree/${catIndex}/subscores/-`,
        value: { key: cleanKey, label, order: nextOrder },
      },
    ];

    await onPatchDraft(ops);
    setSelectedHandler("");
    setTraitKey("");
    toast.success(`Added ${cleanKey} → ${selectedHandler}`);
  }, [draft, onPatchDraft, selectedHandler, traitKey, categoryKey, formulaRefs, subscoreTree, impactTraits]);

  const handleRemove = useCallback(
    async (refKey: string) => {
      if (!draft || !onPatchDraft) {
        toast.error("Create a draft before removing handlers");
        return;
      }

      const ops: JsonPatchOp[] = [
        // Remove formula_ref entry
        { op: "remove", path: `/formula_refs/${refKey}` },
      ];

      // Remove matching Impact Trait
      const traitIndex = impactTraits.findIndex(
        (t: { key: string }) => t.key === refKey,
      );
      if (traitIndex >= 0) {
        ops.push({ op: "remove", path: `/taxonomy/impact_traits/${traitIndex}` });
      }

      // Remove matching subscore from tree
      for (let ci = 0; ci < subscoreTree.length; ci++) {
        const si = subscoreTree[ci].subscores.findIndex(
          (s: { key: string }) => s.key === refKey,
        );
        if (si >= 0) {
          ops.push({
            op: "remove",
            path: `/taxonomy/subscore_tree/${ci}/subscores/${si}`,
          });
          break;
        }
      }

      await onPatchDraft(ops);
      toast.success(`Removed ${refKey}`);
    },
    [draft, onPatchDraft, impactTraits, subscoreTree],
  );

  if (loadingHandlers) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
        Loading handlers…
      </div>
    );
  }

  const noDraft = !draft;

  return (
    <div id="cohesion-cal-handler-picker" className="space-y-6">
      {/* Current formula_refs mappings */}
      <section>
        <h3 id="handler-picker-current-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Current Mappings ({Object.keys(formulaRefs).length})
        </h3>
        {Object.keys(formulaRefs).length === 0 ? (
          <p className="text-xs text-muted-foreground/60">No formula_refs mapped yet.</p>
        ) : (
          <div className="rounded-md border border-border overflow-hidden">
            <table id="handler-picker-mappings-table" className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Impact Trait</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Handler</th>
                  <th className="w-16 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {Object.entries(formulaRefs)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([key, handler]) => (
                    <tr key={key} className="border-b border-border last:border-0 hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono text-foreground">{key}</td>
                      <td className="px-3 py-2 text-muted-foreground">{handler}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          id={`handler-picker-remove-${key}`}
                          type="button"
                          disabled={noDraft}
                          onClick={() => handleRemove(key)}
                          className="text-[10px] text-destructive hover:text-destructive/80 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Add new mapping */}
      <section>
        <h3 id="handler-picker-add-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Add Mapping
        </h3>
        <div className="space-y-3 rounded-md border border-border p-4 bg-muted/10">
          {/* Handler select */}
          <div>
            <label htmlFor="handler-picker-handler-select" className="block text-[10px] font-medium text-muted-foreground mb-1">
              Formula Handler
            </label>
            <select
              id="handler-picker-handler-select"
              value={selectedHandler}
              onChange={(e) => setSelectedHandler(e.target.value)}
              disabled={noDraft}
              className="w-full text-xs rounded-md border border-border bg-background px-3 py-1.5 text-foreground disabled:opacity-50"
            >
              <option value="">Select a handler…</option>
              {availableHandlers.map((h) => (
                <option key={h.name} value={h.name}>
                  {h.name} — {h.description}
                </option>
              ))}
            </select>
          </div>

          {/* Trait key input */}
          <div>
            <label htmlFor="handler-picker-trait-key" className="block text-[10px] font-medium text-muted-foreground mb-1">
              Impact Trait Key
            </label>
            <input
              id="handler-picker-trait-key"
              type="text"
              value={traitKey}
              onChange={(e) => setTraitKey(e.target.value)}
              disabled={noDraft}
              placeholder="e.g. spacing"
              className="w-full text-xs rounded-md border border-border bg-background px-3 py-1.5 text-foreground placeholder:text-muted-foreground/40 disabled:opacity-50"
            />
          </div>

          {/* Category select */}
          <div>
            <label htmlFor="handler-picker-category-select" className="block text-[10px] font-medium text-muted-foreground mb-1">
              Subscore Tree Category
            </label>
            <select
              id="handler-picker-category-select"
              value={categoryKey}
              onChange={(e) => setCategoryKey(e.target.value)}
              disabled={noDraft}
              className="w-full text-xs rounded-md border border-border bg-background px-3 py-1.5 text-foreground disabled:opacity-50"
            >
              {categories.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {/* Add button */}
          <button
            id="handler-picker-add-btn"
            type="button"
            disabled={noDraft || !selectedHandler || !traitKey.trim()}
            onClick={handleAdd}
            className="w-full text-xs font-medium py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add Handler Mapping
          </button>

          {noDraft && (
            <p className="text-[10px] text-muted-foreground/60 text-center">
              Create a draft to add or remove handler mappings.
            </p>
          )}
        </div>
      </section>

      {/* Available handlers reference */}
      <section>
        <h3 id="handler-picker-available-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Available Handlers ({handlers.length})
        </h3>
        <div className="space-y-1">
          {handlers.map((h) => (
            <div
              key={h.name}
              className={`flex items-start gap-2 text-xs px-3 py-2 rounded-md ${
                mappedHandlerNames.has(h.name)
                  ? "bg-primary/5 text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              <span className="font-mono font-medium whitespace-nowrap">{h.name}</span>
              <span className="text-muted-foreground/60">—</span>
              <span className="text-muted-foreground/80">{h.description}</span>
              {mappedHandlerNames.has(h.name) && (
                <span className="ml-auto text-[10px] text-primary font-medium">mapped</span>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
