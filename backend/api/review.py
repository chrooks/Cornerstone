"""
api/review.py — Review queue and flag resolution endpoints.

Endpoints:
  GET  /api/review/queue                    — filterable list of players with unresolved flags
  GET  /api/review/<player_id>/flags        — all flags + profiles for a single player
  POST /api/review/<player_id>/resolve      — resolve a single skill flag
  POST /api/review/bulk-resolve             — resolve open flags across players, optionally one Skill

All responses use the standard {success, data, error} envelope.
"""

import logging
import uuid as _uuid_mod
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from api.auth import require_admin, require_open_draft
from services.supabase_client import get_supabase, in_chunks, paged_rows, run_query
from services.players_service import CURRENT_SEASON
from services.skill_engine.cache import get_thresholds, get_league_averages
from services.skill_engine.evaluator import collect_condition_results
from services.skills import ALL_SKILLS, HIGH_CONFIDENCE_SKILLS, NO_BULK_TRUST_STATS_SKILLS

logger = logging.getLogger(__name__)

review_bp = Blueprint("review", __name__, url_prefix="/api")

# Valid tier values for resolved_value on manual_override
_VALID_TIERS = {"None", "Capable", "Proficient", "Elite", "All-Time Great"}

# Valid resolution choices
_VALID_RESOLUTIONS = {"trust_stats", "trust_claude", "manual_override"}

# Most players a single bulk-resolve call may touch.
_BULK_PLAYER_CAP = 600

# The Skills a negative archetype label reads (D21). Derived from the live
# taxonomy, so the #152 split (perimeter_disruptor → point_of_attack_defender +
# off_ball_disruptor) needs no edit here.
_CORE_DEFENSIVE_SKILLS: tuple[str, ...] = tuple(
    s for s in (
        "point_of_attack_defender",
        "off_ball_disruptor",
        "perimeter_disruptor",
        "versatile_defender",
        "rim_protector",
    )
    if s in ALL_SKILLS
)


def _ok(data) -> tuple:
    """Standard success envelope."""
    return jsonify({"success": True, "data": data, "error": None}), 200


def _err(msg: str, status: int = 400) -> tuple:
    """Standard error envelope."""
    return jsonify({"success": False, "data": None, "error": msg}), status


def _validate_uuid(val: str) -> bool:
    """Return True if val is a valid UUID string."""
    try:
        _uuid_mod.UUID(val)
        return True
    except (ValueError, AttributeError):
        return False


def _claude_tier(skill_name: str, flag: dict, profile_data: dict) -> str | None:
    """Return Claude's tier for a flagged Skill, or None when Claude has none.

    A flag's `claude_rating` is NOT NULL: the commit RPC writes
    `COALESCE(claude_tier, 'None')`, so a HIGH Skill (Claude is never asked) or
    a failed Claude call stores the string 'None'. Trusting that string would
    write a false "reviewed None" over a real stats tier (#154). So the answer
    comes from the Skill's confidence bucket and the composite entry's
    `claude_tier`, not from the flag's string alone. A missing or malformed
    entry fails closed (None): the flag's 'None' could still be the placeholder.
    """
    if skill_name in HIGH_CONFIDENCE_SKILLS:
        return None
    entry = profile_data.get(skill_name)
    if not isinstance(entry, dict) or entry.get("claude_tier") is None:
        return None
    return flag.get("claude_rating")


def _is_agreement(flag: dict, profile_data: dict) -> bool:
    """True when the bulk resolve would write this flag under `agreements_only`.

    The count and the click must read one authority, or a button promises work
    the server refuses (or hides work it would do). So this asks the same two
    questions `bulk_resolve` asks: does `_claude_tier` give a tier from the
    composite entry, and does it equal the stat tier? 'None' is a real tier —
    the entry's `claude_tier`, not the flag's string, tells the two apart.
    """
    sname = flag.get("skill_name")
    if _claude_tier(sname, flag, profile_data) is None:
        return False
    if _is_human_decision(flag, profile_data.get(sname)):
        return False
    return flag.get("claude_rating") == flag.get("stat_rating")


def _is_human_decision(flag: dict, entry) -> bool:
    """True when a person decided this Skill and a bulk action must not redo it.

    Two records say so, and either one is enough:
      - the composite entry's `human_reviewed` marker (D21), written by
        `resolve_flag` and `manual_override_skill` and dropped by a bulk;
      - a `human_decision_contradicted` flag_reason, which the #120 recompute
        guard raises over an entry it refused to overwrite.

    `source` is deliberately NOT part of the test: a bulk writes
    `source="resolved"` too, so gating on it would freeze the league after one
    bulk pass, and a fresh profile is born `source="manual_override"`.
    """
    if str(flag.get("flag_reason") or "").startswith("human_decision_contradicted"):
        return True
    return isinstance(entry, dict) and bool(entry.get("human_reviewed"))


