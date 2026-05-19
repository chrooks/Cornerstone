/**
 * useEvaluationVersion — Manages active + draft Evaluation Version state.
 *
 * Provides the active and draft Versions, mutation methods, and a diff
 * between draft and its parent published Version.
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import { toast } from "sonner";
import {
  getActiveEvaluationVersion,
  getDraftEvaluationVersion,
  listEvaluationVersions,
  createDraft,
  patchDraft,
  validateDraft,
  publishDraft,
  discardDraft,
  reactivateVersion,
} from "@/lib/api/evaluation-versions";
import type {
  EvaluationVersion,
  PublishGateResult,
  JsonPatchOp,
} from "@/lib/types/evaluation-version";

export interface DiffEntry {
  path: string;
  section: string;
  publishedValue: unknown;
  draftValue: unknown;
}

function flattenObject(
  obj: unknown,
  prefix: string = "",
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (obj === null || obj === undefined || typeof obj !== "object") {
    result[prefix] = obj;
    return result;
  }
  if (Array.isArray(obj)) {
    result[prefix] = obj;
    return result;
  }
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      Object.assign(result, flattenObject(value, fullKey));
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}

function computeDiff(
  published: EvaluationVersion | null,
  draft: EvaluationVersion | null,
): DiffEntry[] {
  if (!published || !draft) return [];
  const pubFlat = flattenObject(published.payload);
  const draftFlat = flattenObject(draft.payload);
  const allKeys = Array.from(
    new Set([...Object.keys(pubFlat), ...Object.keys(draftFlat)]),
  );

  const entries: DiffEntry[] = [];
  for (const key of allKeys) {
    const pubVal = pubFlat[key];
    const draftVal = draftFlat[key];
    if (JSON.stringify(pubVal) !== JSON.stringify(draftVal)) {
      const section = key.split(".")[0] ?? "root";
      entries.push({
        path: key,
        section,
        publishedValue: pubVal,
        draftValue: draftVal,
      });
    }
  }
  return entries;
}

export function useEvaluationVersion() {
  const [active, setActive] = useState<EvaluationVersion | null>(null);
  const [draft, setDraft] = useState<EvaluationVersion | null>(null);
  const [versions, setVersions] = useState<EvaluationVersion[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [activeRes, draftRes, versionsRes] = await Promise.all([
        getActiveEvaluationVersion(),
        getDraftEvaluationVersion(),
        listEvaluationVersions(),
      ]);
      if (activeRes.success && activeRes.data) setActive(activeRes.data);
      if (draftRes.success) setDraft(draftRes.data ?? null);
      if (versionsRes.success && versionsRes.data) setVersions(versionsRes.data);
    } catch {
      // Backend unreachable — leave state as-is
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const diff = useMemo(() => computeDiff(active, draft), [active, draft]);

  const handleCreateDraft = useCallback(async () => {
    const res = await createDraft();
    if (res.success && res.data) {
      setDraft(res.data);
      toast.success("Draft created");
    } else {
      toast.error(res.error ?? "Failed to create draft");
    }
  }, []);

  const handlePatch = useCallback(
    async (ops: JsonPatchOp[]) => {
      if (!draft) return;
      const res = await patchDraft(draft.id, ops);
      if (res.success && res.data) {
        setDraft(res.data);
      } else {
        toast.error(res.error ?? "Failed to patch draft");
      }
    },
    [draft],
  );

  const handleValidate = useCallback(
    async (changelogNote: string): Promise<PublishGateResult | null> => {
      if (!draft) return null;
      const res = await validateDraft(draft.id, changelogNote);
      if (res.success && res.data) return res.data;
      toast.error(res.error ?? "Validation failed");
      return null;
    },
    [draft],
  );

  const handlePublish = useCallback(
    async (slug: string, changelogNote: string): Promise<boolean> => {
      if (!draft) return false;
      const res = await publishDraft(draft.id, slug, changelogNote);
      if (res.success && res.data) {
        setActive(res.data);
        setDraft(null);
        toast.success(`Published ${slug}`);
        return true;
      }
      toast.error(res.error ?? "Publish failed");
      return false;
    },
    [draft],
  );

  const handleDiscard = useCallback(async () => {
    if (!draft) return;
    const res = await discardDraft(draft.id);
    if (res.success) {
      setDraft(null);
      toast.success("Draft discarded");
    } else {
      toast.error(res.error ?? "Failed to discard draft");
    }
  }, [draft]);

  const handleReactivate = useCallback(async (versionId: string): Promise<boolean> => {
    const res = await reactivateVersion(versionId);
    if (res.success && res.data) {
      setActive(res.data);
      toast.success(`Reactivated ${res.data.slug}`);
      await reload();
      return true;
    }
    toast.error(res.error ?? "Failed to reactivate");
    return false;
  }, [reload]);

  return {
    active,
    draft,
    versions,
    diff,
    loading,
    reload,
    createDraft: handleCreateDraft,
    patch: handlePatch,
    validate: handleValidate,
    publish: handlePublish,
    discardDraft: handleDiscard,
    reactivate: handleReactivate,
  };
}
