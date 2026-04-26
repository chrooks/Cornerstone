"""
Structured roster notes for the cohesion engine.

Mode A explains partial rosters from player composites alone. Mode B explains
lineup-ready rosters from the already-computed cohesion pipeline output. The
module is intentionally pure: no database calls, no network calls, and no
mutation of incoming player dictionaries.
"""

from __future__ import annotations

from dataclasses import is_dataclass
from typing import Any, Iterable

from .bell_curve import compute_lineup_defense
from .composites import tier_value
from .types import LineupCohesion, Note, PlayerComposites
from .weights import (
    HEIGHT_MAX_INCHES,
    HEIGHT_MIN_INCHES,
    NOTE_CAPABLE_PASSER_THRESHOLD,
    NOTE_ELITE_BELL_AMPLITUDE_THRESHOLD,
    NOTE_ELITE_COMPOSITE_THRESHOLD,
    NOTE_LIMIT_PER_TYPE,
    NOTE_MISSING_COMPOSITE_THRESHOLD,
    NOTE_SEVERITY_MAX,
    NOTE_SEVERITY_MIN,
    NOTE_STACKED_COMPOSITE_THRESHOLD,
    NOTE_STACKED_PLAYER_COUNT,
)

PASSING_CATEGORY = "passing"
DEFENSE_GAP_CATEGORY = "defense_gap"

SUGGESTION_TEMPLATES: dict[str, str] = {
    "spacing": "Add a spot-up or movement shooter to open the floor.",
    "shot_creation": "Add a ball handler or isolation scorer to generate offense.",
    "paint_touch": "Add a driver or interior scorer to attack the paint.",
    "post_game": "Add a low-post or mid-post scorer.",
    "pnr_screener": "Add a PnR roll man or screen setter.",
    "anchor": "Add a rim protector to anchor the paint.",
    "rebounding": "Add a rebounder to control the glass.",
    PASSING_CATEGORY: "Add a playmaker to orchestrate the offense.",
    "transition": "Add a transition athlete for fast-break scoring.",
    "off_ball": "Add an off-ball threat - a cutter or movement shooter.",
    "off_ball_impact": "Add an off-ball threat - a cutter or movement shooter.",
    DEFENSE_GAP_CATEGORY: "Add a versatile defender around {height} to close the gap.",
}

COMPOSITE_LABELS: dict[str, str] = {
    "spacing": "spacing",
    "shot_creation": "shot creation",
    "paint_touch": "paint touch",
    "post_game": "post play",
    "pnr_screener": "screen-and-roll play",
    "anchor": "paint defense",
    "rebounding": "rebounding",
    "transition": "transition play",
    "off_ball_impact": "off-ball impact",
}

SUBSCORE_LABELS: dict[str, str] = {
    "spacing_creation_ratio": "spacing and creation balance",
    "spacing_paint_touch_ratio": "spacing and paint pressure balance",
    "paint_touch_total": "paint pressure",
    "post_game_total": "post scoring",
    "pnr_screener_total": "screen-and-roll play",
    "anchor_total": "paint defense",
    "collective_passing": "passing",
    "rebounding": "rebounding",
    "transition": "transition play",
    "rebound_transition_ratio": "rebound-to-run balance",
    "rebounding_spacing_deficit": "spacing with glass support",
    "defensive_coverage": "defensive coverage",
    "defensive_gaps": "defensive coverage",
}

SUBSCORE_SUGGESTIONS: dict[str, str] = {
    "spacing_creation_ratio": "spacing",
    "spacing_paint_touch_ratio": "spacing",
    "paint_touch_total": "paint_touch",
    "post_game_total": "post_game",
    "pnr_screener_total": "pnr_screener",
    "anchor_total": "anchor",
    "collective_passing": PASSING_CATEGORY,
    "rebounding": "rebounding",
    "transition": "transition",
    "rebound_transition_ratio": "transition",
    "rebounding_spacing_deficit": "spacing",
    "defensive_coverage": DEFENSE_GAP_CATEGORY,
    "defensive_gaps": DEFENSE_GAP_CATEGORY,
}


