"""
api/legends.py — Legends profile builder endpoints.

Endpoints:
  GET  /api/legends                              — all 36 legends with completion counts
  GET  /api/legends/<legend_id>                  — single legend with full skill profile
  PUT  /api/legends/<legend_id>/skills           — upsert partial skill profile
  POST /api/legends/<legend_id>/claude-suggestion — Claude's suggestions (not persisted)

Legend skill profiles are stored in skill_profiles with:
  is_legend=true, source='manual', season=NULL, legend_id=<legend uuid>
  player_id is left NULL for legend rows.

Prerequisite: run migration 002_add_legend_id.sql to add the legend_id FK column.
"""

import json
import logging
import os
import re
import uuid as _uuid_mod
from typing import Any

import anthropic
from flask import Blueprint, jsonify, request

from services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

legends_bp = Blueprint("legends", __name__, url_prefix="/api")

# ---------------------------------------------------------------------------
# Skill taxonomy — the 20 skills used throughout the system
# Matches SKILL_CATEGORIES in frontend/components/SkillProfileCard.tsx
# ---------------------------------------------------------------------------

# All 20 skill keys the legend profile tracks
ALL_SKILLS: list[str] = [
    # Additive skills (12)
    "spot_up_shooter",
    "off_dribble_shooter",
    "isolation_scorer",
    "movement_shooter",
    "cutter",
    "transition_threat",
    "pnr_ball_handler",
    "pnr_finisher",
    "crafty_finisher",
    "passer",
    "offensive_rebounder",
    "vertical_spacer",
    # Threshold-based skills (5)
    "rebounder",
    "rim_protector",
    "screen_setter",
    "mid_post_player",
    "low_post_player",
    # Zero-sum skills (3)
    "switchable_defender",
    "point_of_attack_defender",
    "high_flyer",
]

# One-sentence definitions for each skill (used in the Claude legend prompt)
_SKILL_DEFINITIONS: dict[str, str] = {
    "spot_up_shooter":           "Hits catch-and-shoot three-pointers and mid-range shots from set positions.",
    "off_dribble_shooter":       "Creates and converts shots off the dribble, including pull-ups and step-backs.",
    "isolation_scorer":          "Beats defenders one-on-one in isolation situations through dribble moves and athleticism.",
    "movement_shooter":          "Hits shots while relocating off screens and handoffs (not just standing still).",
    "cutter":                    "Scores effectively by cutting to the basket off-ball.",
    "transition_threat":         "Scores effectively in the open court on fast breaks.",
    "pnr_ball_handler":          "Initiates and scores/creates effectively as the ball handler in pick-and-roll actions.",
    "pnr_finisher":              "Scores effectively as the screener in pick-and-roll actions, whether rolling, popping, or slipping.",
    "crafty_finisher":           "Scores at the rim using touch, body control, and foul-drawing ability rather than pure athleticism.",
    "passer":                    "Creates quality shot opportunities for teammates through vision and passing skill.",
    "offensive_rebounder":       "Consistently crashes offensive boards and converts second-chance opportunities.",
    "vertical_spacer":           "Threatens vertically as a lob target and above-the-rim finisher, creating driving lanes for teammates.",
    "rebounder":                 "Consistently grabs defensive and offensive boards through positioning and effort.",
    "rim_protector":             "Deters and blocks shots at the rim, altering opponent finishing attempts.",
    "screen_setter":             "Sets quality screens that free teammates for open shots.",
    "mid_post_player":           "Scores effectively from the mid-post/elbow area using face-up moves and mid-range shooting.",
    "low_post_player":           "Scores effectively with back-to-basket moves in the low post.",
    "switchable_defender":       "Can guard multiple positional groups effectively when switched.",
    "point_of_attack_defender":  "Disrupts ball handlers through active hands, pressure, and contest at the point of attack.",
    "high_flyer":                "Possesses elite explosive athleticism for above-the-rim plays, highlight dunks, and transition finishes.",
}

# Number of skills to count as "fully profiled"
_TOTAL_SKILLS = len(ALL_SKILLS)

