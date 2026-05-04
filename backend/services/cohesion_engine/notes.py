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
from .weights import (
    DEFENSIVE_GAP_THRESHOLD,
    HEIGHT_MAX_INCHES,
    HEIGHT_MIN_INCHES,
    NOTE_CAPABLE_PASSER_THRESHOLD,
    NOTE_ELITE_BELL_AMPLITUDE_THRESHOLD,
    NOTE_ELITE_COMPOSITE_THRESHOLD,
    NOTE_LIMIT_PER_TYPE,
    NOTE_COVERED_COMPOSITE_THRESHOLD,
    NOTE_MIN_ROSTER_SIZE,
    NOTE_MISSING_COMPOSITE_THRESHOLD,
    NOTE_SEVERITY_MAX,
    NOTE_SEVERITY_MIN,
    NOTE_STACKED_COMPOSITE_THRESHOLD,
    NOTE_STACKED_PLAYER_COUNT,
    NOTE_WEAK_COMPOSITE_AVG_THRESHOLD,
    VIABLE_LINEUP_THRESHOLD,
)

PASSING_CATEGORY = "passing"
DEFENSE_GAP_CATEGORY = "defense_gap"
DEPTH_CATEGORY = "depth"

SUGGESTION_TEMPLATES: dict[str, str] = {
    "spacing": "Add a spot-up or movement shooter to open the floor.",
    "shot_creation": "Add a ball handler or isolation scorer to generate offense.",
    "paint_touch": "Add a driver or interior scorer to pressure the rim.",
    "post_game": "Add a low-post or mid-post scorer.",
    "pnr_screener": "Add a PnR roll man or screen setter.",
    "anchor": "Add a rim protector to anchor the paint.",
    "perimeter_defense": "Add a perimeter defender to pressure ball handlers.",
    "interior_defense": "Add an interior defender to protect the paint.",
    "rebounding": "Add a rebounder to control the glass.",
    PASSING_CATEGORY: "Add a playmaker to orchestrate the offense.",
    "transition": "Add a transition athlete for fast-break scoring.",
    "off_ball": "Add an off-ball threat - a cutter or movement shooter.",
    "off_ball_impact": "Add an off-ball threat - a cutter or movement shooter.",
    DEFENSE_GAP_CATEGORY: "Add a versatile defender to close the gap.",
    DEPTH_CATEGORY: "Add more players to fill out the rotation.",
}

# Maps composite categories to archetype labels for opportunity suggestions.
OPPORTUNITY_ARCHETYPES: dict[str, str] = {
    "spacing": "a shooter",
    "shot_creation": "a ball handler",
    "paint_touch": "a rim attacker",
    "anchor": "a rim protector",
    "rebounding": "a rebounder",
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
    "anchor": "paint defense",
    "perimeter_defense": "perimeter pressure",
    "interior_defense": "interior defense",
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
    "pnr_pairing": "pick-and-roll pairing",
    "anchor_total": "paint defense",
    "perimeter_defense_total": "perimeter pressure",
    "interior_defense_total": "interior defense",
    "collective_passing": "passing",
    "rebounding": "rebounding",
    "transition": "transition play",
    "rebound_transition_ratio": "rebound-to-run balance",
    "rebounding_spacing_deficit": "spacing support",
    "defensive_coverage": "defensive coverage",
    "defensive_gaps": "defensive coverage",
}