def _open_flag_query(supabase, profile_ids, skill_name: str, columns: str):
    """Unresolved flags for a chunk of composite profiles, optionally one Skill."""
    q = (
        supabase.table("draft_skill_flags")
        .select(columns)
        .in_("skill_profile_id", profile_ids)
        .is_("resolution", "null")
    )
    return q.eq("skill_name", skill_name) if skill_name else q


def _is_negative_candidate(profile_data: dict) -> bool:
    """True when the draft composite reads 'None' on every core defensive Skill.

    D21: such a player can drive a negative archetype label, so Chris resolves
    his 'None' flags one at a time — a bulk action must not decide them.
    """
    if not _CORE_DEFENSIVE_SKILLS:
        return False
    for skill in _CORE_DEFENSIVE_SKILLS:
        entry = profile_data.get(skill)
        tier = entry.get("final_tier") if isinstance(entry, dict) else entry
        if tier != "None":
            return False
    return True


# ---------------------------------------------------------------------------
# GET /api/review/queue
# ---------------------------------------------------------------------------


@review_bp.route("/review/queue", methods=["GET"])
def review_queue():
    """
    Return a list of players with at least one unresolved skill flag.

    Results are grouped by player — each entry summarizes the player's
    unresolved flags without listing them individually.

    Query params:
      ?season=2025-26      (default: current season)
      ?search=name         (case-insensitive player name search)
      ?team=BOS            (filter by team abbreviation)
      ?position=F          (filter by position, partial match)
      ?flag_reason=...     (filter by flag_reason value)
      ?skill_name=high_flyer  (only players with an open flag on that Skill;
                               each entry then also carries agreement_count)

    Response data: list of {
      player_id, player_name, team, position,
      unresolved_flag_count, flag_reasons: str[],
      agreement_count?: int    // only when ?skill_name= is set
    }
    """
    season      = request.args.get("season", CURRENT_SEASON)
    search      = request.args.get("search", "").strip()
    team_filter = request.args.get("team", "").strip()
    pos_filter  = request.args.get("position", "").strip()
    reason_filter = request.args.get("flag_reason", "").strip()
    skill_filter  = request.args.get("skill_name", "").strip()

    try:
        supabase = get_supabase()

        # Step 1: Get composite profiles for this season. The JSONB comes along
        # only for a Skill-filtered queue, which is the only caller that counts
        # agreements — and the count has to read the same entry the write does.
        composite_profiles = run_query(lambda: (
            supabase.table("draft_skill_profiles")
            .select("id, player_id, profile" if skill_filter else "id, player_id")
            .eq("season", season)
            .eq("source", "composite")
            .execute()
        ))
        composite_profile_map: dict[str, str] = {
            r["id"]: r["player_id"]
            for r in (composite_profiles.data or [])
        }
        profile_data_by_id: dict[str, dict] = {
            r["id"]: (r.get("profile") or {})
            for r in (composite_profiles.data or [])
        } if skill_filter else {}
        composite_ids = list(composite_profile_map.keys())

        if not composite_ids:
            return _ok([])

        # Step 2: Get all unresolved flags for those profiles (one query per chunk)
        all_unresolved: list[dict] = []
        for chunk in in_chunks(composite_ids):
            # Default arg captures chunk value so the lambda closure is correct
            rows = run_query(lambda c=chunk: (
                _open_flag_query(
                    supabase, c, skill_filter,
                    "id, skill_profile_id, skill_name, flag_reason, "
                    "stat_rating, claude_rating",
                ).execute()
            ))
            all_unresolved.extend(rows.data or [])

        if not all_unresolved:
            return _ok([])

        # Step 3: Resolve player IDs from profile map, group flags by player
        # { player_id: { "count": int, "reasons": set, "agreements": int } }
        player_flag_info: dict[str, dict] = {}
        for flag in all_unresolved:
            pid = composite_profile_map.get(flag["skill_profile_id"])
            if not pid:
                continue
            if pid not in player_flag_info:
                player_flag_info[pid] = {"count": 0, "reasons": set(), "agreements": 0}
            player_flag_info[pid]["count"] += 1
            if skill_filter and _is_agreement(
                flag, profile_data_by_id.get(flag["skill_profile_id"], {})
            ):
                player_flag_info[pid]["agreements"] += 1
            reason = flag.get("flag_reason")
            if reason:
                player_flag_info[pid]["reasons"].add(reason)

        flagged_player_ids = list(player_flag_info.keys())

        # Step 4: Fetch player metadata for all flagged players.
        # Chunked to avoid URL length limits (same pattern as Step 2).
        # No season filter — players table has one row per player (nba_api_id UNIQUE),
        # so the season column is just the last-fetched season metadata, not a key.
        all_player_rows: list[dict] = []
        for chunk in in_chunks(flagged_player_ids):
            rows = run_query(lambda c=chunk: (
                supabase.table("players")
                .select("id, name, team, position")
                .in_("id", c)
                .execute()
            ))
            all_player_rows.extend(rows.data or [])
        players_by_id: dict[str, dict] = {
            r["id"]: r for r in all_player_rows
        }

        # Step 5: Assemble queue entries and apply filters
        queue = []
        for pid, flag_info in player_flag_info.items():
            player = players_by_id.get(pid)
            if not player:
                continue  # Skip if player row not found (season mismatch)

            # Apply server-side text filters
            if search and search.lower() not in (player.get("name") or "").lower():
                continue
            if team_filter and team_filter.upper() != (player.get("team") or "").upper():
                continue
            if pos_filter and pos_filter.lower() not in (player.get("position") or "").lower():
                continue
            if reason_filter and reason_filter not in flag_info["reasons"]:
                continue

            entry = {
                "player_id":             pid,
                "player_name":           player.get("name"),
                "team":                  player.get("team"),
                "position":              player.get("position"),
                "unresolved_flag_count": flag_info["count"],
                "flag_reasons":          sorted(flag_info["reasons"]),
            }
            if skill_filter:
                entry["agreement_count"] = flag_info["agreements"]
            queue.append(entry)

        # Sort by unresolved count descending, then by name
        queue.sort(key=lambda x: (-x["unresolved_flag_count"], x["player_name"] or ""))

        return _ok(queue)

    except Exception:
        logger.exception("Error in GET /api/review/queue")
        return _err("Internal server error", status=500)


