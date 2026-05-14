"""
Roster-level scoring for the cohesion engine.

This layer evaluates every available five-man lineup, then rolls those lineup
results into the final 0-5 roster star rating. It also computes base player
composites for display without lineup-context synergies.
"""

from __future__ import annotations

from dataclasses import replace
from itertools import combinations
from statistics import median
from typing import Any

from .bell_curve import parse_height_inches
from .cohesion import evaluate_lineup
from .composites import compute_player_composites
from .notes import generate_notes
from .team_description import generate_team_description
from .types import LineupCohesion, PlayerComposites, RosterEvaluation
from .weights import (
    ARCHETYPE_LABELS,
    DEPTH_QUALITY_WEIGHT,
    DEPTH_VIABLE_RATIO_WEIGHT,
    ROSTER_ROLLUP_WEIGHTS,
    STAR_RATING_MAX,
    VIABLE_LINEUP_THRESHOLD,
)

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
    """Read a stable player ID from common API shapes."""
    return str(player.get("id") or player.get("player_id") or f"roster-player-{index}")


def _sort_players_for_starting_lineup(players: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Use slot order when present; otherwise preserve input order."""
    indexed_players = list(enumerate(players))
    return [
        player
        for _index, player in sorted(
            indexed_players,
            key=lambda item: (item[1].get("slot", 999), item[0]),
        )
    ]


def _empty_lineup() -> LineupCohesion:
    """Placeholder lineup result for rosters that cannot form five players yet."""
    return LineupCohesion(
        score=0.0,
        subscores={},
        synergies_applied=[],
        accentuation_strength=0.0,
        accentuation_weakness=0.0,
    )


def _compute_base_composites(players: list[dict[str, Any]]) -> list[PlayerComposites]:
    """Compute display composites without lineup synergies."""
    composites: list[PlayerComposites] = []
    for index, player in enumerate(players):
        composites.append(
            compute_player_composites(
                player.get("skills", {}),
                player_id=_player_id(player, index),
                name=str(player.get("name") or _player_id(player, index)),
                height_inches=parse_height_inches(player.get("height")),
            )
        )
    return composites


def _archetypes_for_lineup(lineup: LineupCohesion) -> list[str]:
    """Assign 2-3 archetype labels based on the lineup's strongest subscores."""
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


def _rotation_median_subscores(lineups: list[LineupCohesion]) -> dict[str, float]:
    """Compute the median of each subscore across viable lineups only."""
    viable = [lu for lu in lineups if lu.score >= VIABLE_LINEUP_THRESHOLD]
    if not viable:
        return {}

    # Collect all subscore keys present across viable lineups.
    all_keys: set[str] = set()
    for lu in viable:
        all_keys.update(lu.subscores.keys())

    medians: dict[str, float] = {}
    for key in sorted(all_keys):
        values = [lu.subscores.get(key, 0.0) for lu in viable]
        medians[key] = round(median(values), 2)

    # Include accentuation scores — stored as separate fields, not in subscores.
    medians["accentuation_strength"] = round(median([lu.accentuation_strength for lu in viable]), 2)
    medians["accentuation_weakness"] = round(median([lu.accentuation_weakness for lu in viable]), 2)

    return medians


def _lineup_summary(lineups: list[LineupCohesion], archetypes: set[str]) -> dict[str, Any]:
    """Build the compact lineup summary used by API serialization later."""
    scores = [lineup.score for lineup in lineups]
    viable_count = sum(1 for score in scores if score >= VIABLE_LINEUP_THRESHOLD)
    depth = _depth_components(lineups)
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
        "rotation_median_subscores": _rotation_median_subscores(lineups),
    }


