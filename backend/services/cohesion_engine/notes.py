"""
Structured roster notes for the cohesion engine.

Mode A explains partial rosters from player composites alone. Mode B explains
lineup-ready rosters from the already-computed cohesion pipeline output. The
module is intentionally pure: no database calls, no network calls, and no
mutation of incoming player dictionaries.
"""

from __future__ import annotations

from dataclasses import is_dataclass
from statistics import median
from typing import Any, Iterable

from .bell_curve import (
    cluster_defense_gaps,
    compute_lineup_coverage_by_height,
    gap_cluster_archetype,
)
from .composites import tier_value
from .types import LineupCohesion, Note, PlayerComposites
from .weights import COMPOSITE_NAMES

PASSING_CATEGORY = "passing"
DEFENSE_GAP_CATEGORY = "defense_gap"
DEPTH_CATEGORY = "depth"

SUGGESTION_TEMPLATES: dict[str, str] = {
    "spacing": "Add a spot-up or movement shooter to open the floor.",
    "shot_creation": "Add a ball handler or isolation scorer to generate offense.",
    "paint_touch": "Add a driver or interior scorer to pressure the rim.",
    "post_game": "Add a low-post or mid-post scorer.",
    "pnr_screener": "Add a PnR roll man or screen setter.",
    "ball_security": "Add a reliable ball handler to reduce turnovers.",
    "perimeter_defense": "Add a perimeter defender to pressure ball handlers.",
    "interior_defense": "Add an interior defender to protect the paint.",
    "defensive_rebounding": "Add a rebounder to control the defensive glass.",
    "offensive_rebounding": "Add an offensive rebounder for second chances.",
    PASSING_CATEGORY: "Add a playmaker to orchestrate the offense.",
    "transition": "Add a transition athlete for fast-break scoring.",
    "off_ball": "Add an off-ball threat - a cutter or movement shooter.",
    "off_ball_impact": "Add an off-ball threat - a cutter or movement shooter.",
    DEFENSE_GAP_CATEGORY: "Add a versatile defender to close the gap.",
    DEPTH_CATEGORY: "Add more players to fill out the team.",
}

OPPORTUNITY_ARCHETYPES: dict[str, str] = {
    "spacing": "a shooter",
    "shot_creation": "a ball handler",
    "paint_touch": "a rim attacker",
    "ball_security": "a reliable ball handler",
    "defensive_rebounding": "a rebounder",
    "offensive_rebounding": "an offensive rebounder",
    "transition": "a transition athlete",
    "perimeter_defense": "a perimeter defender",
    "interior_defense": "an interior defender",
    "off_ball_impact": "an off-ball threat",
    "post_game": "a post scorer",
    "pnr_screener": "a roll man",
}

COMPOSITE_LABELS: dict[str, str] = {
    "spacing": "spacing",
    "shot_creation": "shot creation",
    "paint_touch": "rim pressure",
    "post_game": "post play",
    "pnr_screener": "screen-and-roll play",
    "ball_security": "ball security",
    "perimeter_defense": "perimeter pressure",
    "interior_defense": "interior defense",
    "defensive_rebounding": "defensive rebounding",
    "offensive_rebounding": "offensive rebounding",
    "transition": "transition play",
    "off_ball_impact": "off-ball impact",
}

SUBSCORE_LABELS: dict[str, str] = {
    "spacing": "spacing",
    "shot_creation": "shot creation",
    "paint_touch": "paint pressure",
    "collective_passing": "passing",
    "off_ball_impact": "off-ball impact",
    "ball_security": "ball security",
    "pnr_pairing": "pick-and-roll pairing",
    "post_game": "post scoring",
    "spacing_creation_ratio": "spacing and creation balance",
    "creation_offball_ratio": "creation and off-ball balance",
    "spacing_paint_touch_ratio": "spacing and paint pressure balance",
    "interior_defense": "interior defense",
    "defensive_coverage": "defensive coverage",
    "defensive_gaps": "defensive coverage",
    "perimeter_defense": "perimeter pressure",
    "switchability": "defensive switchability",
    "defensive_rebounding": "defensive rebounding",
    "offensive_rebounding": "offensive rebounding",
    "transition": "transition play",
    "rebound_transition_ratio": "rebound-to-run balance",
}

