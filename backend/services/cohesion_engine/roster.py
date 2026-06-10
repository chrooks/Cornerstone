"""
Roster-level scoring for the cohesion engine.

This layer evaluates every available five-man lineup, then rolls those lineup
results into the final 0-5 roster star rating. It also computes base player
composites for display without lineup-context synergies.
"""

from __future__ import annotations

import logging
from dataclasses import replace
from itertools import combinations
from statistics import median
from typing import Any

from .bell_curve import parse_height_inches
from .cohesion import evaluate_lineup
from .composites import compute_player_composites
from .engine import CohesionEngine
from .notes import generate_notes
from .team_description import generate_team_description
from .types import LineupCohesion, PlayerComposites, RosterEvaluation

logger = logging.getLogger(__name__)

SUBSCORE_ARCHETYPES: dict[str, str] = {
    "spacing_creation_ratio": "offensive",
    "spacing_paint_touch_ratio": "offensive",
    "paint_touch_total": "paint",
    "post_game_total": "paint",
    "pnr_screener_total": "offensive",
    "pnr_pairing": "offensive",
    "anchor_total": "defensive",
    "perimeter_defense_total": "defensive",
    "interior_defense_total": "defensive",
    "collective_passing": "offensive",
    "rebounding": "paint",
    "transition": "transition",
    "rebound_transition_ratio": "transition",
    "rebounding_spacing_deficit": "balanced",
    "defensive_coverage": "defensive",
    "defensive_gaps": "defensive",
}


def _player_id(player: dict[str, Any], index: int) -> str:
    return str(player.get("id") or player.get("player_id") or f"roster-player-{index}")


def _sort_players_for_starting_lineup(players: list[dict[str, Any]]) -> list[dict[str, Any]]:
    indexed_players = list(enumerate(players))
    return [
        player
        for _index, player in sorted(
            indexed_players,
            key=lambda item: (item[1].get("slot", 999), item[0]),
        )
    ]


def _empty_lineup() -> LineupCohesion:
    return LineupCohesion(
        score=0.0,
        subscores={},
        synergies_applied=[],
        accentuation_strength=0.0,
        accentuation_weakness=0.0,
    )


