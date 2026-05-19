"""
Claude-generated roster narrative for the cohesion engine.

This module mirrors the legacy roster evaluator's graceful LLM behavior while
grounding the prompt in cohesion-engine data: player composites, lineup
subscores, archetypes, and structured notes. Numeric scores are converted into
qualitative labels before they reach the prompt so the final memo stays focused
on basketball identity rather than internal math.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import anthropic

from .types import PlayerComposites, RosterEvaluation

logger = logging.getLogger(__name__)

# Ported from the legacy team narrative: cheap, fast UX flourish rather than a
# core scoring dependency.
_HAIKU_MODEL = "claude-haiku-4-5-20251001"
_MAX_TOKENS = 800

_COMPOSITE_FIELDS = (
    "spacing",
    "finishing",
    "paint_touch",
    "post_game",
    "pnr_screener",
    "off_ball_impact",
    "shot_creation",
    "ball_security",
    "defensive_rebounding",
    "offensive_rebounding",
    "transition",
    "perimeter_defense",
    "interior_defense",
)

_SUBSCORE_LABELS: dict[str, str] = {
    "spacing": "floor spacing",
    "shot_creation": "shot creation",
    "paint_touch": "rim pressure",
    "collective_passing": "collective passing",
    "off_ball_impact": "off-ball impact",
    "ball_security": "ball security",
    "pnr_pairing": "pick-and-roll pairing",
    "post_game": "post creation",
    "spacing_creation_ratio": "spacing-to-creation balance",
    "creation_offball_ratio": "creation-to-off-ball balance",
    "spacing_paint_touch_ratio": "spacing-to-rim-pressure balance",
    "interior_defense": "interior defense",
    "defensive_coverage": "defensive coverage",
    "defensive_gaps": "defensive gap management",
    "perimeter_defense": "perimeter pressure",
    "switchability": "defensive switchability",
    "defensive_rebounding": "defensive rebounding",
    "offensive_rebounding": "offensive rebounding",
    "transition": "transition pressure",
    "rebound_transition_ratio": "rebound-to-transition balance",
}

_COMPOSITE_LABELS: dict[str, str] = {
    "paint_touch": "rim pressure",
}


def _get_anthropic_client() -> anthropic.Anthropic:
    """Return an Anthropic client, raising clearly if API key is missing."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set.")
    return anthropic.Anthropic(api_key=api_key)


def _label_key(key: str) -> str:
    """Convert an internal snake_case key into memo-friendly text."""
    if key in _COMPOSITE_LABELS:
        return _COMPOSITE_LABELS[key]
    return key.replace("_", " ")


def _qualitative_score(value: float) -> str:
    """Bucket a 0-10 cohesion value without exposing the number itself."""
    if value >= 8.0:
        return "elite"
    if value >= 6.5:
        return "strong"
    if value >= 4.5:
        return "workable"
    if value >= 2.5:
        return "thin"
    return "missing"


def _composite_values(composite: PlayerComposites) -> dict[str, float]:
    """Read only user-facing composite fields from a PlayerComposites object."""
    return {key: float(getattr(composite, key)) for key in _COMPOSITE_FIELDS}


def _top_player_traits(composite: PlayerComposites, limit: int = 3) -> list[str]:
    """Return the player's best qualitative composite traits."""
    traits = sorted(
        _composite_values(composite).items(),
        key=lambda item: item[1],
        reverse=True,
    )
    return [
        f"{_label_key(name)} ({_qualitative_score(value)})"
        for name, value in traits[:limit]
        if value > 0.0
    ]


def _top_composite_contributors(
    composites: list[PlayerComposites],
    composite_name: str,
    limit: int = 3,
) -> list[str]:
    """Return top players for one composite with qualitative labels."""
    entries = sorted(
        (
            (float(getattr(composite, composite_name)), composite.name)
            for composite in composites
        ),
        reverse=True,
    )
    return [
        f"{name} ({_qualitative_score(value)})"
        for value, name in entries[:limit]
        if value > 0.0
    ]


def _player_lookup(players: list[dict[str, Any]] | None) -> dict[str, dict[str, Any]]:
    """Index optional raw player context by common ID and name fields."""
    if not players:
        return {}

    lookup: dict[str, dict[str, Any]] = {}
    for index, player in enumerate(players):
        keys = {
            str(player.get("id") or ""),
            str(player.get("player_id") or ""),
            str(player.get("name") or ""),
            f"roster-player-{index}",
        }
        for key in keys:
            if key:
                lookup[key] = player
    return lookup


