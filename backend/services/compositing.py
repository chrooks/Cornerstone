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
  Three draft_skill_profiles records per player (source = "stats", "claude", "composite").
  One draft_skill_flags record per flagged skill.
"""

import logging
from dataclasses import dataclass
from typing import Any

from supabase import Client

from services.skills import (
    HIGH_CONFIDENCE_SKILLS,
    LOW_CONFIDENCE_SKILLS,
    MODERATE_CONFIDENCE_SKILLS,
)
from services.notability import NOTABILITY_MEDIUM

logger = logging.getLogger(__name__)

# Tier ordering: higher index = higher tier (All-Time Great > Elite > Proficient > Capable > None)
_TIER_ORDER = ["None", "Capable", "Proficient", "Elite", "All-Time Great"]

# All 19 skill keys in canonical order
ALL_SKILLS: list[str] = sorted(
    HIGH_CONFIDENCE_SKILLS | MODERATE_CONFIDENCE_SKILLS | LOW_CONFIDENCE_SKILLS
)


# ---------------------------------------------------------------------------
# Tier helpers
# ---------------------------------------------------------------------------


def _tier_index(tier: str | None) -> int:
    """Return the integer index of a tier (None=0, Capable=1, Proficient=2, Elite=3, All-Time Great=4)."""
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
# Compositing matrix — declarative decision table
# ---------------------------------------------------------------------------
#
# Each rule is a (predicate, outcome_factory) pair. The engine evaluates rules
# in priority order and returns the first match. This makes the decision policy
# readable at a glance and independently testable per cell.
#
# Outcome fields:
#   source      — "stats_only" | "auto_accepted" | "flagged"
#   flagged     — bool
#   flag_reason — str | None
#   use_lower   — if True, final_tier = lower(stat, claude); else final_tier = stat_tier
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class _Outcome:
    """Declarative outcome for a single matrix cell."""
    source: str
    flagged: bool
    flag_reason: str | None = None
    use_lower: bool = False


# Priority-ordered compositing rules. First match wins.
# Each entry: (human-readable label, predicate function, outcome)
_COMPOSITING_RULES: list[tuple[str, Any, _Outcome]] = [
    # --- Rule 1: High-confidence skills bypass Claude entirely ---
    (
        "high_confidence",
        lambda ctx: ctx["is_high_confidence"],
        _Outcome(source="stats_only", flagged=False),
    ),
    # --- Rule 2: Claude data missing or failed ---
    (
        "data_missing",
        lambda ctx: ctx["claude_missing"],
        _Outcome(source="flagged", flagged=True, flag_reason="data_missing"),
    ),
    # --- Rule 3: Low-notability override — flags all non-high skills ---
    (
        "low_notability",
        lambda ctx: ctx["low_notability"],
        _Outcome(source="flagged", flagged=True, flag_reason="low_notability", use_lower=True),
    ),
    # --- Rule 4: Exact agreement — always auto-accept ---
    (
        "exact_agreement",
        lambda ctx: ctx["agreement"] == "exact",
        _Outcome(source="auto_accepted", flagged=False),
    ),
    # --- Rule 5: One-tier + low confidence (skill is inherently low-confidence) ---
    (
        "one_tier_low_confidence_skill",
        lambda ctx: ctx["agreement"] == "one_tier" and ctx["is_low_confidence_skill"],
        _Outcome(source="flagged", flagged=True, flag_reason="one_tier_low_confidence", use_lower=True),
    ),
    # --- Rule 6: One-tier + Claude self-reports low confidence on moderate skill ---
    (
        "one_tier_claude_low_confidence",
        lambda ctx: ctx["agreement"] == "one_tier" and ctx["claude_reports_low"],
        _Outcome(source="flagged", flagged=True, flag_reason="claude_low_confidence", use_lower=True),
    ),
    # --- Rule 7: One-tier + moderate confidence — auto-accept lower tier ---
    (
        "one_tier_moderate",
        lambda ctx: ctx["agreement"] == "one_tier",
        _Outcome(source="auto_accepted", flagged=False, use_lower=True),
    ),
    # --- Rule 8: Two-tier (or more) disagreement — always flag ---
    (
        "two_tier_disagreement",
        lambda ctx: ctx["agreement"] == "two_tier",
        _Outcome(source="flagged", flagged=True, flag_reason="two_tier_disagreement", use_lower=True),
    ),
]


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

    Evaluates the declarative _COMPOSITING_RULES matrix in priority order.
    First matching rule determines the outcome.

    Args:
        skill_name:      Snake_case skill key.
        stat_result:     Dict from evaluate_skill (has "tier", "stat_confidence", etc.).
        claude_result:   Dict from claude_assessment (has "tier", "confidence",
                         "claude_failed"). None if skill is high-confidence.
        notability_score: Player notability score (0–100).

    Returns:
        Dict with all composite fields per the spec schema.
    """
    # Extract raw values from inputs
    stat_tier = stat_result.get("tier", "None")
    stat_confidence = stat_result.get("stat_confidence", "low")
    is_high_confidence = skill_name in HIGH_CONFIDENCE_SKILLS

    claude_failed = (claude_result or {}).get("claude_failed", True)
    claude_tier = (claude_result or {}).get("tier") if not claude_failed else None
    claude_confidence = (claude_result or {}).get("confidence") if not claude_failed else None

    # Derived context for rule predicates
    claude_missing = not is_high_confidence and (claude_failed or claude_tier is None)

    diff = _tier_diff(stat_tier, claude_tier) if claude_tier is not None else 0
    if diff == 0:
        agreement = "exact"
    elif diff == 1:
        agreement = "one_tier"
    else:
        agreement = "two_tier"

    # Build the context dict that predicates evaluate against
    ctx = {
        "is_high_confidence": is_high_confidence,
        "claude_missing": claude_missing,
        "low_notability": (not is_high_confidence) and (notability_score < NOTABILITY_MEDIUM),
        "agreement": agreement,
        "is_low_confidence_skill": skill_name in LOW_CONFIDENCE_SKILLS,
        "claude_reports_low": claude_confidence == "low",
    }

    # Find first matching rule
    outcome: _Outcome | None = None
    for _, predicate, rule_outcome in _COMPOSITING_RULES:
        if predicate(ctx):
            outcome = rule_outcome
            break

    # Should never happen — two_tier rule is a catch-all for non-exact, non-one-tier
    if outcome is None:  # pragma: no cover
        raise ValueError(f"No compositing rule matched for skill={skill_name}, ctx={ctx}")

    # Determine final tier based on outcome
    if is_high_confidence or claude_tier is None:
        # High-confidence or missing Claude: final tier is always stat tier
        final_tier = stat_tier
    elif outcome.use_lower:
        final_tier = _lower_tier(stat_tier, claude_tier)
    else:
        final_tier = stat_tier

    # Determine agreement label for output
    if is_high_confidence or claude_missing:
        output_agreement = "skipped"
    else:
        output_agreement = agreement

    # Honor the stat evaluator's review recommendation even when the compositing
    # rules didn't flag (they only cover Claude disagreement / notability).
    # This is what lets always_flag_for_review, data_missing, and borderline
    # tier bumps reach the review queue for HIGH-confidence skills, where
    # Claude never runs and outcome.flagged is always False.
    flagged = outcome.flagged
    flag_reason = outcome.flag_reason
    if not flagged and stat_result.get("review_recommended"):
        flagged = True
        if stat_result.get("data_missing"):
            flag_reason = "data_missing"
        elif stat_result.get("tier_bump_applied"):
            flag_reason = "tier_bump_applied"
        else:
            flag_reason = "always_flag_for_review"

    return {
        "final_tier": final_tier,
        "stat_tier": stat_tier,
        "claude_tier": claude_tier if not is_high_confidence else None,
        "source": outcome.source,
        "stat_confidence": stat_confidence,
        "claude_confidence": claude_confidence if not is_high_confidence else None,
        "agreement": output_agreement,
        "flagged": flagged,
        "flag_reason": flag_reason,
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
    Upsert a draft_skill_profiles record and return its ID.

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
        supabase.table("draft_skill_profiles")
        .upsert(row, on_conflict="player_id,season,source")
        .execute()
    )
    record_id = result.data[0]["id"] if result.data else None
    logger.debug("Upserted draft_skill_profiles source=%s for player %s — id=%s", source, player_id, record_id)
    return record_id


def _upsert_draft_skill_flags(
    composite_profile_id: str,
    composite: dict,
    stat_skills_result: dict,
    claude_skills: dict,
    supabase: Client,
) -> int:
    """
    Upsert draft_skill_flags records for every flagged skill.

    Uses (skill_profile_id, skill_name) as the logical unique key.
    Supabase does not have a composite unique constraint for upsert here, so
    we delete-then-insert to avoid duplicates on re-runs.

    Returns:
        Number of flag records created.
    """
    if not composite_profile_id:
        logger.warning("Cannot upsert draft_skill_flags — composite_profile_id is None")
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
    supabase.table("draft_skill_flags").delete().eq(
        "skill_profile_id", composite_profile_id
    ).execute()

    supabase.table("draft_skill_flags").insert(flagged_rows).execute()

    logger.debug(
        "Inserted %d draft_skill_flags for composite profile %s", len(flagged_rows), composite_profile_id
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
    Persist all three draft_skill_profiles (stats, claude, composite) and all draft_skill_flags.

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
    flags_created = _upsert_draft_skill_flags(
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
