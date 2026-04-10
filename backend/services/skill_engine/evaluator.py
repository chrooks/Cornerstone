"""
skill_engine/evaluator.py — Per-skill and all-skill evaluation, auto-promotions.

Provides:
  - evaluate_skill:        full pipeline for a single skill (pre-adj → compute → stabilize → tier)
  - _collect_driving_stats: stats that drove the tier decision
  - evaluate_all_skills:   iterate over all threshold rules for one player
  - apply_auto_promotions: second-pass cross-skill tier promotions
"""

import logging
from typing import Any

from services.skill_engine.conditions import (
    evaluate_condition,
    evaluate_conditions_block,
    resolve_stat,
)
from services.skill_engine.transforms import (
    apply_pre_adjustments,
    apply_stabilization,
    compute_derived_stats,
)

logger = logging.getLogger(__name__)

# Tier labels — order matters for comparisons (highest to lowest).
# All-Time Great=index 0, Elite=index 1, Proficient=index 2, Capable=index 3, None=index 4.
_TIER_ORDER = ["All-Time Great", "Elite", "Proficient", "Capable", "None"]


def evaluate_skill(
    skill_name: str,
    rule: dict,
    stats_blob: dict,
    league_avgs: dict[str, float],
    debug: bool = False,
) -> dict:
    """
    Evaluate a single skill against a player's stats blob using the rule definition.

    Evaluation pipeline:
      1. Apply pre-adjustments (stat aliasing)
      2. Compute derived/composite stats
      3. Run stabilization → add stabilized values to stats_map
      4. Check volume gate (minimum usage threshold)
      5. Evaluate tier conditions (Elite → Capable → None)
      6. Check borderline tier bumps
      7. Build result dict with driving stats

    Returns the evaluate_skill result shape (see module docstring).
    """
    # Extract games_played from metadata section of the blob
    games_played = int(
        (stats_blob.get("metadata") or {}).get("games_played") or 0
    )
    if games_played == 0:
        # games_played=0 means metadata is missing or the player has no recorded games.
        # Any condition with per="season" will multiply by 0, silently failing volume gates.
        # We log and continue rather than short-circuit so callers see a full (if unreliable)
        # result rather than an empty one — review_recommended will be True regardless.
        logger.debug(
            "evaluate_skill '%s': games_played=0 in metadata — per='season' scaling disabled",
            skill_name,
        )

    # --- Step 1: Pre-adjustments (stat aliasing for screen setter etc.) ---
    stats_map = apply_pre_adjustments(rule, stats_blob)

    # --- Step 2: Compute derived / composite stats ---
    stats_map = compute_derived_stats(rule, stats_map)

    # --- Step 3: Stabilize percentage and PPP stats ---
    stabilized_vals = apply_stabilization(rule, stats_map, games_played, league_avgs)

    # Merge stabilized values into a flat working stats map that conditions
    # can reference via "stabilized.tracking_shooting.catch_shoot_fg3_pct" paths.
    # We store them in a dedicated "stabilized" sub-dict for clean resolution.
    stats_map = dict(stats_map)  # Shallow copy before adding stabilized
    stats_map["stabilized"] = {}
    for k, v in stabilized_vals.items():
        # Key format: "stabilized.section.stat_key"
        # We store under stats_map["stabilized"]["section.stat_key"] so that
        # resolve_stat("stabilized.tracking_shooting.catch_shoot_fg3_pct") works.
        inner_key = k[len("stabilized."):]  # Strip "stabilized." prefix
        stats_map["stabilized"][inner_key] = v

    # --- Step 4: Volume gate — minimum usage check before tier evaluation ---
    volume_gate = rule.get("volume_gate")
    volume_gate_passed = True
    data_missing = False

    if volume_gate:
        vg_result = evaluate_conditions_block(volume_gate, stats_map, games_played)
        if vg_result is None:
            # Required volume stats are missing — mark data_missing and skip evaluation
            data_missing = True
            volume_gate_passed = False
        elif not vg_result:
            volume_gate_passed = False

    # --- Step 5: Tier evaluation (Elite → Capable → None) ---
    tier = "None"
    tier_bump_applied = False
    driving_stats: dict[str, Any] = {}

    # stat_confidence comes from the rule definition (set per skill, not per player).
    # It reflects the reliability of the underlying stats, not sample size.
    stat_confidence = rule.get("stat_confidence", "low")

    if volume_gate_passed and not data_missing:
        # Try tier conditions from highest to lowest (Elite → Capable → None).
        # Normalize tier keys to lowercase to handle both "Elite" and "elite" in the JSONB.
        raw_tier_defs = rule.get("tiers", {})
        tier_defs = {k.lower(): v for k, v in raw_tier_defs.items()}

        # Lookup table avoids str.capitalize() which breaks "all-time great" → "All-time great"
        _TIER_DISPLAY = {
            "all-time great": "All-Time Great",
            "elite":          "Elite",
            "proficient":     "Proficient",
            "capable":        "Capable",
        }

        for tier_name in ["all-time great", "elite", "proficient", "capable"]:
            tier_rule = tier_defs.get(tier_name)
            if not tier_rule:
                continue

            # tier_rule is the full block dict: {"conditions": [...], "logic": "AND"}
            # Pass it directly to evaluate_conditions_block (not just the conditions list)
            result = evaluate_conditions_block(tier_rule, stats_map, games_played)

            if result is True:
                tier = _TIER_DISPLAY[tier_name]
                break  # Stop at first passing tier
            elif result is None:
                # Missing data for this tier's conditions — flag it
                data_missing = True

        # --- Step 6: Check top-level tier_bumps ---
        # Bumps promote or demote by exactly one tier, subject to ceiling/floor constraints.
        # bump_up_one_tier:   None→Capable, Capable→Proficient, ..., subject to max_tier ceiling.
        # bump_down_one_tier: Elite→Proficient, Proficient→Capable, ..., subject to min_tier floor.
        # Bump-ups run first so a subsequent bump-down can override a promotion (e.g. a player
        # who would get a bump-up but has a disqualifying weakness gets the bump-down applied last).
        bumps = rule.get("tier_bumps", [])

        # Apply bump-ups first (lower index = higher tier in _TIER_ORDER), skipping if at top
        if tier != "All-Time Great":
            for bump in bumps:
                effect = bump.get("effect", "")
                max_tier = bump.get("max_tier", "Elite")
                bump_condition = bump.get("condition", {})

                if effect != "bump_up_one_tier":
                    continue

                # Compute the promoted tier: one step up in _TIER_ORDER
                # (lower index = higher tier, so subtract 1 from current index)
                current_idx = _TIER_ORDER.index(tier)
                bumped_tier = _TIER_ORDER[current_idx - 1]

                # Respect max_tier ceiling — skip if the promoted tier would exceed it.
                # e.g. max_tier="Capable" (idx 1): bumped "Elite" (idx 0) → 0 < 1 → skip.
                # e.g. max_tier="Capable" (idx 1): bumped "Capable" (idx 1) → 1 < 1 → allow.
                if _TIER_ORDER.index(bumped_tier) < _TIER_ORDER.index(max_tier):
                    continue  # Bump would exceed max_tier ceiling — skip

                # Evaluate the bump condition; it may be a block (has "conditions" key) or a leaf
                if "conditions" in bump_condition or "logic" in bump_condition:
                    bump_result = evaluate_conditions_block(bump_condition, stats_map, games_played)
                else:
                    bump_result = evaluate_condition(bump_condition, stats_map, games_played)

                if bump_result is True:
                    logger.debug(
                        "Tier bump applied: %s → %s (rule: %s)", tier, bumped_tier, skill_name
                    )
                    tier = bumped_tier
                    tier_bump_applied = True
                    break  # Only one bump-up per evaluation pass

        # Apply bump-downs last so they can override a bump-up when a player has a disqualifying
        # weakness (e.g. elite mid-range but poor 3pt pull-up shooting).
        for bump in bumps:
            effect = bump.get("effect", "")
            if effect != "bump_down_one_tier":
                continue

            # min_tier is the lowest tier this bump is allowed to reach (default: Capable).
            # e.g. min_tier="Proficient": demoting Elite→Proficient is allowed,
            #   but demoting Proficient→Capable via this bump is not.
            min_tier = bump.get("min_tier", "Capable")
            bump_condition = bump.get("condition", {})

            # Can only demote if currently above None (i.e., there is a lower tier to fall to)
            current_idx = _TIER_ORDER.index(tier)
            if current_idx >= len(_TIER_ORDER) - 1:
                continue  # Already at None — nothing lower to bump down to

            demoted_tier = _TIER_ORDER[current_idx + 1]

            # Respect min_tier floor — skip if the demoted tier would fall below it.
            if _TIER_ORDER.index(demoted_tier) > _TIER_ORDER.index(min_tier):
                continue  # Would go below min_tier floor — skip

            # Evaluate the bump condition
            if "conditions" in bump_condition or "logic" in bump_condition:
                bump_result = evaluate_conditions_block(bump_condition, stats_map, games_played)
            else:
                bump_result = evaluate_condition(bump_condition, stats_map, games_played)

            if bump_result is True:
                logger.debug(
                    "Tier bump down applied: %s → %s (rule: %s)", tier, demoted_tier, skill_name
                )
                tier = demoted_tier
                tier_bump_applied = True
                break  # Only one bump-down per evaluation pass

        # --- Step 7: Collect driving stats (key stats referenced in the rule) ---
        driving_stats = _collect_driving_stats(rule, stats_map, stabilized_vals)

    # Determine if human review is recommended:
    # Covers: data missing, always_flag_for_review rules, and tier bump borderline promotions.
    always_flag = rule.get("always_flag_for_review", False)
    review_recommended = data_missing or bool(always_flag) or tier_bump_applied

    # Strip the "stabilized." prefix so keys match the "section.key" format
    # used by the frontend's PlayerStatDisplay (e.g. "play_type.pr_ball_handler_ppp").
    # The frontend merges these over the blob's stabilized sub-dict to show the
    # correct Bayesian-adjusted values for the active skill.
    stripped_stabilized = {
        k[len("stabilized."):]: v for k, v in stabilized_vals.items()
    }

    result_dict: dict = {
        "skill_name": skill_name,
        "tier": tier,
        "stat_confidence": stat_confidence,
        "review_recommended": review_recommended,
        "data_missing": data_missing,
        "driving_stats": driving_stats,
        "volume_gate_passed": volume_gate_passed,
        "tier_bump_applied": tier_bump_applied,
        "auto_promoted": False,  # Second-pass promotions set this; default False
        "flags": [],
        "stabilized_vals": stripped_stabilized,  # Skill-specific Bayesian values for UI display
    }

    # Attach debug info when requested (full rule, stats_map snapshot, tier decisions)
    if debug:
        result_dict["debug"] = {
            "rule": rule,
            "games_played": games_played,
            "stabilized_vals": stabilized_vals,
            "volume_gate_result": volume_gate_passed,
        }

    return result_dict