def _slot_label(player: dict[str, Any] | None, total_players: int = 9) -> str:
    """Describe roster role when raw player slot context is available.

    When total_players <= 5, every player is a starter — the cornerstone
    label only applies in rotation/roster formats where it distinguishes
    a build-around pick from supporting cast.
    """
    if not player:
        return "team member"
    if player.get("is_cornerstone") and total_players > 5:
        return "cornerstone"
    slot = player.get("slot")
    if isinstance(slot, int):
        if slot <= 5:
            return "starter"
        if slot <= 9:
            return "bench"
        return "reserve"
    return "starter" if total_players <= 5 else "team member"


def _player_line(
    composite: PlayerComposites,
    raw_player: dict[str, Any] | None,
    total_players: int = 9,
) -> str:
    traits = _top_player_traits(composite)
    trait_text = ", ".join(traits) if traits else "no standout composite traits"
    return f"- {composite.name} ({_slot_label(raw_player, total_players)}): {trait_text}"


def _lineup_trait_lines(evaluation: RosterEvaluation) -> tuple[list[str], list[str]]:
    """Return strongest and thinnest lineup traits from the starting lineup."""
    subscores = evaluation.starting_lineup.subscores
    if not subscores:
        return [], []

    sorted_scores = sorted(subscores.items(), key=lambda item: item[1], reverse=True)
    strengths = [
        f"- {_SUBSCORE_LABELS.get(name, _label_key(name))}: {_qualitative_score(value)}"
        for name, value in sorted_scores[:4]
    ]
    weaknesses = [
        f"- {_SUBSCORE_LABELS.get(name, _label_key(name))}: {_qualitative_score(value)}"
        for name, value in sorted_scores[-4:]
    ]
    return strengths, weaknesses


def _note_lines(evaluation: RosterEvaluation) -> list[str]:
    """Summarize structured notes without depending on Phase 5 internals."""
    return [
        f"- {note.type} / {note.category}: {note.text}"
        for note in evaluation.notes[:9]
    ]


# ---------------------------------------------------------------------------
# Evaluation framing — keyed on team_size today, swappable to
# rules_json.eval_context (e.g. "tournament") when that field ships.
# ---------------------------------------------------------------------------

_SHARED_VOICE = (
    "Write in the voice of an experienced GM: direct, specific, basketball-literate. "
    "Output plain prose paragraphs only, with no headers, no bullets, no markdown, "
    "and no horizontal rules. Start directly with the summary sentence."
)

# TODO: When rules_json gains an `eval_context` field (e.g. "season", "playoff",
# "tournament"), re-key this dict from int → str, thread eval_context into
# generate_team_description(), and swap the lookup in _memo_instructions().
# This lets a 12-man Olympic roster use a "tournament" framing instead of "season".
_MEMO_FRAMINGS: dict[int, str] = {
    5: (
        "Write a 2-paragraph memo about this starting five. Start with exactly one "
        "standalone summary sentence suitable for a Saved Team card. After that first "
        "sentence, continue with the longer evaluation detail. The rest of the first "
        "paragraph should establish the lineup's basketball identity: how these five "
        "players fit together on the court, what style they impose, and what makes the "
        "unit cohesive or dangerous when the pressure is highest — think closeout game, "
        "backs against the wall. Second paragraph: analyze vulnerabilities and matchup "
        "concerns that would be exposed in a high-stakes game, and what kind of player "
        "or archetype would complement this five if the roster expanded. This is a pure "
        "starting-five evaluation — do not mention bench depth, rotation, or reserves. "
        + _SHARED_VOICE
    ),
    9: (
        "Write a 2-3 paragraph memo about this rotation built for a playoff run. Start "
        "with exactly one standalone summary sentence suitable for a Saved Team card. "
        "After that first sentence, continue with the longer evaluation detail. The rest "
        "of the first paragraph should establish the starting five's basketball identity: "
        "how they fit together and what style they impose. Second paragraph: analyze the "
        "bench and how it extends or changes the identity — can this rotation adapt to "
        "different opponents across a seven-game series? Does the bench reinforce the "
        "starters' strengths or cover their blind spots? Third paragraph, if warranted: "
        "matchup vulnerabilities and the kind of addition that would make the group more "
        "versatile in a playoff bracket. "
        + _SHARED_VOICE
    ),
    12: (
        "Write a 2-3 paragraph memo about this full roster built for a season-long "
        "campaign. Start with exactly one standalone summary sentence suitable for a "
        "Saved Team card. After that first sentence, continue with the longer evaluation "
        "detail. The rest of the first paragraph should establish the starting five's "
        "basketball identity: how they fit together and what style they impose. Second "
        "paragraph: analyze the full depth chart — can this roster sustain its identity "
        "across 82 games? Is there enough positional depth to absorb injuries, manage "
        "minutes, and handle the grind of a long season without the starters wearing "
        "down? Third paragraph, if warranted: where the roster is thin, what archetypes "
        "are missing, and whether this team can still be standing in June. "
        + _SHARED_VOICE
    ),
}

