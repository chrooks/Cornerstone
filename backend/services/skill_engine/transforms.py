"""
skill_engine/transforms.py — Stat transformation pipeline.

Provides:
  - apply_pre_adjustments:  conditional stat modifiers before tier evaluation
  - compute_derived_stats:  formula-based composite stat computation
  - apply_stabilization:    Bayesian shrinkage toward league average
"""

import copy
import logging
from typing import Any

from services.skill_engine.conditions import evaluate_condition, resolve_stat

logger = logging.getLogger(__name__)


# ===========================================================================
# Pre-adjustments
# ===========================================================================


def apply_pre_adjustments(rule: dict, stats_map: dict) -> dict:
    """
    Apply pre-evaluation stat adjustments defined in the rule, returning a
    modified copy of stats_map. Does not mutate the original.

    Used for skills like "Screen Setter" where a conditional modifier boosts
    a stat before tier evaluation (e.g. add 0.5 screen assists if box_outs_off >= 2).

    Pre-adjustment schema:
      {
        "pre_adjustments": [
          {
            "if": {"stat": "hustle.box_outs_off", "operator": ">=", "value": 2.0},
            "then_add": 0.5,
            "to_stat": "hustle.screen_assists"
          }
        ]
      }

    WARNING: The copy.deepcopy at the top of this function is load-bearing.
    It is the only thing preventing multiple adjustments from mutating the original
    stats blob. Do NOT remove or replace it with a shallow copy.
    """
    pre_adjustments = rule.get("pre_adjustments", [])
    if not pre_adjustments:
        return stats_map  # No adjustments — return as-is (no copy needed)

    # Deep-copy the entire stats_map upfront so any number of adjustments targeting
    # any section can mutate freely without risk of touching the original blob.
    modified: dict = copy.deepcopy(stats_map)

    for adj in pre_adjustments:
        condition = adj.get("if")
        then_add = adj.get("then_add")
        to_stat_path = adj.get("to_stat", "")

        if condition is None or then_add is None or not to_stat_path:
            continue

        # Evaluate the if-condition to determine whether adjustment applies
        games_played = int(
            (stats_map.get("metadata") or {}).get("games_played") or 0
        )
        cond_result = evaluate_condition(condition, modified, games_played)
        if cond_result is not True:
            continue

        # Locate and update the target stat, deep-copying its section
        parts = to_stat_path.split(".", 1)
        if len(parts) != 2:
            logger.warning("pre_adjustment to_stat must be section.key format: %s", to_stat_path)
            continue

        section, key = parts
        current_section = modified.get(section) or {}
        current_val = current_section.get(key)

        if current_val is None:
            continue  # Can't adjust a missing stat

        # Deep-copy was taken at the top — mutate directly
        modified[section][key] = float(current_val) + float(then_add)

        logger.debug(
            "Pre-adjustment: %s %.2f + %.2f = %.2f",
            to_stat_path, float(current_val), float(then_add), modified[section][key],
        )

    return modified


# ===========================================================================
# Derived stat computation
# ===========================================================================


def compute_derived_stats(rule: dict, stats_map: dict) -> dict:
    """
    Compute derived/composite stats defined in the rule and add them to the
    "computed" namespace. Returns a modified copy of stats_map.

    Supported formulas:
      - "sum": weighted sum of component stats
          { "formula": "sum", "components": [{"stat": "...", "weight": 1.0}, ...] }
      - "weighted_average": possession-weighted mean PPP
          { "formula": "weighted_average", "components": [{"stat": "...", "weight_stat": "..."}, ...] }
      - "ratio": numerator / denominator
          { "formula": "ratio", "components": [{"role": "numerator", "stat": "..."}, ...] }
      - "expression": hardcoded composite expression identified by name
          { "formula": "expression", "name": "perim_disruptor_composite" }

    Derived stats are added as stats_map["computed"]["stat_name"].
    """
    derived_stats = rule.get("computed_stats", [])
    if not derived_stats:
        return stats_map

    # Shallow copy at top level; deep-copy the computed sub-dict to isolate mutations
    modified = dict(stats_map)
    modified["computed"] = dict(stats_map.get("computed") or {})

    for derived in derived_stats:
        # "name" is used as both the identifier and the output key in the computed namespace
        output_key = derived.get("name", "")
        formula = derived.get("formula", "")

        if not output_key or not formula:
            continue

        computed_val: float | None = None

        if formula == "sum":
            # Weighted sum: result = sum(component_val * weight)
            # If any component is None, the whole composite is None.
            total = 0.0
            all_present = True
            for component in derived.get("components", []):
                c_val = resolve_stat(modified, component.get("stat", ""))
                if c_val is None:
                    all_present = False
                    break
                weight = float(component.get("weight", 1.0))
                total += c_val * weight

            computed_val = total if all_present else None

        elif formula == "weighted_average":
            # Possession-weighted average PPP: sum(ppp * poss) / sum(poss)
            # Each component has "stat" (the PPP path) and "weight_stat" (poss path).
            numerator = 0.0
            denominator = 0.0
            for component in derived.get("components", []):
                ppp_val = resolve_stat(modified, component.get("stat", ""))
                poss_val = resolve_stat(modified, component.get("weight_stat", ""))
                if ppp_val is not None and poss_val is not None and poss_val > 0:
                    numerator += ppp_val * poss_val
                    denominator += poss_val

            computed_val = (numerator / denominator) if denominator > 0 else None

        elif formula == "ratio":
            # Ratio of two stats: numerator / denominator
            # Components use role="numerator" and role="denominator".
            num_val: float | None = None
            den_val: float | None = None
            for component in derived.get("components", []):
                role = component.get("role", "")
                val = resolve_stat(modified, component.get("stat", ""))
                if role == "numerator":
                    num_val = val
                elif role == "denominator":
                    den_val = val

            if num_val is not None and den_val is not None and den_val > 0:
                computed_val = num_val / den_val

        elif formula == "expression":
            # Named composite expressions — each has a specific formula documented
            # in the spec. These are the only hardcoded logic in the service.
            expr_name = derived.get("name", "")

            if expr_name == "perim_disruptor_composite":
                # perimeter disruptor composite formula (per spec):
                #   (stl_pct × 1000) + deflections + (contested_shots_3pt × 0.5)
                # stl_pct is stored as a decimal fraction (e.g., 0.02 for 2%),
                # so multiply by 1000 to scale it to the same magnitude as the other terms.
                stl_pct = resolve_stat(modified, "advanced.stl_pct")
                deflections = resolve_stat(modified, "tracking_defense.deflections")
                contested_3pt = resolve_stat(modified, "tracking_defense.contested_shots_3pt")

                if all(v is not None for v in [stl_pct, deflections, contested_3pt]):
                    computed_val = (stl_pct * 1000) + deflections + (contested_3pt * 0.5)
                # else: computed_val remains None (data missing)

        # Store the computed value under the "computed" sub-dict
        modified["computed"][output_key] = computed_val
        logger.debug("Computed derived stat %s = %s (formula=%s)", output_key, computed_val, formula)

    return modified