# Claude API settings — same as Prompt 5 composite assessment
_DEFAULT_MODEL = "claude-sonnet-4-20250514"
_MAX_TOKENS = 2500
_TEMPERATURE = 0


# ---------------------------------------------------------------------------
# Response helpers
# ---------------------------------------------------------------------------


def _ok(data: Any) -> tuple:
    """Standard success envelope."""
    return jsonify({"success": True, "data": data, "error": None}), 200


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
# Completion counting helpers
# ---------------------------------------------------------------------------


def _count_rated(profile: dict | None) -> int:
    """
    Count how many of the 20 skills have been deliberately rated.
    A skill is 'rated' if its key exists in the profile dict with any non-null value —
    even 'None' (the tier) counts because it's a deliberate choice by the user.
    Null/missing means the skill has not been evaluated yet.
    """
    if not profile:
        return 0
    count = 0
    for skill in ALL_SKILLS:
        val = profile.get(skill)
        if val is not None:
            count += 1
    return count


def _empty_profile() -> dict:
    """Return a profile dict with all 20 skills set to null (unrated)."""
    return {skill: None for skill in ALL_SKILLS}


# ---------------------------------------------------------------------------
# GET /api/legends
# ---------------------------------------------------------------------------


@legends_bp.route("/legends", methods=["GET"])
def list_legends():
    """
    Return all 36 legends sorted alphabetically, each with completion counts.

    Response data: list of {id, name, peak_era, notes, completion, completion_pct}
    where completion is how many of the 20 skills have been rated.
    """
    try:
        supabase = get_supabase()

        # Fetch all legends ordered by name
        legends_res = (
            supabase.table("legends")
            .select("id, name, peak_era, notes")
            .order("name")
            .execute()
        )
        legends = legends_res.data or []

        if not legends:
            return _ok([])

        # Fetch all legend skill profiles in one query (is_legend=true, source=manual)
        # We only need legend_id and the profile JSONB for completion counting
        profiles_res = (
            supabase.table("skill_profiles")
            .select("legend_id, profile")
            .eq("is_legend", True)
            .eq("source", "manual")
            .execute()
        )
        # Build lookup: legend_id → profile dict
        profile_map: dict[str, dict] = {}
        for row in (profiles_res.data or []):
            lid = row.get("legend_id")
            if lid:
                profile_map[lid] = row.get("profile") or {}

        # Assemble response rows
        result = []
        for legend in legends:
            lid = legend["id"]
            profile = profile_map.get(lid)
            rated = _count_rated(profile)
            result.append({
                "id":             lid,
                "name":           legend["name"],
                "peak_era":       legend["peak_era"],
                "notes":          legend.get("notes"),
                "completion":     rated,
                "completion_pct": round(rated / _TOTAL_SKILLS * 100, 1),
            })

        return _ok(result)

    except Exception:
        logger.exception("Error in GET /api/legends")
        return _err("Internal server error")


# ---------------------------------------------------------------------------
# GET /api/legends/<legend_id>
# ---------------------------------------------------------------------------


@legends_bp.route("/legends/<legend_id>", methods=["GET"])
def get_legend(legend_id: str):
    """
    Return a single legend with full skill profile.

    If no skill profile exists yet, returns the legend metadata with an empty profile
    (all 20 skills as null — distinct from 'None' which is a deliberate rating).

    Response data: {id, name, peak_era, notes, profile, completion, completion_pct}
    """
    if not _validate_uuid(legend_id):
        return _err("Invalid legend_id — must be a UUID", status=400)

    try:
        supabase = get_supabase()

        # Fetch legend metadata
        legend_res = (
            supabase.table("legends")
            .select("id, name, peak_era, notes")
            .eq("id", legend_id)
            .limit(1)
            .execute()
        )
        if not legend_res.data:
            return _err(f"Legend {legend_id} not found", status=404)
        legend = legend_res.data[0]

        # Fetch skill profile (manual legend profile)
        profile_res = (
            supabase.table("skill_profiles")
            .select("id, profile")
            .eq("legend_id", legend_id)
            .eq("is_legend", True)
            .eq("source", "manual")
            .limit(1)
            .execute()
        )

        if profile_res.data:
            # Merge stored profile with empty template to ensure all 20 skills are present
            stored = profile_res.data[0].get("profile") or {}
            profile = {**_empty_profile(), **stored}
        else:
            # No profile yet — all skills are null (unrated)
            profile = _empty_profile()

        rated = _count_rated(profile)
        return _ok({
            "id":             legend["id"],
            "name":           legend["name"],
            "peak_era":       legend["peak_era"],
            "notes":          legend.get("notes"),
            "profile":        profile,
            "completion":     rated,
            "completion_pct": round(rated / _TOTAL_SKILLS * 100, 1),
        })

    except Exception:
        logger.exception("Error in GET /api/legends/%s", legend_id)
        return _err("Internal server error")