def _clamp_severity(value: float) -> float:
    return round(max(NOTE_SEVERITY_MIN, min(NOTE_SEVERITY_MAX, value)), 3)


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


def _composite_value(composite: PlayerComposites, category: str) -> float:
    return float(getattr(composite, category))


def _note(
    note_type: str,
    category: str,
    severity: float,
    raw_value: float,
    text: str,
) -> Note:
    return Note(
        type=note_type,  # type: ignore[arg-type]
        category=category,
        severity=_clamp_severity(severity),
        raw_value=round(float(raw_value), 2),
        text=text,
    )


def _ranked(notes: Iterable[Note]) -> list[Note]:
    return sorted(notes, key=lambda note: (-note.severity, note.category, note.text))


def _dedupe_and_limit(notes: Iterable[Note]) -> list[Note]:
    selected: list[Note] = []
    seen: set[tuple[str, str]] = set()

    for note in _ranked(notes):
        key = (note.type, note.category)
        if key in seen:
            continue
        seen.add(key)
        selected.append(note)
        if len(selected) >= NOTE_LIMIT_PER_TYPE:
            break

    return selected


def _limit_by_type(notes: Iterable[Note]) -> list[Note]:
    by_type: dict[str, list[Note]] = {"strength": [], "weakness": [], "suggestion": []}
    for note in notes:
        by_type[note.type].append(note)

    limited: list[Note] = []
    for note_type in ("strength", "weakness", "suggestion"):
        limited.extend(_dedupe_and_limit(by_type[note_type]))
    return limited


def _strongest_player(composites: list[PlayerComposites], category: str) -> PlayerComposites | None:
    if not composites:
        return None
    return max(composites, key=lambda composite: _composite_value(composite, category))


