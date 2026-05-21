/**
 * useFormulaEditor — Manages formula editor state for the Formulas tab.
 *
 * Loads formulas from API, tracks local edits, and commits changes as
 * JSON Patch ops to the draft Evaluation Version.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { fetchCompositeFormulas } from "@/lib/api";
import type { JsonPatchOp, EvaluationVersion } from "@/lib/types/evaluation-version";
import type { CompositeFormula, FormulaFactor, FormulaAmplifier } from "../types";

interface UseFormulaEditorOptions {
  draft: EvaluationVersion | null | undefined;
  onPatchDraft: (ops: JsonPatchOp[]) => Promise<void>;
}

export function useFormulaEditor({ draft, onPatchDraft }: UseFormulaEditorOptions) {
  const [formulas, setFormulas] = useState<Record<string, CompositeFormula>>({});
  const [selectedComposite, setSelectedComposite] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // Local draft formula for the selected composite (edited but not yet committed).
  const [localDraft, setLocalDraft] = useState<CompositeFormula | null>(null);

  const compositeKeys = useMemo(() => Object.keys(formulas), [formulas]);

  // Load formulas on mount and when draft changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCompositeFormulas().then((res) => {
      if (cancelled) return;
      if (res.success && res.data) {
        const loaded = res.data.formulas as Record<string, CompositeFormula>;
        setFormulas(loaded);
        const keys = Object.keys(loaded);
        if (keys.length > 0 && !selectedComposite) {
          setSelectedComposite(keys[0]);
        }
      } else {
        toast.error(res.error ?? "Failed to load formulas");
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id]);

  // Reset local draft when selected composite changes.
  useEffect(() => {
    if (selectedComposite && formulas[selectedComposite]) {
      setLocalDraft(structuredClone(formulas[selectedComposite]));
    } else {
      setLocalDraft(null);
    }
  }, [selectedComposite, formulas]);

  const hasUnsavedChanges = useMemo(() => {
    if (!localDraft || !formulas[selectedComposite]) return false;
    return JSON.stringify(localDraft) !== JSON.stringify(formulas[selectedComposite]);
  }, [localDraft, formulas, selectedComposite]);

  // The "current" formula is the local draft if editing, otherwise the stored formula.
  const currentFormula = localDraft ?? formulas[selectedComposite] ?? null;

  const updateCoefficient = useCallback((factorIndex: number, newCoefficient: number) => {
    setLocalDraft((prev) => {
      if (!prev) return prev;
      const updated = structuredClone(prev);
      if (factorIndex >= 0 && factorIndex < updated.factors.length) {
        updated.factors[factorIndex] = { ...updated.factors[factorIndex], coefficient: newCoefficient };
      }
      return updated;
    });
  }, []);

  const addFactor = useCallback((factor: FormulaFactor) => {
    setLocalDraft((prev) => {
      if (!prev) return prev;
      const updated = structuredClone(prev);
      updated.factors = [...updated.factors, factor];
      // Auto-update depends_on if composite factor.
      if (factor.type === "composite" && !updated.depends_on.includes(factor.key)) {
        updated.depends_on = [...updated.depends_on, factor.key];
      }
      return updated;
    });
  }, []);

  const removeFactor = useCallback((factorIndex: number) => {
    setLocalDraft((prev) => {
      if (!prev) return prev;
      const updated = structuredClone(prev);
      const removed = updated.factors[factorIndex];
      updated.factors = updated.factors.filter((_, i) => i !== factorIndex);
      // Clean up depends_on if no more composite refs to that key.
      if (removed?.type === "composite") {
        const stillReferenced = updated.factors.some(
          (f) => f.type === "composite" && f.key === removed.key,
        );
        if (!stillReferenced) {
          updated.depends_on = updated.depends_on.filter((d) => d !== removed.key);
        }
      }
      // Adjust applies_to indices in amplifiers.
      updated.amplifiers = updated.amplifiers.map((amp) => {
        if (!amp.applies_to) return amp;
        return {
          ...amp,
          applies_to: amp.applies_to
            .filter((idx) => idx !== factorIndex)
            .map((idx) => (idx > factorIndex ? idx - 1 : idx)),
        };
      });
      return updated;
    });
  }, []);

  const addAmplifier = useCallback((amplifier: FormulaAmplifier) => {
    setLocalDraft((prev) => {
      if (!prev) return prev;
      const updated = structuredClone(prev);
      updated.amplifiers = [...updated.amplifiers, amplifier];
      // Auto-update depends_on if composite source.
      if (typeof amplifier.source === "string" && !updated.depends_on.includes(amplifier.source)) {
        updated.depends_on = [...updated.depends_on, amplifier.source];
      }
      return updated;
    });
  }, []);

  const removeAmplifier = useCallback((index: number) => {
    setLocalDraft((prev) => {
      if (!prev) return prev;
      const updated = structuredClone(prev);
      const removed = updated.amplifiers[index];
      updated.amplifiers = updated.amplifiers.filter((_, i) => i !== index);
      // Clean up depends_on if composite source no longer referenced.
      if (removed && typeof removed.source === "string") {
        const stillReferenced =
          updated.factors.some((f) => f.type === "composite" && f.key === removed.source) ||
          updated.amplifiers.some((a) => typeof a.source === "string" && a.source === removed.source);
        if (!stillReferenced) {
          updated.depends_on = updated.depends_on.filter((d) => d !== removed.source);
        }
      }
      return updated;
    });
  }, []);

  const updateAmplifierScale = useCallback((index: number, scale: number) => {
    setLocalDraft((prev) => {
      if (!prev) return prev;
      const updated = structuredClone(prev);
      if (index >= 0 && index < updated.amplifiers.length) {
        updated.amplifiers[index] = { ...updated.amplifiers[index], scale };
      }
      return updated;
    });
  }, []);

  const updateAmplifierFloor = useCallback((index: number, floor: number) => {
    setLocalDraft((prev) => {
      if (!prev) return prev;
      const updated = structuredClone(prev);
      if (index >= 0 && index < updated.amplifiers.length) {
        updated.amplifiers[index] = { ...updated.amplifiers[index], floor };
      }
      return updated;
    });
  }, []);

  const commitChanges = useCallback(async () => {
    if (!draft) {
      toast.error("Create a draft before editing formulas");
      return;
    }
    if (!localDraft || !selectedComposite) return;

    const ops: JsonPatchOp[] = [
      {
        op: formulas[selectedComposite] ? "replace" : "add",
        path: `/values/composite_formulas/${selectedComposite}`,
        value: localDraft,
      },
    ];

    await onPatchDraft(ops);

    // Update local state to reflect the committed formula.
    setFormulas((prev) => ({ ...prev, [selectedComposite]: structuredClone(localDraft) }));
    toast.success(`Updated ${selectedComposite} formula`);
  }, [draft, localDraft, selectedComposite, formulas, onPatchDraft]);

  const discardLocalChanges = useCallback(() => {
    if (selectedComposite && formulas[selectedComposite]) {
      setLocalDraft(structuredClone(formulas[selectedComposite]));
    }
  }, [selectedComposite, formulas]);

  return {
    formulas,
    compositeKeys,
    selectedComposite,
    setSelectedComposite,
    currentFormula,
    loading,
    updateCoefficient,
    addFactor,
    removeFactor,
    addAmplifier,
    removeAmplifier,
    updateAmplifierScale,
    updateAmplifierFloor,
    commitChanges,
    discardLocalChanges,
    hasUnsavedChanges,
  };
}