# ---------------------------------------------------------------------------
# GET /api/review/<player_id>/flags
# ---------------------------------------------------------------------------


@review_bp.route("/review/<player_id>/flags", methods=["GET"])
def player_flags(player_id: str):
    """
    Return all skill flags and skill profiles for a single player.

    Provides the full data needed to render the per-player review panel:
    the player's metadata, all of their flags (resolved and unresolved),
    and all three source profiles (stats, claude, composite) for side-by-side
    comparison.

    Path params:
      player_id — Supabase UUID

    Query params:
      ?season=2025-26  (default: current season)

    Response data:
      {
        "player":    { id, name, team, position, age, games_played, minutes_per_game, height, weight },
        "flags":     [ { id, skill_name, stat_rating, claude_rating, flag_reason,
                         stat_values, claude_justification, resolution, resolved_value,
                         resolved_at, notes, has_claude_tier } ],
        "profiles":  { "stats": {skill: tier}, "claude": {skill: tier|null},
                       "composite": {skill: composite_result_dict} }
      }
    """
    if not _validate_uuid(player_id):
        return _err("Invalid player_id — must be a UUID")

    season = request.args.get("season", CURRENT_SEASON)

    try:
        supabase = get_supabase()

        # Fetch player metadata
        player_row = run_query(lambda: (
            supabase.table("players")
            .select("id, name, team, position, age, games_played, minutes_per_game, height, weight, nba_api_id")
            .eq("id", player_id)
            .eq("season", season)
            .limit(1)
            .execute()
        ))
        if not player_row.data:
            return _err(f"Player {player_id} not found for season {season}", status=404)
        player = player_row.data[0]

        # Fetch all three skill profiles for this player+season
        profile_rows = run_query(lambda: (
            supabase.table("draft_skill_profiles")
            .select("id, source, profile")
            .eq("player_id", player_id)
            .eq("season", season)
            .execute()
        ))
        profiles_by_source: dict[str, dict] = {}
        composite_profile_id: str | None = None
        for row in (profile_rows.data or []):
            profiles_by_source[row["source"]] = row["profile"]
            if row["source"] == "composite":
                composite_profile_id = row["id"]

        # Fetch skill flags for the composite profile
        flags: list[dict] = []
        if composite_profile_id:
            flag_rows = run_query(lambda: (
                supabase.table("draft_skill_flags")
                .select(
                    "id, skill_name, stat_rating, claude_rating, flag_reason, "
                    "stat_values, claude_justification, resolution, resolved_value, "
                    "resolved_at, notes"
                )
                .eq("skill_profile_id", composite_profile_id)
                .order("skill_name")
                .execute()
            ))
            flags = flag_rows.data or []
            # The page's stats-only count uses the same rule as the bulk skip (#154).
            composite = profiles_by_source.get("composite") or {}
            flags = [
                {**f, "has_claude_tier": _claude_tier(f["skill_name"], f, composite) is not None}
                for f in flags
            ]

        # Normalize stats/claude profiles to {skill: tier_string} format.
        # The stored profile may have evolved to store full dicts per skill
        # (e.g. {tier, auto_promoted, stat_confidence, ...}), so we extract
        # just the tier string so the frontend always receives a flat map.
        def _extract_tier(val) -> str | None:
            if val is None:
                return None
            if isinstance(val, str):
                return val
            if isinstance(val, dict):
                return val.get("tier") or val.get("final_tier") or "None"
            return "None"

        raw_stats  = profiles_by_source.get("stats", {}) or {}
        raw_claude = profiles_by_source.get("claude", {}) or {}

        normalized_stats  = {k: _extract_tier(v) for k, v in raw_stats.items()}
        normalized_claude = {k: _extract_tier(v) for k, v in raw_claude.items()}

        return _ok({
            "player":   player,
            "flags":    flags,
            "profiles": {
                "stats":     normalized_stats,
                "claude":    normalized_claude,
                "composite": profiles_by_source.get("composite", {}),
            },
        })

    except Exception:
        logger.exception("Error in GET /api/review/%s/flags", player_id)
        return _err("Internal server error", status=500)


