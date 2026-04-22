"""
roster_evaluator/team_description.py — LLM-generated team narrative for final eval.

Calls Anthropic's Claude API (haiku) to produce a 2–3 paragraph GM-memo-style
description of the team's identity, strengths, and weaknesses. Grounded in skill
archetypes — never references numeric scores.

Returns None on any API failure so the caller can degrade gracefully.
"""
from __future__ import annotations

import logging
import os
from typing import TYPE_CHECKING

import anthropic

from .weights import SKILL_WEIGHTS, SLOT_WEIGHTS, TIER_VALUES

if TYPE_CHECKING:
    from .types import Scores

logger = logging.getLogger(__name__)

# Haiku is used intentionally — this is UX flourish, not core evaluation logic.
# Fast and cheap; accuracy demand is low compared to the main skill pipeline.
_HAIKU_MODEL = "claude-haiku-4-5-20251001"
_MAX_TOKENS = 800


def _get_anthropic_client() -> anthropic.Anthropic:
    """Return an Anthropic client, raising clearly if API key is missing."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set.")
    return anthropic.Anthropic(api_key=api_key)


_TIER_LABELS: dict[str, str] = {
    "All-Time Great": "[ALL-TIME GREAT]",
    "Elite":          "[ELITE]",
    "Proficient":     "(Proficient)",
    "Capable":        "(Capable)",
}

# Dimensions to compute top contributors for
_SUBSCORE_DIMENSIONS = ("spacing", "creation", "defense", "paint", "transition")


def _top_contributors(all_players: list[dict], dimension: str, n: int = 3) -> list[str]:
    """
    Return the top-n player+skill combinations that contributed most to a dimension,
    ranked by raw slot-weighted tier contribution (tier_value × skill_weight × slot_weight).
    """
    entries: list[tuple[float, str, str, str]] = []
    for p in all_players:
        slot_weight = SLOT_WEIGHTS.get(p.get("slot", 9), 0.05)
        skills = p.get("skills") or {}
        for skill, tier in skills.items():
            if tier in (None, "None", ""):
                continue
            tier_val = TIER_VALUES.get(tier, 0)
            if tier_val == 0:
                continue
            dim_weight = SKILL_WEIGHTS.get(skill, {}).get(dimension, 0.0)
            if dim_weight == 0.0:
                continue
            contribution = tier_val * dim_weight * slot_weight
            skill_label = skill.replace("_", " ").title()
            tier_label = _TIER_LABELS.get(tier, f"({tier})")
            entries.append((contribution, p.get("name", "?"), skill_label, tier_label))

    entries.sort(reverse=True)
    return [f"{name} – {skill} {tier}" for _, name, skill, tier in entries[:n]]


def _build_prompt(cornerstone: dict, supporting_players: list[dict]) -> str:
    """
    Build the GM-memo prompt from player skill profiles.

    Starters (slots 1–5) and bench (slots 6–9) are presented separately so the
    model can reason about starting-unit identity vs. bench contribution. All tiers
    are shown — top tiers annotated with [ALL-TIME GREAT] / [ELITE], others with
    (Proficient) / (Capable). Top-3 skill contributors per subscore are included
    so the model can ground its analysis in what actually drives each dimension.
    """
    def skill_summary(player: dict) -> str:
        skills = player.get("skills") or {}
        parts = []
        for skill, tier in skills.items():
            if tier in (None, "None", ""):
                continue
            label = skill.replace("_", " ").title()
            tier_label = _TIER_LABELS.get(tier, f"({tier})")
            parts.append(f"{label} {tier_label}")
        return ", ".join(parts) if parts else "no rated skills"

    cs_name = cornerstone.get("name", "the cornerstone")
    cs_skills = skill_summary(cornerstone)

    # Cornerstone (slot 0) + slots 1–5 = starting lineup; slots 6–9 = bench
    starters = [p for p in supporting_players if 1 <= p.get("slot", 0) <= 5]
    bench    = [p for p in supporting_players if p.get("slot", 0) >= 6]

    def player_line(p: dict) -> str:
        return f"- {p.get('name', 'Unknown')}: {skill_summary(p)}"

    starter_block = (
        "\n".join(player_line(p) for p in starters) if starters else "- (no starters added yet)"
    )
    bench_block = (
        "\n".join(player_line(p) for p in bench) if bench else "- (no bench players added yet)"
    )

    # Top-3 contributors per subscore across full roster (cornerstone + supporting)
    all_players = [cornerstone] + supporting_players
    contributor_lines = []
    for dim in _SUBSCORE_DIMENSIONS:
        top = _top_contributors(all_players, dim)
        if top:
            contributors = "; ".join(top)
            contributor_lines.append(f"  {dim.title()}: {contributors}")
    contributor_block = "\n".join(contributor_lines) if contributor_lines else "  (none)"

    return (
        "You are an NBA general manager writing an internal scouting memo about your current "
        "roster construction. Skills marked [ALL-TIME GREAT] are at the highest level — call them out "
        "explicitly and explain what they mean for how this team plays, followed by [ELITE] skills.\n\n"
        f"Cornerstone: {cs_name}\n"
        f"Skills: {cs_skills}\n\n"
        f"Starting unit (slots 1–5):\n{starter_block}\n\n"
        f"Bench (slots 6–9):\n{bench_block}\n\n"
        "Top skill contributors by dimension (player – skill tier):\n"
        f"{contributor_block}\n\n"
        "Write a 2–3 paragraph memo. "
        "First paragraph: establish the team's identity — how the cornerstone and starting unit "
        "fit together, what style of basketball this lineup imposes, and how any [ALL-TIME GREAT] or [ELITE] skills "
        "define that identity. Use the top contributors data to ground your analysis in what actually drives each dimension. "
        "Second paragraph: analyze the bench — do these players reinforce the starting unit's "
        "identity, or do they bring a different dimension? Call out any [ALL-TIME GREAT] or [ELITE] bench skills "
        "and what they add. "
        "Third paragraph (if warranted): weaknesses or vulnerabilities in the roster construction. "
        "Do not mention numeric ratings or scores. Write in the voice of an experienced GM — "
        "direct, specific, basketball-literate. "
        "Output plain prose paragraphs only — no headers, no bullet points, no markdown, "
        "no horizontal rules. Start directly with your analysis."
    )


def generate_team_description(
    cornerstone: dict,
    supporting_players: list[dict],
    scores: "Scores",
) -> str | None:
    """
    Call Claude (haiku) to generate a GM-memo team narrative.

    Returns the narrative string on success, None on any failure.

    The `scores` parameter is accepted for future use but is intentionally
    excluded from the prompt — we keep the narrative archetype-focused per
    the product spec (scores change on rerun; archetype framing is stable).
    """
    try:
        client = _get_anthropic_client()
        prompt = _build_prompt(cornerstone, supporting_players)
        response = client.messages.create(
            model=_HAIKU_MODEL,
            max_tokens=_MAX_TOKENS,
            messages=[{"role": "user", "content": prompt}],
        )
        # Extract text content from the first response block
        return response.content[0].text.strip()
    except Exception:
        logger.exception("Failed to generate team description — returning None")
        return None
