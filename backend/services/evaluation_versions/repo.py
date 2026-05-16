"""
Database access for Evaluation Versions.

All writes use the Supabase service-role client. The caller (Flask blueprint)
is responsible for verifying admin auth before calling write methods.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from services.cohesion_engine.engine import EvaluationVersion
from services.supabase_client import get_supabase, run_query


def _row_to_version(row: dict[str, Any]) -> EvaluationVersion:
    """Map a Supabase row dict to an EvaluationVersion dataclass."""
    return EvaluationVersion(
        id=str(row["id"]),
        slug=row["slug"],
        status=row["status"],
        payload=row["payload"],
    )


def _payload_hash(payload: dict) -> str:
    """Compute a deterministic sha256 hash of a payload dict."""
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode()).hexdigest()


def list_versions() -> list[EvaluationVersion]:
    """Return all Evaluation Versions, newest first."""
    client = get_supabase()
    result = run_query(
        lambda: client.table("evaluation_versions")
        .select("*")
        .order("created_at", desc=True)
        .execute()
    )
    return [_row_to_version(row) for row in result.data]


def get_active() -> EvaluationVersion:
    """Return the single active published Evaluation Version."""
    client = get_supabase()
    result = run_query(
        lambda: client.table("evaluation_versions")
        .select("*")
        .eq("is_active", True)
        .single()
        .execute()
    )
    return _row_to_version(result.data)


def get_draft() -> EvaluationVersion | None:
    """Return the current draft Evaluation Version, or None."""
    client = get_supabase()
    result = run_query(
        lambda: client.table("evaluation_versions")
        .select("*")
        .eq("status", "draft")
        .execute()
    )
    if not result.data:
        return None
    return _row_to_version(result.data[0])


def get_version(version_id: str) -> EvaluationVersion:
    """Return a single Evaluation Version by ID."""
    client = get_supabase()
    result = run_query(
        lambda: client.table("evaluation_versions")
        .select("*")
        .eq("id", version_id)
        .single()
        .execute()
    )
    return _row_to_version(result.data)


def create_draft_from_published(parent_id: str | None = None) -> EvaluationVersion:
    """Clone the active (or specified) published Version into a new draft.

    Raises ValueError if a draft already exists.
    """
    existing_draft = get_draft()
    if existing_draft is not None:
        raise ValueError("draft_already_exists")

    if parent_id:
        parent = get_version(parent_id)
    else:
        parent = get_active()

    client = get_supabase()
    result = run_query(
        lambda: client.table("evaluation_versions")
        .insert({
            "slug": f"{parent.slug}-draft",
            "status": "draft",
            "parent_id": parent.id,
            "payload": parent.payload,
            "payload_hash": _payload_hash(parent.payload),
        })
        .execute()
    )
    return _row_to_version(result.data[0])


def patch_draft(draft_id: str, patch: list[dict]) -> EvaluationVersion:
    """Apply JSON-Patch-style operations to a draft's payload.

    Only supports 'replace' and 'add' ops on payload paths.
    Raises ValueError if the Version is not a draft.
    """
    version = get_version(draft_id)
    if version.status != "draft":
        raise ValueError("can_only_patch_draft")

    import copy
    payload = copy.deepcopy(version.payload)

    for op in patch:
        operation = op.get("op")
        path = op.get("path", "")
        value = op.get("value")

        # Parse JSON pointer path like "/values/tier_values/Elite"
        parts = [p for p in path.split("/") if p]
        if not parts:
            continue

        target = payload
        for part in parts[:-1]:
            target = target[part]

        if operation in ("replace", "add"):
            target[parts[-1]] = value
        elif operation == "remove":
            del target[parts[-1]]

    client = get_supabase()
    result = run_query(
        lambda: client.table("evaluation_versions")
        .update({
            "payload": payload,
            "payload_hash": _payload_hash(payload),
        })
        .eq("id", draft_id)
        .eq("status", "draft")
        .execute()
    )
    if not result.data:
        raise ValueError("draft_not_found_or_not_draft")
    return _row_to_version(result.data[0])


def publish_draft(
    draft_id: str,
    slug: str,
    changelog_note: str,
    user_id: str | None = None,
) -> EvaluationVersion:
    """Atomically publish a draft: deactivate current, activate new.

    The caller must validate before calling this. Raises ValueError on
    constraint violations.
    """
    client = get_supabase()

    # Step 1: deactivate current active version
    run_query(
        lambda: client.table("evaluation_versions")
        .update({"is_active": False})
        .eq("is_active", True)
        .execute()
    )

    # Step 2: promote draft to published + active
    update_data: dict[str, Any] = {
        "slug": slug,
        "status": "published",
        "changelog_note": changelog_note,
        "is_active": True,
        "published_at": "now()",
    }
    if user_id:
        update_data["published_by"] = user_id

    result = run_query(
        lambda: client.table("evaluation_versions")
        .update(update_data)
        .eq("id", draft_id)
        .execute()
    )

    if not result.data:
        raise ValueError("draft_not_found")
    return _row_to_version(result.data[0])


def discard_draft(draft_id: str) -> None:
    """Hard-delete a draft Version."""
    client = get_supabase()
    run_query(
        lambda: client.table("evaluation_versions")
        .delete()
        .eq("id", draft_id)
        .eq("status", "draft")
        .execute()
    )
