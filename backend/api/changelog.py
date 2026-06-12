"""
api/changelog.py — public changelog read endpoint (issue #18).

Surfaces published RuleSet Version and Evaluation Version events as a single
newest-first feed for the landing page. The feed auto-updates whenever a new
version is published — there is no hardcoded list anywhere.

Blueprint prefix: /api
This endpoint is public (no auth). It reads only published version metadata.
"""

from __future__ import annotations

import logging
from typing import Any

from flask import Blueprint, jsonify, request

from services.changelog.assembler import DEFAULT_LIMIT, assemble_changelog
from services.supabase_client import get_supabase, run_query

logger = logging.getLogger(__name__)

changelog_bp = Blueprint("changelog", __name__, url_prefix="/api")

# Hard ceiling so a crafted ?limit= can't ask the DB for an unbounded page.
MAX_LIMIT = 50


def _fetch_published_ruleset_versions() -> list[dict[str, Any]]:
    """Return every RuleSet Version that was ever published, with its name/slug.

    Filters on `published_at IS NOT NULL` rather than current status: publishing
    a new RuleSet Version *retires* the prior one, but that retired row is still
    a real publish event and belongs in the changelog history. Fetched in two
    cheap reads (versions + rulesets) and joined in Python so the query does not
    depend on PostgREST FK-embed naming.
    """
    supabase = get_supabase()

    versions = run_query(
        lambda: supabase.table("ruleset_versions")
        .select("ruleset_id, version_label, published_at")
        .not_.is_("published_at", "null")
        .order("published_at", desc=True)
        .execute()
    ).data or []

    if not versions:
        return []

    rulesets = run_query(
        lambda: supabase.table("rulesets")
        .select("id, name, slug")
        .execute()
    ).data or []
    by_id = {r["id"]: r for r in rulesets}

    rows: list[dict[str, Any]] = []
    for v in versions:
        parent = by_id.get(v.get("ruleset_id")) or {}
        rows.append({
            "version_label": v.get("version_label"),
            "published_at": v.get("published_at"),
            "ruleset_name": parent.get("name"),
            "ruleset_slug": parent.get("slug"),
        })
    return rows


def _fetch_published_evaluation_versions() -> list[dict[str, Any]]:
    """Return published Evaluation Version rows (slug, note, published_at)."""
    supabase = get_supabase()
    rows = run_query(
        lambda: supabase.table("evaluation_versions")
        .select("slug, changelog_note, published_at")
        .eq("status", "published")
        .order("published_at", desc=True)
        .execute()
    ).data or []
    return rows


def _parse_limit(raw: str | None) -> int:
    """Clamp the optional ?limit= query param into a safe range."""
    if raw is None:
        return DEFAULT_LIMIT
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_LIMIT
    if value < 1:
        return DEFAULT_LIMIT
    return min(value, MAX_LIMIT)


@changelog_bp.route("/changelog", methods=["GET"])
def get_changelog():
    """Return the public changelog feed, newest first."""
    limit = _parse_limit(request.args.get("limit"))
    try:
        ruleset_rows = _fetch_published_ruleset_versions()
        eval_rows = _fetch_published_evaluation_versions()
        entries = assemble_changelog(ruleset_rows, eval_rows, limit=limit)
        return jsonify({
            "success": True,
            "data": entries,
            "error": None,
        })
    except Exception:
        logger.exception("Failed to assemble public changelog")
        return jsonify({
            "success": False,
            "data": None,
            "error": "Failed to load changelog",
        }), 500