def collect_condition_results(
    rule: dict,
    stats_blob: dict,
    league_avgs: dict[str, float],
) -> list[dict]:
    """
    Return per-condition pass/fail details for the calibration UI.

    Runs the same preprocessing pipeline as evaluate_skill (pre-adjustments,
    derived stats, stabilization) and then evaluates every leaf condition
    individually, returning a flat list ordered by section:
      volume_gate → elite → capable → tier_bump

    Each entry: {section, stat, operator, threshold, actual_value, passed, per, stabilized}
    """
    games_played = int(
        (stats_blob.get("metadata") or {}).get("games_played") or 0
    )
    stats_map = apply_pre_adjustments(rule, stats_blob)
    stats_map = compute_derived_stats(rule, stats_map)
    stabilized_vals = apply_stabilization(rule, stats_map, games_played, league_avgs)

    # Merge stabilized values into stats_map so condition evaluation works
    stats_map = dict(stats_map)
    stats_map["stabilized"] = {}
    for k, v in stabilized_vals.items():
        inner_key = k[len("stabilized."):]
        stats_map["stabilized"][inner_key] = v

    results: list[dict] = []

    def _eval_leaf(condition: dict, section: str) -> dict:
        stat_path = condition.get("stat", "")
        op = condition.get("operator", ">=")
        threshold = condition.get("value")
        per = condition.get("per", "")
        is_stabilized = condition.get("stabilized", False)

        # Resolve the actual value — prefer stabilized path when the condition uses it
        if is_stabilized:
            actual = resolve_stat(stats_map, f"stabilized.{stat_path}")
            if actual is None:
                actual = resolve_stat(stats_map, stat_path)
        else:
            actual = resolve_stat(stats_map, stat_path)

        # Apply default_value when the stat is null (mirrors evaluate_condition logic)
        if actual is None:
            default_value = condition.get("default_value")
            if default_value is not None:
                actual = float(default_value)

        # Scale per-season conditions the same way evaluate_condition does.
        # play_type._poss values are stored per-game, so they must also be multiplied.
        display_value = actual
        if actual is not None and per == "season":
            display_value = actual * games_played

        # Compute pass/fail
        passed: bool | None = None
        if display_value is not None and threshold is not None:
            t = float(threshold)
            if op == ">=":   passed = display_value >= t
            elif op == ">":  passed = display_value > t
            elif op == "<=": passed = display_value <= t
            elif op == "<":  passed = display_value < t
            elif op == "==": passed = display_value == t
            elif op == "!=": passed = display_value != t

        return {
            "section":      section,
            "stat":         stat_path,
            "operator":     op,
            "threshold":    threshold,
            "actual_value": display_value,
            "passed":       passed,
            "per":          per or None,
            "stabilized":   is_stabilized,
            # Grouping fields — filled in by _walk_block
            "group_id":     None,
            "group_logic":  None,
            "depth":        0,
        }

    # Monotonically incrementing counter for group IDs so the frontend can
    # detect group boundaries without comparing adjacent items.
    _group_counter = [0]

    def _walk_block(block: dict, section: str, depth: int = 0) -> None:
        logic = block.get("logic", "AND").upper()
        group_id = _group_counter[0]
        _group_counter[0] += 1

        for item in block.get("conditions", []):
            if "conditions" in item:
                # Nested AND/OR group — recurse one level deeper
                _walk_block(item, section, depth + 1)
            else:
                leaf = _eval_leaf(item, section)
                leaf["group_id"] = group_id
                leaf["group_logic"] = logic
                leaf["depth"] = depth
                results.append(leaf)

    # Sections in display order
    vg = rule.get("volume_gate")
    if vg:
        _walk_block(vg, "volume_gate")

    tiers_lower = {k.lower(): v for k, v in rule.get("tiers", {}).items()}
    for tier_name in ["all-time great", "elite", "proficient", "capable"]:
        tier_block = tiers_lower.get(tier_name, {})
        if tier_block:
            _walk_block(tier_block, tier_name)

    for bump in rule.get("tier_bumps", []):
        bump_cond = bump.get("condition", {})
        if "conditions" in bump_cond:
            _walk_block(bump_cond, "tier_bump")
        elif bump_cond:
            results.append(_eval_leaf(bump_cond, "tier_bump"))

    return results


