"""
api/evaluation_versions.py — Evaluation Version CRUD + publish workflow.

Blueprint prefix: /api/evaluation-versions
Read endpoints are public. Write endpoints require @require_admin.
"""

from __future__ import annotations

import dataclasses
import logging
import re
from uuid import UUID

from flask import Blueprint, jsonify, request

from api.auth import require_admin
from services.evaluation_versions import repo, validator

logger = logging.getLogger(__name__)

evaluation_versions_bp = Blueprint(
    "evaluation_versions",
    __name__,
    url_prefix="/api/evaluation-versions",
)

SLUG_PATTERN = re.compile(r"^cohesion-[a-z0-9-]+$")
MAX_CHANGELOG_LENGTH = 2000


def _version_dict(v) -> dict:
    """Serialize an EvaluationVersion to a JSON-safe dict."""
    return {
        "id": v.id,
        "slug": v.slug,
        "status": v.status,
        "payload": v.payload,
    }


def _validate_uuid(value: str, label: str = "id") -> str | None:
    """Return None if valid UUID, or error message."""
    try:
        UUID(value)
        return None
    except (ValueError, AttributeError):
        return f"Invalid {label}: {value}"


# ---------------------------------------------------------------------------
# Read endpoints (public)
# ---------------------------------------------------------------------------


@evaluation_versions_bp.route("", methods=["GET"])
def list_versions():
    """List all Evaluation Versions, newest first."""
    versions = repo.list_versions()
    return jsonify({
        "success": True,
        "data": [_version_dict(v) for v in versions],
        "error": None,
    })


@evaluation_versions_bp.route("/active", methods=["GET"])
def get_active():
    """Return the currently active Evaluation Version."""
    try:
        version = repo.get_active()
        return jsonify({
            "success": True,
            "data": _version_dict(version),
            "error": None,
        })
    except Exception:
        logger.exception("Failed to fetch active Evaluation Version")
        return jsonify({
            "success": False,
            "data": None,
            "error": "Failed to fetch active Evaluation Version",
        }), 500


@evaluation_versions_bp.route("/draft", methods=["GET"])
def get_draft():
    """Return the current draft Evaluation Version, or null."""
    draft = repo.get_draft()
    return jsonify({
        "success": True,
        "data": _version_dict(draft) if draft else None,
        "error": None,
    })


@evaluation_versions_bp.route("/<version_id>", methods=["GET"])
@require_admin
def get_version(version_id: str):
    """Return a single Evaluation Version by ID (admin only)."""
    uuid_err = _validate_uuid(version_id, "version_id")
    if uuid_err:
        return jsonify({"success": False, "data": None, "error": uuid_err}), 400

    try:
        version = repo.get_version(version_id)
        return jsonify({
            "success": True,
            "data": _version_dict(version),
            "error": None,
        })
    except Exception:
        logger.exception("Failed to fetch Evaluation Version %s", version_id)
        return jsonify({
            "success": False,
            "data": None,
            "error": "Evaluation Version not found",
        }), 404


# ---------------------------------------------------------------------------
# Write endpoints (admin only)
# ---------------------------------------------------------------------------


@evaluation_versions_bp.route("/drafts", methods=["POST"])
@require_admin
def create_draft():
    """Create a new draft from the active published Version."""
    body = request.get_json(silent=True) or {}
    parent_id = body.get("parent_id")

    if parent_id:
        uuid_err = _validate_uuid(parent_id, "parent_id")
        if uuid_err:
            return jsonify({"success": False, "data": None, "error": uuid_err}), 400

    try:
        draft = repo.create_draft_from_published(parent_id)
        return jsonify({
            "success": True,
            "data": _version_dict(draft),
            "error": None,
        }), 201
    except ValueError as exc:
        code = str(exc)
        status = 409 if code == "draft_already_exists" else 400
        return jsonify({
            "success": False,
            "data": None,
            "error": code,
        }), status


