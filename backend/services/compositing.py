"""
compositing.py — Composite stat + Claude ratings into a final skill profile.

After the stat pipeline (Prompt 4) and Claude assessment (Prompt 5) run, this
module combines them using a confidence-and-agreement matrix to produce the
authoritative composite profile. Flags are raised when disagreement is too
large or when reliability is too low to auto-resolve.

Compositing matrix (stat_confidence is the primary axis):

  High confidence (Claude skipped):
    → stats_only: final_tier = stat_tier, no Claude tier

  Moderate confidence (Claude blind):
    Exact agreement       → auto_accepted (agreed tier)
    One-tier disagreement → auto_accepted (LOWER tier)
    Two-tier disagreement → flagged

  Low confidence (Claude informed):
    Exact agreement       → auto_accepted
    One-tier disagreement → flagged
    Two-tier disagreement → flagged

  Notability override (score < 40):
    ALL moderate and low skills → flagged, regardless of agreement

  Claude self-reported low confidence:
    Treat as low-confidence skill regardless of stat_confidence tier —
    one-tier disagreements become flagged instead of auto-accepted.

Persistence:
  Three skill_profiles records per player (source = "stats", "claude", "composite").
  One skill_flags record per flagged skill.
"""

import logging
from typing import Any

from supabase import Client

from services.claude_assessment import (
    HIGH_CONFIDENCE_SKILLS,
    LOW_CONFIDENCE_SKILLS,
    MODERATE_CONFIDENCE_SKILLS,
)
from services.notability import NOTABILITY_MEDIUM

logger = logging.getLogger(__name__)

# Tier ordering: higher index = higher tier (Elite > Capable > None)
_TIER_ORDER = ["None", "Capable", "Elite"]

# All 19 skill keys in canonical order
ALL_SKILLS: list[str] = sorted(
    HIGH_CONFIDENCE_SKILLS | MODERATE_CONFIDENCE_SKILLS | LOW_CONFIDENCE_SKILLS
)

# Valid flag reasons
_FLAG_REASONS = frozenset({
    "two_tier_disagreement",
    "one_tier_low_confidence",
    "low_notability",
    "claude_low_confidence",
    "data_missing",
})


# ---------------------------------------------------------------------------
# Tier helpers
# ---------------------------------------------------------------------------


def _tier_index(tier: str | None) -> int:
    """Return the integer index of a tier (None=0, Capable=1, Elite=2)."""
    if tier is None or tier not in _TIER_ORDER:
        return 0  # Treat unknown / null as "None"
    return _TIER_ORDER.index(tier)


def _tier_diff(tier_a: str | None, tier_b: str | None) -> int:
    """Return the absolute difference between two tier indices."""
    return abs(_tier_index(tier_a) - _tier_index(tier_b))


def _lower_tier(tier_a: str | None, tier_b: str | None) -> str:
    """Return the lower of two tiers (e.g. Capable vs Elite → Capable)."""
    return _TIER_ORDER[min(_tier_index(tier_a), _tier_index(tier_b))]


# ---------------------------------------------------------------------------
# Single-skill compositing
# ---------------------------------------------------------------------------


