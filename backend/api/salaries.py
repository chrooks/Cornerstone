"""
api/salaries.py — Bulk salary scraping route.

Endpoint:
  GET /api/salaries/bulk    — scrape ESPN and upsert salary data into Supabase

All responses use the standard envelope: {success, data, error}.
"""

import logging

from flask import Blueprint, jsonify, request

from services.supabase_client import get_supabase
from services import players_service

logger = logging.getLogger(__name__)

salaries_bp = Blueprint("salaries", __name__, url_prefix="/api")


def _ok(data) -> tuple:
    return jsonify({"success": True, "data": data, "error": None}), 200


def _err(message: str, status: int = 500) -> tuple:
    return jsonify({"success": False, "data": None, "error": message}), status


# ---------------------------------------------------------------------------
# GET /api/salaries/bulk
# ---------------------------------------------------------------------------

@salaries_bp.route("/salaries/bulk", methods=["GET"])
def bulk_salaries():
    """
    Scrape salary data from ESPN and upsert into the Supabase players table.

    Query params:
      ?team=LAL   (optional — scrape only one team's roster page)
                  If omitted, scrapes the full league via paginated salary listing.
                  This takes ~30-45 seconds for a full league sweep.

    Returns:
      { matched: int, unmatched: int, total: int }

    'matched' = players whose ESPN salary was matched to a Supabase record.
    'unmatched' = players in Supabase who had no ESPN match (may be below MPG threshold
                  or have name mismatches requiring manual review).
    """
    team_abbrev = request.args.get("team")  # e.g. "LAL", "BOS"

    try:
        supabase = get_supabase()
        result = players_service.run_bulk_salary_scrape(team_abbrev, supabase)
        return _ok(result)
    except Exception as exc:
        logger.exception("Error in GET /api/salaries/bulk")
        return _err(str(exc))