def _depth_components(lineups: list[LineupCohesion]) -> dict[str, float | int]:
    """Calculate bench-depth ingredients shared by summary and star breakdown."""
    bench_scores = [lineup.score for lineup in lineups[1:]]
    bench_lineups = len(bench_scores)
    bench_viable_lineups = sum(1 for score in bench_scores if score >= VIABLE_LINEUP_THRESHOLD)
    viable_ratio = bench_viable_lineups / bench_lineups if bench_lineups else 0.0
    bench_median_score = median(bench_scores) if bench_scores else 0.0
    quality = min(1.0, bench_median_score / STAR_RATING_MAX) if bench_scores else 0.0
    score = DEPTH_VIABLE_RATIO_WEIGHT * viable_ratio + DEPTH_QUALITY_WEIGHT * quality
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
) -> dict[str, float]:
    """Normalize the four roster factors to 0.0-1.0."""
    if not lineups:
        return {
            "starting_5": 0.0,
            "depth": 0.0,
            "archetype_diversity": 0.0,
            "floor": 0.0,
        }

    scores = [lineup.score for lineup in lineups]
    depth = _depth_components(lineups)
    return {
        "starting_5": round(min(1.0, starting_lineup.score / STAR_RATING_MAX), 3),
        "depth": float(depth["score"]),
        "archetype_diversity": round(min(1.0, len(archetypes) / len(ARCHETYPE_LABELS)), 3),
        "floor": round(min(1.0, median(scores) / STAR_RATING_MAX), 3),
    }


LINEUP_ONLY_ROLLUP_WEIGHTS: dict[str, float] = {
    "starting_5": 0.90,
    "depth": 0.0,
    "archetype_diversity": 0.10,
    "floor": 0.0,
}


def _rollup_star_rating(breakdown: dict[str, float], lineup_only: bool = False) -> float:
    """Apply the roster rollup to produce a 0-5 star rating.

    When lineup_only is True (5-man Lineup mode), depth and floor factors
    are zeroed out and the starting lineup dominates the score.
    """
    weights = LINEUP_ONLY_ROLLUP_WEIGHTS if lineup_only else ROSTER_ROLLUP_WEIGHTS
    weighted = sum(
        weights[key] * breakdown.get(key, 0.0)
        for key in weights
    )
    return round(STAR_RATING_MAX * weighted, 2)


def evaluate_roster(players: list[dict[str, Any]], mode: str = "live") -> RosterEvaluation:
    """
    Evaluate a 1-9 player roster.

    Live mode returns structured notes. Final mode also attempts the optional
    Claude-generated team narrative and degrades to None if that call fails.
    """
    ordered_players = _sort_players_for_starting_lineup(list(players))
    base_composites = _compute_base_composites(ordered_players)

    if len(ordered_players) < 5:
        evaluation = RosterEvaluation(
            star_rating=0.0,
            star_breakdown={
                "starting_5": 0.0,
                "depth": 0.0,
                "archetype_diversity": 0.0,
                "floor": 0.0,
            },
            starting_lineup=_empty_lineup(),
            player_composites=base_composites,
            lineup_summary={
                "total_lineups": 0,
                "viable_lineups": 0,
                "median_score": 0.0,
                "archetype_labels": [],
            },
            notes=generate_notes(ordered_players, base_composites),
            team_description=None,
        )
        if mode == "final":
            return replace(
                evaluation,
                team_description=generate_team_description(evaluation, ordered_players),
            )
        return evaluation

    starting_players = ordered_players[:5]
    starting_lineup = evaluate_lineup(starting_players)

    lineups: list[LineupCohesion] = []
    archetypes: set[str] = set()
    for lineup_players in combinations(ordered_players, 5):
        lineup = evaluate_lineup(list(lineup_players))
        lineups.append(lineup)
        if lineup.score >= VIABLE_LINEUP_THRESHOLD:
            archetypes.update(_archetypes_for_lineup(lineup))

    lineup_only = len(ordered_players) == 5
    lineup_summary = _lineup_summary(lineups, archetypes)
    breakdown = _star_breakdown(starting_lineup, lineups, archetypes)
    notes = generate_notes(
        ordered_players,
        base_composites,
        {
            "starting_lineup": starting_lineup,
            "lineup_summary": lineup_summary,
            "star_breakdown": breakdown,
            "all_lineups": lineups,
        },
    )

    evaluation = RosterEvaluation(
        star_rating=_rollup_star_rating(breakdown, lineup_only=lineup_only),
        star_breakdown=breakdown,
        starting_lineup=starting_lineup,
        player_composites=base_composites,
        lineup_summary=lineup_summary,
        notes=notes,
        team_description=None,
    )
    if mode == "final":
        return replace(
            evaluation,
            team_description=generate_team_description(evaluation, ordered_players),
        )
    return evaluation
