"""
services/pipeline_run_results/repo.py — Staging table CRUD.

Public surface:
  - StagedProfileRow  (frozen dataclass)
  - StagedFlagRow     (frozen dataclass)
  - stage_profile_rows(run_id, rows) -> None
  - stage_flag_rows(run_id, rows) -> None
  - get_diff(run_id) -> dict
  - discard_staged_rows(run_id) -> None

Commit logic lives in commit.py to keep this module focused on CRUD.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Iterable, Optional

from services.supabase_client import get_supabase, run_query

logger = logging.getLogger(__name__)

# Tier order: higher index = lower tier. Used to classify promotions/demotions.
_TIER_ORDER = ["All-Time Great", "Elite", "Proficient", "Capable", "None"]


def _tier_rank(tier: Optional[str]) -> int:
    """Return numeric rank of a tier name. Lower index = higher tier. None → max."""
    if tier is None:
        return len(_TIER_ORDER)
    try:
        return _TIER_ORDER.index(tier)
    except ValueError:
        return len(_TIER_ORDER)


# ---------------------------------------------------------------------------
# Dataclasses — frozen (immutable) per coding-style Invariant
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class StagedProfileRow:
    player_id: str
    season: str
    source: str
    profile: dict


@dataclass(frozen=True)
class StagedFlagRow:
    player_id: str
    skill_name: str
    flag_reason: str
    season: str
    claude_tier: Optional[str] = None
    stats_tier: Optional[str] = None


# ---------------------------------------------------------------------------
# Internal
# ---------------------------------------------------------------------------


def _get_client():
    """Indirection point so tests can patch without touching get_supabase."""
    return get_supabase()


# ---------------------------------------------------------------------------
# Public CRUD
# ---------------------------------------------------------------------------


def stage_profile_rows(run_id: str, rows: Iterable[StagedProfileRow]) -> None:
    """Insert staged profile rows into pipeline_run_results.

    Each row gets run_id attached. Rows with the same (run_id, player_id, source)
    are upserted on conflict (idempotent re-stage).

    Empty rows list is a no-op.
    """
    rows_list = list(rows)
    if not rows_list:
        return

    client = _get_client()
    payload = [
        {
            "run_id": run_id,
            "player_id": row.player_id,
            "season": row.season,
            "source": row.source,
            "profile": row.profile,
        }
        for row in rows_list
    ]

    run_query(
        lambda: client.table("pipeline_run_results")
        .insert(payload)
        .execute()
    )
    logger.debug("Staged %d profile rows for run %s", len(payload), run_id)


def stage_flag_rows(run_id: str, rows: Iterable[StagedFlagRow]) -> None:
    """Insert staged flag rows into pipeline_run_flag_results.

    Each row gets run_id attached.

    Empty rows list is a no-op.
    """
    rows_list = list(rows)
    if not rows_list:
        return

    client = _get_client()
    payload = [
        {
            "run_id": run_id,
            "player_id": row.player_id,
            "skill_name": row.skill_name,
            "flag_reason": row.flag_reason,
            "season": row.season,
            "claude_tier": row.claude_tier,
            "stats_tier": row.stats_tier,
        }
        for row in rows_list
    ]

    run_query(
        lambda: client.table("pipeline_run_flag_results")
        .insert(payload)
        .execute()
    )
    logger.debug("Staged %d flag rows for run %s", len(payload), run_id)


def get_diff(run_id: str) -> dict:
    """Compute diff between staged rows and current draft_skill_profiles.

    Returns:
        {
            "run_id": str,
            "summary": {
                "per_skill": {
                    "<skill_name>": {
                        "promotions": int,
                        "demotions": int,
                        "new": int,
                        "unchanged": int,
                    }
                },
                "total_changed": int,
            },
            "changes": [
                {
                    "player_id": str,
                    "season": str,
                    "source": str,
                    "skill_name": str,
                    "old_tier": str | null,
                    "new_tier": str,
                    "change_type": "promotion" | "demotion" | "new" | "unchanged",
                }
            ],
        }
    """
    client = _get_client()

    # Fetch all staged rows for this run
    staged_result = run_query(
        lambda: client.table("pipeline_run_results")
        .select("*")
        .eq("run_id", run_id)
        .execute()
    )
    staged_rows = staged_result.data or []

    if not staged_rows:
        return {
            "run_id": run_id,
            "summary": {"per_skill": {}, "total_changed": 0},
            "changes": [],
        }

    # Collect the distinct player_ids to look up current profiles
    player_ids = list({row["player_id"] for row in staged_rows})

    # Fetch current draft_skill_profiles for these players
    current_result = run_query(
        lambda: client.table("draft_skill_profiles")
        .select("player_id, season, source, profile")
        .in_("player_id", player_ids)
        .execute()
    )
    current_rows = current_result.data or []

    # Build lookup: (player_id, season, source) -> profile dict
    current_lookup: dict[tuple[str, str, str], dict] = {}
    for row in current_rows:
        key = (row["player_id"], row["season"], row["source"])
        current_lookup[key] = row.get("profile") or {}

    # Compare staged vs current — per skill
    changes: list[dict] = []
    per_skill: dict[str, dict] = {}

    for staged in staged_rows:
        player_id = staged["player_id"]
        season = staged["season"]
        source = staged["source"]
        new_profile = staged.get("profile") or {}
        key = (player_id, season, source)
        old_profile = current_lookup.get(key, {})

        # Walk all skills present in the new profile
        for skill_name, new_skill_data in new_profile.items():
            new_tier = new_skill_data.get("tier") if isinstance(new_skill_data, dict) else None
            old_skill_data = old_profile.get(skill_name)
            old_tier = old_skill_data.get("tier") if isinstance(old_skill_data, dict) else None

            # Classify the change
            if old_tier is None and new_tier is not None:
                change_type = "new"
            elif new_tier == old_tier:
                change_type = "unchanged"
            elif _tier_rank(new_tier) < _tier_rank(old_tier):
                change_type = "promotion"
            else:
                change_type = "demotion"

            if change_type != "unchanged":
                changes.append({
                    "player_id": player_id,
                    "season": season,
                    "source": source,
                    "skill_name": skill_name,
                    "old_tier": old_tier,
                    "new_tier": new_tier,
                    "change_type": change_type,
                })

            # Aggregate per-skill summary counts
            skill_stats = per_skill.setdefault(skill_name, {
                "promotions": 0,
                "demotions": 0,
                "new": 0,
                "unchanged": 0,
            })
            if change_type == "promotion":
                skill_stats["promotions"] += 1
            elif change_type == "demotion":
                skill_stats["demotions"] += 1
            elif change_type == "new":
                skill_stats["new"] += 1
            else:
                skill_stats["unchanged"] += 1

    total_changed = sum(
        s["promotions"] + s["demotions"] + s["new"]
        for s in per_skill.values()
    )

    return {
        "run_id": run_id,
        "summary": {"per_skill": per_skill, "total_changed": total_changed},
        "changes": changes,
    }


def discard_staged_rows(run_id: str) -> None:
    """Delete all staged rows for a run from both staging tables."""
    client = _get_client()

    run_query(
        lambda: client.table("pipeline_run_results")
        .delete()
        .eq("run_id", run_id)
        .execute()
    )
    run_query(
        lambda: client.table("pipeline_run_flag_results")
        .delete()
        .eq("run_id", run_id)
        .execute()
    )
    logger.debug("Discarded staged rows for run %s", run_id)
