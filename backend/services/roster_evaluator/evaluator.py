"""
roster_evaluator/evaluator.py — 4-layer scoring pipeline orchestration.

Public API:
  evaluate_roster(players, mode, debug) -> RosterEvaluation

Pipeline layers:
  Layer 1 — Skill Aggregation: per-player slot-weighted tier contributions
  Layer 2 — Dimension Scores: raw → normalized per-dimension scores + context flags
  Layer 3 — Interaction Modifiers: apply all 33 modifiers as additive deltas
  Layer 4 — Hard Checks + Finalization: apply floor checks, compute composite scores

The cornerstone (is_cornerstone=True) contributes ONLY to context flags (Layer 2)
and modifier condition checks — never to the aggregate dimension scores.
"""

from __future__ import annotations

import logging
import math
from typing import Literal

logger = logging.getLogger(__name__)

from .modifiers import ALL_MODIFIERS, guard_range, _parse_height_inches, HEIGHT_COVERAGE_LOW, HEIGHT_COVERAGE_HIGH
from .hard_checks import ALL_HARD_CHECKS
from .optionality import compute_optionality, compute_robustness
from .cornerstone_complement import get_complement_notes
from .team_description import generate_team_description
from .types import Note, RosterEvaluation, Scores
from .weights import (
    TIER_VALUES,
    SLOT_WEIGHTS,
    SKILL_WEIGHTS,
    DIMENSION_WEIGHTS,
    OFFENSE_SUBWEIGHTS,
    MODIFIER_DELTAS,
    REDUNDANCY_RANGES,
    SEVERITY_ORDER,
    LIVE_NOTE_LIMIT,
    LIVE_STRENGTH_LIMIT,
    ABSENCE_NOTE_MIN_PLAYERS,
    COMPLEMENT_STAGE_CUTOFF,
    SPACING_SLOT_WEIGHT_FLOOR,
    NOTE_SUPPRESSION_THRESHOLD,
)

# Skills that contribute to the spacing dimension — these use SPACING_SLOT_WEIGHT_FLOOR
_SPACING_SKILLS: frozenset[str] = frozenset({"movement_shooter", "spot_up_shooter", "screen_setter"})

# ---------------------------------------------------------------------------
# Minimum severity overrides — built at module load by scanning ALL_MODIFIERS
# for note_min_severity attributes set on modifier functions.
# Applied in note assembly: promotes severity if the computed level is weaker
# than the override. Never demotes — promotion only.
# ---------------------------------------------------------------------------
_MIN_SEVERITY_OVERRIDES: dict[str, str] = {
    modifier_fn.__name__.replace("check_", "").upper(): getattr(modifier_fn, "note_min_severity", None)
    for modifier_fn in ALL_MODIFIERS
    if getattr(modifier_fn, "note_min_severity", None) is not None
}


# ---------------------------------------------------------------------------
# Theoretical maximum per dimension — pre-computed at module load.
# Used to normalize raw layer-1 scores to 0–100.
# Maximum assumes all 9 supporting slots at All-Time Great tier (value=8),
# highest skill weight for that dimension, full slot weight.
# ---------------------------------------------------------------------------

def _compute_theoretical_max(dimension: str) -> float:
    """
    Compute the theoretical maximum raw score for a dimension by assuming:
    - All slots 1–9 are filled (slot weights 1.0, 0.85, 0.70, ..., 0.05)
    - Each player has the highest-weight skill for that dimension at ATG (8)
    - No diminishing returns applied (we normalize against this ceiling)
    """
    max_skill_weight = max(
        (weights.get(dimension, 0.0) for weights in SKILL_WEIGHTS.values()),
        default=1.0,
    )
    atg_value = TIER_VALUES["All-Time Great"]
    raw_max = sum(
        atg_value * max_skill_weight * SLOT_WEIGHTS[slot]
        for slot in range(1, 10)
    )
    return raw_max if raw_max > 0 else 1.0  # avoid division by zero


# Pre-compute at module load to avoid repeating in hot path
_THEORETICAL_MAX: dict[str, float] = {
    dim: _compute_theoretical_max(dim)
    for dim in ("spacing", "creation", "defense", "paint", "transition")
}


# ---------------------------------------------------------------------------
# Input normalization
# ---------------------------------------------------------------------------

