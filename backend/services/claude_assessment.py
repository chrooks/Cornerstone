"""
claude_assessment.py — Claude API integration for skill assessment.

Calls Anthropic's Claude API to independently rate players on skills where
stat-based classification is insufficient (moderate and low confidence skills).

Pipeline per player:
  1. Fetch player metadata (name, team, position, age, GP, MPG, season)
  2. Fetch raw stats blob from player_stats table
  3. Build structured prompt with player context + stat tables
  4. Call Claude with blind assessment (the moderate-confidence skills) and
     informed assessment (the low-confidence skills)
  5. Parse JSON response; retry once on failure

Claude is NOT called for the high-confidence skills — their stat ratings
become the final ratings directly. Callers can pass a `skills` subset to rate
only some of the moderate and low keys (a skill-scoped run).

Environment:
  ANTHROPIC_API_KEY — required; fails clearly if absent
  CLAUDE_MODEL      — optional; defaults to claude-sonnet-5
"""

import json
import logging
import os
import threading
import time
from typing import Any

import anthropic
from supabase import Client

from services.skills import (
    HIGH_CONFIDENCE_SKILLS,
    LOW_CONFIDENCE_SKILLS,
    MODERATE_CONFIDENCE_SKILLS,
    SKILL_DEFINITIONS as _ALL_SKILL_DEFINITIONS,
)

logger = logging.getLogger(__name__)

# Re-export so existing callers that import these from here continue to work.
__all__ = [
    "HIGH_CONFIDENCE_SKILLS",
    "MODERATE_CONFIDENCE_SKILLS",
    "LOW_CONFIDENCE_SKILLS",
]

# Human-readable names for the prompt (used in Section 3)
_SKILL_DISPLAY_NAMES: dict[str, str] = {
    "cutter":             "Cutter",
    "movement_shooter":   "Movement Shooter",
    "passer":             "Passer",
    "crafty_finisher":    "Below the Rim Finishing",
    "driver":             "Driver",
    "mid_post_player":    "Mid Post Player",
    "low_post_player":    "Low Post Player",
    "screen_setter":      "Screen Setter",
    "vertical_spacer":    "Vertical Spacer",
    "transition_threat":  "Transition Threat",
    "pnr_ball_handler":   "PnR Ball Handler",
    "pnr_finisher":       "PnR Finisher",
    "versatile_defender": "Versatile Defender",
    "perimeter_disruptor": "Perimeter Disruptor",
    "high_flyer":         "Above the Rim Finishing",
}

# Definitions scoped to the skills Claude actually evaluates (moderate + low)
_SKILL_DEFINITIONS: dict[str, str] = {
    k: v for k, v in _ALL_SKILL_DEFINITIONS.items()
    if k in MODERATE_CONFIDENCE_SKILLS | LOW_CONFIDENCE_SKILLS
}

# Every skill key Claude is asked to rate (a high-confidence key never appears)
_CLAUDE_SKILLS: frozenset[str] = MODERATE_CONFIDENCE_SKILLS | LOW_CONFIDENCE_SKILLS

# One "what the stats miss" sentence per low-confidence skill, read by
# _build_informed_section. Every key in LOW_CONFIDENCE_SKILLS needs an entry.
_INFORMED_GUIDANCE: dict[str, str] = {
    "versatile_defender": (
        "Your assessment of this player's defensive versatility based on body type, "
        "lateral movement, and known defensive reputation should override the stats "
        "if they conflict; versatility includes defending bigs in the post."
    ),
    "perimeter_disruptor": (
        "Screen navigation, recovery speed, and overall defensive IQ are invisible in "
        "these stats — weight your knowledge accordingly."
    ),
    "high_flyer": (
        "Athleticism is poorly captured by statistics — weight your knowledge of this "
        "player's physical tools and playing style heavily."
    ),
}

# API configuration
_DEFAULT_MODEL = "claude-sonnet-5"
# Sonnet 5's tokenizer spends ~30% more tokens for the same text — 4000 keeps a
# full 22-skill JSON response (tier + justification each) from truncating.
_MAX_TOKENS = 4000