def _mode_a_strengths(players: list[dict[str, Any]], composites: list[PlayerComposites]) -> list[Note]:
    strengths: list[Note] = []

    for category in ("spacing", "shot_creation", "paint_touch", "anchor", "transition"):
        strongest = _strongest_player(composites, category)
        if strongest and _composite_value(strongest, category) >= NOTE_ELITE_COMPOSITE_THRESHOLD:
            text_by_category = {
                "spacing": f"{strongest.name}'s shooting creates elite floor spacing.",
                "shot_creation": f"{strongest.name} is an elite shot creator.",
                "paint_touch": f"{strongest.name} dominates inside.",
                "anchor": f"{strongest.name} anchors the paint.",
                "transition": f"{strongest.name} is a transition force.",
            }
            raw_value = _composite_value(strongest, category)
            strengths.append(_note("strength", category, raw_value / 10.0, raw_value, text_by_category[category]))

    for category, text in (
        ("spacing", "Multiple shooters - floor spacing is a strength."),
        (PASSING_CATEGORY, "Multiple playmakers - ball movement will flow."),
    ):
        if category == PASSING_CATEGORY:
            count = sum(
                1
                for player in players
                if tier_value(player.get("skills", {}), "passer") >= NOTE_STACKED_COMPOSITE_THRESHOLD
            )
            raw_value = float(count)
        else:
            count = sum(
                1
                for composite in composites
                if _composite_value(composite, category) >= NOTE_STACKED_COMPOSITE_THRESHOLD
            )
            raw_value = float(count)
        if count >= NOTE_STACKED_PLAYER_COUNT:
            strengths.append(_note("strength", category, 0.75 + 0.05 * count, raw_value, text))

    best_passer = max(
        players,
        key=lambda player: tier_value(player.get("skills", {}), "passer"),
        default=None,
    )
    if best_passer:
        passer_value = tier_value(best_passer.get("skills", {}), "passer")
        if passer_value >= NOTE_ELITE_COMPOSITE_THRESHOLD:
            name = str(best_passer.get("name") or "This roster")
            strengths.append(_note("strength", PASSING_CATEGORY, passer_value / 10.0, passer_value, f"{name} is an all-time caliber passer."))

    for composite in composites:
        if composite.bell_amplitude >= NOTE_ELITE_BELL_AMPLITUDE_THRESHOLD:
            strengths.append(
                _note(
                    "strength",
                    "defense",
                    composite.bell_amplitude / 4.0,
                    composite.bell_amplitude,
                    f"{composite.name}'s defensive versatility covers multiple positions.",
                )
            )

    handler = next((player for player in players if tier_value(player.get("skills", {}), "pnr_ball_handler") >= NOTE_STACKED_COMPOSITE_THRESHOLD), None)
    finisher = next((player for player in players if tier_value(player.get("skills", {}), "pnr_finisher") >= NOTE_STACKED_COMPOSITE_THRESHOLD and player is not handler), None)
    if handler and finisher:
        strengths.append(
            _note(
                "strength",
                "synergy",
                0.85,
                2.0,
                f"PnR duo: {handler.get('name')} and {finisher.get('name')} form a two-man game.",
            )
        )

    screener = next((player for player in players if tier_value(player.get("skills", {}), "screen_setter") >= NOTE_STACKED_COMPOSITE_THRESHOLD), None)
    shooter = next((player for player in players if tier_value(player.get("skills", {}), "movement_shooter") >= NOTE_STACKED_COMPOSITE_THRESHOLD and player is not screener), None)
    if screener and shooter:
        strengths.append(
            _note(
                "strength",
                "synergy",
                0.8,
                2.0,
                f"Off-ball actions: {screener.get('name')}'s screens free {shooter.get('name')}.",
            )
        )

    for composite in composites:
        offense_values = [composite.spacing, composite.paint_touch, composite.shot_creation, composite.off_ball_impact, composite.transition]
        defense_values = [composite.anchor, composite.rebounding, composite.bell_amplitude * 2.5]
        if max(offense_values, default=0.0) >= 7.5 and max(defense_values, default=0.0) >= 7.5:
            raw_value = min(max(offense_values), max(defense_values))
            strengths.append(_note("strength", "two_way", raw_value / 10.0, raw_value, f"{composite.name} is a two-way force."))

    if not strengths and composites:
        best_category, best_composite = max(
            (
                (category, composite)
                for composite in composites
                for category in COMPOSITE_LABELS
            ),
            key=lambda item: _composite_value(item[1], item[0]),
        )
        raw_value = _composite_value(best_composite, best_category)
        strengths.append(
            _note(
                "strength",
                best_category,
                raw_value / 10.0,
                raw_value,
                f"{best_composite.name}'s best early fit signal is {COMPOSITE_LABELS[best_category]}.",
            )
        )

    return strengths


def _mode_a_weaknesses(players: list[dict[str, Any]], composites: list[PlayerComposites]) -> list[Note]:
    weaknesses: list[Note] = []

    for category in ("spacing", "shot_creation", "paint_touch", "anchor", "rebounding", "transition"):
        total = sum(_composite_value(composite, category) for composite in composites)
        if total < NOTE_MISSING_COMPOSITE_THRESHOLD:
            text_by_category = {
                "spacing": "No floor spacing - defenders can collapse freely.",
                "shot_creation": "No primary shot creator on the roster.",
                "paint_touch": "No interior scoring presence.",
                "anchor": "No rim protection or paint control.",
                "rebounding": "Rebounding is nonexistent.",
                "transition": "No transition game.",
            }
            severity = (NOTE_MISSING_COMPOSITE_THRESHOLD - total) / NOTE_MISSING_COMPOSITE_THRESHOLD
            weaknesses.append(_note("weakness", category, severity, total, text_by_category[category]))

    best_passer_value = max(
        (tier_value(player.get("skills", {}), "passer") for player in players),
        default=0.0,
    )
    if best_passer_value < NOTE_CAPABLE_PASSER_THRESHOLD:
        severity = (NOTE_CAPABLE_PASSER_THRESHOLD - best_passer_value) / NOTE_CAPABLE_PASSER_THRESHOLD
        weaknesses.append(_note("weakness", PASSING_CATEGORY, severity, best_passer_value, "No capable playmaker."))

    if players:
        _coverage, _penalty, gaps = compute_lineup_defense(players)
        if gaps:
            label = _height_range_label(gaps)
            severity = min(1.0, len(gaps) / (HEIGHT_MAX_INCHES - HEIGHT_MIN_INCHES + 1))
            weaknesses.append(
                _note(
                    "weakness",
                    DEFENSE_GAP_CATEGORY,
                    severity,
                    len(gaps),
                    f"Defensive gap at {label} - opponents there find easy matchups.",
                )
            )

    return weaknesses