def composite_skill(
    skill_name: str,
    stat_result: dict,
    claude_result: dict | None,
    notability_score: int,
) -> dict[str, Any]:
    """
    Composite a single skill from the stat result and Claude result.

    Args:
        skill_name:      Snake_case skill key.
        stat_result:     Dict from Prompt 4's evaluate_skill (has "tier", "stat_confidence", etc.).
        claude_result:   Dict from claude_assessment.get_claude_assessment (has "tier",
                         "confidence", "claude_failed"). None if skill is high-confidence.
        notability_score: Player notability score (0–100).

    Returns:
        Dict with all composite fields per the spec schema.
    """
    stat_tier       = stat_result.get("tier", "None")
    stat_confidence = stat_result.get("stat_confidence", "low")

    low_notability = notability_score < NOTABILITY_MEDIUM

    # -----------------------------------------------------------------------
    # High confidence skills — Claude was not called
    # -----------------------------------------------------------------------
    if skill_name in HIGH_CONFIDENCE_SKILLS:
        return {
            "final_tier":      stat_tier,
            "stat_tier":       stat_tier,
            "claude_tier":     None,
            "source":          "stats_only",
            "stat_confidence": stat_confidence,
            "claude_confidence": None,
            "agreement":       "skipped",
            "flagged":         False,
            "flag_reason":     None,
        }

    # -----------------------------------------------------------------------
    # Moderate / low confidence skills — Claude was called
    # -----------------------------------------------------------------------
    claude_failed    = (claude_result or {}).get("claude_failed", True)
    claude_tier      = (claude_result or {}).get("tier") if not claude_failed else None
    claude_confidence = (claude_result or {}).get("confidence") if not claude_failed else None

    # If Claude data is missing (failed or null tier), treat as data_missing flag
    if claude_failed or claude_tier is None:
        return {
            "final_tier":       stat_tier,
            "stat_tier":        stat_tier,
            "claude_tier":      None,
            "source":           "flagged",
            "stat_confidence":  stat_confidence,
            "claude_confidence": None,
            "agreement":        "skipped",
            "flagged":          True,
            "flag_reason":      "data_missing",
        }

    diff = _tier_diff(stat_tier, claude_tier)

    # Convert diff to agreement label
    if diff == 0:
        agreement = "exact"
    elif diff == 1:
        agreement = "one_tier"
    else:
        agreement = "two_tier"

    # Determine effective confidence level for compositing:
    # Claude self-reporting "low" escalates to low-confidence rules.
    claude_reports_low = (claude_confidence == "low")
    is_low_confidence_skill = skill_name in LOW_CONFIDENCE_SKILLS

    # Effective behavior: treat as low-confidence if skill IS low-confidence
    # OR if Claude self-reports low confidence on a moderate-confidence skill.
    act_as_low_confidence = is_low_confidence_skill or claude_reports_low

    # -----------------------------------------------------------------------
    # Notability override — flag everything for low-notability players
    # -----------------------------------------------------------------------
    if low_notability:
        return {
            "final_tier":       _lower_tier(stat_tier, claude_tier),
            "stat_tier":        stat_tier,
            "claude_tier":      claude_tier,
            "source":           "flagged",
            "stat_confidence":  stat_confidence,
            "claude_confidence": claude_confidence,
            "agreement":        agreement,
            "flagged":          True,
            "flag_reason":      "low_notability",
        }

    # -----------------------------------------------------------------------
    # Agreement-based resolution
    # -----------------------------------------------------------------------
    if agreement == "exact":
        # Both sources agree — auto-accept
        return {
            "final_tier":       stat_tier,
            "stat_tier":        stat_tier,
            "claude_tier":      claude_tier,
            "source":           "auto_accepted",
            "stat_confidence":  stat_confidence,
            "claude_confidence": claude_confidence,
            "agreement":        agreement,
            "flagged":          False,
            "flag_reason":      None,
        }

    elif agreement == "one_tier":
        lower = _lower_tier(stat_tier, claude_tier)

        if act_as_low_confidence:
            # Low-confidence skill OR Claude self-reports low: flag one-tier disagreements
            flag_reason = (
                "claude_low_confidence"
                if (claude_reports_low and not is_low_confidence_skill)
                else "one_tier_low_confidence"
            )
            return {
                "final_tier":       lower,
                "stat_tier":        stat_tier,
                "claude_tier":      claude_tier,
                "source":           "flagged",
                "stat_confidence":  stat_confidence,
                "claude_confidence": claude_confidence,
                "agreement":        agreement,
                "flagged":          True,
                "flag_reason":      flag_reason,
            }
        else:
            # Moderate confidence — auto-accept the lower (more conservative) tier
            return {
                "final_tier":       lower,
                "stat_tier":        stat_tier,
                "claude_tier":      claude_tier,
                "source":           "auto_accepted",
                "stat_confidence":  stat_confidence,
                "claude_confidence": claude_confidence,
                "agreement":        agreement,
                "flagged":          False,
                "flag_reason":      None,
            }

    else:
        # Two-tier disagreement — always flag
        return {
            "final_tier":       _lower_tier(stat_tier, claude_tier),
            "stat_tier":        stat_tier,
            "claude_tier":      claude_tier,
            "source":           "flagged",
            "stat_confidence":  stat_confidence,
            "claude_confidence": claude_confidence,
            "agreement":        agreement,
            "flagged":          True,
            "flag_reason":      "two_tier_disagreement",
        }


# ---------------------------------------------------------------------------
# Full-profile compositing
# ---------------------------------------------------------------------------


def composite_profile(
    stat_skills_result: dict,
    claude_skills: dict,
    notability_score: int,
) -> dict[str, dict]:
    """
    Composite all 19 skills into a final profile.

    Args:
        stat_skills_result: Dict of { skill_name: evaluate_skill_result } from Prompt 4.
        claude_skills:      Dict of { skill_name: claude_assessment_entry } for 14 skills.
        notability_score:   Player notability score (0–100).

    Returns:
        Dict of { skill_name: composite_skill_result } for all 19 skills.
    """
    composite: dict[str, dict] = {}

    all_skill_keys = HIGH_CONFIDENCE_SKILLS | MODERATE_CONFIDENCE_SKILLS | LOW_CONFIDENCE_SKILLS

    for skill_name in all_skill_keys:
        stat_result   = stat_skills_result.get(skill_name, {})
        claude_result = claude_skills.get(skill_name)  # None for high-confidence skills

        composite[skill_name] = composite_skill(
            skill_name,
            stat_result,
            claude_result,
            notability_score,
        )

    return composite


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------


def _build_stats_source_profile(stat_skills_result: dict) -> dict:
    """Build a simplified stats profile JSONB for source='stats'."""
    return {
        skill: result.get("tier", "None")
        for skill, result in stat_skills_result.items()
    }