# Rate limiter — enforces ≥200ms between Claude API request starts across all threads.
# Applied immediately before each client.messages.create() call so it covers the
# actual HTTP dispatch, not pre-fetch work like DB queries or prompt building.
_rate_lock = threading.Lock()
_last_claude_req_time: float = 0.0
_MIN_REQUEST_INTERVAL_SEC = 0.2

# Pricing per million tokens (used for cost estimation in batch endpoint)
# Key: model name prefix → (input_cost_per_mtok, output_cost_per_mtok)
_MODEL_PRICING: dict[str, tuple[float, float]] = {
    "claude-sonnet-5":  (3.0, 15.0),
    "claude-sonnet-4":  (3.0, 15.0),
    "claude-opus-4":    (15.0, 75.0),
    "claude-haiku-4":   (0.8, 4.0),
    "claude-sonnet-3-7": (3.0, 15.0),
    "claude-sonnet-3-5": (3.0, 15.0),
}


# ---------------------------------------------------------------------------
# Anthropic client factory
# ---------------------------------------------------------------------------


def _get_anthropic_client() -> anthropic.Anthropic:
    """Return an Anthropic client, raising clearly if API key is missing."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not set. Add it to your .env file before "
            "running Claude assessment endpoints."
        )
    return anthropic.Anthropic(api_key=api_key)


def _get_model() -> str:
    """Return the configured Claude model name."""
    return os.environ.get("CLAUDE_MODEL", _DEFAULT_MODEL)


# ---------------------------------------------------------------------------
# Stats formatting for the prompt
# ---------------------------------------------------------------------------


def _format_value(val: Any) -> str:
    """Format a stat value for display in the prompt table."""
    if val is None:
        return "N/A"
    if isinstance(val, float):
        # Show rates and differentials as decimals to 3 places; counts as whole
        # numbers. The range is signed — a matchup differential of -0.03 must not
        # round to "-0.0" and throw away the defensive signal (#119).
        if -1.0 <= val <= 1.0:
            return f"{val:.3f}"
        return f"{val:.1f}"
    return str(val)


def _format_stat_section(title: str, data: dict | None) -> str | None:
    """
    Format a stats blob section as a markdown table.
    Returns None if the section is None or empty (caller shows unavailable note).
    """
    if not data:
        return None

    rows = []
    for key, val in data.items():
        if isinstance(val, dict):
            # Nested dict — flatten one level with dot notation
            for sub_key, sub_val in val.items():
                rows.append(f"| {key}.{sub_key} | {_format_value(sub_val)} |")
        else:
            # Format the key as a readable label (snake_case → Title Case)
            label = key.replace("_", " ").title()
            rows.append(f"| {label} | {_format_value(val)} |")

    if not rows:
        return None

    header = f"### {title}\n| Stat | Value |\n|------|-------|"
    return header + "\n" + "\n".join(rows)


def _format_stats_for_prompt(stats_blob: dict) -> str:
    """
    Format the full stats blob into a readable multi-section string for the prompt.
    Sections that are None are omitted with an unavailability note.
    """
    sections = [
        ("Box Score Stats",        stats_blob.get("box_score")),
        ("Tracking & Shooting",    stats_blob.get("tracking_shooting")),
        ("Play Type Breakdown",    stats_blob.get("play_type")),
        ("Hustle Stats",           stats_blob.get("hustle")),
        ("Shot Detail",            stats_blob.get("shot_detail")),
        ("Defensive Matchup Data", stats_blob.get("matchup_defense")),
    ]

    parts = []
    for title, data in sections:
        formatted = _format_stat_section(title, data)
        if formatted:
            parts.append(formatted)
        else:
            parts.append(f"### {title}\n*Data was unavailable for this section.*")

    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------


def _scoped_skills(skills: list[str] | None, group: frozenset[str]) -> list[str]:
    """
    Sorted members of `group` the caller asked for — all of them when `skills` is None.

    Sorting keeps prompt ordering deterministic across runs (a frozenset has no
    stable order).

    Raises:
        ValueError: `skills` is empty, or holds a high-confidence or unknown key.
    """
    if skills is None:
        return sorted(group)
    if not skills:
        raise ValueError("skills subset is empty — nothing for Claude to rate")
    unrated = sorted(set(skills) - _CLAUDE_SKILLS)
    if unrated:
        raise ValueError(
            "Claude does not rate these skill keys (high-confidence or unknown): "
            + ", ".join(unrated)
        )
    return sorted(group & set(skills))


def _build_blind_section(skills: list[str] | None = None) -> str:
    """
    Build Sub-section A: blind assessment of the moderate-confidence skills.
    Claude sees stats but NOT the stat-based tier.

    Args:
        skills: Optional subset of skill keys. None means every moderate skill.

    Returns:
        The section text, or "" when no moderate skill is in the subset.
    """
    skill_keys = _scoped_skills(skills, MODERATE_CONFIDENCE_SKILLS)
    if not skill_keys:
        return ""

    lines = [
        "## Sub-section A — Blind Skill Assessment (Moderate Confidence)",
        "",
        "Rate each skill below at **None**, **Capable**, **Proficient**, **Elite**, or **All-Time Great** based solely "
        "on the player's statistics above and your contextual knowledge. "
        "Reserve **All-Time Great** only for historically exceptional skill levels — "
        "the kind that defines a player's legacy or sets the standard at the position. "
        "Do NOT use any prior knowledge of official ratings or tier systems.",
        "",
        "Skill definitions:",
        "",
    ]
    for skill_key in skill_keys:
        display = _SKILL_DISPLAY_NAMES[skill_key]
        definition = _SKILL_DEFINITIONS[skill_key]
        lines.append(f"- **{skill_key}** ({display}): {definition}")

    lines += [
        "",
        f"Provide your assessment for each of the {len(skill_keys)} skills above. "
        "Set confidence to \"low\" for any skill where you are uncertain.",
    ]
    return "\n".join(lines)


def _build_informed_section(
    stat_skills_result: dict,
    skills: list[str] | None = None,
) -> str:
    """
    Build Sub-section B: informed assessment of the low-confidence skills.
    Claude sees stats AND the stat-based tier and confidence.

    Args:
        stat_skills_result: Skill evaluation results from the stat pipeline.
        skills: Optional subset of skill keys. None means every low skill.

    Returns:
        The section text, or "" when no low-confidence skill is in the subset.
    """
    skill_keys = _scoped_skills(skills, LOW_CONFIDENCE_SKILLS)
    if not skill_keys:
        return ""

    lines = [
        "## Sub-section B — Informed Skill Assessment (Low Confidence)",
        "",
        "The stat-based pipeline computed a rating for each skill below, but with LOW "
        "confidence. Your contextual knowledge of this player's defensive reputation, "
        "body type, athleticism, and scheme context should carry significant weight — "
        "feel free to confirm, challenge, or adjust the stat-based rating.",
        "",
    ]

    for skill_key in skill_keys:
        stat_entry = stat_skills_result.get(skill_key, {})
        tier = stat_entry.get("tier", "None")
        driving_stats = _format_driving_stats_inline(stat_entry.get("driving_stats", {}))
        lines += [
            f"### {skill_key} ({_SKILL_DISPLAY_NAMES[skill_key]})",
            _SKILL_DEFINITIONS[skill_key],
            f"The stats show: {driving_stats}",
            f"The stat-based rating is **{tier}** with LOW confidence.",
            _INFORMED_GUIDANCE[skill_key],
            "",
        ]

    lines.append(
        f"Provide your assessment for each of the {len(skill_keys)} skills above. "
        "Set confidence to \"low\" for any skill where you are uncertain."
    )
    return "\n".join(lines)


def _format_driving_stats_inline(driving_stats: dict) -> str:
    """Format driving stats as a compact inline string for the informed section."""
    if not driving_stats:
        return "no specific stats available"
    parts = []
    for path, val in driving_stats.items():
        # Use the last segment of the dot-path as the label
        label = path.split(".")[-1].replace("_", " ")
        parts.append(f"{label}={_format_value(val)}")
    return ", ".join(parts)


def build_claude_prompt(
    player_info: dict,
    stats_blob: dict,
    stat_skills_result: dict,
    skills: list[str] | None = None,
) -> str:
    """
    Build the full structured Claude prompt for a player's skill assessment.

    Args:
        player_info:       Player metadata row from the players table.
        stats_blob:        Raw stats JSONB blob from player_stats table.
        stat_skills_result: Skill evaluation results from the stat pipeline (Prompt 4).
        skills:            Optional subset of skill keys to rate. None means every
                           moderate + low skill. A section whose subset is empty is
                           left out of the prompt entirely.

    Returns:
        Prompt string ready to send to the Anthropic messages API.

    Raises:
        ValueError: `skills` is empty, or holds a high-confidence or unknown key.
    """
    blind_section    = _build_blind_section(skills)
    informed_section = _build_informed_section(stat_skills_result, skills)
    blind_count      = len(_scoped_skills(skills, MODERATE_CONFIDENCE_SKILLS))
    informed_count   = len(_scoped_skills(skills, LOW_CONFIDENCE_SKILLS))
    section_counts   = " + ".join(
        part for part in (
            f"{blind_count} from Sub-section A" if blind_count else "",
            f"{informed_count} from Sub-section B" if informed_count else "",
        ) if part
    )

    name     = player_info.get("name", "Unknown")
    team     = player_info.get("team", "Unknown")
    position = player_info.get("position", "Unknown")
    age      = player_info.get("age", "Unknown")
    gp       = player_info.get("games_played", "Unknown")
    mpg      = player_info.get("minutes_per_game", "Unknown")
    season   = player_info.get("season", "Unknown")

    # Format MPG to one decimal if numeric
    if isinstance(mpg, (int, float)):
        mpg = f"{mpg:.1f}"

    prompt_parts = [
        "# NBA Player Skill Assessment",
        "",
        "## Section 1 — Player Context",
        "",
        f"- **Name:** {name}",
        f"- **Team:** {team}",
        f"- **Position:** {position}",
        f"- **Age:** {age}",
        f"- **Season:** {season}",
        f"- **Games Played:** {gp}",
        f"- **Minutes Per Game:** {mpg}",
        "",
        "## Section 2 — Statistical Profile",
        "",
        _format_stats_for_prompt(stats_blob),
        "",
        "## Section 3 — Skill Assessment Request",
        "",
        *([blind_section, ""] if blind_section else []),
        *([informed_section, ""] if informed_section else []),
        "---",
        "",
        "## Response Format",
        "",
        "Respond ONLY in valid JSON with no preamble, markdown code fences, or "
        "explanation outside the JSON. Use exactly this schema:",
        "",
        '```',
        json.dumps({
            "skills": {
                "<skill_key>": {
                    "tier": "None | Capable | Proficient | Elite",
                    "justification": "one sentence",
                    "confidence": "high | medium | low",
                }
            }
        }, indent=2),
        '```',
        "",
        f"Include all {blind_count + informed_count} skills ({section_counts}) in the "
        "\"skills\" object. Use the snake_case skill keys as the object keys. "
        "Set confidence to \"low\" for any skill where you are uncertain, even if you "
        "still provide a tier — this self-reported confidence is used in compositing.",
    ]

    return "\n".join(prompt_parts)


# ---------------------------------------------------------------------------
# Claude API call and response parsing
# ---------------------------------------------------------------------------


def _parse_claude_response(text: str) -> dict[str, dict] | None:
    """
    Parse Claude's JSON response into a skills dict.
    Returns None if parsing fails (caller retries).
    """
    # Strip markdown code fences if present (defensive parsing)
    cleaned = text.strip()
    if cleaned.startswith("```"):
        # Remove first and last code fence lines
        lines = cleaned.split("\n")
        cleaned = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        logger.warning("Claude response is not valid JSON. Raw: %.200s", text)
        return None

    if "skills" not in parsed or not isinstance(parsed["skills"], dict):
        logger.warning("Claude response missing 'skills' key. Parsed: %s", parsed)
        return None

    return parsed["skills"]


def _validate_skill_entry(entry: Any) -> bool:
    """Return True if a single skill entry has the required keys and valid values."""
    if not isinstance(entry, dict):
        return False
    valid_tiers = {"None", "Capable", "Proficient", "Elite", "All-Time Great"}
    valid_conf  = {"high", "medium", "low"}
    return (
        entry.get("tier") in valid_tiers
        and entry.get("confidence") in valid_conf
        and isinstance(entry.get("justification"), str)
    )


def _apply_rate_limit() -> None:
    """
    Enforce ≥200ms between Claude HTTP request starts across all threads.

    This is applied immediately before client.messages.create() so it covers
    the actual network dispatch, not pre-fetch work like DB queries or prompt
    building. Holding _rate_lock only during the sleep+timestamp update keeps
    the critical section short.
    """
    global _last_claude_req_time
    with _rate_lock:
        now = time.monotonic()
        elapsed = now - _last_claude_req_time
        if elapsed < _MIN_REQUEST_INTERVAL_SEC:
            time.sleep(_MIN_REQUEST_INTERVAL_SEC - elapsed)
        _last_claude_req_time = time.monotonic()


def call_claude(prompt: str, client: anthropic.Anthropic) -> tuple[dict[str, dict], int, int]:
    """
    Call the Claude API with the given prompt.

    Retries once on JSON parse failure. If both attempts fail, returns an empty
    dict with a flag indicating failure (callers check for this).

    The built-in rate limiter enforces ≥200ms between Claude request starts,
    covering concurrent callers in the batch endpoint.

    Returns:
        (skills_dict, input_tokens, output_tokens)
        skills_dict is empty on total failure.
    """
    model = _get_model()
    total_input_tokens  = 0
    total_output_tokens = 0

    for attempt in range(2):
        try:
            # Apply rate limit immediately before the network call (not before DB fetches)
            _apply_rate_limit()
            response = client.messages.create(
                model=model,
                max_tokens=_MAX_TOKENS,
                # Sonnet 5 rejects non-default sampling params (temperature=0
                # was a 400) and runs adaptive thinking unless disabled —
                # disabled keeps content[0] the text block our parser reads.
                thinking={"type": "disabled"},
                messages=[{"role": "user", "content": prompt}],
            )
            raw_text = response.content[0].text
            input_tok  = response.usage.input_tokens
            output_tok = response.usage.output_tokens
            total_input_tokens  += input_tok
            total_output_tokens += output_tok

            logger.debug(
                "Claude attempt %d: %d input tokens, %d output tokens",
                attempt + 1, input_tok, output_tok,
            )

            skills = _parse_claude_response(raw_text)
            if skills is not None:
                return skills, total_input_tokens, total_output_tokens

            # Parse failed — log and retry if not already on last attempt
            logger.warning(
                "Claude parse failed on attempt %d — %s",
                attempt + 1,
                "retrying" if attempt == 0 else "giving up",
            )

        except Exception:
            logger.exception(
                "Claude API call failed on attempt %d — %s",
                attempt + 1,
                "retrying" if attempt == 0 else "giving up",
            )

    # Both attempts failed — return empty dict (caller marks all skills as failed)
    logger.error("Claude assessment failed after 2 attempts for this player")
    return {}, total_input_tokens, total_output_tokens


# ---------------------------------------------------------------------------
# Data fetching helpers
# ---------------------------------------------------------------------------


def _fetch_player_info(player_id: str, season: str, supabase: Client) -> dict | None:
    """Fetch the player's metadata row from the players table."""
    try:
        row = (
            supabase.table("players")
            .select("name, team, position, age, games_played, minutes_per_game, season")
            .eq("id", player_id)
            .eq("season", season)
            .limit(1)
            .execute()
        )
        return row.data[0] if row.data else None
    except Exception:
        logger.exception("Failed to fetch player info for %s", player_id)
        return None