SUBSCORE_SUGGESTIONS: dict[str, str] = {
    "spacing": "spacing",
    "shot_creation": "shot_creation",
    "paint_touch": "paint_touch",
    "collective_passing": PASSING_CATEGORY,
    "off_ball_impact": "off_ball_impact",
    "ball_security": "ball_security",
    "pnr_pairing": "pnr_screener",
    "post_game": "post_game",
    "spacing_creation_ratio": "spacing",
    "creation_offball_ratio": "off_ball_impact",
    "spacing_paint_touch_ratio": "spacing",
    "interior_defense": "interior_defense",
    "defensive_coverage": DEFENSE_GAP_CATEGORY,
    "defensive_gaps": DEFENSE_GAP_CATEGORY,
    "perimeter_defense": "perimeter_defense",
    "switchability": "perimeter_defense",
    "defensive_rebounding": "defensive_rebounding",
    "offensive_rebounding": "offensive_rebounding",
    "transition": "transition",
    "rebound_transition_ratio": "transition",
}


def _clamp_severity(severity_min: float, severity_max: float, value: float) -> float:
    return round(max(severity_min, min(severity_max, value)), 3)


def _height_label(height_inches: int) -> str:
    return f"{height_inches // 12}'{height_inches % 12}\""


def _height_range_label(gaps: list[int]) -> str:
    if not gaps:
        return "unknown height"
    start = min(gaps)
    end = max(gaps)
    if start == end:
        return _height_label(start)
    return f"{_height_label(start)}-{_height_label(end)}"


def _get_value(source: Any, key: str, default: Any = None) -> Any:
    if isinstance(source, dict):
        return source.get(key, default)
    return getattr(source, key, default)


def _get_pipeline_value(pipeline_data: Any, *keys: str, default: Any = None) -> Any:
    value = pipeline_data
    for key in keys:
        value = _get_value(value, key, default)
        if value is default:
            return default
    return value


def _lineup_score(lineup: Any) -> float:
    if isinstance(lineup, LineupCohesion):
        return lineup.score
    if isinstance(lineup, dict):
        return float(lineup.get("score", lineup.get("cohesion_score", 0.0)))
    if is_dataclass(lineup):
        return float(getattr(lineup, "score", 0.0))
    return 0.0


def _lineup_subscores(lineup: Any) -> dict[str, float]:
    if isinstance(lineup, LineupCohesion):
        return lineup.subscores
    if isinstance(lineup, dict):
        return dict(lineup.get("subscores", {}))
    if is_dataclass(lineup):
        return dict(getattr(lineup, "subscores", {}))
    return {}


def _composite_value(composite: PlayerComposites, category: str) -> float:
    return float(getattr(composite, category))


def _note(
    note_type: str,
    category: str,
    severity: float,
    raw_value: float,
    text: str,
    values: dict[str, Any],
) -> Note:
    return Note(
        type=note_type,  # type: ignore[arg-type]
        category=category,
        severity=_clamp_severity(values["note_severity_min"], values["note_severity_max"], severity),
        raw_value=round(float(raw_value), 2),
        text=text,
    )


def _ranked(notes: Iterable[Note]) -> list[Note]:
    return sorted(notes, key=lambda note: (-note.severity, note.category, note.text))


def _dedupe_and_limit(notes: Iterable[Note], limit: int) -> list[Note]:
    selected: list[Note] = []
    seen: set[tuple[str, str]] = set()

    for note in _ranked(notes):
        key = (note.type, note.category)
        if key in seen:
            continue
        seen.add(key)
        selected.append(note)
        if len(selected) >= limit:
            break

    return selected


def _limit_by_type(notes: Iterable[Note], values: dict[str, Any]) -> list[Note]:
    limit: int = values["note_limit_per_type"]
    by_type: dict[str, list[Note]] = {"strength": [], "weakness": [], "suggestion": []}
    for note in notes:
        by_type[note.type].append(note)

    limited: list[Note] = []
    for note_type in ("strength", "weakness", "suggestion"):
        limited.extend(_dedupe_and_limit(by_type[note_type], limit))
    return limited


def _strongest_player(composites: list[PlayerComposites], category: str) -> PlayerComposites | None:
    if not composites:
        return None
    return max(composites, key=lambda composite: _composite_value(composite, category))