def _suggestions_from_weaknesses(weaknesses: Iterable[Note]) -> list[Note]:
    suggestions: list[Note] = []
    for weakness in weaknesses:
        template = SUGGESTION_TEMPLATES.get(weakness.category)
        if not template:
            continue
        text = template
        if "{height}" in text:
            height = "that size"
            if weakness.category == DEFENSE_GAP_CATEGORY and " at " in weakness.text:
                height = weakness.text.split(" at ", maxsplit=1)[1].split(" - ", maxsplit=1)[0]
            text = text.format(height=height)
        suggestions.append(_note("suggestion", weakness.category, weakness.severity, weakness.raw_value, text))
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
        )
    if is_dataclass(lineup):
        return lineup
    return None


def _mode_b_notes(pipeline_data: Any) -> list[Note]:
    lineup = _lineup_from_pipeline(pipeline_data)
    if lineup is None:
        return []

    notes: list[Note] = []
    subscores = lineup.subscores

    for category, value in sorted(subscores.items(), key=lambda item: item[1], reverse=True):
        if value < 7.0:
            continue
        label = SUBSCORE_LABELS.get(category, category.replace("_", " "))
        notes.append(_note("strength", category, value / 10.0, value, f"Lineup-level {label} is a clear strength."))

    if lineup.synergies_applied:
        notes.append(
            _note(
                "strength",
                "synergy",
                min(1.0, 0.65 + 0.05 * len(lineup.synergies_applied)),
                len(lineup.synergies_applied),
                f"{len(lineup.synergies_applied)} lineup synergies are active.",
            )
        )

    if lineup.accentuation_strength >= 5.0:
        notes.append(
            _note(
                "strength",
                "accentuation",
                lineup.accentuation_strength / 10.0,
                lineup.accentuation_strength,
                "Top player strengths amplify each other cleanly.",
            )
        )

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
        notes.append(_note("weakness", category, severity, value, text))

    if lineup.accentuation_weakness < 4.0:
        notes.append(
            _note(
                "weakness",
                "accentuation",
                (4.0 - lineup.accentuation_weakness) / 4.0,
                lineup.accentuation_weakness,
                "Player weaknesses are not being covered by teammates.",
            )
        )

    weaknesses = [note for note in notes if note.type == "weakness"]
    suggestions: list[Note] = []
    for weakness in weaknesses:
        suggestion_category = SUBSCORE_SUGGESTIONS.get(weakness.category, weakness.category)
        template = SUGGESTION_TEMPLATES.get(suggestion_category)
        if not template:
            continue
        text = template.format(height="the uncovered size band") if "{height}" in template else template
        suggestions.append(
            _note(
                "suggestion",
                suggestion_category,
                weakness.severity,
                weakness.raw_value,
                text,
            )
        )
    notes.extend(suggestions)

    return notes


def generate_notes(
    players: list[dict[str, Any]],
    composites: list[PlayerComposites],
    pipeline_data: Any | None = None,
) -> list[Note]:
    """
    Generate deterministic roster feedback.

    Rosters with fewer than five players use Mode A composite-level notes.
    Rosters with five or more players use Mode B lineup-level notes when
    pipeline data is available, falling back to Mode A if called standalone.
    """
    if len(players) >= 5 and pipeline_data is not None:
        notes = _mode_b_notes(pipeline_data)
        if notes:
            return _limit_by_type(notes)

    strengths = _mode_a_strengths(players, composites)
    weaknesses = _mode_a_weaknesses(players, composites)
    suggestions = _suggestions_from_weaknesses(weaknesses)
    return _limit_by_type([*strengths, *weaknesses, *suggestions])