def _collect_driving_stats(
    rule: dict,
    stats_map: dict,
    stabilized_vals: dict[str, float],
) -> dict[str, Any]:
    """
    Collect the key stats that drove the tier decision for this skill.

    Includes:
      - Stats referenced in the volume gate conditions
      - Stats referenced in tier conditions (Elite and Capable)
      - Stats referenced in tier_bump conditions
      - Stabilized counterparts where available

    This gives transparency into why a player received their tier rating.
    """
    driving: dict[str, Any] = {}

    # Gather all stat paths referenced anywhere in the rule
    referenced_paths: set[str] = set()

    def _collect_paths_from_block(block: dict) -> None:
        """Recursively extract stat paths from a conditions block."""
        for item in block.get("conditions", []):
            if "conditions" in item:
                _collect_paths_from_block(item)
            else:
                path = item.get("stat", "")
                if path:
                    referenced_paths.add(path)

    for block_key in ("volume_gate",):
        block = rule.get(block_key)
        if block:
            _collect_paths_from_block(block)

    # Collect stats referenced in each tier_bump condition so bumped players'
    # driving stats include the stat that triggered the promotion
    for bump in rule.get("tier_bumps", []):
        bump_cond = bump.get("condition")
        if bump_cond:
            _collect_paths_from_block(
                bump_cond if "conditions" in bump_cond else {"conditions": [bump_cond]}
            )

    tiers_lower = {k.lower(): v for k, v in rule.get("tiers", {}).items()}
    for tier_name in ["all-time great", "elite", "proficient", "capable"]:
        tier_rule = tiers_lower.get(tier_name, {})
        # tier_rule is the full block; conditions are inside it
        if tier_rule.get("conditions"):
            _collect_paths_from_block(tier_rule)

    # Resolve each referenced path to its raw value
    for path in sorted(referenced_paths):
        val = resolve_stat(stats_map, path)
        if val is not None:
            driving[path] = val

        # Include stabilized counterpart if it exists
        stab_key = f"stabilized.{path}"
        if stab_key in stabilized_vals:
            driving[stab_key] = stabilized_vals[stab_key]

    return driving