def _mode_a_strengths(
    players: list[dict[str, Any]], composites: list[PlayerComposites], values: dict[str, Any]
) -> list[Note]:
    tv = values["tier_values"]
    elite_threshold: float = values["note_elite_composite_threshold"]
    stacked_threshold: float = values["note_stacked_composite_threshold"]
    stacked_count: int = values["note_stacked_player_count"]
    bell_amplitude_threshold: float = values["note_elite_bell_amplitude_threshold"]

    strengths: list[Note] = []

    for category in (
        "spacing", "shot_creation", "paint_touch",
        "transition", "perimeter_defense", "interior_defense",
    ):
        strongest = _strongest_player(composites, category)
        if strongest and _composite_value(strongest, category) >= elite_threshold:
            text_by_category = {
                "spacing": f"{strongest.name}'s shooting creates elite floor spacing.",
                "shot_creation": f"{strongest.name} is an elite shot creator.",
                "paint_touch": f"{strongest.name} creates elite rim pressure.",
                "transition": f"{strongest.name} is a transition force.",
                "perimeter_defense": f"{strongest.name} applies elite perimeter pressure.",
                "interior_defense": f"{strongest.name} protects the interior at an elite level.",
            }
            raw_value = _composite_value(strongest, category)
            strengths.append(_note("strength", category, raw_value / 10.0, raw_value, text_by_category[category], values))

    for category, text in (
        ("spacing", "Multiple shooters - floor spacing is a strength."),
        (PASSING_CATEGORY, "Multiple playmakers - ball movement will flow."),
    ):
        if category == PASSING_CATEGORY:
            count = sum(
                1 for player in players
                if tier_value(player.get("skills", {}), "passer", tv) >= stacked_threshold
            )
            raw_value = float(count)
        else:
            count = sum(
                1 for composite in composites
                if _composite_value(composite, category) >= stacked_threshold
            )
            raw_value = float(count)
        if count >= stacked_count:
            strengths.append(_note("strength", category, 0.75 + 0.05 * count, raw_value, text, values))

    best_passer = max(
        players,
        key=lambda player: tier_value(player.get("skills", {}), "passer", tv),
        default=None,
    )
    if best_passer:
        passer_value = tier_value(best_passer.get("skills", {}), "passer", tv)
        if passer_value >= elite_threshold:
            name = str(best_passer.get("name") or "This roster")
            strengths.append(_note("strength", PASSING_CATEGORY, passer_value / 10.0, passer_value, f"{name} is an all-time caliber passer.", values))

    for composite in composites:
        if composite.bell_amplitude >= bell_amplitude_threshold:
            strengths.append(_note(
                "strength", "defense", composite.bell_amplitude / 4.0,
                composite.bell_amplitude,
                f"{composite.name}'s defensive versatility covers multiple positions.", values,
            ))

    handler = next((player for player in players if tier_value(player.get("skills", {}), "pnr_ball_handler", tv) >= stacked_threshold), None)
    finisher = next((player for player in players if tier_value(player.get("skills", {}), "pnr_finisher", tv) >= stacked_threshold and player is not handler), None)
    if handler and finisher:
        strengths.append(_note(
            "strength", "synergy", 0.85, 2.0,
            f"PnR duo: {handler.get('name')} and {finisher.get('name')} form a two-man game.", values,
        ))

    screener = next((player for player in players if tier_value(player.get("skills", {}), "screen_setter", tv) >= stacked_threshold), None)
    shooter = next((player for player in players if tier_value(player.get("skills", {}), "movement_shooter", tv) >= stacked_threshold and player is not screener), None)
    if screener and shooter:
        strengths.append(_note(
            "strength", "synergy", 0.8, 2.0,
            f"Off-ball actions: {screener.get('name')}'s screens free {shooter.get('name')}.", values,
        ))

    for composite in composites:
        offense_values = [composite.spacing, composite.paint_touch, composite.shot_creation, composite.off_ball_impact, composite.transition]
        defense_values = [composite.perimeter_defense, composite.interior_defense, composite.defensive_rebounding, composite.bell_amplitude * 2.5]
        if max(offense_values, default=0.0) >= 7.5 and max(defense_values, default=0.0) >= 7.5:
            raw_value = min(max(offense_values), max(defense_values))
            strengths.append(_note("strength", "two_way", raw_value / 10.0, raw_value, f"{composite.name} is a two-way force.", values))

    if not strengths and composites:
        best_category, best_composite = max(
            ((category, composite) for composite in composites for category in COMPOSITE_LABELS),
            key=lambda item: _composite_value(item[1], item[0]),
        )
        raw_value = _composite_value(best_composite, best_category)
        strengths.append(_note(
            "strength", best_category, raw_value / 10.0, raw_value,
            f"{best_composite.name}'s best early fit signal is {COMPOSITE_LABELS[best_category]}.", values,
        ))

    return strengths