# ===========================================================================
# Stabilization
# ===========================================================================


def apply_stabilization(
    rule: dict,
    stats_map: dict,
    games_played: int,
    league_avgs: dict[str, float],
) -> dict[str, float]:
    """
    Apply Bayesian stabilization to percentage and PPP stats per the rule spec.

    Formula: stabilized = (player_makes + K * league_avg) / (player_attempts + K)

    For percentage stats (e.g., catch_shoot_fg3_pct):
      - attempts (season total) = per_game_attempts * games_played
      - makes (season total) = per_game_attempts * games_played * fg_pct
      - attempt stat path = pct_path with "_pct" replaced by "a"
      - Output: divide back by games_played to return per-game stabilized pct

    For PPP stats (e.g., offscreen_ppp):
      - attempts = corresponding _poss stat (season total, not multiplied)
      - makes equivalent = ppp * poss
      - Output: stabilized value is the stabilized PPP directly (already per-poss)

    Returns: { "stabilized.{stat_path}": stabilized_value, ... }
    """
    stabilizations = rule.get("stabilization", [])
    result: dict[str, float] = {}

    for stab in stabilizations:
        stat_path = stab.get("stat", "")
        K = float(stab.get("K", 50))  # Credibility constant (default 50)

        if not stat_path:
            continue

        raw_val = resolve_stat(stats_map, stat_path)
        if raw_val is None:
            continue  # Can't stabilize missing stats

        # Determine the stat type: "pct" or "ppp"
        stat_key = stat_path.split(".")[-1]
        stat_section = stat_path.split(".")[0]

        # Look up the league average for this stat
        league_avg = league_avgs.get(stat_path)
        if league_avg is None:
            # No league average available — skip stabilization for this stat
            logger.debug("No league average for %s — skipping stabilization", stat_path)
            continue

        stabilized_val: float | None = None

        if stat_key.endswith("_pct"):
            # Percentage stat: derive attempt stat path by replacing "_pct" with "a"
            attempt_key = stat_key[: -len("_pct")] + "a"
            attempt_path = f"{stat_section}.{attempt_key}"

            per_game_attempts = resolve_stat(stats_map, attempt_path)
            if per_game_attempts is None or per_game_attempts <= 0:
                continue  # Can't stabilize with zero attempts

            # Scale to season totals for the Bayesian formula
            season_attempts = per_game_attempts * games_played
            season_makes = season_attempts * raw_val  # pct → makes

            # Bayesian stabilization toward league average
            stabilized_season_pct = (season_makes + K * league_avg) / (
                season_attempts + K
            )

            # Convert back to per-game basis (same unit as the raw stat)
            stabilized_val = stabilized_season_pct

        elif stat_key.endswith("_ppp") and stat_section == "play_type":
            # PPP stat: attempt stat is the corresponding _poss stat (season total)
            poss_key = stat_key[: -len("_ppp")] + "_poss"
            poss_path = f"{stat_section}.{poss_key}"

            season_poss = resolve_stat(stats_map, poss_path)
            if season_poss is None or season_poss <= 0:
                continue  # Can't stabilize without possession count

            # For PPP: "makes" = ppp * poss (points earned equivalent)
            ppp_numerator = raw_val * season_poss  # total points from this play type

            # Bayesian stabilization toward league average PPP
            stabilized_val = (ppp_numerator + K * league_avg) / (season_poss + K)

        if stabilized_val is not None:
            # Store under a "stabilized." prefix so conditions can reference it
            result_key = f"stabilized.{stat_path}"
            result[result_key] = stabilized_val
            logger.debug(
                "Stabilized %s: raw=%.4f → stabilized=%.4f (K=%d, league_avg=%.4f)",
                stat_path, raw_val, stabilized_val, K, league_avg,
            )

    return result