def _normalize_player_skills(players: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return copies of player dicts with missing/None skills coerced to {} (#64).

    A Player with no row in the active released_players reaches the builder
    payload with skills: null. Scoring them as all-"None" is sometimes the
    only option, but it must not be silent — log a WARN naming the player so
    release gaps are visible, and coerce to an empty map so downstream
    lineup/composite code never sees None. Player dicts are copied, never
    mutated.
    """
    normalized: list[dict[str, Any]] = []
    for index, player in enumerate(players):
        skills = player.get("skills")
        if skills:
            normalized.append(player)
            continue
        logger.warning(
            "missing_from_release: player %s has no skills in the roster "
            "evaluation payload — scoring as unrated (likely missing from the "
            "active Snapshot Release)",
            player.get("name") or _player_id(player, index),
        )
        normalized.append({**player, "skills": {}})
    return normalized


def _compute_base_composites(
    players: list[dict[str, Any]], values: dict[str, Any]
) -> list[PlayerComposites]:
    # Imported at call time: snapshot_versions.distribution_cache imports this
    # package's composites module at load, so a module-level import here would
    # be circular. Grab the immutable state ONCE for the whole roster — a
    # concurrent publish flip cannot tear this batch.
    from services.snapshot_versions import distribution_cache

    state = distribution_cache.get_state()
    composites: list[PlayerComposites] = []
    for index, player in enumerate(players):
        composites.append(
            compute_player_composites(
                player.get("skills", {}),
                player_id=_player_id(player, index),
                name=str(player.get("name") or _player_id(player, index)),
                values=values,
                height_inches=parse_height_inches(player.get("height")),
                distributions=state.distributions,
            )
        )
    return composites


def _archetypes_for_lineup(lineup: LineupCohesion) -> list[str]:
    if not lineup.subscores:
        return []

    labels: list[str] = []
    for subscore, _value in sorted(lineup.subscores.items(), key=lambda item: item[1], reverse=True):
        label = SUBSCORE_ARCHETYPES.get(subscore)
        if label and label not in labels:
            labels.append(label)
        if len(labels) >= 3:
            break

    return labels or ["balanced"]


def _rotation_median_subscores(
    lineups: list[LineupCohesion], values: dict[str, Any]
) -> dict[str, float]:
    viable_threshold: float = values["viable_lineup_threshold"]
    viable = [lu for lu in lineups if lu.score >= viable_threshold]
    if not viable:
        return {}

    all_keys: set[str] = set()
    for lu in viable:
        all_keys.update(lu.subscores.keys())

    medians: dict[str, float] = {}
    for key in sorted(all_keys):
        key_values = [lu.subscores.get(key, 0.0) for lu in viable]
        medians[key] = round(median(key_values), 2)

    medians["accentuation_strength"] = round(median([lu.accentuation_strength for lu in viable]), 2)
    medians["accentuation_weakness"] = round(median([lu.accentuation_weakness for lu in viable]), 2)

    return medians


def _lineup_summary(
    lineups: list[LineupCohesion], archetypes: set[str], values: dict[str, Any]
) -> dict[str, Any]:
    viable_threshold: float = values["viable_lineup_threshold"]
    scores = [lineup.score for lineup in lineups]
    viable_count = sum(1 for score in scores if score >= viable_threshold)
    depth = _depth_components(lineups, values)
    return {
        "total_lineups": len(lineups),
        "viable_lineups": viable_count,
        "median_score": round(median(scores), 2) if scores else 0.0,
        "archetype_labels": sorted(archetypes),
        "bench_lineups": depth["bench_lineups"],
        "bench_viable_lineups": depth["bench_viable_lineups"],
        "bench_median_score": depth["bench_median_score"],
        "depth_viable_ratio": depth["viable_ratio"],
        "depth_quality": depth["quality"],
        "depth_score": depth["score"],
        "rotation_median_subscores": _rotation_median_subscores(lineups, values),
    }


def _depth_components(lineups: list[LineupCohesion], values: dict[str, Any]) -> dict[str, float | int]:
    viable_threshold: float = values["viable_lineup_threshold"]
    star_rating_max: float = values["star_rating_max"]
    depth_viable_ratio_weight: float = values["depth_viable_ratio_weight"]
    depth_quality_weight: float = values["depth_quality_weight"]

    bench_scores = [lineup.score for lineup in lineups[1:]]
    bench_lineups = len(bench_scores)
    bench_viable_lineups = sum(1 for score in bench_scores if score >= viable_threshold)
    viable_ratio = bench_viable_lineups / bench_lineups if bench_lineups else 0.0
    bench_median_score = median(bench_scores) if bench_scores else 0.0
    quality = min(1.0, bench_median_score / star_rating_max) if bench_scores else 0.0
    score = depth_viable_ratio_weight * viable_ratio + depth_quality_weight * quality
    return {
        "bench_lineups": bench_lineups,
        "bench_viable_lineups": bench_viable_lineups,
        "bench_median_score": round(bench_median_score, 2),
        "viable_ratio": round(viable_ratio, 3),
        "quality": round(quality, 3),
        "score": round(min(1.0, score), 3),
    }


def _star_breakdown(
    starting_lineup: LineupCohesion,
    lineups: list[LineupCohesion],
    archetypes: set[str],
    values: dict[str, Any],
) -> dict[str, float]:
    star_rating_max: float = values["star_rating_max"]
    archetype_labels: list[str] = values["archetype_labels"]
    lineup_archetype_max: int = values["lineup_archetype_max"]

    if not lineups:
        return {"starting_5": 0.0, "depth": 0.0, "archetype_diversity": 0.0, "floor": 0.0}

    scores = [lineup.score for lineup in lineups]
    depth = _depth_components(lineups, values)
    archetype_denominator = lineup_archetype_max if len(lineups) == 1 else len(archetype_labels)
    return {
        "starting_5": round(min(1.0, starting_lineup.score / star_rating_max), 3),
        "depth": float(depth["score"]),
        "archetype_diversity": round(min(1.0, len(archetypes) / archetype_denominator), 3),
        "floor": round(min(1.0, median(scores) / star_rating_max), 3),
    }


def _rollup_star_rating(breakdown: dict[str, float], values: dict[str, Any], lineup_only: bool = False) -> float:
    star_rating_max: float = values["star_rating_max"]
    weights = values["lineup_only_rollup_weights"] if lineup_only else values["roster_rollup_weights"]
    weighted = sum(weights[key] * breakdown.get(key, 0.0) for key in weights)
    return round(star_rating_max * weighted, 2)


def evaluate_roster(
    players: list[dict[str, Any]], engine: CohesionEngine, mode: str = "live"
) -> RosterEvaluation:
    """
    Evaluate a Team with at least five Players as Lineup Combinations.

    Live mode returns structured notes. Final mode also attempts the optional
    Claude-generated team narrative and degrades to None if that call fails.
    """
    values = engine.version.values
    viable_threshold: float = values["viable_lineup_threshold"]
    ordered_players = _sort_players_for_starting_lineup(_normalize_player_skills(list(players)))
    base_composites = _compute_base_composites(ordered_players, values)

    if len(ordered_players) < 5:
        evaluation = RosterEvaluation(
            star_rating=0.0,
            star_breakdown={"starting_5": 0.0, "depth": 0.0, "archetype_diversity": 0.0, "floor": 0.0},
            starting_lineup=_empty_lineup(),
            player_composites=base_composites,
            lineup_summary={"total_lineups": 0, "viable_lineups": 0, "median_score": 0.0, "archetype_labels": []},
            notes=generate_notes(ordered_players, base_composites, values),
            team_description=None,
        )
        if mode == "final":
            return replace(evaluation, team_description=generate_team_description(evaluation, ordered_players))
        return evaluation

    starting_players = ordered_players[:5]
    starting_lineup = evaluate_lineup(starting_players, engine)

    lineups: list[LineupCohesion] = []
    archetypes: set[str] = set()
    for lineup_players in combinations(ordered_players, 5):
        lineup = evaluate_lineup(list(lineup_players), engine)
        lineups.append(lineup)
        if lineup.score >= viable_threshold:
            archetypes.update(_archetypes_for_lineup(lineup))

    lineup_only = len(ordered_players) == 5
    lineup_summary = _lineup_summary(lineups, archetypes, values)
    breakdown = _star_breakdown(starting_lineup, lineups, archetypes, values)
    notes = generate_notes(
        ordered_players,
        base_composites,
        values,
        {
            "starting_lineup": starting_lineup,
            "lineup_summary": lineup_summary,
            "star_breakdown": breakdown,
            "all_lineups": lineups,
        },
    )

    evaluation = RosterEvaluation(
        star_rating=_rollup_star_rating(breakdown, values, lineup_only=lineup_only),
        star_breakdown=breakdown,
        starting_lineup=starting_lineup,
        player_composites=base_composites,
        lineup_summary=lineup_summary,
        notes=notes,
        team_description=None,
    )
    if mode == "final":
        return replace(evaluation, team_description=generate_team_description(evaluation, ordered_players))
    return evaluation