def evaluate_all_skills(
    stats_blob: dict,
    thresholds: dict[str, Any],
    league_avgs: dict[str, float],
    debug: bool = False,
) -> dict[str, dict]:
    """
    Evaluate all skills in the thresholds dict against a single player's stats blob.

    Returns: { skill_name: evaluate_skill_result_dict, ... }
    """
    results: dict[str, dict] = {}

    for skill_name, rule in thresholds.items():
        try:
            skill_result = evaluate_skill(skill_name, rule, stats_blob, league_avgs, debug=debug)
            results[skill_name] = skill_result
        except Exception:
            logger.exception("Error evaluating skill '%s' — skipping", skill_name)
            # Return a safe default result rather than crashing the whole evaluation
            results[skill_name] = {
                "skill_name": skill_name,
                "tier": "None",
                "stat_confidence": "low",
                "review_recommended": True,
                "data_missing": True,
                "driving_stats": {},
                "volume_gate_passed": False,
                "tier_bump_applied": False,
                "auto_promoted": False,
                "flags": ["evaluation_error"],
            }

    return results


def apply_auto_promotions(
    skills_result: dict[str, dict],
    thresholds: dict[str, Any],
) -> dict[str, dict]:
    """
    Second-pass promotion: a skill's achieved tier can trigger a minimum tier
    guarantee on another skill.

    Auto-promotion rules are defined on the SOURCE skill (e.g., movement_shooter):
      {
        "auto_promotions": [
          {
            "if_tier_gte": "Capable",         # Source skill must be at least this tier
            "then_set_skill": "spot_up_shooter", # Target skill to promote
            "to_minimum_tier": "Capable"      # Ensure target is at least this tier
          }
        ]
      }

    Only promotes (never demotes). Sets auto_promoted=True on the TARGET skill.
    Returns a new dict (does not mutate the input).
    """
    # Shallow-copy the outer dict; inner dicts are copied on write (below)
    updated = {k: dict(v) for k, v in skills_result.items()}

    for source_skill, rule in thresholds.items():
        auto_promotions = rule.get("auto_promotions", [])
        if not auto_promotions:
            continue

        # Determine the SOURCE skill's current tier
        source_result = updated.get(source_skill)
        if source_result is None:
            continue

        source_tier = source_result.get("tier", "None")

        for promo in auto_promotions:
            required_tier = promo.get("if_tier_gte", "")     # e.g., "Capable"
            target_skill = promo.get("then_set_skill", "")   # e.g., "spot_up_shooter"
            promote_to = promo.get("to_minimum_tier", "")    # e.g., "Capable"

            if not required_tier or not target_skill or not promote_to:
                continue

            # Validate tier names to avoid index errors
            if required_tier not in _TIER_ORDER or promote_to not in _TIER_ORDER:
                logger.warning("Invalid tier in auto_promotion for %s: %s", source_skill, promo)
                continue

            # Check if source skill meets the required tier threshold.
            # Lower index = higher tier (Elite=0, Capable=1, None=2).
            # "gte" means source_tier index <= required_tier index.
            source_meets_requirement = (
                _TIER_ORDER.index(source_tier) <= _TIER_ORDER.index(required_tier)
            )
            if not source_meets_requirement:
                continue

            # Get the TARGET skill's current result
            target_result = updated.get(target_skill)
            if target_result is None:
                continue

            current_target_tier = target_result.get("tier", "None")

            # Only promote — if promote_to is higher than the target's current tier, apply it.
            if _TIER_ORDER.index(promote_to) < _TIER_ORDER.index(current_target_tier):
                logger.debug(
                    "Auto-promoting %s: %s → %s (triggered by %s at %s)",
                    target_skill, current_target_tier, promote_to, source_skill, source_tier,
                )
                updated[target_skill] = dict(target_result)
                updated[target_skill]["tier"] = promote_to
                updated[target_skill]["auto_promoted"] = True

    return updated