# ---------------------------------------------------------------------------
# POST /api/review/<player_id>/resolve
# ---------------------------------------------------------------------------


@review_bp.route("/review/<player_id>/resolve", methods=["POST"])
@require_admin
@require_open_draft
def resolve_flag(player_id: str):
    """
    Resolve a single skill flag for a player.

    After resolution:
    - Updates draft_skill_flags: sets resolution, resolved_value, resolved_at, notes.
    - Updates the composite skill_profile.profile JSONB: final_tier → resolved tier,
      source → "resolved".
    - If ALL flags for this composite profile are now resolved, marks
      draft_skill_profiles.reviewed = true.

    Path params:
      player_id — Supabase UUID

    Request body (JSON):
      {
        "skill_name":     str,                                  // required
        "resolution":     "trust_stats"|"trust_claude"|"manual_override",  // required
        "resolved_value": "None"|"Capable"|"Elite"|null,       // required only for manual_override
        "notes":          str | null,                           // optional
        "season":         "2025-26"                            // optional, default current
      }

    Response data:
      { "flag_id": str, "resolved_tier": str, "all_flags_resolved": bool }

    409 when resolution=trust_claude and the Skill has no Claude tier (#154).
    """
    if not _validate_uuid(player_id):
        return _err("Invalid player_id — must be a UUID")

    body       = request.get_json(silent=True) or {}
    skill_name = body.get("skill_name", "").strip()
    resolution = body.get("resolution", "").strip()
    resolved_value = body.get("resolved_value")
    notes      = body.get("notes")
    season     = body.get("season", CURRENT_SEASON)

    # Input validation
    if not skill_name:
        return _err("'skill_name' is required")
    if resolution not in _VALID_RESOLUTIONS:
        return _err(f"'resolution' must be one of: {', '.join(sorted(_VALID_RESOLUTIONS))}")
    if resolution == "manual_override":
        if resolved_value not in _VALID_TIERS:
            return _err(
                "'resolved_value' must be None/Capable/Proficient/Elite when resolution=manual_override"
            )

    try:
        supabase = get_supabase()

        # Find the composite skill_profile for this player+season
        profile_row = (
            supabase.table("draft_skill_profiles")
            .select("id, profile")
            .eq("player_id", player_id)
            .eq("season", season)
            .eq("source", "composite")
            .limit(1)
            .execute()
        )
        if not profile_row.data:
            return _err(
                f"No composite profile for player {player_id} season {season}", status=404
            )
        profile_id   = profile_row.data[0]["id"]
        profile_data = profile_row.data[0]["profile"] or {}

        # Find the unresolved flag for this skill — filter by resolution IS NULL so that
        # duplicate flags (e.g. one manual_override + one auto-flagged, or a prior
        # resolved row alongside a new proficient_tier_review flag) don't cause the
        # already-resolved row to be targeted, leaving the real unresolved flag stuck.
        flag_row = (
            supabase.table("draft_skill_flags")
            .select("id, stat_rating, claude_rating, resolution")
            .eq("skill_profile_id", profile_id)
            .eq("skill_name", skill_name)
            .is_("resolution", "null")
            .limit(1)
            .execute()
        )
        if not flag_row.data:
            return _err(
                f"No unresolved flag found for skill '{skill_name}' on player {player_id}", status=404
            )
        flag    = flag_row.data[0]
        flag_id = flag["id"]

        # Determine the resolved tier based on resolution type
        if resolution == "trust_stats":
            resolved_tier = flag["stat_rating"]
        elif resolution == "trust_claude":
            resolved_tier = _claude_tier(skill_name, flag, profile_data)
            if resolved_tier is None:
                # #154: the flag's 'None' is a placeholder, not Claude's tier.
                return _err(
                    f"No Claude tier for '{skill_name}' — use Trust Stats or Override",
                    status=409,
                )
        else:
            resolved_tier = resolved_value  # manual_override

        resolved_at = datetime.now(timezone.utc).isoformat()

        # Update the skill_flag record
        supabase.table("draft_skill_flags").update({
            "resolution":     resolution,
            "resolved_value": resolved_tier,
            "resolved_at":    resolved_at,
            "notes":          notes,
        }).eq("id", flag_id).execute()

        # Update the composite profile JSONB — change final_tier and mark as resolved
        if skill_name in profile_data and isinstance(profile_data[skill_name], dict):
            updated_skill = {
                **profile_data[skill_name],
                "final_tier": resolved_tier,
                "source":     "resolved",
                # D21: a human looked at this one. Every bulk resolve reads the
                # marker (_is_human_decision) and leaves the entry alone.
                "human_reviewed": True,
            }
            updated_profile = {**profile_data, skill_name: updated_skill}
            supabase.table("draft_skill_profiles").update({
                "profile": updated_profile,
            }).eq("id", profile_id).execute()

        # Check if all flags for this composite profile are now resolved
        remaining = (
            supabase.table("draft_skill_flags")
            .select("id")
            .eq("skill_profile_id", profile_id)
            .is_("resolution", "null")
            .execute()
        )
        all_resolved = len(remaining.data or []) == 0

        if all_resolved:
            # Mark the composite profile as fully reviewed
            supabase.table("draft_skill_profiles").update({
                "reviewed":    True,
                "reviewed_at": resolved_at,
            }).eq("id", profile_id).execute()

        logger.info(
            "Resolved flag for player=%s skill=%s → %s (%s)",
            player_id, skill_name, resolved_tier, resolution,
        )

        return _ok({
            "flag_id":           flag_id,
            "resolved_tier":     resolved_tier,
            "all_flags_resolved": all_resolved,
        })

    except Exception:
        logger.exception("Error in POST /api/review/%s/resolve", player_id)
        return _err("Internal server error", status=500)