# ---------------------------------------------------------------------------
# PUT /api/legends/<legend_id>/skills
# ---------------------------------------------------------------------------


@legends_bp.route("/legends/<legend_id>/skills", methods=["PUT"])
def update_legend_skills(legend_id: str):
    """
    Upsert a partial or full skill profile for a legend.

    Partial updates are supported — only the skills included in the request body
    are updated; others are left unchanged. This supports auto-save on individual
    skill changes from the frontend.

    Request body:
      {
        "profile": { "spot_up_shooter": "Elite", "movement_shooter": "Capable", ... },
        "notes": "Optional general context about this player"
      }

    Both 'profile' and 'notes' are optional — pass only what changed.

    Response data: {completion, completion_pct, updated_skills}
    """
    if not _validate_uuid(legend_id):
        return _err("Invalid legend_id — must be a UUID", status=400)

    body = request.get_json(silent=True) or {}
    incoming_profile: dict = body.get("profile") or {}
    incoming_notes: str | None = body.get("notes")

    # Validate tier values
    valid_tiers = {"None", "Capable", "Elite", "All-Time Great", None}
    for skill_key, tier_val in incoming_profile.items():
        if skill_key not in ALL_SKILLS:
            return _err(f"Unknown skill: '{skill_key}'", status=400)
        if tier_val not in valid_tiers:
            return _err(
                f"Invalid tier '{tier_val}' for skill '{skill_key}'. "
                "Must be None, Capable, Elite, or All-Time Great.",
                status=400,
            )

    try:
        supabase = get_supabase()

        # Verify the legend exists
        legend_res = (
            supabase.table("legends")
            .select("id, notes")
            .eq("id", legend_id)
            .limit(1)
            .execute()
        )
        if not legend_res.data:
            return _err(f"Legend {legend_id} not found", status=404)

        # Fetch existing profile to merge (partial update support)
        existing_res = (
            supabase.table("skill_profiles")
            .select("id, profile")
            .eq("legend_id", legend_id)
            .eq("is_legend", True)
            .eq("source", "manual")
            .limit(1)
            .execute()
        )

        if existing_res.data:
            # Merge: existing profile overwritten only where new values provided
            existing_profile = existing_res.data[0].get("profile") or {}
            merged_profile = {**existing_profile, **incoming_profile}
            # Update the existing row
            (
                supabase.table("skill_profiles")
                .update({"profile": merged_profile})
                .eq("id", existing_res.data[0]["id"])
                .execute()
            )
        else:
            # Create a new profile row (upsert via insert)
            merged_profile = {**_empty_profile(), **incoming_profile}
            (
                supabase.table("skill_profiles")
                .insert({
                    "legend_id":  legend_id,
                    "is_legend":  True,
                    "source":     "manual",
                    "season":     None,
                    "player_id":  None,
                    "profile":    merged_profile,
                })
                .execute()
            )

        # Update legend notes if provided in the request
        if incoming_notes is not None:
            (
                supabase.table("legends")
                .update({"notes": incoming_notes})
                .eq("id", legend_id)
                .execute()
            )

        rated = _count_rated(merged_profile)
        return _ok({
            "completion":     rated,
            "completion_pct": round(rated / _TOTAL_SKILLS * 100, 1),
            "updated_skills": list(incoming_profile.keys()),
        })

    except Exception:
        logger.exception("Error in PUT /api/legends/%s/skills", legend_id)
        return _err("Internal server error")