def normalize_player(player: dict) -> dict:
    """
    Sanitize a raw player dict into the unified shape expected by the pipeline.
    Returns a new dict; does not mutate the original.
    """
    raw_skills: dict = player.get("skills") or {}
    clean_skills = {
        k: (v if v is not None else "None")
        for k, v in raw_skills.items()
    }
    return {
        "name":           player.get("name", ""),
        "slot":           int(player.get("slot", 0)),
        "is_cornerstone": bool(player.get("is_cornerstone", False)),
        "height":         player.get("height"),
        "skills":         clean_skills,
    }


# ---------------------------------------------------------------------------
# Layer 1 — Skill aggregation helpers
# ---------------------------------------------------------------------------

def _tier_value(player: dict, skill: str) -> int:
    """Return numeric tier value for a skill on a player."""
    tier_str = player.get("skills", {}).get(skill, "None")
    return TIER_VALUES.get(tier_str, 0)


def _has_skill(player: dict, skill: str, min_tier: str = "Capable") -> bool:
    return _tier_value(player, skill) >= TIER_VALUES.get(min_tier, 1)


def _compute_player_contributions(player: dict) -> dict[str, float]:
    """
    Layer 1: Compute per-dimension slot-weighted tier contributions for one player.
    Returns a dict mapping dimension name → raw contribution.
    """
    slot_weight = SLOT_WEIGHTS.get(player.get("slot", 9), 0.05)
    contributions: dict[str, float] = {}

    for skill, dim_weights in SKILL_WEIGHTS.items():
        tier_val = _tier_value(player, skill)
        if tier_val == 0:
            continue
        # Spacing skills use a slot weight floor — a bench shooter still
        # occupies a defender regardless of their roster slot.
        eff_slot_weight = (
            max(slot_weight, SPACING_SLOT_WEIGHT_FLOOR)
            if skill in _SPACING_SKILLS
            else slot_weight
        )
        for dim, skill_weight in dim_weights.items():
            raw = tier_val * skill_weight * eff_slot_weight
            contributions[dim] = contributions.get(dim, 0.0) + raw

    return contributions


def _apply_diminishing_returns(
    contributions_by_skill: dict[str, list[float]],
) -> dict[str, float]:
    """
    Apply roster-level diminishing returns for over-stacked skills.
    formula: score *= 1 / (1 + max(0, count - ceiling) * 0.15)
    Uses REDUNDANCY_RANGES ceilings for stack limits.
    Returns aggregated contributions per dimension.
    """
    # contributions_by_skill: {skill: [contribution1, contribution2, ...]}
    # Already dimensionally separated — aggregate with diminishing returns
    dim_totals: dict[str, float] = {}
    for skill, raw_list in contributions_by_skill.items():
        ceiling = REDUNDANCY_RANGES.get(skill, (1, 3))[1]
        count = len(raw_list)
        dr_factor = 1.0 / (1.0 + max(0, count - ceiling) * 0.15)
        for contrib_val in raw_list:
            adjusted = contrib_val * dr_factor
            # Determine which dimensions this skill contributes to
            for dim, _ in SKILL_WEIGHTS.get(skill, {}).items():
                dim_totals[dim] = dim_totals.get(dim, 0.0) + adjusted

    return dim_totals


# ---------------------------------------------------------------------------
# Layer 2 — Dimension score computation + context flags
# ---------------------------------------------------------------------------

def _compute_dimension_scores(
    supporting_players: list[dict],
) -> dict[str, float]:
    """
    Layer 2: Aggregate layer-1 contributions into normalized 0–100 dimension scores.
    Cornerstone players are excluded — they are context-only.
    """
    # Collect per-skill contributions across all supporting players
    skills_contributions: dict[str, list[float]] = {}
    for player in supporting_players:
        player_contribs = _compute_player_contributions(player)
        # Map back to skills for diminishing returns tracking
        for skill, dim_weights in SKILL_WEIGHTS.items():
            tier_val = _tier_value(player, skill)
            if tier_val == 0:
                continue
            slot_weight = SLOT_WEIGHTS.get(player.get("slot", 9), 0.05)
            eff_slot_weight = (
                max(slot_weight, SPACING_SLOT_WEIGHT_FLOOR)
                if skill in _SPACING_SKILLS
                else slot_weight
            )
            base_contrib = tier_val * eff_slot_weight
            for dim, skill_weight in dim_weights.items():
                if skill not in skills_contributions:
                    skills_contributions[skill] = []
                skills_contributions[skill].append(base_contrib * skill_weight)

    # Aggregate with diminishing returns
    raw_totals = _apply_diminishing_returns(skills_contributions)

    # Normalize to 0–100
    scores: dict[str, float] = {}
    for dim, theoretical_max in _THEORETICAL_MAX.items():
        raw = raw_totals.get(dim, 0.0)
        scores[dim] = min(100.0, (raw / theoretical_max) * 100.0)

    return scores