# ---------------------------------------------------------------------------
# POST /api/review/bulk-resolve
# ---------------------------------------------------------------------------


@review_bp.route("/review/bulk-resolve", methods=["POST"])
@require_admin
@require_open_draft
def bulk_resolve():
    """
    Resolve open flags across one or many players, optionally for one Skill.

    Supports "trust_stats" and "trust_claude". Manual override is not supported
    in bulk mode since each Skill would need its own value.

    Under "trust_claude", a flag whose Skill has no Claude tier (a HIGH Skill,
    or a failed Claude call — see _claude_tier) is skipped: its flag stays
    open, its composite entry is untouched, and it is listed in `skipped`
    (#154). Trusting the stored 'None' would erase a real stats tier.

    What a bulk resolve does NOT do (#152, D21): it never resolves a flag whose
    `flag_reason` starts with `human_decision_contradicted`, so a manual
    override a human made — the way a player whose reputation beats his numbers
    gets corrected — survives every later bulk action on that Skill. It also
    never sets the `human_reviewed` marker, and strips it from any entry it
    rewrites, so the marker always names the last HUMAN decision.

    Request body (JSON):
      {
        "player_ids": str[],                         // required (alias: "player_id")
        "resolution": "trust_stats"|"trust_claude",  // required (no manual_override)
        "skill_name": str | null,                    // optional — one Skill only
        "agreements_only": bool,                     // optional, default false
        "notes":      str | null,                    // optional
        "season":     "2025-26"                      // optional, default current
      }

    Response data:
      { "resolved_count": int, "all_flags_resolved": bool,
        "skipped": [ { "player_id": str, "skill_name": str, "reason": str } ] }

    A `skipped` reason is one of: no_claude_tier (#154), defensive_key,
    disagreement, human_decision, negative_candidate.
    """
    body = request.get_json(silent=True) or {}

    raw_ids = body.get("player_ids")
    if raw_ids is None:
        alias = body.get("player_id")
        raw_ids = [alias] if alias else []
    if not isinstance(raw_ids, list):
        return _err("'player_ids' must be a list of UUIDs")
    player_ids = list(dict.fromkeys(str(p).strip() for p in raw_ids if str(p).strip()))
    if not player_ids:
        return _err("'player_ids' is required")
    if len(player_ids) > _BULK_PLAYER_CAP:
        return _err("too_many_players")
    for pid in player_ids:
        if not _validate_uuid(pid):
            return _err("Invalid player_id — must be a UUID")

    resolution      = body.get("resolution", "").strip()
    skill_name      = (body.get("skill_name") or "").strip()
    agreements_only = body.get("agreements_only", False)
    notes           = body.get("notes")
    season          = body.get("season", CURRENT_SEASON)

    _bulk_valid = {"trust_stats", "trust_claude"}
    if resolution not in _bulk_valid:
        return _err(
            f"'resolution' for bulk-resolve must be one of: {', '.join(sorted(_bulk_valid))}"
        )
    if skill_name and skill_name not in ALL_SKILLS:
        return _err("unknown_skill")
    if not isinstance(agreements_only, bool):
        return _err("invalid_agreements_only")
    if resolution == "trust_stats" and skill_name in NO_BULK_TRUST_STATS_SKILLS:
        return _err("defensive_key_trust_stats_blocked")

    try:
        supabase = get_supabase()

        profiles: list[dict] = []
        for chunk in in_chunks(player_ids):
            rows = run_query(lambda c=chunk: (
                supabase.table("draft_skill_profiles")
                .select("id, player_id, profile")
                .in_("player_id", c)
                .eq("season", season)
                .eq("source", "composite")
                .execute()
            ))
            profiles.extend(rows.data or [])

        if not profiles:
            return _err(
                f"No composite profile for the requested players, season {season}",
                status=404,
            )

        profile_ids = [p["id"] for p in profiles]
        flags_by_profile: dict[str, list[dict]] = {}
        for chunk in in_chunks(profile_ids):
            # Paged: a queue player carries 5-15 open flags, so 100 profile ids
            # can pass PostgREST's row cap and drop flags with no error.
            rows = paged_rows(lambda c=chunk: _open_flag_query(
                supabase, c, skill_name,
                "id, skill_profile_id, skill_name, stat_rating, "
                "claude_rating, flag_reason",
            ))
            for flag in rows:
                flags_by_profile.setdefault(flag["skill_profile_id"], []).append(flag)

        if not flags_by_profile:
            return _ok({"resolved_count": 0, "all_flags_resolved": True, "skipped": []})

        resolved_at = datetime.now(timezone.utc).isoformat()
        resolved_count = 0
        skipped: list[dict] = []
        touched_profile_ids: list[str] = []

        for prof in profiles:
            profile_id   = prof["id"]
            player_id    = prof["player_id"]
            profile_data = prof.get("profile") or {}
            flags        = flags_by_profile.get(profile_id) or []
            if not flags:
                continue

            # D21 runs per player, not per flag — compute it once.
            negative_candidate = bool(skill_name) and _is_negative_candidate(profile_data)

            updated_profile = dict(profile_data)
            ids_by_tier: dict[str, list[str]] = {}

            for flag in flags:
                sname = flag["skill_name"]

                def _skip(reason: str):
                    skipped.append({
                        "player_id":  player_id,
                        "skill_name": sname,
                        "reason":     reason,
                    })

                # A human decision outranks every automated rule below it, in
                # every mode — the per-player "Trust All" buttons send no
                # skill_name, and they must not overwrite a person's call either.
                if _is_human_decision(flag, profile_data.get(sname)):
                    _skip("human_decision")
                    continue

                if resolution == "trust_stats":
                    if sname in NO_BULK_TRUST_STATS_SKILLS:
                        _skip("defensive_key")
                        continue
                    resolved_tier = flag["stat_rating"]
                else:
                    resolved_tier = _claude_tier(sname, flag, profile_data)
                    if resolved_tier is None:
                        _skip("no_claude_tier")
                        continue

                if agreements_only and not (
                    _claude_tier(sname, flag, profile_data) is not None
                    and flag.get("stat_rating") == flag.get("claude_rating")
                ):
                    _skip("disagreement")
                    continue

                if negative_candidate and resolved_tier == "None":
                    _skip("negative_candidate")
                    continue

                ids_by_tier.setdefault(resolved_tier, []).append(flag["id"])

                if isinstance(updated_profile.get(sname), dict):
                    entry = {
                        **updated_profile[sname],
                        "final_tier": resolved_tier,
                        "source":     "resolved",
                    }
                    # D21: a bulk action is not a human decision.
                    entry.pop("human_reviewed", None)
                    updated_profile[sname] = entry

                resolved_count += 1

            if not ids_by_tier:
                continue

            # One flag write per resolved tier, not one per flag.
            for tier, ids in ids_by_tier.items():
                for id_chunk in in_chunks(ids):
                    supabase.table("draft_skill_flags").update({
                        "resolution":     resolution,
                        "resolved_value": tier,
                        "resolved_at":    resolved_at,
                        "notes":          notes,
                    }).in_("id", id_chunk).execute()

            # ponytail: ~400 profile writes per Skill; move to an RPC if prod times out (gunicorn --timeout 120)
            supabase.table("draft_skill_profiles").update({
                "profile": updated_profile,
            }).eq("id", profile_id).execute()
            touched_profile_ids.append(profile_id)

        # One chunked read of what is still open across every touched profile,
        # then one reviewed=True write per chunk of the profiles with none left.
        still_open: set[str] = set()
        for chunk in in_chunks(touched_profile_ids):
            rows = paged_rows(lambda c=chunk: (
                supabase.table("draft_skill_flags")
                .select("skill_profile_id")
                .in_("skill_profile_id", c)
                .is_("resolution", "null")
            ))
            still_open.update(r["skill_profile_id"] for r in rows)

        done_ids = [p for p in touched_profile_ids if p not in still_open]
        for chunk in in_chunks(done_ids):
            supabase.table("draft_skill_profiles").update({
                "reviewed":    True,
                "reviewed_at": resolved_at,
            }).in_("id", chunk).execute()

        all_resolved = bool(touched_profile_ids) and not still_open and not skipped

        logger.info(
            "Bulk-resolved %d flags across %d players (%s, skill=%s, agreements_only=%s), skipped %d",
            resolved_count, len(player_ids), resolution, skill_name or "*",
            agreements_only, len(skipped),
        )

        return _ok({
            "resolved_count":     resolved_count,
            "all_flags_resolved": all_resolved,
            "skipped":            skipped,
        })

    except Exception:
        logger.exception("Error in POST /api/review/bulk-resolve")
        return _err("Internal server error", status=500)


