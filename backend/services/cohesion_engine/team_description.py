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
    "anchor",
    "post_game",
    "pnr_screener",
    "off_ball_impact",
    "shot_creation",
    "rebounding",
    "transition",
)

_SUBSCORE_LABELS: dict[str, str] = {
    "spacing_creation_ratio": "spacing-to-creation balance",
    "spacing_paint_touch_ratio": "spacing-to-paint-touch balance",
    "paint_touch_total": "paint pressure",
    "post_game_total": "post creation",
    "pnr_screener_total": "screen-and-roll pressure",
    "pnr_pairing": "pick-and-roll pairing",
    "anchor_total": "interior defensive anchoring",
    "collective_passing": "collective passing",
    "rebounding": "rebounding",
    "transition": "transition pressure",
    "rebound_transition_ratio": "rebound-to-transition balance",
    "rebounding_spacing_deficit": "spacing support",
    "defensive_coverage": "defensive coverage",
    "defensive_gaps": "defensive gap management",
}


def _get_anthropic_client() -> anthropic.Anthropic:
    """Return an Anthropic client, raising clearly if API key is missing."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set.")
    return anthropic.Anthropic(api_key=api_key)


def _label_key(key: str) -> str:
    """Convert an internal snake_case key into memo-friendly text."""
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


def _slot_label(player: dict[str, Any] | None) -> str:
    """Describe roster role when raw player slot context is available."""
    if not player:
        return "rotation"
    if player.get("is_cornerstone"):
        return "cornerstone"
    slot = player.get("slot")
    if isinstance(slot, int):
        if slot <= 5:
            return "starter"
        if slot <= 9:
            return "bench"
    return "rotation"


def _player_line(
    composite: PlayerComposites,
    raw_player: dict[str, Any] | None,
) -> str:
    traits = _top_player_traits(composite)
    trait_text = ", ".join(traits) if traits else "no standout composite traits"
    return f"- {composite.name} ({_slot_label(raw_player)}): {trait_text}"


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

    player_lines = [
        _player_line(
            composite,
            raw_by_key.get(composite.player_id) or raw_by_key.get(composite.name),
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
        "Write a 2-3 paragraph memo. First paragraph: establish the team's basketball "
        "identity, how the best players fit together, and what style this roster can impose. "
        "Second paragraph: analyze the rotation depth and whether the bench reinforces or "
        "changes the identity. Third paragraph, if warranted: vulnerabilities and the kind "
        "of addition that would make the roster more complete. Write in the voice of an "
        "experienced GM: direct, specific, basketball-literate. Output plain prose paragraphs "
        "only, with no headers, no bullets, no markdown, and no horizontal rules. Start "
        "directly with the analysis."
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