def _compute_context_flags(
    supporting_players: list[dict],
    cornerstone: dict,
) -> dict:
    """
    Layer 2: Compute aggregate context flags used by modifier functions.
    Some flags include the cornerstone (e.g. has_passer, has_lob_thrower).
    """
    all_players = [cornerstone] + supporting_players

    def count_with_skill(players, skill, min_tier="Capable"):
        return sum(1 for p in players if _has_skill(p, skill, min_tier))

    # Exclusive on-ball: has on-ball skill AND no off-ball skills
    _on_ball = {"pnr_ball_handler", "driver", "isolation_scorer", "mid_post_player", "low_post_player"}
    _off_ball = {
        "spot_up_shooter", "movement_shooter", "cutter", "pnr_finisher",
        "vertical_spacer", "screen_setter", "offensive_rebounder", "transition_threat",
    }
    exclusive_onball_count = sum(
        1 for p in supporting_players
        if any(_has_skill(p, s) for s in _on_ball)
        and not any(_has_skill(p, s) for s in _off_ball)
    )

    return {
        "has_rim_protector":       any(_has_skill(p, "rim_protector") for p in all_players),
        "has_passer":              any(_has_skill(p, "passer") for p in all_players),
        "has_lob_thrower":         any(
            _has_skill(p, "passer") or _has_skill(p, "driver")
            for p in all_players
        ),
        "pnr_handler_tier":        max(
            (_tier_value(p, "pnr_ball_handler") for p in all_players),
            default=0,
        ),
        "pnr_finisher_count":      count_with_skill(supporting_players, "pnr_finisher"),
        "perimeter_disruptor_count": count_with_skill(supporting_players, "perimeter_disruptor"),
        "versatile_defender_count":  count_with_skill(supporting_players, "versatile_defender"),
        "movement_shooter_count":    count_with_skill(supporting_players, "movement_shooter"),
        "cutter_count":              count_with_skill(supporting_players, "cutter"),
        "transition_threat_count":   count_with_skill(supporting_players, "transition_threat"),
        "exclusive_onball_count":    exclusive_onball_count,
        # pre-modifier spacing/creation/defense scores (from layer 2, before layer 3)
        # Populated after dimension score computation — set placeholder here
        "spacing_score_pre_modifiers":  0.0,
        "creation_score_pre_modifiers": 0.0,
        "defense_score_pre_modifiers":  0.0,
    }


# ---------------------------------------------------------------------------
# Layer 3 — Interaction modifier application
# ---------------------------------------------------------------------------

def _severity_from_delta(delta: float, presence_type: str, final_score: float | None = None) -> str:
    """
    Derive note severity from delta sign + presence type (positive notes) or final
    dimension score (negative notes).

    Positive presence notes → strength (what's working well on the current roster).
    Positive absence notes → suggestion (gap compensation — directional recommendation).
    Negative notes → severity from the final dimension score, not the delta magnitude.
      - score < 30  → critical  (dimension is broken)
      - score < 55  → warning   (dimension is struggling)
      - score ≥ 55  → suggestion (dimension is healthy; note is informational)
    Falls back to delta magnitude when no final score is available (e.g. roster_balance).
    """
    if delta > 0:
        # Positive presence = a synergy/strength on the current roster
        # Positive absence = a gap mitigation — still a recommendation to add something
        if presence_type == "presence":
            return "strength"
        else:
            return "suggestion"
    else:
        if final_score is not None:
            # Use actual dimension health, not how large this one delta is
            if final_score < 30:
                return "critical"
            elif final_score < 55:
                return "warning"
            else:
                return "suggestion"
        else:
            # Fallback: no dimension score available (e.g. roster_balance notes)
            abs_delta = abs(delta)
            if abs_delta > 20:
                return "critical"
            elif abs_delta >= 10:
                return "warning"
            else:
                return "suggestion"


