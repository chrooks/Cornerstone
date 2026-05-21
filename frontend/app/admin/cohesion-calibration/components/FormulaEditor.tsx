"use client";

/**
 * FormulaEditor — Composite formula editor tab for cohesion calibration.
 *
 * Two-column layout:
 *   Left (~240px):  Composite selector list
 *   Right (flex):   Factor table, amplifiers, dependencies, preview, distribution
 *
 * All mutations go through useFormulaEditor → onPatchDraft (JSON Patch ops).
 */

import { useState, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { COMPOSITE_COLUMNS, IMPACT_TRAIT_DESCRIPTIONS } from "@/lib/cohesion-constants";
import type { EvaluationVersion, JsonPatchOp } from "@/lib/types/evaluation-version";
import type { ReferencePlayer } from "../types";
import { useFormulaEditor } from "../hooks/useFormulaEditor";
import { FormulaPreview } from "./FormulaPreview";
import { FormulaDistribution } from "./FormulaDistribution";

interface FormulaEditorProps {
  draft?: EvaluationVersion | null;
  onPatchDraft?: (ops: JsonPatchOp[]) => Promise<void>;
  referencePlayersState: [ReferencePlayer[], React.Dispatch<React.SetStateAction<ReferencePlayer[]>>];
}

const COMPOSITE_LABELS: Record<string, string> = Object.fromEntries(
  COMPOSITE_COLUMNS.map((c) => [c.key, c.label]),
);

export function FormulaEditor({ draft, onPatchDraft, referencePlayersState }: FormulaEditorProps) {
  const [referencePlayers] = referencePlayersState;
  const noDraft = !draft;

  const {
    formulas,
    compositeKeys,
    selectedComposite,
    setSelectedComposite,
    currentFormula,
    loading,
    updateCoefficient,
    addFactor,
    removeFactor,
    removeAmplifier,
    updateAmplifierScale,
    updateAmplifierFloor,
    commitChanges,
    discardLocalChanges,
    hasUnsavedChanges,
  } = useFormulaEditor({
    draft: draft ?? null,
    onPatchDraft: onPatchDraft ?? (async () => {}),
  });

  // Add factor form state.
  const [newFactorType, setNewFactorType] = useState<"skill" | "composite">("skill");
  const [newFactorKey, setNewFactorKey] = useState("");
  const [newFactorCoefficient, setNewFactorCoefficient] = useState(1.0);

  const handleAddFactor = useCallback(() => {
    if (!newFactorKey.trim()) return;
    addFactor({ type: newFactorType, key: newFactorKey.trim(), coefficient: newFactorCoefficient });
    setNewFactorKey("");
    setNewFactorCoefficient(1.0);
  }, [newFactorType, newFactorKey, newFactorCoefficient, addFactor]);

  // Derive tier values from active version for preview.
  const tierValues = useMemo(() => {
    if (draft?.payload?.values?.tier_values) return draft.payload.values.tier_values as Record<string, number>;
    return { None: 0, Capable: 1, Proficient: 4, Elite: 8, "All-Time Great": 16 };
  }, [draft]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
        Loading formulas…
      </div>
    );
  }

  if (compositeKeys.length === 0) {
    return (
      <div className="text-xs text-muted-foreground/60 text-center py-8">
        No composite formulas found. Ensure the Evaluation Version has been bootstrapped.
      </div>
    );
  }

  return (
    <div id="formula-editor" className="flex gap-0 h-full">
      {/* Left column: composite selector */}
      <div id="formula-editor-composite-list" className="w-[240px] flex-shrink-0 border-r border-border overflow-y-auto">
        <div className="p-2 space-y-0.5">
          {compositeKeys.map((key) => {
            const formula = formulas[key];
            const isSelected = key === selectedComposite;
            return (
              <button
                key={key}
                id={`formula-editor-select-${key}`}
                type="button"
                onClick={() => setSelectedComposite(key)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-sm text-xs transition-colors cursor-pointer",
                  isSelected
                    ? "bg-primary/8 text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/30",
                )}
              >
                <span className="block">{COMPOSITE_LABELS[key] ?? key}</span>
                <span className="block text-[10px] text-muted-foreground/50 mt-0.5">
                  {formula?.factors.length ?? 0} factors
                  {(formula?.amplifiers.length ?? 0) > 0 && ` · ${formula.amplifiers.length} amp`}
                  {(formula?.depends_on.length ?? 0) > 0 && ` · ${formula.depends_on.length} deps`}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right column: formula details */}
      <div id="formula-editor-details" className="flex-1 min-w-0 overflow-y-auto p-4 space-y-5">
        {currentFormula && (
          <>
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h3 id="formula-editor-heading" className="text-sm font-semibold text-foreground">
                  {COMPOSITE_LABELS[selectedComposite] ?? selectedComposite}
                </h3>
                {IMPACT_TRAIT_DESCRIPTIONS[selectedComposite] && (
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                    {IMPACT_TRAIT_DESCRIPTIONS[selectedComposite]}
                  </p>
                )}
              </div>
              {hasUnsavedChanges && (
                <div className="flex gap-2">
                  <button
                    id="formula-editor-discard-btn"
                    type="button"
                    onClick={discardLocalChanges}
                    className="text-[10px] font-medium px-2.5 py-1 rounded-sm border border-border hover:bg-muted text-muted-foreground transition-colors cursor-pointer"
                  >
                    Discard
                  </button>
                  <button
                    id="formula-editor-save-btn"
                    type="button"
                    disabled={noDraft}
                    onClick={commitChanges}
                    className="text-[10px] font-medium px-2.5 py-1 rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Save to Draft
                  </button>
                </div>
              )}
            </div>

            {/* Factors table */}
            <section>
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Factors ({currentFormula.factors.length})
              </h4>
              <div className="rounded-sm border border-border overflow-hidden">
                <table id="formula-editor-factors-table" className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-3 py-1.5 font-medium text-muted-foreground w-16">Type</th>
                      <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Key</th>
                      <th className="text-right px-3 py-1.5 font-medium text-muted-foreground w-24">Coefficient</th>
                      <th className="w-8 px-2 py-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {currentFormula.factors.map((factor, i) => (
                      <tr key={`${factor.key}-${i}`} className="border-b border-border last:border-0 hover:bg-muted/20">
                        <td className="px-3 py-1.5">
                          <span className={cn(
                            "text-[10px] font-medium px-1.5 py-0.5 rounded-sm",
                            factor.type === "composite"
                              ? "bg-blue-500/10 text-blue-600"
                              : "bg-muted text-muted-foreground",
                          )}>
                            {factor.type === "composite" ? "CMP" : "SKL"}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 font-mono text-foreground">{factor.key}</td>
                        <td className="px-3 py-1.5 text-right">
                          <input
                            id={`formula-editor-coeff-${selectedComposite}-${i}`}
                            type="number"
                            step="0.05"
                            value={factor.coefficient}
                            disabled={noDraft}
                            onChange={(e) => updateCoefficient(i, parseFloat(e.target.value) || 0)}
                            className="w-20 text-right text-xs font-mono rounded-sm border border-border bg-background px-2 py-0.5 text-foreground disabled:opacity-50"
                          />
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <button
                            type="button"
                            disabled={noDraft}
                            onClick={() => removeFactor(i)}
                            className="text-[10px] text-destructive hover:text-destructive/80 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Add factor row */}
              <div className="flex gap-2 mt-2 items-end">
                <select
                  id="formula-editor-new-factor-type"
                  value={newFactorType}
                  onChange={(e) => setNewFactorType(e.target.value as "skill" | "composite")}
                  disabled={noDraft}
                  className="text-xs rounded-sm border border-border bg-background px-2 py-1 text-foreground disabled:opacity-50"
                >
                  <option value="skill">Skill</option>
                  <option value="composite">Composite</option>
                </select>
                <input
                  id="formula-editor-new-factor-key"
                  type="text"
                  value={newFactorKey}
                  onChange={(e) => setNewFactorKey(e.target.value)}
                  disabled={noDraft}
                  placeholder="key"
                  className="flex-1 text-xs font-mono rounded-sm border border-border bg-background px-2 py-1 text-foreground placeholder:text-muted-foreground/40 disabled:opacity-50"
                />
                <input
                  id="formula-editor-new-factor-coeff"
                  type="number"
                  step="0.05"
                  value={newFactorCoefficient}
                  onChange={(e) => setNewFactorCoefficient(parseFloat(e.target.value) || 0)}
                  disabled={noDraft}
                  className="w-20 text-right text-xs font-mono rounded-sm border border-border bg-background px-2 py-1 text-foreground disabled:opacity-50"
                />
                <button
                  id="formula-editor-add-factor-btn"
                  type="button"
                  disabled={noDraft || !newFactorKey.trim()}
                  onClick={handleAddFactor}
                  className="text-[10px] font-medium px-2.5 py-1 rounded-sm border border-border hover:bg-muted text-muted-foreground transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Add
                </button>
              </div>
            </section>

            {/* Amplifiers */}
            {(currentFormula.amplifiers.length > 0) && (
              <section>
                <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Amplifiers ({currentFormula.amplifiers.length})
                </h4>
                <div className="space-y-2">
                  {currentFormula.amplifiers.map((amp, i) => (
                    <div key={i} className="rounded-sm border border-border p-3 bg-muted/10 text-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">
                          Source:{" "}
                          <span className="font-mono text-foreground">
                            {typeof amp.source === "string"
                              ? amp.source
                              : `skills(${(amp.source as { skills: string[] }).skills.join(", ")})`}
                          </span>
                          {amp.applies_to != null && (
                            <span className="ml-2 text-muted-foreground/60">
                              → factor[{amp.applies_to.join(", ")}]
                            </span>
                          )}
                        </span>
                        <button
                          type="button"
                          disabled={noDraft}
                          onClick={() => removeAmplifier(i)}
                          className="text-[10px] text-destructive hover:text-destructive/80 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          ×
                        </button>
                      </div>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-1.5">
                          <span className="text-muted-foreground">Scale</span>
                          <input
                            type="number"
                            step="0.01"
                            value={amp.scale}
                            disabled={noDraft}
                            onChange={(e) => updateAmplifierScale(i, parseFloat(e.target.value) || 0)}
                            className="w-20 text-right text-xs font-mono rounded-sm border border-border bg-background px-2 py-0.5 disabled:opacity-50"
                          />
                        </label>
                        <label className="flex items-center gap-1.5">
                          <span className="text-muted-foreground">Floor</span>
                          <input
                            type="number"
                            step="0.1"
                            value={amp.floor}
                            disabled={noDraft}
                            onChange={(e) => updateAmplifierFloor(i, parseFloat(e.target.value) || 0)}
                            className="w-20 text-right text-xs font-mono rounded-sm border border-border bg-background px-2 py-0.5 disabled:opacity-50"
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Dependencies (read-only) */}
            {currentFormula.depends_on.length > 0 && (
              <section>
                <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Dependencies
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {currentFormula.depends_on.map((dep) => (
                    <span
                      key={dep}
                      className="text-[10px] font-mono px-2 py-0.5 rounded-sm bg-blue-500/10 text-blue-600 border border-blue-500/20"
                    >
                      {dep}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* Distribution histogram */}
            <FormulaDistribution
              compositeKey={selectedComposite}
              formula={currentFormula}
              hasChanges={hasUnsavedChanges}
            />

            {/* Reference player preview */}
            {referencePlayers.length > 0 && (() => {
              const previewFormulas = hasUnsavedChanges
                ? localDraftFormulas(formulas, selectedComposite, currentFormula) ?? formulas
                : formulas;
              return (
                <FormulaPreview
                  formulas={previewFormulas}
                  baseFormulas={formulas}
                  tierValues={tierValues}
                  referencePlayers={referencePlayers}
                  selectedComposite={selectedComposite}
                />
              );
            })()}

            {noDraft && (
              <p className="text-[10px] text-muted-foreground/60 text-center">
                Create a draft to edit formulas.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Build a merged formula dict with local draft applied for preview. */
function localDraftFormulas(
  base: Record<string, import("../types").CompositeFormula>,
  key: string,
  draft: import("../types").CompositeFormula,
): Record<string, import("../types").CompositeFormula> | null {
  if (!key || !draft) return null;
  return { ...base, [key]: draft };
}