# Fallback when team_size doesn't match a known framing — uses the rotation
# framing as the most general middle ground.
_DEFAULT_FRAMING_KEY = 9


def _memo_instructions(evaluation: RosterEvaluation) -> str:
    """Return closing paragraph instructions, adapted to team size.

    Keyed on player count today. To key on rules_json.eval_context instead,
    change the lookup key here — the framings dict and callers stay the same.
    """
    player_count = len(evaluation.player_composites)
    return _MEMO_FRAMINGS.get(player_count, _MEMO_FRAMINGS[_DEFAULT_FRAMING_KEY])


def _build_prompt(
    evaluation: RosterEvaluation,
    players: list[dict[str, Any]] | None = None,
) -> str:
    """
    Build a GM-memo prompt from cohesion data shapes.

    The prompt contains qualitative labels derived from internal scores and
    explicitly tells Claude not to cite numbers. Optional raw player dictionaries
    provide roster roles; the function works with evaluation data alone.
    """
    raw_by_key = _player_lookup(players)
    total_players = len(evaluation.player_composites)

    player_lines = [
        _player_line(
            composite,
            raw_by_key.get(composite.player_id) or raw_by_key.get(composite.name),
            total_players,
        )
        for composite in evaluation.player_composites
    ]
    player_block = "\n".join(player_lines) if player_lines else "- No players available"

    contributor_lines: list[str] = []
    for composite_name in _COMPOSITE_FIELDS:
        contributors = _top_composite_contributors(evaluation.player_composites, composite_name)
        if contributors:
            contributor_lines.append(
                f"- {_label_key(composite_name)}: {'; '.join(contributors)}"
            )
    contributor_block = (
        "\n".join(contributor_lines)
        if contributor_lines
        else "- No composite contributors available"
    )

    strengths, weaknesses = _lineup_trait_lines(evaluation)
    strength_block = "\n".join(strengths) if strengths else "- No five-man lineup evaluated yet"
    weakness_block = "\n".join(weaknesses) if weaknesses else "- No five-man lineup evaluated yet"

    archetypes = evaluation.lineup_summary.get("archetype_labels", [])
    archetype_text = ", ".join(archetypes) if archetypes else "not established yet"

    synergy_text = (
        ", ".join(evaluation.starting_lineup.synergies_applied)
        if evaluation.starting_lineup.synergies_applied
        else "none recorded"
    )

    notes = _note_lines(evaluation)
    notes_block = "\n".join(notes) if notes else "- No structured notes available yet"

    return (
        "You are an NBA general manager writing an internal scouting memo about a roster "
        "built in Cornerstone's cohesion engine. The data below uses qualitative labels "
        "derived from player composites and lineup cohesion. Do not mention numeric ratings, "
        "scores, stars, or internal model mechanics.\n\n"
        f"Roster archetypes: {archetype_text}\n"
        f"Starting-lineup synergies: {synergy_text}\n\n"
        "Player composite identities:\n"
        f"{player_block}\n\n"
        "Top composite contributors by roster trait:\n"
        f"{contributor_block}\n\n"
        "Strongest starting-lineup traits:\n"
        f"{strength_block}\n\n"
        "Thinnest starting-lineup traits:\n"
        f"{weakness_block}\n\n"
        "Structured roster notes:\n"
        f"{notes_block}\n\n"
        + _memo_instructions(evaluation)
    )


def _extract_response_text(response: Any) -> str | None:
    """Extract text from Anthropic responses and simple test doubles."""
    content = getattr(response, "content", None)
    if not content:
        return None

    first_block = content[0]
    if isinstance(first_block, dict):
        text = first_block.get("text")
    else:
        text = getattr(first_block, "text", None)

    if not isinstance(text, str):
        return None

    text = text.strip()
    return text or None


def generate_team_description(
    evaluation: RosterEvaluation,
    players: list[dict[str, Any]] | None = None,
) -> str | None:
    """
    Generate a GM-memo team narrative with Claude.

    Returns the narrative string on success and None on missing API key, API
    failure, malformed response, or any other unexpected issue. The optional
    `players` argument is raw roster context for roles/slots; the evaluation is
    sufficient on its own.
    """
    try:
        client = _get_anthropic_client()
        prompt = _build_prompt(evaluation, players)
        response = client.messages.create(
            model=_HAIKU_MODEL,
            max_tokens=_MAX_TOKENS,
            messages=[{"role": "user", "content": prompt}],
        )
        return _extract_response_text(response)
    except Exception:
        logger.exception("Failed to generate cohesion team description; returning None")
        return None