def _category_from_dimension(dimension: str) -> str:
    """Map a dimension key to a note category."""
    offense_dims = {"spacing", "creation", "paint", "transition", "offense"}
    defense_dims = {"defense"}
    if dimension in offense_dims:
        return "offense"
    elif dimension in defense_dims:
        return "defense"
    else:
        return "roster_balance"


def _run_modifiers(
    supporting_players: list[dict],
    agg: dict,
    cornerstone: dict,
) -> list[tuple[float, str, str, str, str]]:
    """
    Layer 3: Run all modifiers and collect (delta, narrative, dimension, presence_type, trace_key) tuples.
    Returns list of all fired modifier results.
    """
    results: list[tuple[float, str, str, str, str]] = []
    for modifier_fn in ALL_MODIFIERS:
        result = modifier_fn(supporting_players, agg, cornerstone, MODIFIER_DELTAS)
        if result is not None:
            delta, narrative, dimension = result
            presence_type = getattr(modifier_fn, "presence_type", "presence")
            # Derive trace_key from function name: check_DEF_01 → DEF_01
            trace_key = modifier_fn.__name__.replace("check_", "").upper()
            results.append((delta, narrative, dimension, presence_type, trace_key))
    return results


# ---------------------------------------------------------------------------
# Layer 4 — Hard checks + finalization
# ---------------------------------------------------------------------------

def _apply_deltas(
    dim_scores: dict[str, float],
    modifier_results: list[tuple[float, str, str, str, str]],
) -> dict[str, float]:
    """
    Apply modifier deltas to dimension scores.
    Clamp all scores to [0, 100] after application.
    """
    updated = dict(dim_scores)
    for delta, _, dimension, _, _ in modifier_results:
        if dimension in updated:
            updated[dimension] = max(0.0, min(100.0, updated[dimension] + delta))
    return updated


def _make_note_from_modifier(
    delta: float,
    narrative: str,
    dimension: str,
    presence_type: str,
    trace_key: str,
) -> Note:
    """Construct a Note from a modifier result."""
    severity = _severity_from_delta(delta, presence_type)
    category = _category_from_dimension(dimension)
    return Note(
        severity=severity,
        category=category,
        text=narrative,
        trace_key=trace_key,
        presence_type=presence_type,
    )


# ---------------------------------------------------------------------------
# Debug trace generation
# ---------------------------------------------------------------------------

def _build_player_traces(supporting_players: list[dict]) -> dict:
    """Build per-player debug traces showing raw contributions."""
    traces: dict = {}
    for p in supporting_players:
        slot_weight = SLOT_WEIGHTS.get(p.get("slot", 9), 0.05)
        skill_contributions: dict[str, dict] = {}
        for skill, dim_weights in SKILL_WEIGHTS.items():
            tier_val = _tier_value(p, skill)
            if tier_val == 0:
                continue
            eff_slot_weight = (
                max(slot_weight, SPACING_SLOT_WEIGHT_FLOOR)
                if skill in _SPACING_SKILLS
                else slot_weight
            )
            skill_contributions[skill] = {
                "tier_value": tier_val,
                "slot_weight": eff_slot_weight,
                "dimensions": {
                    dim: round(tier_val * skill_weight * eff_slot_weight, 4)
                    for dim, skill_weight in dim_weights.items()
                },
            }
        traces[p["name"]] = {
            "slot": p.get("slot"),
            "slot_weight": slot_weight,
            "skill_contributions": skill_contributions,
        }
    return traces


def _build_aggregate_traces(
    dim_scores: dict[str, float],
    modifier_results: list[tuple[float, str, str, str, str]],
    final_scores: Scores,
) -> dict:
    """Build aggregate debug traces with pre/post modifier scores and fired modifiers."""
    fired_modifiers = [
        {
            "trace_key": trace_key,
            "delta": delta,
            "dimension": dimension,
            "presence_type": presence_type,
            "narrative": narrative,
        }
        for delta, narrative, dimension, presence_type, trace_key in modifier_results
    ]
    return {
        "pre_modifier_scores": {k: round(v, 2) for k, v in dim_scores.items()},
        "fired_modifiers": fired_modifiers,
        "final_scores": {
            "overall":    round(final_scores.overall, 2),
            "offense":    round(final_scores.offense, 2),
            "defense":    round(final_scores.defense, 2),
            "spacing":    round(final_scores.spacing, 2),
            "creation":   round(final_scores.creation, 2),
            "paint":      round(final_scores.paint, 2),
            "transition": round(final_scores.transition, 2),
            "optionality": round(final_scores.optionality, 2),
            "robustness": round(final_scores.robustness, 2),
        },
    }


# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Height coverage computation (used by debug chart + DEF_05/06)
# ---------------------------------------------------------------------------

def _compute_height_coverage(all_players: list[dict]) -> dict:
    """
    Compute height coverage data for the full roster (cornerstone + supporting).

    Returns a dict with per-player ranges and hole/coverage analysis across
    the 6'0"–7'2" (72–86 inch) target window.
    """
    def _in_to_ft(inches: int) -> str:
        return f"{inches // 12}'{inches % 12}\""

    player_data = []
    covered: set[int] = set()

    for p in all_players:
        height_in = _parse_height_inches(p.get("height"))
        skills = p.get("skills", {})
        vd_tier = skills.get("versatile_defender", "None")
        pd_tier = skills.get("perimeter_disruptor", "None")
        r = guard_range(p)
        entry = {
            "name":           p.get("name", ""),
            "is_cornerstone": bool(p.get("is_cornerstone", False)),
            "height_in":      height_in,
            "height_str":     _in_to_ft(height_in) if height_in else None,
            "vd_tier":        vd_tier,
            "pd_tier":        pd_tier,
            "range_low":      r[0] if r else None,
            "range_high":     r[1] if r else None,
        }
        player_data.append(entry)
        if r:
            covered.update(range(r[0], r[1] + 1))

    target = list(range(HEIGHT_COVERAGE_LOW, HEIGHT_COVERAGE_HIGH + 1))
    holes = [h for h in target if h not in covered]

    return {
        "players":       player_data,
        "target_low":    HEIGHT_COVERAGE_LOW,
        "target_high":   HEIGHT_COVERAGE_HIGH,
        "holes":         holes,
        "full_coverage": len(holes) == 0,
    }


# ---------------------------------------------------------------------------
# Main pipeline entry point
# ---------------------------------------------------------------------------