@evaluation_versions_bp.route("/drafts/<draft_id>", methods=["PATCH"])
@require_admin
def patch_draft(draft_id: str):
    """Apply JSON-Patch operations to a draft's payload."""
    uuid_err = _validate_uuid(draft_id, "draft_id")
    if uuid_err:
        return jsonify({"success": False, "data": None, "error": uuid_err}), 400

    body = request.get_json(silent=True) or {}
    patch = body.get("patch", [])
    if not patch:
        return jsonify({
            "success": False,
            "data": None,
            "error": "patch_required",
        }), 400

    try:
        updated = repo.patch_draft(draft_id, patch)
        return jsonify({
            "success": True,
            "data": _version_dict(updated),
            "error": None,
        })
    except ValueError as exc:
        return jsonify({
            "success": False,
            "data": None,
            "error": str(exc),
        }), 400


@evaluation_versions_bp.route("/drafts/<draft_id>/validate", methods=["POST"])
@require_admin
def validate_draft(draft_id: str):
    """Run the publish gate on a draft. Does not mutate."""
    uuid_err = _validate_uuid(draft_id, "draft_id")
    if uuid_err:
        return jsonify({"success": False, "data": None, "error": uuid_err}), 400

    body = request.get_json(silent=True) or {}
    changelog_note = body.get("changelog_note")

    version = repo.get_version(draft_id)
    if version.status != "draft":
        return jsonify({
            "success": False,
            "data": None,
            "error": "can_only_validate_draft",
        }), 400

    violations = validator.validate(version.payload, changelog_note)

    return jsonify({
        "success": True,
        "data": {
            "ok": len(violations) == 0,
            "violations": [dataclasses.asdict(v) for v in violations],
        },
        "error": None,
    })


@evaluation_versions_bp.route("/drafts/<draft_id>/publish", methods=["POST"])
@require_admin
def publish_draft(draft_id: str):
    """Validate and atomically publish a draft."""
    uuid_err = _validate_uuid(draft_id, "draft_id")
    if uuid_err:
        return jsonify({"success": False, "data": None, "error": uuid_err}), 400

    body = request.get_json(silent=True) or {}
    slug = body.get("slug", "")
    changelog_note = body.get("changelog_note", "")

    # Slug format validation
    if not SLUG_PATTERN.match(slug):
        return jsonify({
            "success": False,
            "data": None,
            "error": f"slug must match ^cohesion-[a-z0-9-]+$, got '{slug}'",
        }), 400

    # Changelog length cap
    if len(changelog_note) > MAX_CHANGELOG_LENGTH:
        return jsonify({
            "success": False,
            "data": None,
            "error": f"changelog_note exceeds {MAX_CHANGELOG_LENGTH} characters",
        }), 400

    # Run publish gate
    version = repo.get_version(draft_id)
    violations = validator.validate(version.payload, changelog_note)
    if violations:
        return jsonify({
            "success": False,
            "data": {
                "ok": False,
                "violations": [dataclasses.asdict(v) for v in violations],
            },
            "error": "publish_gate_failed",
        }), 422

    try:
        published = repo.publish_draft(draft_id, slug, changelog_note)
        return jsonify({
            "success": True,
            "data": _version_dict(published),
            "error": None,
        })
    except Exception:
        logger.exception("Failed to publish draft")
        return jsonify({
            "success": False,
            "data": None,
            "error": "Failed to publish draft",
        }), 500


@evaluation_versions_bp.route("/drafts/<draft_id>", methods=["DELETE"])
@require_admin
def discard_draft(draft_id: str):
    """Hard-delete a draft Version."""
    uuid_err = _validate_uuid(draft_id, "draft_id")
    if uuid_err:
        return jsonify({"success": False, "data": None, "error": uuid_err}), 400

    try:
        repo.discard_draft(draft_id)
        return jsonify({
            "success": True,
            "data": None,
            "error": None,
        })
    except ValueError:
        return jsonify({
            "success": False,
            "data": None,
            "error": "draft_not_found",
        }), 404