def _mode_a_weaknesses(
    players: list[dict[str, Any]], composites: list[PlayerComposites], values: dict[str, Any]
) -> list[Note]:
    tv = values["tier_values"]
    missing_threshold: float = values["note_missing_composite_threshold"]
    weak_avg_threshold: float = values["note_weak_composite_avg_threshold"]
    passer_threshold: float = values["note_capable_passer_threshold"]
    gap_threshold: float = values["defensive_gap_threshold"]
    height_min: int = values["height_min_inches"]
    height_max: int = values["height_max_inches"]

    weaknesses: list[Note] = []

    missing_text: dict[str, str] = {
        "spacing": "No floor spacing - defenders can collapse freely.",
        "shot_creation": "No primary shot creator on the roster.",
        "paint_touch": "No rim pressure.",
        "defensive_rebounding": "Defensive rebounding is nonexistent.",
        "transition": "No transition game.",
        "perimeter_defense": "No perimeter pressure at the point of attack.",
        "interior_defense": "No interior defensive presence.",
    }

    weak_text: dict[str, str] = {
        "spacing": "Roster lacks floor spacing - need more shooting.",
        "shot_creation": "Shot creation is thin - need a primary ball handler.",
        "paint_touch": "Limited rim pressure - need more interior scoring.",
        "defensive_rebounding": "Defensive rebounding is a liability.",
        "transition": "No reliable transition scoring.",
        "perimeter_defense": "Perimeter defense is exposed.",
        "interior_defense": "Interior defense is soft.",
    }

    n_players = max(len(composites), 1)
    for category in (
        "spacing", "shot_creation", "paint_touch",
        "defensive_rebounding", "transition", "perimeter_defense", "interior_defense",
    ):
        total = sum(_composite_value(composite, category) for composite in composites)
        avg = total / n_players

        if total < missing_threshold:
            severity = (missing_threshold - total) / missing_threshold
            weaknesses.append(_note("weakness", category, severity, total, missing_text[category], values))
        elif avg < weak_avg_threshold:
            severity = (weak_avg_threshold - avg) / weak_avg_threshold
            weaknesses.append(_note("weakness", category, severity, avg, weak_text[category], values))

    best_passer_value = max(
        (tier_value(player.get("skills", {}), "passer", tv) for player in players),
        default=0.0,
    )
    if best_passer_value < passer_threshold:
        severity = (passer_threshold - best_passer_value) / passer_threshold
        weaknesses.append(_note("weakness", PASSING_CATEGORY, severity, best_passer_value, "No capable playmaker.", values))

    if players:
        coverage_by_height = compute_lineup_coverage_by_height(players, values)
        clusters = cluster_defense_gaps(coverage_by_height, gap_threshold)
        for cluster in clusters:
            _, archetype_label = gap_cluster_archetype(cluster)
            band_label = _height_range_label(list(range(cluster.start, cluster.end + 1)))
            severity = min(1.0, (cluster.end - cluster.start + 1) / (height_max - height_min + 1))
            weaknesses.append(_note(
                "weakness", DEFENSE_GAP_CATEGORY, severity, cluster.deepest_coverage,
                f"Defensive gap at {band_label} \u2014 add {archetype_label} to close it.", values,
            ))

    return weaknesses


def _suggestions_from_weaknesses(weaknesses: Iterable[Note], values: dict[str, Any]) -> list[Note]:
    suggestions: list[Note] = []
    has_defense_gap = any(w.category == DEFENSE_GAP_CATEGORY for w in weaknesses)

    for weakness in weaknesses:
        if has_defense_gap and weakness.category in ("perimeter_defense", "interior_defense"):
            continue

        if weakness.category == DEFENSE_GAP_CATEGORY:
            if " add " in weakness.text:
                archetype_part = weakness.text.split(" add ", maxsplit=1)[1]
                text = f"Add {archetype_part}"
            else:
                text = "Add a versatile defender to close the gap."
            suggestions.append(_note("suggestion", weakness.category, weakness.severity, weakness.raw_value, text, values))
            continue

        template = SUGGESTION_TEMPLATES.get(weakness.category)
        if not template:
            continue
        severity = values["note_severity_min"] if weakness.category == DEPTH_CATEGORY else weakness.severity
        suggestions.append(_note("suggestion", weakness.category, severity, weakness.raw_value, template, values))
    return suggestions