# ---------------------------------------------------------------------------
# POST /api/review/<player_id>/manual-override
# ---------------------------------------------------------------------------


@review_bp.route("/review/<player_id>/manual-override", methods=["POST"])
@require_admin
@require_open_draft
def manual_override_skill(player_id: str):
    """
    Manually set the final tier for any skill, regardless of whether it was flagged.

    Works for auto-accepted, stats-only, and already-flagged skills alike.
    If a skill_flag row already exists it is updated in place; otherwise a new
    one is created with flag_reason="manual_override".

    Path params:
      player_id — Supabase UUID

    Request body (JSON):
      {
        "skill_name":     str,                       // required
        "resolved_value": "None"|"Capable"|"Elite",  // required
        "notes":          str | null,                // optional
        "season":         "2025-26"                 // optional, default current
      }

    Response data:
      { "skill_name": str, "resolved_tier": str }
    """
    if not _validate_uuid(player_id):
        return _err("Invalid player_id — must be a UUID")

    body           = request.get_json(silent=True) or {}
    skill_name     = body.get("skill_name", "").strip()
    resolved_value = body.get("resolved_value", "").strip()
    notes          = body.get("notes")
    season         = body.get("season", CURRENT_SEASON)

    if not skill_name:
        return _err("'skill_name' is required")
    if skill_name not in ALL_SKILLS:
        return _err("unknown_skill")
    if resolved_value not in _VALID_TIERS:
        return _err("'resolved_value' must be None, Capable, Proficient, or Elite")

    try:
        supabase = get_supabase()

        # Find the composite profile for this player+season
        profile_row = (
            supabase.table("draft_skill_profiles")
            .select("id, profile")
            .eq("player_id", player_id)
            .eq("season", season)
            .eq("source", "composite")
            .limit(1)
            .execute()
        )
        if not profile_row.data:
            # No composite profile yet — create one pre-filled with all skills
            # set to "None" so the profile page renders every skill row editable.
            _empty_skill = {"final_tier": "None", "stat_tier": None, "claude_tier": None, "source": "manual_override", "flagged": False}
            profile_data = {skill: dict(_empty_skill) for skill in ALL_SKILLS}
            new_profile_row = (
                supabase.table("draft_skill_profiles")
                .insert({
                    "player_id": player_id,
                    "season":    season,
                    "source":    "composite",
                    "profile":   profile_data,
                })
                .execute()
            )
            profile_id = new_profile_row.data[0]["id"]
        else:
            profile_id   = profile_row.data[0]["id"]
            profile_data = profile_row.data[0]["profile"] or {}

        resolved_at = datetime.now(timezone.utc).isoformat()

        # Check if an OPEN skill_flag already exists for this skill. A Skill can
        # carry several rows (a prior resolved one beside a new flag), and
        # stamping the resolved one would leave the live flag open for the next
        # bulk resolve to overwrite this override.
        existing_flag = (
            supabase.table("draft_skill_flags")
            .select("id")
            .eq("skill_profile_id", profile_id)
            .eq("skill_name", skill_name)
            .is_("resolution", "null")
            .limit(1)
            .execute()
        )

        if existing_flag.data:
            # Update the existing flag with the manual override resolution
            flag_id = existing_flag.data[0]["id"]
            supabase.table("draft_skill_flags").update({
                "resolution":     "manual_override",
                "resolved_value": resolved_value,
                "resolved_at":    resolved_at,
                "notes":          notes,
            }).eq("id", flag_id).execute()
        else:
            # Create a new flag row for the manual override
            # Pull the current stat/claude ratings from stored profiles for audit trail
            stats_profile_row = (
                supabase.table("draft_skill_profiles")
                .select("profile")
                .eq("player_id", player_id)
                .eq("season", season)
                .eq("source", "stats")
                .limit(1)
                .execute()
            )
            stats_profile = (stats_profile_row.data or [{}])[0].get("profile") or {}

            claude_profile_row = (
                supabase.table("draft_skill_profiles")
                .select("profile")
                .eq("player_id", player_id)
                .eq("season", season)
                .eq("source", "claude")
                .limit(1)
                .execute()
            )
            claude_profile = (claude_profile_row.data or [{}])[0].get("profile") or {}

            # A stats profile holds either a plain tier string (the direct
            # compositing path) or the evaluator's dict (a staged run). Reading
            # only the string shape wrote "the stats said None" into the audit
            # row of the very decision Chris re-reads later.
            stat_skill  = stats_profile.get(skill_name)
            if isinstance(stat_skill, dict):
                stat_rating = stat_skill.get("tier") or "None"
            else:
                stat_rating = stat_skill if isinstance(stat_skill, str) else "None"

            # Claude profile stores either a tier string or a dict with a tier key
            claude_skill = claude_profile.get(skill_name)
            if isinstance(claude_skill, str):
                claude_rating = claude_skill
            elif isinstance(claude_skill, dict):
                claude_rating = claude_skill.get("tier", "None")
            else:
                claude_rating = "None"

            supabase.table("draft_skill_flags").insert({
                "skill_profile_id":  profile_id,
                "skill_name":        skill_name,
                "stat_rating":       stat_rating,
                "claude_rating":     claude_rating,
                "flag_reason":       "manual_override",
                "resolution":        "manual_override",
                "resolved_value":    resolved_value,
                "resolved_at":       resolved_at,
                "notes":             notes,
            }).execute()

        # Update the composite profile JSONB for this skill
        current_skill_data = profile_data.get(skill_name) or {}
        if isinstance(current_skill_data, dict):
            updated_skill = {
                **current_skill_data,
                "final_tier": resolved_value,
                "source":     "manual_override",
                # D21: an override is the strongest human decision there is.
                "human_reviewed": True,
            }
        else:
            # Skill not in composite profile yet — build a minimal entry
            updated_skill = {
                "final_tier":   resolved_value,
                "stat_tier":    None,
                "claude_tier":  None,
                "source":       "manual_override",
                "flagged":      False,
                "flag_reason":  "manual_override",
                "human_reviewed": True,
            }
        updated_profile = {**profile_data, skill_name: updated_skill}
        supabase.table("draft_skill_profiles").update({
            "profile": updated_profile,
        }).eq("id", profile_id).execute()

        logger.info(
            "Manual override: player=%s skill=%s → %s",
            player_id, skill_name, resolved_value,
        )

        return _ok({"skill_name": skill_name, "resolved_tier": resolved_value})

    except Exception:
        logger.exception("Error in POST /api/review/%s/manual-override", player_id)
        return _err("Internal server error", status=500)


