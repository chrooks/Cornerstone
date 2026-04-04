"""
api/rosters.py — Roster persistence endpoints for the Cornerstone team builder.

Each roster belongs to one legend (the cornerstone) and holds up to 8 slots:
  Slot 1  → the cornerstone row (is_cornerstone=true, player_id=null, salary=$54M)
  Slots 2-8 → supporting players (is_cornerstone=false, player_id required)

Endpoints:
  POST   /api/rosters                            — create roster + cornerstone slot
  GET    /api/rosters?legend_id=<uuid>           — list rosters for a legend
  GET    /api/rosters/<roster_id>                — single roster with full detail
  PUT    /api/rosters/<roster_id>/players        — add or replace a supporting player
  DELETE /api/rosters/<roster_id>/players/<slot> — remove a supporting player
"""

import logging
import uuid as _uuid_mod
from typing import Any

from flask import Blueprint, jsonify, request

from services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

rosters_bp = Blueprint("rosters", __name__, url_prefix="/api")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Cornerstone slot is always slot 1; cap hit is fixed at $54M
_CORNERSTONE_SLOT = 1
_CORNERSTONE_SALARY = 54_000_000

# Maximum total slots per roster (1 cornerstone + 7 supporting)
_MAX_SLOTS = 8


# ---------------------------------------------------------------------------
# Response helpers
# ---------------------------------------------------------------------------


def _ok(data: Any, status: int = 200) -> tuple:
    """Standard success envelope."""
    return jsonify({"success": True, "data": data, "error": None}), status


def _err(msg: str, status: int = 500) -> tuple:
    """Standard error envelope."""
    return jsonify({"success": False, "data": None, "error": msg}), status


def _validate_uuid(value: str) -> bool:
    """Return True if value is a valid UUID string."""
    try:
        _uuid_mod.UUID(value)
        return True
    except (ValueError, AttributeError):
        return False


# ---------------------------------------------------------------------------
# Internal data helpers
# ---------------------------------------------------------------------------


def _fetch_roster_with_players(supabase, roster_id: str) -> dict | None:
    """
    Fetch a roster row and its full roster_players array, enriched with
    player/legend identity details.

    Cornerstone rows (is_cornerstone=true) are joined to the legends table
    for name/position because legends are not rows in the players table.
    Supporting rows are joined to the players table for name/team/position.

    Returns None if the roster does not exist.
    """
    # --- roster metadata ---
    roster_res = (
        supabase.table("rosters")
        .select("id, legend_id, name, total_budget, created_at, updated_at")
        .eq("id", roster_id)
        .limit(1)
        .execute()
    )
    if not roster_res.data:
        return None
    roster = roster_res.data[0]

    # --- all slots for this roster, ordered by slot number ---
    rp_res = (
        supabase.table("roster_players")
        .select("id, roster_id, player_id, is_cornerstone, slot, salary_snapshot, created_at")
        .eq("roster_id", roster_id)
        .order("slot")
        .execute()
    )
    roster_players: list[dict] = rp_res.data or []

    # --- fetch legend name for the cornerstone row ---
    # We always need the legend regardless of whether a cornerstone row exists yet,
    # so we fetch once using the roster's legend_id FK.
    legend_map: dict[str, dict] = {}
    legend_res = (
        supabase.table("legends")
        .select("id, name")
        .eq("id", roster["legend_id"])
        .limit(1)
        .execute()
    )
    if legend_res.data:
        leg = legend_res.data[0]
        legend_map[leg["id"]] = leg

    # --- fetch player details for supporting rows in a single query ---
    player_ids = [
        rp["player_id"]
        for rp in roster_players
        if not rp["is_cornerstone"] and rp["player_id"]
    ]
    player_map: dict[str, dict] = {}
    if player_ids:
        players_res = (
            supabase.table("players")
            .select("id, name, team, position")
            .in_("id", player_ids)
            .execute()
        )
        for p in (players_res.data or []):
            player_map[p["id"]] = p

    # --- enrich each roster_player row with identity fields ---
    enriched: list[dict] = []
    for rp in roster_players:
        row: dict = {
            "id":              rp["id"],
            "roster_id":       rp["roster_id"],
            "player_id":       rp["player_id"],
            "is_cornerstone":  rp["is_cornerstone"],
            "slot":            rp["slot"],
            "salary_snapshot": rp["salary_snapshot"],
            "created_at":      rp["created_at"],
        }

        if rp["is_cornerstone"]:
            # Source of truth for cornerstone identity is the legends table,
            # NOT the players table — the legend has no player_id FK.
            legend = legend_map.get(roster["legend_id"], {})
            row["name"]     = legend.get("name")
            row["team"]     = None   # legends have no current team
            row["position"] = None   # legends table has no position column
        else:
            # Supporting player — join to players table
            player = player_map.get(rp["player_id"] or "", {})
            row["name"]     = player.get("name")
            row["team"]     = player.get("team")
            row["position"] = player.get("position")

        enriched.append(row)

    return {
        "id":           roster["id"],
        "legend_id":    roster["legend_id"],
        "name":         roster["name"],
        "total_budget": roster["total_budget"],
        "created_at":   roster["created_at"],
        "updated_at":   roster["updated_at"],
        "roster_players": enriched,
    }


