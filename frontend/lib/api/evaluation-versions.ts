/**
 * API helpers for the Evaluation Version system.
 * All calls go through apiFetch<T>() from @/lib/api.
 */

import { apiFetch } from "@/lib/api";
import type { ApiResponse } from "@/lib/types";
import type {
  EvaluationVersion,
  PublishGateResult,
  JsonPatchOp,
} from "@/lib/types/evaluation-version";

export async function listEvaluationVersions(): Promise<ApiResponse<EvaluationVersion[]>> {
  return apiFetch<EvaluationVersion[]>("/api/evaluation-versions");
}

export async function getActiveEvaluationVersion(): Promise<ApiResponse<EvaluationVersion>> {
  return apiFetch<EvaluationVersion>("/api/evaluation-versions/active");
}

export async function getDraftEvaluationVersion(): Promise<ApiResponse<EvaluationVersion | null>> {
  return apiFetch<EvaluationVersion | null>("/api/evaluation-versions/draft");
}

export async function createDraft(parentId?: string): Promise<ApiResponse<EvaluationVersion>> {
  return apiFetch<EvaluationVersion>("/api/evaluation-versions/drafts", {
    method: "POST",
    body: parentId ? JSON.stringify({ parent_id: parentId }) : undefined,
  });
}

export async function patchDraft(
  id: string,
  patch: JsonPatchOp[],
): Promise<ApiResponse<EvaluationVersion>> {
  return apiFetch<EvaluationVersion>(`/api/evaluation-versions/drafts/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ patch }),
  });
}

export async function validateDraft(
  id: string,
  changelogNote: string,
): Promise<ApiResponse<PublishGateResult>> {
  return apiFetch<PublishGateResult>(
    `/api/evaluation-versions/drafts/${id}/validate`,
    {
      method: "POST",
      body: JSON.stringify({ changelog_note: changelogNote }),
    },
  );
}

export async function publishDraft(
  id: string,
  slug: string,
  changelogNote: string,
): Promise<ApiResponse<EvaluationVersion>> {
  return apiFetch<EvaluationVersion>(
    `/api/evaluation-versions/drafts/${id}/publish`,
    {
      method: "POST",
      body: JSON.stringify({ slug, changelog_note: changelogNote }),
    },
  );
}

export async function discardDraft(id: string): Promise<ApiResponse<null>> {
  return apiFetch<null>(`/api/evaluation-versions/drafts/${id}`, {
    method: "DELETE",
  });
}