# ---------------------------------------------------------------------------
# GET /api/review/<player_id>/skill-breakdown
# ---------------------------------------------------------------------------


@review_bp.route("/review/<player_id>/skill-breakdown", methods=["GET"])
def skill_breakdown(player_id: str):
    """
    Return per-condition pass/fail details for a single player + skill.

    Runs the same preprocessing pipeline as the rule engine (pre-adjustments,
    derived stats, stabilization) and evaluates every leaf condition against
    the player's actual stats, returning a flat list ordered by section:
      volume_gate → elite → capable → tier_bump

    Used by the review panel to show "Stats vs Thresholds" for each flagged skill.

    Path params:
      player_id — Supabase UUID

    Query params:
      ?skill_name=spot_up_shooter  (required)
      ?season=2025-26              (default: current season)

    Response data:
      {
        "skill_name": str,
        "condition_results": [ { section, stat, operator, threshold, actual_value,
                                  passed, per, stabilized, group_id, group_logic, depth } ],
        "stat_tier": str,          // current stats-engine tier for this skill
        "volume_gate_passed": bool,
      }
    """
    if not _validate_uuid(player_id):
        return _err("Invalid player_id — must be a UUID")

    skill_name = request.args.get("skill_name", "").strip()
    season     = request.args.get("season", CURRENT_SEASON)

    if not skill_name:
        return _err("'skill_name' query parameter is required")

    try:
        supabase = get_supabase()

        # Load the threshold rule for this skill
        thresholds = get_thresholds(supabase)
        rule = thresholds.get(skill_name)
        if not rule:
            return _err(f"No threshold rule found for skill '{skill_name}'", status=404)

        # Load league averages (needed for stabilization in collect_condition_results)
        league_avgs = get_league_averages(season, supabase)

        # Load the player's stats blob
        stats_row = (
            supabase.table("player_stats")
            .select("stats")
            .eq("player_id", player_id)
            .eq("season", season)
            .order("fetched_at", desc=True)
            .limit(1)
            .execute()
        )
        if not stats_row.data:
            return _err(
                f"No stats found for player {player_id} season {season}", status=404
            )
        stats_blob = stats_row.data[0].get("stats") or {}

        # Run the condition breakdown — same logic as calibration's test-thresholds
        condition_results = collect_condition_results(rule, stats_blob, league_avgs)

        # Also fetch the stored stat tier from draft_skill_profiles for display
        profile_row = (
            supabase.table("draft_skill_profiles")
            .select("profile")
            .eq("player_id", player_id)
            .eq("season", season)
            .eq("source", "stats")
            .limit(1)
            .execute()
        )
        stat_tier = "None"
        volume_gate_passed = False
        if profile_row.data and profile_row.data[0].get("profile"):
            skill_data = profile_row.data[0]["profile"].get(skill_name) or {}
            # Stats profile stores just the tier string; composite profile has full dict
            if isinstance(skill_data, str):
                stat_tier = skill_data
            elif isinstance(skill_data, dict):
                stat_tier = skill_data.get("tier", "None")

        # Determine volume_gate_passed from condition_results
        vg_items = [c for c in condition_results if c["section"] == "volume_gate"]
        if vg_items:
            # Volume gate passes if ALL volume_gate conditions pass (AND logic)
            volume_gate_passed = all(c["passed"] for c in vg_items if c["passed"] is not None)

        return _ok({
            "skill_name":        skill_name,
            "condition_results": condition_results,
            "stat_tier":         stat_tier,
            "volume_gate_passed": volume_gate_passed,
        })

    except Exception:
        logger.exception(
            "Error in GET /api/review/%s/skill-breakdown?skill_name=%s",
            player_id, skill_name,
        )
        return _err("Internal server error", status=500)