# ---------------------------------------------------------------------------
# POST /api/rosters
# ---------------------------------------------------------------------------


@rosters_bp.route("/rosters", methods=["POST"])
def create_roster():
    """
    Create a new roster and insert the cornerstone slot automatically.

    Request body:
      { "legend_id": "<uuid>", "name": "<string>", "total_budget": <int> }

    The cornerstone row is inserted as:
      { roster_id, player_id: null, is_cornerstone: true,
        slot: 1, salary_snapshot: 54_000_000 }

    Returns the full roster object including the cornerstone row.
    """
    body = request.get_json(silent=True) or {}

    legend_id    = body.get("legend_id", "")
    name         = body.get("name", "")
    total_budget = body.get("total_budget")

    # Input validation
    if not _validate_uuid(legend_id):
        return _err("legend_id must be a valid UUID", status=400)
    if not isinstance(name, str) or not name.strip():
        return _err("name is required and must be a non-empty string", status=400)
    if not isinstance(total_budget, int) or total_budget <= 0:
        return _err("total_budget must be a positive integer (dollars)", status=400)

    try:
        supabase = get_supabase()

        # Verify the legend exists before creating a dangling roster
        legend_res = (
            supabase.table("legends")
            .select("id")
            .eq("id", legend_id)
            .limit(1)
            .execute()
        )
        if not legend_res.data:
            return _err(f"Legend {legend_id} not found", status=404)

        # Insert the roster row
        roster_insert = (
            supabase.table("rosters")
            .insert({
                "legend_id":    legend_id,
                "name":         name.strip(),
                "total_budget": total_budget,
            })
            .execute()
        )
        new_roster_id = roster_insert.data[0]["id"]

        # Insert the mandatory cornerstone slot (slot 1, salary=$54M, player_id=null)
        (
            supabase.table("roster_players")
            .insert({
                "roster_id":       new_roster_id,
                "player_id":       None,
                "is_cornerstone":  True,
                "slot":            _CORNERSTONE_SLOT,
                "salary_snapshot": _CORNERSTONE_SALARY,
            })
            .execute()
        )

        # Return the full roster with the cornerstone row included
        roster_data = _fetch_roster_with_players(supabase, new_roster_id)
        return _ok(roster_data, status=201)

    except Exception:
        logger.exception("Error in POST /api/rosters")
        return _err("Internal server error")


# ---------------------------------------------------------------------------
# GET /api/rosters
# ---------------------------------------------------------------------------


