"""
skill_engine/history.py — Multi-season historical stat blending.

Provides:
  - get_weighted_stats: fetch and blend stats across up to 3 seasons
  - _blend_blobs:       weighted numeric averaging over season blobs
"""

import logging

from supabase import Client

from services.players_service import CURRENT_SEASON

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Season constants — derived from CURRENT_SEASON so they stay in sync
# automatically when players_service.CURRENT_SEASON is updated each year.
# Format: "YYYY-YY" e.g. "2025-26"
# ---------------------------------------------------------------------------


def _prev_season(season: str) -> str:
    """Return the season immediately before the given one (e.g. "2025-26" → "2024-25")."""
    start_year = int(season.split("-")[0])
    return f"{start_year - 1}-{str(start_year)[-2:]}"


_PREV_SEASON = _prev_season(CURRENT_SEASON)
_TWO_AGO_SEASON = _prev_season(_PREV_SEASON)

# Historical blend weights: must sum to 1.0
_HISTORY_WEIGHTS = {
    CURRENT_SEASON: 0.50,
    _PREV_SEASON: 0.30,
    _TWO_AGO_SEASON: 0.20,
}


# ===========================================================================
# Historical weighting
# ===========================================================================


def get_weighted_stats(
    player_id: str, season: str, supabase: Client
) -> dict:
    """
    Blend stats across up to three seasons using weighted averaging.

    Weights: current=50%, prev=30%, two_ago=20%. If a season is missing,
    redistribute the missing weight proportionally to available seasons.

    The blend operates on raw numeric stats. The blended blob is structured
    identically to a single-season stats blob and is used as input to
    evaluate_all_skills (stabilization runs on the blended data).

    Returns: blended stats blob (dict), or empty dict if no data found.
    """
    # Determine which seasons to look up based on the requested "current" season
    # The caller passes the target season; we derive prev/two_ago from constants
    # only when the target is CURRENT_SEASON. For arbitrary seasons, we shift.
    if season == CURRENT_SEASON:
        seasons_to_fetch = [CURRENT_SEASON, _PREV_SEASON, _TWO_AGO_SEASON]
    elif season == _PREV_SEASON:
        seasons_to_fetch = [_PREV_SEASON, _TWO_AGO_SEASON]
    else:
        # For older seasons, only single-season data is used
        seasons_to_fetch = [season]

    # Fetch stats blobs for all relevant seasons
    season_blobs: dict[str, dict] = {}
    for s in seasons_to_fetch:
        row = (
            supabase.table("player_stats")
            .select("stats")
            .eq("player_id", player_id)
            .eq("season", s)
            .order("fetched_at", desc=True)
            .limit(1)
            .execute()
        )
        if row.data:
            blob = row.data[0].get("stats") or {}
            if blob:
                season_blobs[s] = blob

    if not season_blobs:
        logger.warning("No historical stats found for player %s", player_id)
        return {}

    if len(season_blobs) == 1:
        # Only one season available — return it directly without blending
        return next(iter(season_blobs.values()))

    # Determine effective weights for available seasons and normalize them
    available_weights = {
        s: _HISTORY_WEIGHTS.get(s, 0.0) for s in season_blobs
    }
    total_weight = sum(available_weights.values())

    if total_weight <= 0:
        # Fallback: equal weights if HISTORY_WEIGHTS doesn't cover these seasons
        weight_per_season = 1.0 / len(season_blobs)
        available_weights = {s: weight_per_season for s in season_blobs}
        total_weight = 1.0

    # Normalize weights to sum to 1.0
    normalized_weights = {
        s: w / total_weight for s, w in available_weights.items()
    }

    # Blend the stats blobs using the normalized weights.
    # The most recent season is tracked explicitly (not inferred from dict order)
    # so non-numeric fallback values are always taken from the correct season.
    most_recent_season = seasons_to_fetch[0]  # seasons_to_fetch is newest-first
    reference_blob = season_blobs[most_recent_season]
    blended = _blend_blobs(season_blobs, normalized_weights, reference_blob, most_recent_season)

    return blended


def _blend_blobs(
    season_blobs: dict[str, dict],
    weights: dict[str, float],
    reference: dict,
    most_recent_season: str,
) -> dict:
    """
    Recursively blend two or more stats blobs using weighted averaging.

    Numeric values are blended across all available seasons. Non-numeric values
    (strings, lists) are taken from `most_recent_season` explicitly — never
    inferred from dict insertion order.

    Returns a new dict (does not modify inputs).
    """
    blended: dict = {}

    for key, ref_val in reference.items():
        if isinstance(ref_val, dict):
            # Recursively blend nested dicts (section level)
            sub_blobs = {s: blob.get(key, {}) or {} for s, blob in season_blobs.items()}
            blended[key] = _blend_blobs(sub_blobs, weights, ref_val, most_recent_season)

        elif isinstance(ref_val, (int, float)) or ref_val is None:
            # Numeric leaf: weighted average of non-null values
            weighted_sum = 0.0
            weight_sum = 0.0
            for season, blob in season_blobs.items():
                val = blob.get(key)
                if val is not None:
                    try:
                        weighted_sum += float(val) * weights[season]
                        weight_sum += weights[season]
                    except (TypeError, ValueError):
                        pass

            blended[key] = (weighted_sum / weight_sum) if weight_sum > 0 else None

        else:
            # Non-numeric (strings, lists): use the explicitly identified most-recent season
            recent_blob = season_blobs.get(most_recent_season, {})
            blended[key] = recent_blob.get(key, ref_val)

    return blended