def _fetch_stats_blob(player_id: str, season: str, supabase: Client) -> dict:
    """Fetch the player's raw stats blob from the player_stats table."""
    try:
        row = (
            supabase.table("player_stats")
            .select("stats")
            .eq("player_id", player_id)
            .eq("season", season)
            .order("fetched_at", desc=True)
            .limit(1)
            .execute()
        )
        return (row.data[0].get("stats") or {}) if row.data else {}
    except Exception:
        logger.exception("Failed to fetch stats blob for player %s", player_id)
        return {}


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def get_claude_assessment(
    player_id: str,
    season: str,
    stat_skills_result: dict,
    supabase: Client,
    skills: list[str] | None = None,
) -> dict:
    """
    Run Claude's skill assessment for a single player.

    Builds the prompt from the player's stats blob and stat skill results,
    calls the Claude API, and returns the parsed assessment.

    Args:
        player_id:          Supabase UUID of the player.
        season:             Season string (e.g. "2025-26").
        stat_skills_result: Dict from Prompt 4 skill evaluation (may be empty).
        supabase:           Supabase client.
        skills:             Optional subset of skill keys to rate. None means every
                            moderate + low skill. The returned "skills" dict holds
                            exactly the requested keys.

    Returns:
        {
          "skills":         { skill_key: {"tier", "justification", "confidence"} },
          "claude_failed":  bool,  # True if the API call completely failed
          "input_tokens":   int,
          "output_tokens":  int,
        }

    Raises:
        ValueError: `skills` is empty, or holds a high-confidence or unknown key.
    """
    # Validate the subset before any fetch or API spend.
    target_skills = _scoped_skills(skills, _CLAUDE_SKILLS)

    client = _get_anthropic_client()

    player_info = _fetch_player_info(player_id, season, supabase)
    if not player_info:
        logger.warning("No player info found for %s season %s — cannot build prompt", player_id, season)
        return {"skills": {}, "claude_failed": True, "input_tokens": 0, "output_tokens": 0}

    stats_blob = _fetch_stats_blob(player_id, season, supabase)

    prompt = build_claude_prompt(player_info, stats_blob, stat_skills_result, skills=skills)

    raw_skills, input_tokens, output_tokens = call_claude(prompt, client)

    # Complete failure — both attempts returned nothing
    if not raw_skills:
        return {
            "skills": {},
            "claude_failed": True,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
        }

    # Build the final skills dict — validate each entry, mark missing as failed
    assessed: dict[str, dict] = {}

    for skill_key in target_skills:
        entry = raw_skills.get(skill_key)
        if entry and _validate_skill_entry(entry):
            assessed[skill_key] = {
                "tier":          entry["tier"],
                "justification": entry["justification"],
                "confidence":    entry["confidence"],
                "claude_failed": False,
            }
        else:
            # Skill missing or malformed in Claude's response
            logger.warning("Claude response missing or invalid for skill '%s'", skill_key)
            assessed[skill_key] = {
                "tier":          None,
                "justification": None,
                "confidence":    None,
                "claude_failed": True,
            }

    return {
        "skills":        assessed,
        "claude_failed": False,
        "input_tokens":  input_tokens,
        "output_tokens": output_tokens,
    }


def estimate_cost_usd(input_tokens: int, output_tokens: int) -> float:
    """
    Estimate the cost of a Claude API call based on token counts and published pricing.
    Uses a pricing table keyed by model name prefix.
    """
    model = _get_model()
    # Find the matching pricing entry by model prefix
    input_cost_per_mtok, output_cost_per_mtok = 3.0, 15.0  # Default: Sonnet pricing
    for prefix, pricing in _MODEL_PRICING.items():
        if model.startswith(prefix):
            input_cost_per_mtok, output_cost_per_mtok = pricing
            break

    return (
        (input_tokens / 1_000_000) * input_cost_per_mtok
        + (output_tokens / 1_000_000) * output_cost_per_mtok
    )