@rosters_bp.route("/rosters", methods=["GET"])
def list_rosters():
    """
    Return all rosters for a given legend, newest first.

    Query param: ?legend_id=<uuid>

    Each roster includes its full roster_players array joined with player/legend
    identity details (see _fetch_roster_with_players for join logic).
    """
    legend_id = request.args.get("legend_id", "")
    if not _validate_uuid(legend_id):
        return _err("legend_id query param must be a valid UUID", status=400)

    try:
        supabase = get_supabase()

        # Fetch all roster IDs for this legend, newest first
        rosters_res = (
            supabase.table("rosters")
            .select("id")
            .eq("legend_id", legend_id)
            .order("created_at", desc=True)
            .execute()
        )
        roster_rows = rosters_res.data or []

        # Enrich each roster with its players (separate fetch per roster)
        result = []
        for row in roster_rows:
            enriched = _fetch_roster_with_players(supabase, row["id"])
            if enriched:
                result.append(enriched)

        return _ok(result)

    except Exception:
        logger.exception("Error in GET /api/rosters?legend_id=%s", legend_id)
        return _err("Internal server error")


# ---------------------------------------------------------------------------
# GET /api/rosters/<roster_id>
# ---------------------------------------------------------------------------


@rosters_bp.route("/rosters/<roster_id>", methods=["GET"])
def get_roster(roster_id: str):
    """
    Return a single roster with full roster_players detail.

    Same shape as each item in the list endpoint.
    """
    if not _validate_uuid(roster_id):
        return _err("Invalid roster_id — must be a UUID", status=400)

    try:
        supabase = get_supabase()
        roster_data = _fetch_roster_with_players(supabase, roster_id)
        if roster_data is None:
            return _err(f"Roster {roster_id} not found", status=404)
        return _ok(roster_data)

    except Exception:
        logger.exception("Error in GET /api/rosters/%s", roster_id)
        return _err("Internal server error")


# ---------------------------------------------------------------------------
# PUT /api/rosters/<roster_id>/players
# ---------------------------------------------------------------------------


@rosters_bp.route("/rosters/<roster_id>/players", methods=["PUT"])
def upsert_roster_player(roster_id: str):
    """
    Add or replace a supporting player in a specific slot.

    Request body:
      { "player_id": "<uuid>", "slot": <int 2-8>, "salary_snapshot": <int> }

    Rules enforced:
      - Slot 1 is reserved for the cornerstone and cannot be assigned here.
      - Adding this player must not push the total salary over total_budget.
      - The roster cannot exceed 8 filled slots (1 cornerstone + 7 supporting).
      - The same player cannot appear twice on the same roster.

    When the requested slot is already occupied, the existing player is replaced
    (removed first, then the new row is inserted). Budget math accounts for the
    outgoing player's salary before checking headroom.

    Returns the updated roster.
    """
    if not _validate_uuid(roster_id):
        return _err("Invalid roster_id — must be a UUID", status=400)

    body = request.get_json(silent=True) or {}

    player_id       = body.get("player_id", "")
    slot            = body.get("slot")
    salary_snapshot = body.get("salary_snapshot")

    # Input validation
    if not _validate_uuid(player_id):
        return _err("player_id must be a valid UUID", status=400)
    if not isinstance(slot, int):
        return _err("slot must be an integer", status=400)
    if slot == _CORNERSTONE_SLOT:
        return _err("Slot 1 is reserved for the cornerstone and cannot be modified here", status=400)
    if slot < 1 or slot > _MAX_SLOTS:
        return _err(f"slot must be between 1 and {_MAX_SLOTS}", status=400)
    if not isinstance(salary_snapshot, int) or salary_snapshot < 0:
        return _err("salary_snapshot must be a non-negative integer (dollars)", status=400)

    try:
        supabase = get_supabase()

        # Verify roster exists and fetch total_budget
        roster_res = (
            supabase.table("rosters")
            .select("id, total_budget")
            .eq("id", roster_id)
            .limit(1)
            .execute()
        )
        if not roster_res.data:
            return _err(f"Roster {roster_id} not found", status=404)
        total_budget: int = roster_res.data[0]["total_budget"]

        # Fetch all current roster_player rows for budget + cap calculations
        existing_res = (
            supabase.table("roster_players")
            .select("id, player_id, slot, salary_snapshot, is_cornerstone")
            .eq("roster_id", roster_id)
            .execute()
        )
        existing_rows: list[dict] = existing_res.data or []

        # Check whether this player is already on the roster (duplicate guard)
        # We exclude the slot being replaced — replacing A with A is fine.
        for row in existing_rows:
            if row["player_id"] == player_id and row["slot"] != slot:
                return _err(
                    "This player is already on the roster in a different slot",
                    status=400,
                )

        # Identify the row currently occupying the target slot (may be None)
        slot_occupant = next((r for r in existing_rows if r["slot"] == slot), None)

        # Check 8-slot cap: only matters when adding to an *empty* slot
        if slot_occupant is None:
            filled_slots = len(existing_rows)
            if filled_slots >= _MAX_SLOTS:
                return _err(
                    f"Roster is full — cannot exceed {_MAX_SLOTS} slots (1 cornerstone + 7 supporting)",
                    status=400,
                )

        # Budget check: sum all current salaries, subtract outgoing player's salary
        # if we're replacing, then add the incoming salary.
        current_total = sum(r["salary_snapshot"] for r in existing_rows)
        outgoing_salary = slot_occupant["salary_snapshot"] if slot_occupant else 0
        projected_total = current_total - outgoing_salary + salary_snapshot

        if projected_total > total_budget:
            remaining = total_budget - (current_total - outgoing_salary)
            return _err(
                f"Adding this player (${salary_snapshot:,}) exceeds the cap. "
                f"Available cap space: ${remaining:,}",
                status=400,
            )

        # Remove the existing occupant from the target slot (if any) before inserting
        if slot_occupant:
            (
                supabase.table("roster_players")
                .delete()
                .eq("id", slot_occupant["id"])
                .execute()
            )

        # Insert the new supporting player row
        (
            supabase.table("roster_players")
            .insert({
                "roster_id":       roster_id,
                "player_id":       player_id,
                "is_cornerstone":  False,
                "slot":            slot,
                "salary_snapshot": salary_snapshot,
            })
            .execute()
        )

        # Return the full updated roster
        roster_data = _fetch_roster_with_players(supabase, roster_id)
        return _ok(roster_data)

    except Exception:
        logger.exception("Error in PUT /api/rosters/%s/players", roster_id)
        return _err("Internal server error")


