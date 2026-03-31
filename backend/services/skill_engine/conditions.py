"""
skill_engine/conditions.py — Stat resolution and condition evaluation.

Provides:
  - resolve_stat:              dot-path lookup against a stats blob
  - evaluate_condition:        single condition dict → True / False / None
  - evaluate_conditions_block: AND/OR block with arbitrary nesting depth
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)


# ===========================================================================
# Core stat resolution
# ===========================================================================


def resolve_stat(stats_blob: dict, dotpath: str) -> float | None:
    """
    Resolve a dot-notation stat path against a stats blob (or computed map).

    Supports two namespaces:
      - Standard blob paths: "tracking_shooting.catch_shoot_fg3_pct"
        → stats_blob["tracking_shooting"]["catch_shoot_fg3_pct"]
      - Computed namespace: "computed.player_composite"
        → stats_blob["computed"]["player_composite"] (added by compute_derived_stats)

    Returns None if any part of the path is missing or the value itself is None.
    """
    parts = dotpath.split(".", 1)  # Split into at most two parts

    if len(parts) == 1:
        # Top-level key (rare but valid)
        val = stats_blob.get(parts[0])
    else:
        section, key = parts
        section_data = stats_blob.get(section)
        if not isinstance(section_data, dict):
            return None
        val = section_data.get(key)

    # Coerce to float if numeric; return None for missing/null values
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


# ===========================================================================
# Condition evaluation
# ===========================================================================


def evaluate_condition(
    condition: dict, stats_map: dict, games_played: int
) -> bool | None:
    """
    Evaluate a single condition dict against the stats map.

    Condition schema:
      {
        "stat": "tracking_shooting.catch_shoot_fg3_pct",  # dot-path
        "operator": ">=",     # comparison operator
        "value": 0.38,        # threshold value
        "per": "season"       # optional: "season" multiplies per-game by games_played
      }

    Returns:
      True  — condition passes
      False — condition fails
      None  — required stat is null (data missing, can't evaluate)

    Note: play_type _poss stats are season totals already, so "per: season"
    is a no-op for those (the spec exempts them; we detect them by suffix).
    """
    stat_path = condition.get("stat", "")
    op = condition.get("operator", ">=")
    threshold = condition.get("value")
    per = condition.get("per", "")  # "season" or "" (per-game default)

    if threshold is None:
        logger.warning("Condition missing 'value' for stat=%s", stat_path)
        return None

    raw_val = resolve_stat(stats_map, stat_path)
    if raw_val is None:
        return None  # Signal data is missing for this stat

    # Scale per-game stats to season totals when per="season",
    # but skip play_type _poss stats which are already season totals.
    val = raw_val
    if per == "season":
        stat_key = stat_path.split(".")[-1]
        # _poss stats in play_type are already season totals — don't re-multiply
        is_poss_stat = stat_key.endswith("_poss") and stat_path.startswith("play_type.")
        if not is_poss_stat:
            val = raw_val * games_played

    # Evaluate the comparison operator
    threshold = float(threshold)
    if op == ">=":
        return val >= threshold
    elif op == ">":
        return val > threshold
    elif op == "<=":
        return val <= threshold
    elif op == "<":
        return val < threshold
    elif op == "==":
        return val == threshold
    elif op == "!=":
        return val != threshold
    else:
        logger.warning("Unknown operator '%s' in condition for stat=%s", op, stat_path)
        return None


def evaluate_conditions_block(
    block: dict, stats_map: dict, games_played: int
) -> bool | None:
    """
    Evaluate a conditions block that supports AND/OR logic with arbitrary nesting depth.

    The implementation recurses whenever an item has a "conditions" key, so nesting
    beyond one level works correctly. All 19 skills in the current taxonomy fit within
    one level (AND containing OR groups), but deeper nesting is supported if needed.

    Block schema example (AND at top level, OR group inside):
      {
        "logic": "AND",                   # "AND" or "OR" (default: "AND")
        "conditions": [
          { "stat": "...", "operator": ">=", "value": 1.0 },
          {
            "logic": "OR",               # nested group — recurse
            "conditions": [
              { "stat": "...", "operator": ">=", "value": 0.5 },
              { "stat": "...", "operator": ">=", "value": 0.4 }
            ]
          }
        ]
      }

    Returns None if any condition returns None (data missing) and the result
    would be indeterminate. For AND: any None is treated as indeterminate.
    For OR: if any condition passes, None conditions are ignored.
    """
    logic = block.get("logic", "AND").upper()
    conditions = block.get("conditions", [])

    if not conditions:
        return True  # Empty block always passes

    results: list[bool | None] = []

    for item in conditions:
        if "conditions" in item:
            # Nested group — recurse one level
            sub_result = evaluate_conditions_block(item, stats_map, games_played)
        else:
            # Leaf condition
            sub_result = evaluate_condition(item, stats_map, games_played)
        results.append(sub_result)

    if logic == "AND":
        # AND: all must pass; any None makes result indeterminate (return None)
        # unless a False is already present (short-circuit to False)
        if any(r is False for r in results):
            return False
        if any(r is None for r in results):
            return None
        return True  # All True

    else:  # OR
        # OR: if any is True, return True regardless of Nones
        if any(r is True for r in results):
            return True
        if any(r is None for r in results):
            return None
        return False  # All False