SUBSCORE_SUGGESTIONS: dict[str, str] = {
    "spacing_creation_ratio": "spacing",
    "spacing_paint_touch_ratio": "spacing",
    "paint_touch_total": "paint_touch",
    "post_game_total": "post_game",
    "pnr_screener_total": "pnr_screener",
    "pnr_pairing": "pnr_screener",
    "anchor_total": "anchor",
    "perimeter_defense_total": "perimeter_defense",
    "interior_defense_total": "interior_defense",
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


def _lineup_score(lineup: Any) -> float:
    """Extract the cohesion score from a LineupCohesion or raw dict."""
    if isinstance(lineup, LineupCohesion):
        return lineup.score
    if isinstance(lineup, dict):
        return float(lineup.get("score", lineup.get("cohesion_score", 0.0)))
    if is_dataclass(lineup):
        return float(getattr(lineup, "score", 0.0))
    return 0.0


def _lineup_subscores(lineup: Any) -> dict[str, float]:
    """Extract subscores dict from a LineupCohesion or raw dict."""
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

    for category in (
        "spacing",
        "shot_creation",
        "paint_touch",
        "anchor",
        "transition",
        "perimeter_defense",
        "interior_defense",
    ):
        strongest = _strongest_player(composites, category)
        if strongest and _composite_value(strongest, category) >= NOTE_ELITE_COMPOSITE_THRESHOLD:
            text_by_category = {
                "spacing": f"{strongest.name}'s shooting creates elite floor spacing.",
                "shot_creation": f"{strongest.name} is an elite shot creator.",
                "paint_touch": f"{strongest.name} creates elite rim pressure.",
                "anchor": f"{strongest.name} anchors the paint.",
                "transition": f"{strongest.name} is a transition force.",
                "perimeter_defense": f"{strongest.name} applies elite perimeter pressure.",
                "interior_defense": f"{strongest.name} protects the interior at an elite level.",
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
        defense_values = [
            composite.anchor,
            composite.perimeter_defense,
            composite.interior_defense,
            composite.rebounding,
            composite.bell_amplitude * 2.5,
        ]
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

    # Text for catastrophic absence (total near zero across all players).
    missing_text: dict[str, str] = {
        "spacing": "No floor spacing - defenders can collapse freely.",
        "shot_creation": "No primary shot creator on the roster.",
        "paint_touch": "No rim pressure.",
        "anchor": "No rim protection or paint control.",
        "rebounding": "Rebounding is nonexistent.",
        "transition": "No transition game.",
        "perimeter_defense": "No perimeter pressure at the point of attack.",
        "interior_defense": "No interior defensive presence.",
    }

    # Text for per-player weakness (average is below the weak threshold).
    weak_text: dict[str, str] = {
        "spacing": "Roster lacks floor spacing - need more shooting.",
        "shot_creation": "Shot creation is thin - need a primary ball handler.",
        "paint_touch": "Limited rim pressure - need more interior scoring.",
        "anchor": "Paint protection is undersized - need an anchor.",
        "rebounding": "Rebounding is a liability.",
        "transition": "No reliable transition scoring.",
        "perimeter_defense": "Perimeter defense is exposed.",
        "interior_defense": "Interior defense is soft.",
    }

    n_players = max(len(composites), 1)
    for category in (
        "spacing",
        "shot_creation",
        "paint_touch",
        "anchor",
        "rebounding",
        "transition",
        "perimeter_defense",
        "interior_defense",
    ):
        total = sum(_composite_value(composite, category) for composite in composites)
        avg = total / n_players

        # Catastrophic: virtually no contribution from any player.
        if total < NOTE_MISSING_COMPOSITE_THRESHOLD:
            severity = (NOTE_MISSING_COMPOSITE_THRESHOLD - total) / NOTE_MISSING_COMPOSITE_THRESHOLD
            weaknesses.append(_note("weakness", category, severity, total, missing_text[category]))
        # Weak average: roster has some coverage but not enough per player.
        elif avg < NOTE_WEAK_COMPOSITE_AVG_THRESHOLD:
            severity = (NOTE_WEAK_COMPOSITE_AVG_THRESHOLD - avg) / NOTE_WEAK_COMPOSITE_AVG_THRESHOLD
            weaknesses.append(_note("weakness", category, severity, avg, weak_text[category]))

    best_passer_value = max(
        (tier_value(player.get("skills", {}), "passer") for player in players),
        default=0.0,
    )
    if best_passer_value < NOTE_CAPABLE_PASSER_THRESHOLD:
        severity = (NOTE_CAPABLE_PASSER_THRESHOLD - best_passer_value) / NOTE_CAPABLE_PASSER_THRESHOLD
        weaknesses.append(_note("weakness", PASSING_CATEGORY, severity, best_passer_value, "No capable playmaker."))

    if players:
        coverage_by_height = compute_lineup_coverage_by_height(players)
        clusters = cluster_defense_gaps(coverage_by_height, DEFENSIVE_GAP_THRESHOLD)
        for cluster in clusters:
            _, archetype_label = gap_cluster_archetype(cluster)
            band_label = _height_range_label(list(range(cluster.start, cluster.end + 1)))
            severity = min(1.0, (cluster.end - cluster.start + 1) / (HEIGHT_MAX_INCHES - HEIGHT_MIN_INCHES + 1))
            weaknesses.append(
                _note(
                    "weakness",
                    DEFENSE_GAP_CATEGORY,
                    severity,
                    cluster.deepest_coverage,
                    f"Defensive gap at {band_label} \u2014 add {archetype_label} to close it.",
                )
            )

    return weaknesses


def _suggestions_from_weaknesses(weaknesses: Iterable[Note]) -> list[Note]:
    suggestions: list[Note] = []
    has_defense_gap = any(w.category == DEFENSE_GAP_CATEGORY for w in weaknesses)

    for weakness in weaknesses:
        # Skip generic defensive suggestions when a defense_gap suggestion
        # already covers the need with a specific size band.
        if has_defense_gap and weakness.category in ("perimeter_defense", "interior_defense"):
            continue

        # Defense gap weaknesses already contain the archetype action —
        # extract it directly instead of using the generic template.
        if weakness.category == DEFENSE_GAP_CATEGORY:
            # Text format: "Defensive gap at X — add {archetype} to close it."
            # Extract everything after "add " as the suggestion.
            if " add " in weakness.text:
                archetype_part = weakness.text.split(" add ", maxsplit=1)[1]
                text = f"Add {archetype_part}"
            else:
                text = "Add a versatile defender to close the gap."
            suggestions.append(_note("suggestion", weakness.category, weakness.severity, weakness.raw_value, text))
            continue

        template = SUGGESTION_TEMPLATES.get(weakness.category)
        if not template:
            continue
        text = template
        # Depth suggestion is always last — the user already sees the depth
        # weakness; actionable roster-building suggestions matter more.
        severity = NOTE_SEVERITY_MIN if weakness.category == DEPTH_CATEGORY else weakness.severity
        suggestions.append(_note("suggestion", weakness.category, severity, weakness.raw_value, text))
    return suggestions


# Categories eligible for opportunity suggestions. Excludes passing
# (handled separately) and defense_gap / depth (not composite-based).
_OPPORTUNITY_CATEGORIES = (
    "spacing",
    "shot_creation",
    "paint_touch",
    "anchor",
    "rebounding",
    "transition",
    "perimeter_defense",
    "interior_defense",
)


def _opportunity_suggestions(
    composites: list[PlayerComposites],
    existing_suggestion_categories: set[str],
) -> list[Note]:
    """
    Rank composites by how much the roster would benefit from adding a player
    in that role, then return suggestion notes for the top opportunities not
    already covered by weakness-based suggestions.

    Ranking uses a hybrid score: per-player average is the primary signal, but
    categories where at least one player already exceeds the "covered" threshold
    are deprioritized — a roster with an elite rim protector doesn't need
    another anchor even if the average is low.
    """
    if not composites:
        return []

    n_players = len(composites)

    # Build (category, priority_score) pairs. Lower score = bigger opportunity.
    scored: list[tuple[str, float]] = []
    for category in _OPPORTUNITY_CATEGORIES:
        # Skip categories that already have a weakness-based suggestion.
        if category in existing_suggestion_categories:
            continue

        values = [_composite_value(c, category) for c in composites]
        avg = sum(values) / n_players
        best = max(values)

        # Deprioritize covered categories by pushing their score up.
        # A covered category still gets ranked, just behind uncovered ones.
        covered_penalty = 5.0 if best >= NOTE_COVERED_COMPOSITE_THRESHOLD else 0.0
        priority = avg + covered_penalty

        scored.append((category, priority))

    # Sort ascending — lowest priority score = biggest opportunity.
    scored.sort(key=lambda item: item[1])

    suggestions: list[Note] = []
    for category, priority in scored:
        archetype = OPPORTUNITY_ARCHETYPES.get(category)
        if not archetype:
            continue
        # Severity scales inversely with priority — lower avg = higher severity.
        avg = priority if priority < 5.0 else priority - 5.0
        severity = max(0.1, (10.0 - avg) / 10.0)
        suggestions.append(
            _note(
                "suggestion",
                category,
                severity,
                avg,
                f"{archetype.capitalize()} would most improve this rotation.",
            )
        )

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
    composites: list[PlayerComposites] | None = None,
) -> list[Note]:
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

    # Rotation-wide check: median subscores across viable lineups.
    # Catches roster composition issues (e.g., 4 non-shooting bigs on bench)
    # that the starting 5's subscores alone won't reveal.
    all_lineups = _get_pipeline_value(pipeline_data, "all_lineups")
    if isinstance(all_lineups, list):
        viable = [lu for lu in all_lineups if _lineup_score(lu) >= VIABLE_LINEUP_THRESHOLD]
        if viable:
            # Collect all subscore keys across viable lineups.
            all_keys: set[str] = set()
            for lu in viable:
                all_keys.update(_lineup_subscores(lu).keys())

            starting_weak_categories = {n.category for n in notes if n.type == "weakness"}
            for key in sorted(all_keys):
                # Skip categories already flagged by the starting-lineup check.
                if key in starting_weak_categories:
                    continue
                values = [_lineup_subscores(lu).get(key, 0.0) for lu in viable]
                med = median(values)
                threshold = 4.0
                if key.endswith("_ratio") or key in {"spacing_creation_ratio", "spacing_paint_touch_ratio", "rebound_transition_ratio"}:
                    threshold = 5.0
                if key == "defensive_gaps":
                    threshold = 6.0
                if med >= threshold:
                    continue
                label = SUBSCORE_LABELS.get(key, key.replace("_", " "))
                severity = (threshold - med) / threshold
                notes.append(
                    _note(
                        "weakness",
                        key,
                        severity * 0.8,  # slightly lower than starting-lineup weaknesses
                        med,
                        f"Rotation-wide {label} is a concern across viable lineups.",
                    )
                )

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

    # Fill remaining suggestion slots with opportunity-based recommendations.
    if composites:
        existing_categories = {s.category for s in suggestions}
        if DEFENSE_GAP_CATEGORY in existing_categories:
            existing_categories.update(("perimeter_defense", "interior_defense"))
        opportunities = _opportunity_suggestions(composites, existing_categories)
        notes.extend(opportunities)

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
        notes = _mode_b_notes(pipeline_data, composites)
        if notes:
            return _limit_by_type(notes)

    strengths = _mode_a_strengths(players, composites)
    weaknesses = _mode_a_weaknesses(players, composites)

    # Always flag incomplete rosters so users know more depth is needed.
    if len(players) < NOTE_MIN_ROSTER_SIZE:
        weaknesses.insert(
            0,
            _note(
                "weakness",
                DEPTH_CATEGORY,
                1.0,
                float(len(players)),
                f"Only {len(players)} player{'s' if len(players) != 1 else ''} in the rotation"
                f" \u2014 need at least {NOTE_MIN_ROSTER_SIZE} for a viable lineup.",
            ),
        )

    suggestions = _suggestions_from_weaknesses(weaknesses)

    # Fill remaining suggestion slots with opportunity-based recommendations
    # for categories not already covered by weakness suggestions.
    existing_categories = {s.category for s in suggestions}
    # Defense gap subsumes perimeter/interior defense suggestions.
    if DEFENSE_GAP_CATEGORY in existing_categories:
        existing_categories.update(("perimeter_defense", "interior_defense"))
    opportunities = _opportunity_suggestions(composites, existing_categories)
    suggestions.extend(opportunities)

    return _limit_by_type([*strengths, *weaknesses, *suggestions])
