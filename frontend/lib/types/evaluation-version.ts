/**
 * TypeScript types for the Evaluation Version system.
 * Mirrors backend response shapes from /api/evaluation-versions.
 */

export interface EvaluationVersionPayload {
  taxonomy: {
    skills: { key: string; label: string; order: number }[];
    impact_traits: { key: string; label: string; order: number }[];
    subscore_tree: {
      category_key: string;
      category_label: string;
      subscores: { key: string; label: string; order: number }[];
    }[];
  };
  values: Record<string, unknown>;
  formula_refs: Record<string, string>;
  meta: {
    version_schema: number;
    bootstrap_source: string;
  };
}

export interface EvaluationVersion {
  id: string;
  slug: string;
  status: "draft" | "published" | "archived";
  payload: EvaluationVersionPayload;
}

export interface PublishGateViolation {
  layer: "L1" | "L2" | "L3" | "L4" | "L7";
  code: string;
  message: string;
  target?: string;
}

export interface PublishGateResult {
  ok: boolean;
  violations: PublishGateViolation[];
}

export interface JsonPatchOp {
  op: "replace" | "add" | "remove";
  path: string;
  value?: unknown;
}