_OPPORTUNITY_CATEGORIES = (
    "spacing", "shot_creation", "paint_touch",
    "defensive_rebounding", "transition", "perimeter_defense", "interior_defense",
)


def _opportunity_suggestions(
    composites: list[PlayerComposites],
    existing_suggestion_categories: set[str],
    values: dict[str, Any],
) -> list[Note]:
    if not composites:
        return []

    covered_threshold: float = values["note_covered_composite_threshold"]
    n_players = len(composites)

    scored: list[tuple[str, float]] = []
    for category in _OPPORTUNITY_CATEGORIES:
        if category in existing_suggestion_categories:
            continue

        cat_values = [_composite_value(c, category) for c in composites]
        avg = sum(cat_values) / n_players
        best = max(cat_values)

        covered_penalty = 5.0 if best >= covered_threshold else 0.0
        priority = avg + covered_penalty
        scored.append((category, priority))

    scored.sort(key=lambda item: item[1])

    suggestions: list[Note] = []
    for category, priority in scored:
        archetype = OPPORTUNITY_ARCHETYPES.get(category)
        if not archetype:
            continue
        avg = priority if priority < 5.0 else priority - 5.0
        severity = max(0.1, (10.0 - avg) / 10.0)
        suggestions.append(_note(
            "suggestion", category, severity, avg,
            f"{archetype.capitalize()} would most improve this team.", values,
        ))

    return suggestions


def _lineup_from_pipeline(pipeline_data: Any) -> LineupCohesion | None:
    lineup = _get_pipeline_value(pipeline_data, "starting_lineup")
    if isinstance(lineup, LineupCohesion):
        return lineup
    if isinstance(lineup, dict):
        return LineupCohesion(
            score=float(lineup.get("score", lineup.get("cohesion_score", 0.0))),
            subscores=dict(lineup.get("subscores", {})),
            synergies_applied=list(lineup.get("synergies_applied", [])),
            accentuation_strength=float(lineup.get("accentuation_strength", 0.0)),
            accentuation_weakness=float(lineup.get("accentuation_weakness", 0.0)),
            accentuation_details=dict(lineup.get("accentuation_details", {})),
        )
    if is_dataclass(lineup):
        return lineup
    return None