# ---------------------------------------------------------------------------
# POST /api/legends/<legend_id>/claude-suggestion
# ---------------------------------------------------------------------------


def _get_anthropic_client() -> anthropic.Anthropic:
    """Return an Anthropic client, raising clearly if ANTHROPIC_API_KEY is missing."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not set. Add it to your .env file."
        )
    return anthropic.Anthropic(api_key=api_key)


def _get_model() -> str:
    """Return the configured Claude model (or default)."""
    return os.environ.get("CLAUDE_MODEL", _DEFAULT_MODEL)


def _build_legend_prompt(
    name: str,
    peak_era: str,
    existing_profile: dict | None,
) -> str:
    """
    Build the Claude prompt for rating an all-time great on all 20 skills.

    When the legend already has ratings the prompt asks Claude to provide an
    independent assessment and explain any disagreements with the existing ratings.
    """
    skill_list_lines = []
    for skill in ALL_SKILLS:
        defn = _SKILL_DEFINITIONS.get(skill, "")
        skill_list_lines.append(f"- **{skill}**: {defn}")
    skill_definitions_block = "\n".join(skill_list_lines)

    # Build context section about existing ratings (if any)
    rated_skills = {
        skill: val
        for skill, val in (existing_profile or {}).items()
        if val is not None
    }

    if rated_skills:
        existing_ratings_lines = [
            f"  - {skill}: {val}"
            for skill, val in sorted(rated_skills.items())
        ]
        existing_context = (
            "\n## Existing User Ratings\n\n"
            "The user has already rated this player as follows:\n"
            + "\n".join(existing_ratings_lines)
            + "\n\nPlease provide your INDEPENDENT assessment for all 20 skills below. "
            "Where your assessment differs from the user's ratings, explain clearly why "
            "in your justification — this will surface as a disagreement for the user to review."
        )
    else:
        existing_context = (
            "\n## Context\n\n"
            "This legend has no existing ratings yet. Please rate this player on all 20 skills "
            "based solely on your knowledge of their peak abilities, playing style, historical "
            "reputation, and era context. There are no modern stats available — rely on historical "
            "accounts, contemporary records, and your knowledge of how this player is remembered."
        )

    response_schema = json.dumps({
        "skills": {
            "<skill_key>": {
                "tier": "None | Capable | Elite | All-Time Great",
                "justification": "one or two sentence explanation",
            }
        }
    }, indent=2)

    return "\n".join([
        "# NBA Legend Skill Assessment",
        "",
        "## Legend",
        "",
        f"- **Name:** {name}",
        f"- **Peak Era:** {peak_era}",
        "",
        "## Skill Definitions",
        "",
        "Rate each skill using these tier values:",
        "- **None** — did not possess this skill at a meaningful level",
        "- **Capable** — solid, reliable contributor in this area",
        "- **Elite** — among the best at this skill in their era",
        "- **All-Time Great** — historically exceptional; defines the standard for this skill",
        "",
        skill_definitions_block,
        existing_context,
        "",
        "## Response Format",
        "",
        "Respond ONLY in valid JSON with no preamble, markdown code fences, or explanation "
        "outside the JSON. Use exactly this schema:",
        "",
        "```",
        response_schema,
        "```",
        "",
        "Include ALL 20 skills in the 'skills' object. Use the snake_case skill keys as "
        "the object keys. Be honest and direct — do not inflate ratings out of reverence.",
    ])


def _parse_claude_legend_response(text: str) -> dict[str, dict] | None:
    """
    Parse Claude's JSON response for a legend skill assessment.
    Returns None if parsing fails (caller retries).
    """
    cleaned = text.strip()
    # Strip markdown code fences if present
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        cleaned = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        logger.warning("Claude legend response is not valid JSON. Raw: %.200s", text)
        return None

    if "skills" not in parsed or not isinstance(parsed["skills"], dict):
        logger.warning("Claude legend response missing 'skills' key.")
        return None

    return parsed["skills"]


@legends_bp.route("/legends/<legend_id>/claude-suggestion", methods=["POST"])
def claude_suggestion(legend_id: str):
    """
    Call Claude to suggest skill ratings for a legend based on historical basketball knowledge.

    Builds a prompt with the legend's name, peak era, all 20 skill definitions, and any
    existing ratings (if present). Claude's suggestions are returned to the client but
    NOT persisted — the user decides what to accept via the diff view.

    Response data:
      {
        "skills": {
          "<skill_key>": {
            "tier": "None | Capable | Elite | All-Time Great",
            "justification": "..."
          },
          ...
        }
      }
    """
    if not _validate_uuid(legend_id):
        return _err("Invalid legend_id — must be a UUID", status=400)

    try:
        supabase = get_supabase()

        # Fetch legend metadata
        legend_res = (
            supabase.table("legends")
            .select("id, name, peak_era")
            .eq("id", legend_id)
            .limit(1)
            .execute()
        )
        if not legend_res.data:
            return _err(f"Legend {legend_id} not found", status=404)
        legend = legend_res.data[0]

        # Fetch existing skill profile (if any) — used to build diff context for Claude
        profile_res = (
            supabase.table("skill_profiles")
            .select("profile")
            .eq("legend_id", legend_id)
            .eq("is_legend", True)
            .eq("source", "manual")
            .limit(1)
            .execute()
        )
        existing_profile = (profile_res.data[0].get("profile") or {}) if profile_res.data else None

        # Build the prompt and call Claude
        prompt = _build_legend_prompt(
            name=legend["name"],
            peak_era=legend["peak_era"],
            existing_profile=existing_profile,
        )

        client = _get_anthropic_client()
        model  = _get_model()

        logger.info(
            "Calling Claude for legend suggestion: %s (%s)", legend["name"], legend_id
        )

        # Retry once on JSON parse failure (same pattern as claude_assessment.py)
        skills_result: dict[str, dict] | None = None
        for attempt in range(2):
            try:
                response = client.messages.create(
                    model=model,
                    max_tokens=_MAX_TOKENS,
                    temperature=_TEMPERATURE,
                    messages=[{"role": "user", "content": prompt}],
                )
                raw_text = response.content[0].text
                skills_result = _parse_claude_legend_response(raw_text)
                if skills_result is not None:
                    break
                logger.warning(
                    "Legend Claude parse failed on attempt %d — %s",
                    attempt + 1,
                    "retrying" if attempt == 0 else "giving up",
                )
            except Exception:
                logger.exception(
                    "Legend Claude API call failed on attempt %d — %s",
                    attempt + 1,
                    "retrying" if attempt == 0 else "giving up",
                )

        if not skills_result:
            return _err("Claude assessment failed — please try again", status=502)

        # Validate and normalize tiers — unknown tiers default to None
        valid_tiers = {"None", "Capable", "Elite", "All-Time Great"}
        normalized: dict[str, dict] = {}
        for skill in ALL_SKILLS:
            entry = skills_result.get(skill) or {}
            tier = entry.get("tier", "None")
            if tier not in valid_tiers:
                tier = "None"
            normalized[skill] = {
                "tier":          tier,
                "justification": entry.get("justification", ""),
            }

        # NOTE: suggestions are NOT persisted — the client applies what it wants
        logger.info(
            "Claude legend suggestion complete for %s: %d skills returned",
            legend["name"],
            len(normalized),
        )
        return _ok({"skills": normalized})

    except RuntimeError as exc:
        # Missing API key
        logger.error("Legend Claude suggestion setup error: %s", exc)
        return _err(str(exc), status=500)
    except Exception:
        logger.exception("Error in POST /api/legends/%s/claude-suggestion", legend_id)
        return _err("Internal server error")