def evaluate_roster(
    players: list[dict],
    mode: Literal["live", "final"] = "live",
    debug: bool = False,
) -> RosterEvaluation:
    """
    Orchestrate the 4-layer scoring pipeline and return a RosterEvaluation.

    Layer 1 → per-player slot-weighted tier contributions
    Layer 2 → normalized dimension scores + context flags
    Layer 3 → modifier deltas applied to dimension scores
    Layer 4 → hard checks, composite scores, note assembly

    live mode:  critical/warning/tip notes; ABSENCE notes suppressed if < ABSENCE_NOTE_MIN_PLAYERS;
                cap at LIVE_NOTE_LIMIT
    final mode: all severities including strength; no cap; ABSENCE notes always eligible

    debug=True populates player_traces and aggregate_traces.
    """
    # Normalize all input players
    normalized = [normalize_player(p) for p in players]

    # Separate cornerstone from supporting rotation
    cornerstones = [p for p in normalized if p["is_cornerstone"]]
    supporting_players = [p for p in normalized if not p["is_cornerstone"]]

    # Use the first cornerstone as context (validation ensures exactly one)
    cornerstone = cornerstones[0] if cornerstones else {
        "name": "Unknown", "slot": 0, "is_cornerstone": True, "height": None, "skills": {}
    }

    # ----- Layer 1 + 2: Compute dimension scores (supporting players only) -----
    dim_scores = _compute_dimension_scores(supporting_players)

    # ----- Layer 2: Compute context flags -----
    agg = _compute_context_flags(supporting_players, cornerstone)
    # Update pre-modifier scores in context
    agg["spacing_score_pre_modifiers"] = dim_scores.get("spacing", 0.0)
    agg["creation_score_pre_modifiers"] = dim_scores.get("creation", 0.0)
    agg["defense_score_pre_modifiers"] = dim_scores.get("defense", 0.0)

    # ----- Layer 3: Run all modifiers -----
    modifier_results = _run_modifiers(supporting_players, agg, cornerstone)

    # Apply modifier deltas to dimension scores
    updated_dim_scores = _apply_deltas(dim_scores, modifier_results)

    # ----- Layer 4: Hard checks -----
    hard_check_notes: list[Note] = []
    for check_fn in ALL_HARD_CHECKS:
        note = check_fn(supporting_players, agg, cornerstone)
        if note is not None:
            hard_check_notes.append(note)

    # Apply DEF_09 cap: rebounding deficit caps defense at DEF_09_rebounding_deficit_cap.
    # DEF_09 runs as a Layer 3 modifier (generates the Note + trace_key) but returns delta=0
    # so it does not affect the additive path. The cap is enforced here after all deltas are
    # applied, which is the correct point to clamp a score to a ceiling value.
    def09_fired = any(
        trace_key == "DEF_09"
        for _, _, _, _, trace_key in modifier_results
    )
    if def09_fired:
        cap = MODIFIER_DELTAS["DEF_09_rebounding_deficit_cap"]
        updated_dim_scores["defense"] = min(updated_dim_scores.get("defense", 0.0), cap)

    # Apply hard check delta effects (critical notes imply large score penalties)
    # Hard checks that cap defense score
    final_dim_scores = dict(updated_dim_scores)
    hard_traces = [n.trace_key for n in hard_check_notes]
    if "HARD_05" in hard_traces:
        cap = MODIFIER_DELTAS["HARD_05_no_rebounding_cap"]
        final_dim_scores["defense"] = min(final_dim_scores.get("defense", 0.0), cap)
    if "HARD_01" in hard_traces:
        penalty = MODIFIER_DELTAS["HARD_01_no_paint_penalty"]
        final_dim_scores["creation"] = max(0.0, final_dim_scores.get("creation", 0.0) + penalty)
    if "HARD_02" in hard_traces:
        penalty = MODIFIER_DELTAS["HARD_02_no_creation_penalty"]
        final_dim_scores["creation"] = max(0.0, final_dim_scores.get("creation", 0.0) + penalty)
    if "HARD_03" in hard_traces:
        penalty = MODIFIER_DELTAS["HARD_03_insufficient_spacing_penalty"]
        final_dim_scores["spacing"] = max(0.0, final_dim_scores.get("spacing", 0.0) + penalty)
    if "HARD_04" in hard_traces:
        penalty = MODIFIER_DELTAS["HARD_04_no_defender_penalty"]
        final_dim_scores["defense"] = max(0.0, final_dim_scores.get("defense", 0.0) + penalty)

    # Clamp all dimension scores to [0, 100]
    final_dim_scores = {k: max(0.0, min(100.0, v)) for k, v in final_dim_scores.items()}

    # ----- Compute composite offense score -----
    offense_score = sum(
        OFFENSE_SUBWEIGHTS.get(dim, 0.0) * final_dim_scores.get(dim, 0.0)
        for dim in ("spacing", "creation", "paint", "transition")
    )
    offense_score = max(0.0, min(100.0, offense_score))

    # ----- Compute optionality + robustness -----
    optionality_score = compute_optionality(supporting_players, cornerstone, SLOT_WEIGHTS)
    robustness_score = compute_robustness(supporting_players, SLOT_WEIGHTS)

    # ----- Compute overall score -----
    overall_score = (
        DIMENSION_WEIGHTS["offense"] * offense_score
        + DIMENSION_WEIGHTS["defense"] * final_dim_scores.get("defense", 0.0)
        + DIMENSION_WEIGHTS["optionality"] * optionality_score
        + DIMENSION_WEIGHTS["robustness"] * robustness_score
    )
    overall_score = max(0.0, min(100.0, overall_score))

    # Build Scores dataclass
    scores = Scores(
        overall=round(overall_score, 2),
        offense=round(offense_score, 2),
        defense=round(final_dim_scores.get("defense", 0.0), 2),
        spacing=round(final_dim_scores.get("spacing", 0.0), 2),
        creation=round(final_dim_scores.get("creation", 0.0), 2),
        paint=round(final_dim_scores.get("paint", 0.0), 2),
        transition=round(final_dim_scores.get("transition", 0.0), 2),
        optionality=round(optionality_score, 2),
        robustness=round(robustness_score, 2),
    )

    # ----- Assemble notes -----
    # Score lookup for final-score-based severity on negative notes.
    # Includes all sub-dimensions plus the composite offense score.
    _final_score_lookup: dict[str, float] = {
        **final_dim_scores,
        "offense": offense_score,
    }

    # Build note list from modifier results (5-tuple: delta, narrative, dimension, presence_type, trace_key)
    modifier_notes: list[Note] = []
    # Strength candidates collected separately so live mode can cap them at LIVE_STRENGTH_LIMIT
    strength_candidates: list[tuple[float, Note]] = []

    for delta, narrative, dimension, presence_type, trace_key in modifier_results:
        # Pass the final dimension score so severity reflects actual roster health,
        # not just the magnitude of this one modifier's delta.
        severity = _severity_from_delta(delta, presence_type, _final_score_lookup.get(dimension))

        # Suppress negative notes when the final dimension score is healthy enough
        # that the note's premise no longer holds. Modifiers fire against pre-modifier
        # scores — positive modifiers can later push a dimension well past the threshold,
        # making "floor spacing is too thin (34)" misleading when final spacing is 84.
        final_dim_score = _final_score_lookup.get(dimension)
        if delta < 0 and final_dim_score is not None and final_dim_score > NOTE_SUPPRESSION_THRESHOLD:
            continue

        # Apply note_min_severity override (promotes only — never demotes)
        min_severity = _MIN_SEVERITY_OVERRIDES.get(trace_key)
        if min_severity is not None and SEVERITY_ORDER[severity] > SEVERITY_ORDER[min_severity]:
            severity = min_severity

        note = Note(
            severity=severity,
            category=_category_from_dimension(dimension),
            text=narrative,
            trace_key=trace_key,
            presence_type=presence_type,
        )

        if severity == "strength":
            # Collect strength notes with their delta for sorting in live mode
            strength_candidates.append((abs(delta), note))
        else:
            modifier_notes.append(note)

    # Add strength notes: all in final mode, top LIVE_STRENGTH_LIMIT by |delta| in live mode
    if mode == "final":
        modifier_notes.extend(n for _, n in strength_candidates)
    else:
        # Sort by abs delta descending and take at most LIVE_STRENGTH_LIMIT
        strength_candidates.sort(key=lambda t: t[0], reverse=True)
        modifier_notes.extend(n for _, n in strength_candidates[:LIVE_STRENGTH_LIMIT])

    # Combine all notes
    all_notes: list[Note] = modifier_notes + hard_check_notes

    # Filter ABSENCE notes in live mode when supporting rotation < ABSENCE_NOTE_MIN_PLAYERS
    supporting_count = len(supporting_players)
    if mode == "live" and supporting_count < ABSENCE_NOTE_MIN_PLAYERS:
        all_notes = [n for n in all_notes if n.presence_type == "presence"]

    # Cornerstone complement layer — inject early-stage directional suggestions.
    # Runs when the supporting rotation is below COMPLEMENT_STAGE_CUTOFF (default 3).
    # These notes bypass the ABSENCE_NOTE_MIN_PLAYERS filter above because they're
    # specifically designed for early roster stages — they're merged in after it.
    if supporting_count < COMPLEMENT_STAGE_CUTOFF:
        complement_notes = get_complement_notes(cornerstone, supporting_players)
        # Prepend so they sort naturally with the rest (all are "suggestion" severity)
        all_notes = complement_notes + all_notes

    # Sort: critical → warning → suggestion → strength
    all_notes.sort(key=lambda n: SEVERITY_ORDER.get(n.severity, 99))

    # Cap at LIVE_NOTE_LIMIT in live mode
    if mode == "live":
        all_notes = all_notes[:LIVE_NOTE_LIMIT]

    # ----- Debug traces -----
    player_traces_out = None
    aggregate_traces_out = None
    if debug:
        player_traces_out = _build_player_traces(supporting_players)
        aggregate_traces_out = _build_aggregate_traces(dim_scores, modifier_results, scores)

    # ----- Height coverage (always computed — cheap, used by debug chart) -----
    height_coverage_out = _compute_height_coverage([cornerstone] + supporting_players)

    # ----- LLM team description (final mode only — too slow for live) -----
    # Calls Anthropic haiku; any failure degrades gracefully to None.
    # The service's own try/except handles most failures; the outer guard here
    # ensures the whole evaluation never fails due to the LLM being unavailable.
    team_description_out: str | None = None
    if mode == "final":
        try:
            team_description_out = generate_team_description(cornerstone, supporting_players, scores)
        except Exception:
            logger.exception(
                "generate_team_description raised unexpectedly — continuing with None"
            )
            team_description_out = None

    return RosterEvaluation(
        scores=scores,
        notes=all_notes,
        player_traces=player_traces_out,
        aggregate_traces=aggregate_traces_out,
        height_coverage=height_coverage_out,
        team_description=team_description_out,
    )