def _build_claude_source_profile(claude_skills: dict) -> dict:
    """
    Build the Claude profile JSONB for source='claude'.
    High-confidence skills (not assessed by Claude) are represented as null.
    """
    profile: dict[str, Any] = {}
    for skill in HIGH_CONFIDENCE_SKILLS:
        profile[skill] = None  # Claude was not called for these
    for skill, entry in claude_skills.items():
        if entry and not entry.get("claude_failed"):
            profile[skill] = entry.get("tier")
        else:
            profile[skill] = None
    return profile


def _build_composite_source_profile(composite: dict) -> dict:
    """Build the composite profile JSONB (final_tier for all 19 skills + metadata)."""
    return dict(composite)


def _upsert_skill_profile(
    player_id: str,
    season: str,
    source: str,
    profile: dict,
    review_required: bool,
    supabase: Client,
) -> str:
    """
    Upsert a skill_profiles record and return its ID.

    Unique constraint: (player_id, season, source).
    """
    row = {
        "player_id":       player_id,
        "season":          season,
        "source":          source,
        "profile":         profile,
        "review_required": review_required,
        "reviewed":        False,
        "reviewed_at":     None,
        "is_legend":       False,
    }
    result = (
        supabase.table("skill_profiles")
        .upsert(row, on_conflict="player_id,season,source")
        .execute()
    )
    record_id = result.data[0]["id"] if result.data else None
    logger.debug("Upserted skill_profiles source=%s for player %s — id=%s", source, player_id, record_id)
    return record_id


def _upsert_skill_flags(
    composite_profile_id: str,
    composite: dict,
    stat_skills_result: dict,
    claude_skills: dict,
    supabase: Client,
) -> int:
    """
    Upsert skill_flags records for every flagged skill.

    Uses (skill_profile_id, skill_name) as the logical unique key.
    Supabase does not have a composite unique constraint for upsert here, so
    we delete-then-insert to avoid duplicates on re-runs.

    Returns:
        Number of flag records created.
    """
    if not composite_profile_id:
        logger.warning("Cannot upsert skill_flags — composite_profile_id is None")
        return 0

    # Collect all flagged skills
    flagged_rows = []
    for skill_name, result in composite.items():
        if not result.get("flagged"):
            continue

        stat_result  = stat_skills_result.get(skill_name, {})
        claude_entry = claude_skills.get(skill_name) or {}

        row = {
            "skill_profile_id":    composite_profile_id,
            "skill_name":          skill_name,
            "stat_rating":         result.get("stat_tier"),
            "claude_rating":       result.get("claude_tier"),
            "flag_reason":         result.get("flag_reason"),
            "stat_values":         stat_result.get("driving_stats") or {},
            "claude_justification": claude_entry.get("justification"),
            "resolution":          None,
            "resolved_value":      None,
            "resolved_at":         None,
            "notes":               None,
        }
        flagged_rows.append(row)

    if not flagged_rows:
        return 0

    # Delete existing flags for this composite profile, then re-insert
    # This is the safest upsert strategy for a table without a multi-col unique constraint.
    supabase.table("skill_flags").delete().eq(
        "skill_profile_id", composite_profile_id
    ).execute()

    supabase.table("skill_flags").insert(flagged_rows).execute()

    logger.debug(
        "Inserted %d skill_flags for composite profile %s", len(flagged_rows), composite_profile_id
    )
    return len(flagged_rows)


def persist_profiles(
    player_id: str,
    season: str,
    stat_skills_result: dict,
    claude_skills: dict,
    composite: dict,
    supabase: Client,
) -> dict:
    """
    Persist all three skill_profiles (stats, claude, composite) and all skill_flags.

    Args:
        player_id:          Supabase UUID.
        season:             Season string.
        stat_skills_result: Prompt 4 skill results dict.
        claude_skills:      Claude assessment skills dict (14 skills).
        composite:          Composite result from composite_profile().
        supabase:           Supabase client.

    Returns:
        {
          "stats_profile_id":     str | None,
          "claude_profile_id":    str | None,
          "composite_profile_id": str | None,
          "flags_created":        int,
        }
    """
    review_required = any(v.get("flagged", False) for v in composite.values())

    # Source: stats
    stats_profile = _build_stats_source_profile(stat_skills_result)
    stats_profile_id = _upsert_skill_profile(
        player_id, season, "stats", stats_profile, False, supabase
    )

    # Source: claude
    claude_profile = _build_claude_source_profile(claude_skills)
    claude_profile_id = _upsert_skill_profile(
        player_id, season, "claude", claude_profile, False, supabase
    )

    # Source: composite
    composite_profile_data = _build_composite_source_profile(composite)
    composite_profile_id = _upsert_skill_profile(
        player_id, season, "composite", composite_profile_data, review_required, supabase
    )

    # Skill flags — only for composite profile
    flags_created = _upsert_skill_flags(
        composite_profile_id,
        composite,
        stat_skills_result,
        claude_skills,
        supabase,
    )

    return {
        "stats_profile_id":     stats_profile_id,
        "claude_profile_id":    claude_profile_id,
        "composite_profile_id": composite_profile_id,
        "flags_created":        flags_created,
    }