# ---------------------------------------------------------------------------
# DELETE /api/rosters/<roster_id>/players/<slot>
# ---------------------------------------------------------------------------


@rosters_bp.route("/rosters/<roster_id>/players/<int:slot>", methods=["DELETE"])
def remove_roster_player(roster_id: str, slot: int):
    """
    Remove the supporting player in the given slot.

    Slot 1 (cornerstone) cannot be deleted — reject with 400.

    Returns the updated roster.
    """
    if not _validate_uuid(roster_id):
        return _err("Invalid roster_id — must be a UUID", status=400)
    if slot == _CORNERSTONE_SLOT:
        return _err("The cornerstone slot (slot 1) cannot be removed", status=400)

    try:
        supabase = get_supabase()

        # Verify roster exists
        roster_res = (
            supabase.table("rosters")
            .select("id")
            .eq("id", roster_id)
            .limit(1)
            .execute()
        )
        if not roster_res.data:
            return _err(f"Roster {roster_id} not found", status=404)

        # Find the row occupying this slot
        slot_res = (
            supabase.table("roster_players")
            .select("id, is_cornerstone")
            .eq("roster_id", roster_id)
            .eq("slot", slot)
            .limit(1)
            .execute()
        )
        if not slot_res.data:
            return _err(f"No player found in slot {slot}", status=404)

        # Defensive check — should not happen given slot 1 guard above,
        # but we never want to silently delete the cornerstone row.
        if slot_res.data[0]["is_cornerstone"]:
            return _err("Cannot delete the cornerstone slot", status=400)

        # Delete the slot row
        (
            supabase.table("roster_players")
            .delete()
            .eq("id", slot_res.data[0]["id"])
            .execute()
        )

        # Return the full updated roster
        roster_data = _fetch_roster_with_players(supabase, roster_id)
        return _ok(roster_data)

    except Exception:
        logger.exception(
            "Error in DELETE /api/rosters/%s/players/%d", roster_id, slot
        )
        return _err("Internal server error")