def _mode_b_notes(
    pipeline_data: Any,
    composites: list[PlayerComposites] | None,
    values: dict[str, Any],
) -> list[Note]:
    lineup = _lineup_from_pipeline(pipeline_data)
    if lineup is None:
        return []

    viable_threshold: float = values["viable_lineup_threshold"]
    notes: list[Note] = []
    subscores = lineup.subscores

    for category, value in sorted(subscores.items(), key=lambda item: item[1], reverse=True):
        if value < 7.0:
            continue
        label = SUBSCORE_LABELS.get(category, category.replace("_", " "))
        notes.append(_note("strength", category, value / 10.0, value, f"Lineup-level {label} is a clear strength.", values))

    if lineup.synergies_applied:
        notes.append(_note(
            "strength", "synergy",
            min(1.0, 0.65 + 0.05 * len(lineup.synergies_applied)),
            len(lineup.synergies_applied),
            f"{len(lineup.synergies_applied)} lineup synergies are active.", values,
        ))

    if lineup.accentuation_strength >= 5.0:
        notes.append(_note(
            "strength", "accentuation",
            lineup.accentuation_strength / 10.0, lineup.accentuation_strength,
            "Top player strengths amplify each other cleanly.", values,
        ))

    for category, value in sorted(subscores.items(), key=lambda item: item[1]):
        threshold = 4.0
        if category.endswith("_ratio") or category in {"spacing_creation_ratio", "spacing_paint_touch_ratio", "rebound_transition_ratio"}:
            threshold = 5.0
        if category == "defensive_gaps":
            threshold = 6.0
        if value >= threshold:
            continue
        label = SUBSCORE_LABELS.get(category, category.replace("_", " "))
        severity = (threshold - value) / threshold
        if "ratio" in category:
            text = f"Lineup balance issue: {label} is lagging."
        elif category == "defensive_gaps":
            text = "Lineup defensive coverage has exploitable gaps."
        else:
            text = f"Lineup-level {label} is thin."
        notes.append(_note("weakness", category, severity, value, text, values))

    all_lineups = _get_pipeline_value(pipeline_data, "all_lineups")
    if isinstance(all_lineups, list):
        viable = [lu for lu in all_lineups if _lineup_score(lu) >= viable_threshold]
        if viable:
            all_keys: set[str] = set()
            for lu in viable:
                all_keys.update(_lineup_subscores(lu).keys())

            starting_weak_categories = {n.category for n in notes if n.type == "weakness"}
            for key in sorted(all_keys):
                if key in starting_weak_categories:
                    continue
                key_values = [_lineup_subscores(lu).get(key, 0.0) for lu in viable]
                med = median(key_values)
                threshold = 4.0
                if key.endswith("_ratio") or key in {"spacing_creation_ratio", "spacing_paint_touch_ratio", "rebound_transition_ratio"}:
                    threshold = 5.0
                if key == "defensive_gaps":
                    threshold = 6.0
                if med >= threshold:
                    continue
                label = SUBSCORE_LABELS.get(key, key.replace("_", " "))
                severity = (threshold - med) / threshold
                notes.append(_note(
                    "weakness", key, severity * 0.8, med,
                    f"Team-wide {label} is a concern across viable lineups.", values,
                ))

    if lineup.accentuation_weakness < 4.0:
        notes.append(_note(
            "weakness", "accentuation",
            (4.0 - lineup.accentuation_weakness) / 4.0, lineup.accentuation_weakness,
            "Player weaknesses are not being covered by teammates.", values,
        ))

    weaknesses = [note for note in notes if note.type == "weakness"]
    suggestions: list[Note] = []
    for weakness in weaknesses:
        suggestion_category = SUBSCORE_SUGGESTIONS.get(weakness.category, weakness.category)
        template = SUGGESTION_TEMPLATES.get(suggestion_category)
        if not template:
            continue
        text = template.format(height="the uncovered size band") if "{height}" in template else template
        suggestions.append(_note("suggestion", suggestion_category, weakness.severity, weakness.raw_value, text, values))
    notes.extend(suggestions)

    if composites:
        existing_categories = {s.category for s in suggestions}
        if DEFENSE_GAP_CATEGORY in existing_categories:
            existing_categories.update(("perimeter_defense", "interior_defense"))
        opportunities = _opportunity_suggestions(composites, existing_categories, values)
        notes.extend(opportunities)

    return notes


def generate_notes(
    players: list[dict[str, Any]],
    composites: list[PlayerComposites],
    values: dict[str, Any],
    pipeline_data: Any | None = None,
) -> list[Note]:
    """
    Generate deterministic roster feedback.

    Rosters with fewer than five players use Mode A composite-level notes.
    Rosters with five or more players use Mode B lineup-level notes when
    pipeline data is available, falling back to Mode A if called standalone.
    """
    min_roster_size: int = values["note_min_roster_size"]

    if len(players) >= 5 and pipeline_data is not None:
        notes = _mode_b_notes(pipeline_data, composites, values)
        if notes:
            return _limit_by_type(notes, values)

    strengths = _mode_a_strengths(players, composites, values)
    weaknesses = _mode_a_weaknesses(players, composites, values)

    if len(players) < min_roster_size:
        weaknesses.insert(
            0,
            _note(
                "weakness", DEPTH_CATEGORY, 1.0, float(len(players)),
                f"Only {len(players)} player{'s' if len(players) != 1 else ''} on the team"
                f" \u2014 need at least {min_roster_size} for a viable lineup.", values,
            ),
        )

    suggestions = _suggestions_from_weaknesses(weaknesses, values)

    existing_categories = {s.category for s in suggestions}
    if DEFENSE_GAP_CATEGORY in existing_categories:
        existing_categories.update(("perimeter_defense", "interior_defense"))
    opportunities = _opportunity_suggestions(composites, existing_categories, values)
    suggestions.extend(opportunities)

    return _limit_by_type([*strengths, *weaknesses, *suggestions], values)
