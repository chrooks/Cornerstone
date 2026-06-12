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

from api.auth import is_admin_request, require_admin
from services.cohesion_engine.engine import CohesionEngine
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
    """Serialize an EvaluationVersion to a JSON-safe dict.

    Includes `changelog_note` and `published_at` so the public changelog Surface
    (issue #18) can display the publish event without a second fetch.
    """
    return {
        "id": v.id,
        "slug": v.slug,
        "status": v.status,
        "payload": v.payload,
        "changelog_note": v.changelog_note,
        "published_at": v.published_at,
    }


def _public_payload_projection(payload: dict) -> dict:
    """
    Strip an Evaluation Version payload down to fields safe to expose to
    unauthenticated callers. The public Builder reads `values.tier_values`
    (skill→numeric mapping), `values.theoretical_max` (per-trait normalization
    ceilings), and `taxonomy.subscore_tree` (Impact Trait → Lineup Subscore
    mapping). Everything else — formulas, coefficients, weights, full taxonomy
    metadata — stays admin-only.
    """
    values = payload.get("values") or {}
    taxonomy = payload.get("taxonomy") or {}
    return {
        "values": {
            "tier_values": values.get("tier_values", {}),
            "theoretical_max": values.get("theoretical_max", {}),
        },
        "taxonomy": {
            "subscore_tree": taxonomy.get("subscore_tree", []),
        },
    }


def _public_version_dict(v) -> dict:
    """Serialize an EvaluationVersion with payload stripped for public callers."""
    return {
        "id": v.id,
        "slug": v.slug,
        "status": v.status,
        "payload": _public_payload_projection(v.payload),
    }


def _validate_uuid(value: str, label: str = "id") -> str | None:
    """Return None if valid UUID, or error message."""
    try:
        UUID(value)
        return None
    except (ValueError, AttributeError):
        return f"Invalid {label}: {value}"


# ---------------------------------------------------------------------------
# Read endpoints
#
# `list` and `draft` are admin-only — they expose the full engine config
# (composite formulas, coefficients, weights, full taxonomy) which is internal
# IP and a probing surface for crafted-input attacks against the scoring model.
#
# `active` stays public but serves a stripped projection (tier_values,
# theoretical_max, subscore_tree only) so the unauthenticated Builder can still
# normalize Impact Traits. Admin callers with a valid Bearer token receive the
# full payload for calibration surfaces.
# ---------------------------------------------------------------------------


@evaluation_versions_bp.route("", methods=["GET"])
@require_admin
def list_versions():
    """List all Evaluation Versions, newest first (admin only)."""
    versions = repo.list_versions()
    return jsonify({
        "success": True,
        "data": [_version_dict(v) for v in versions],
        "error": None,
    })


@evaluation_versions_bp.route("/active", methods=["GET"])
def get_active():
    """
    Return the currently active Evaluation Version.

    Public callers receive a stripped payload safe for the Builder. Admin
    callers (valid Bearer token + admin role) receive the full payload.
    """
    try:
        version = repo.get_active()
        serialized = _version_dict(version) if is_admin_request() else _public_version_dict(version)
        return jsonify({
            "success": True,
            "data": serialized,
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
@require_admin
def get_draft():
    """Return the current draft Evaluation Version, or null (admin only)."""
    draft = repo.get_draft()
    return jsonify({
        "success": True,
        "data": _version_dict(draft) if draft else None,
        "error": None,
    })


@evaluation_versions_bp.route("/handlers", methods=["GET"])
@require_admin
def list_handlers():
    """Return registered Formula Handler names and descriptions."""
    handlers = CohesionEngine.registered_handlers()
    data = [
        {
            "name": name,
            "description": (fn.__doc__ or "").strip().split("\n")[0] or name,
        }
        for name, fn in sorted(handlers.items())
    ]
    return jsonify({"success": True, "data": data, "error": None})


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
    blocking = [v for v in violations if v.severity == "error"]
    if blocking:
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


@evaluation_versions_bp.route("/<version_id>/reactivate", methods=["POST"])
@require_admin
def reactivate_version(version_id: str):
    """Atomically reactivate a previously published Evaluation Version."""
    uuid_err = _validate_uuid(version_id, "version_id")
    if uuid_err:
        return jsonify({"success": False, "data": None, "error": uuid_err}), 400

    try:
        version = repo.reactivate(version_id)
        return jsonify({
            "success": True,
            "data": _version_dict(version),
            "error": None,
        })
    except ValueError as exc:
        return jsonify({
            "success": False,
            "data": None,
            "error": str(exc),
        }), 400


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
