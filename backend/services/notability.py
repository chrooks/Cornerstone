"""
notability.py — Player notability score calculation for Claude weighting.

The notability score (0–100) reflects how well-known a player is, which
controls how much weight Claude's contextual knowledge gets in compositing.

Thresholds:
  70–100  High   — Claude's knowledge is extensive and reliable
  40–69   Medium — Claude likely knows the player but may have gaps
  0–39    Low    — Claude may not know this player; flag ALL moderate/low skills

Score components (max 100):
  ├── Minutes per game   0–30 pts   (MPG – 10) × 2, clamped 0–30
  ├── All-Star appearances 0–25 pts  tiered: 0/1/2-3/4+
  ├── Award voting       0–25 pts   max(All-NBA ballot, MVP/DPOY top-5, MVP/DPOY win)
  └── Career games       0–20 pts   career_games / 50, clamped 0–20
"""

import logging
import threading

from supabase import Client

from services.players_service import get_or_fetch_career

logger = logging.getLogger(__name__)

# Notability thresholds — controls Claude's weight in compositing
NOTABILITY_HIGH = 70
NOTABILITY_MEDIUM = 40  # Below this → low notability, flag all moderate/low skills


# In-memory cache keyed by (player_id, season) — notability is stable within a season.
# Per-process only; cleared on server restart.
# Protected by _cache_lock for thread-safety under concurrent batch processing.
_notability_cache: dict[tuple[str, str], int] = {}
_cache_lock = threading.Lock()


def get_notability_score(
    player_id: str,
    season: str,
    supabase: Client,
    refresh: bool = False,
) -> int:
    """
    Return the notability score (0–100) for a player.

    Fetches the player's current-season MPG from the players table and
    career metadata (All-Stars, awards, career games) from the career endpoint.
    Results are cached in-process — scores don't change within a season.
    Cache reads/writes are protected by a lock for thread-safety.

    Args:
        player_id: Supabase UUID for the player.
        season:    Current season string (e.g. "2025-26").
        supabase:  Supabase client.
        refresh:   If True, bypass the in-process cache and recompute.

    Returns:
        Integer score in [0, 100].
    """
    cache_key = (player_id, season)

    # Fast path — check cache under lock to avoid redundant fetches
    if not refresh:
        with _cache_lock:
            if cache_key in _notability_cache:
                logger.debug("Notability cache hit for player %s", player_id)
                return _notability_cache[cache_key]

    # Fetch outside the lock — DB calls may be slow and we don't want to hold it
    mpg = _fetch_mpg(player_id, season, supabase)
    career = get_or_fetch_career(player_id, supabase) or {}

    score = _compute_score(mpg, career)

    # Write back under lock (last-write-wins is acceptable; results are deterministic)
    with _cache_lock:
        _notability_cache[cache_key] = score

    logger.debug(
        "Notability score for player %s: %d (MPG=%.1f, all_stars=%d, career_gp=%d)",
        player_id,
        score,
        mpg,
        career.get("all_star_appearances", 0),
        career.get("career_games_played", 0),
    )
    return score


def notability_tier(score: int) -> str:
    """Return the notability tier label for a given score."""
    if score >= NOTABILITY_HIGH:
        return "high"
    if score >= NOTABILITY_MEDIUM:
        return "medium"
    return "low"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _fetch_mpg(player_id: str, season: str, supabase: Client) -> float:
    """Fetch the player's minutes_per_game for the given season from the players table."""
    try:
        row = (
            supabase.table("players")
            .select("minutes_per_game")
            .eq("id", player_id)
            .eq("season", season)
            .limit(1)
            .execute()
        )
        if row.data:
            return float(row.data[0].get("minutes_per_game") or 0.0)
    except Exception:
        logger.exception("Failed to fetch MPG for player %s season %s", player_id, season)
    return 0.0


def _compute_score(mpg: float, career: dict) -> int:
    """
    Compute the notability score from MPG and career data dict.

    The career dict is expected to contain:
      career_games_played, all_star_appearances, all_nba_selections,
      mvp_top5_finishes, dpoy_top5_finishes, award_winner.
    """
    return (
        _mpg_pts(mpg)
        + _all_star_pts(career.get("all_star_appearances", 0))
        + _award_pts(career)
        + _games_pts(career.get("career_games_played", 0))
    )


def _mpg_pts(mpg: float) -> int:
    """
    Minutes per game component (0–30 pts).
    Formula: (MPG – 10) × 2, clamped to [0, 30].
    """
    raw = (mpg - 10.0) * 2.0
    return int(max(0.0, min(30.0, raw)))


def _all_star_pts(all_star_appearances: int) -> int:
    """
    All-Star appearances component (0–25 pts).
      0   → 0 pts
      1   → 10 pts
      2–3 → 18 pts
      4+  → 25 pts
    """
    if all_star_appearances == 0:
        return 0
    if all_star_appearances == 1:
        return 10
    if all_star_appearances <= 3:
        return 18
    return 25


def _award_pts(career: dict) -> int:
    """
    Award voting component (0–25 pts). Takes the MAX across categories.
      Any All-NBA ballot appearance  → 10 pts
      Any MVP or DPOY top-5 finish   → 18 pts
      Any MVP or DPOY win            → 25 pts
    """
    all_nba     = career.get("all_nba_selections", 0) or 0
    mvp_top5    = career.get("mvp_top5_finishes", 0) or 0
    dpoy_top5   = career.get("dpoy_top5_finishes", 0) or 0
    award_winner = bool(career.get("award_winner", False))

    pts = 0
    if all_nba > 0:
        pts = max(pts, 10)
    if mvp_top5 > 0 or dpoy_top5 > 0:
        pts = max(pts, 18)
    # award_winner is True for MVP, DPOY, and championship wins.
    # We use the combination of award_winner AND a top-5 finish as the
    # best proxy for "MVP or DPOY winner" given the current data model.
    if award_winner and (mvp_top5 > 0 or dpoy_top5 > 0):
        pts = max(pts, 25)
    return pts


def _games_pts(career_games: int) -> int:
    """
    Career games played component (0–20 pts).
    Formula: career_games / 50, clamped to [0, 20].
    """
    raw = career_games / 50.0
    return int(max(0.0, min(20.0, raw)))
