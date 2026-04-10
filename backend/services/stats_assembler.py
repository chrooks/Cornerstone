"""
stats_assembler.py — Maps raw nba_api data to the standardised stats JSON blob.

Every field access uses .get() with a None fallback so a missing or renamed
API column never crashes the request.  Failed data sources are recorded in
metadata.sources_failed; successful ones in metadata.sources_succeeded.

Usage:
    from services.stats_assembler import assemble_stats_blob
    blob = assemble_stats_blob(nba_api_id, bulk_data, shot_chart_df,
                               matchup_df, salary, season, gp, mpg)
"""

import logging
from typing import Any

import pandas as pd

from services.stats_schema import empty_stats_blob
from services import nba_api_client

logger = logging.getLogger(__name__)


def assemble_stats_blob(
    nba_api_id: int,
    bulk_data: dict[str, dict[int, dict]],
    shot_chart_df: pd.DataFrame | None,
    matchup_df: pd.DataFrame | None,
    salary: int | None,
    season: str,
    games_played: int,
    minutes_per_game: float,
    player_index: dict[int, dict] | None = None,
    weight: int | None = None,
) -> dict:
    """
    Build and return a complete stats blob for one player.

    Parameters
    ----------
    nba_api_id : nba_api integer player ID
    bulk_data  : output of nba_api_client.get_bulk_stats(season)
    shot_chart_df : ShotChartDetail DataFrame (per-player, may be None)
    matchup_df    : LeagueSeasonMatchups DataFrame (per-player, may be None)
    salary     : annual salary in dollars from ESPN scraper (may be None)
    season     : e.g. "2025-26"
    games_played : GP from base stats
    minutes_per_game : MIN from base stats
    player_index : output of nba_api_client.get_player_index(season); used to
                   resolve offensive player positions without extra API calls
    """
    blob = empty_stats_blob()
    succeeded: list[str] = []
    failed: list[str] = []

    # Helper that fetches the row dict for this player from a bulk data key
    def row(key: str) -> dict:
        return bulk_data.get(key, {}).get(nba_api_id, {})

    # -----------------------------------------------------------------------
    # box_score — LeagueDashPlayerStats Base (PerGame)
    # -----------------------------------------------------------------------
    base = row("base")
    if base:
        blob["box_score"].update({
            "pts":     _v(base, "PTS"),
            "reb":     _v(base, "REB"),
            "ast":     _v(base, "AST"),
            "stl":     _v(base, "STL"),
            "blk":     _v(base, "BLK"),
            "fga":     _v(base, "FGA"),
            "fgm":     _v(base, "FGM"),
            "fg_pct":  _v(base, "FG_PCT"),
            "fg3a":    _v(base, "FG3A"),
            "fg3m":    _v(base, "FG3M"),
            "fg3_pct": _v(base, "FG3_PCT"),
            "fta":     _v(base, "FTA"),
            "ftm":     _v(base, "FTM"),
            "ft_pct":  _v(base, "FT_PCT"),
            "oreb":    _v(base, "OREB"),
            "dreb":    _v(base, "DREB"),
            "tov":     _v(base, "TOV"),
            "pf":      _v(base, "PF"),
            "min":     _v(base, "MIN"),
        })
        succeeded.append("base")
    else:
        failed.append("base")

    # -----------------------------------------------------------------------
    # advanced — LeagueDashPlayerStats Advanced (PerGame)
    # -----------------------------------------------------------------------
    adv = row("advanced")
    if adv:
        fta = _v(base, "FTA") or 0
        fga = _v(base, "FGA") or 0
        blob["advanced"].update({
            "usage_rate":        _v(adv, "USG_PCT"),
            "true_shooting_pct": _v(adv, "TS_PCT"),
            "offensive_rating":  _v(adv, "OFF_RATING"),
            "defensive_rating":  _v(adv, "DEF_RATING"),
            "ast_pct":           _v(adv, "AST_PCT"),
            "oreb_pct":          _v(adv, "OREB_PCT"),
            "dreb_pct":          _v(adv, "DREB_PCT"),
            "reb_pct":           _v(adv, "REB_PCT"),
            # STL_PCT / BLK_PCT are absent from the advanced endpoint (verified 2025-26).
            # Computed via per-48-minute normalization from base stats: stat × 48 / MIN.
            # This is proportional to the true NBA% and consistent with basketball-reference's
            # approximation. stl_pct is stored as a percentage (e.g. 1.64 for ~1.6%).
            "stl_pct": _compute_per48_pct(_v(base, "STL"), _v(base, "MIN")),
            "blk_pct": _compute_per48_pct(_v(base, "BLK"), _v(base, "MIN")),
            # free_throw_rate = FTA / FGA (computed from base, PerGame already applied)
            "free_throw_rate":   round(fta / fga, 4) if fga else None,
        })
        succeeded.append("advanced")
    else:
        failed.append("advanced")

    # -----------------------------------------------------------------------
    # tracking_shooting — CatchShoot + PullUpShot
    # -----------------------------------------------------------------------
    cs = row("catchshoot")
    pu = row("pullupshot")
    if cs or pu:
        blob["tracking_shooting"].update({
            "catch_shoot_fg3_pct": _v(cs, "CATCH_SHOOT_FG3_PCT"),
            "catch_shoot_fg3a":    _v(cs, "CATCH_SHOOT_FG3A"),
            "catch_shoot_fga":     _v(cs, "CATCH_SHOOT_FGA"),
            "catch_shoot_fg_pct":  _v(cs, "CATCH_SHOOT_FG_PCT"),
            "catch_shoot_pts":     _v(cs, "CATCH_SHOOT_PTS"),
            "pullup_fg3_pct":      _v(pu, "PULL_UP_FG3_PCT"),
            "pullup_fg3a":         _v(pu, "PULL_UP_FG3A"),
            # PULL_UP_FG2A and PULL_UP_FG2_PCT don't exist in the NBA API response —
            # derive them from FGA/FGM/FG3A/FG3M which are returned.
            "pullup_fg2a":         (
                round(_v(pu, "PULL_UP_FGA") - _v(pu, "PULL_UP_FG3A"), 4)
                if _v(pu, "PULL_UP_FGA") is not None and _v(pu, "PULL_UP_FG3A") is not None
                else None
            ),
            "pullup_fg2_pct":      (
                round(
                    (_v(pu, "PULL_UP_FGM") - _v(pu, "PULL_UP_FG3M"))
                    / (_v(pu, "PULL_UP_FGA") - _v(pu, "PULL_UP_FG3A")),
                    4,
                )
                if (
                    _v(pu, "PULL_UP_FGM") is not None
                    and _v(pu, "PULL_UP_FG3M") is not None
                    and _v(pu, "PULL_UP_FGA") is not None
                    and _v(pu, "PULL_UP_FG3A") is not None
                    and (_v(pu, "PULL_UP_FGA") - _v(pu, "PULL_UP_FG3A")) > 0
                )
                else None
            ),
            "pullup_fga":          _v(pu, "PULL_UP_FGA"),
            "pullup_fg_pct":       _v(pu, "PULL_UP_FG_PCT"),
            "pullup_pts":          _v(pu, "PULL_UP_PTS"),
        })
        succeeded.append("tracking_shooting")
    else:
        failed.append("tracking_shooting")

    # -----------------------------------------------------------------------
    # tracking_drives — Drives (PerGame values)
    # -----------------------------------------------------------------------
    drv = row("drives")
    if drv:
        blob["tracking_drives"].update({
            "drives_per_game": _v(drv, "DRIVES"),
            "drive_fg_pct":    _v(drv, "DRIVE_FG_PCT"),
            "drive_pts":       _v(drv, "DRIVE_PTS"),
            "drive_fta":       _v(drv, "DRIVE_FTA"),
        })
        succeeded.append("tracking_drives")
    else:
        failed.append("tracking_drives")

    # -----------------------------------------------------------------------
    # tracking_passing — Passing
    # -----------------------------------------------------------------------
    pas = row("passing")
    if pas:
        blob["tracking_passing"].update({
            "potential_assists":  _v(pas, "POTENTIAL_AST"),
            "secondary_assists":  _v(pas, "SECONDARY_AST"),
            "passes_made":        _v(pas, "PASSES_MADE"),
            "ast_adj":            _v(pas, "AST_ADJ"),  # actual column name in nba_api
        })
        succeeded.append("tracking_passing")
    else:
        failed.append("tracking_passing")

    # -----------------------------------------------------------------------
    # tracking_defense — Defense PtStats + LeagueDashPtDefend (Less Than 6Ft)
    #
    # Column name notes (verified against live API 2025-26):
    #   - CONTESTED_SHOTS / DEFLECTIONS live in the hustle endpoint, NOT defense
    #   - defend_less_than_6ft uses FGA_LT_06 / LT_06_PCT (not D_FGA / D_FG_PCT)
    # -----------------------------------------------------------------------
    dfn = row("defense")
    rim = row("defend_less_than_6ft")
    hus_def = row("hustle")  # contested shots and deflections come from hustle
    if dfn or rim or hus_def:
        blob["tracking_defense"].update({
            # Contested shots and deflections are in LeagueHustleStatsPlayer
            "contested_shots":        _v(hus_def, "CONTESTED_SHOTS"),
            "contested_shots_2pt":    _v(hus_def, "CONTESTED_SHOTS_2PT"),
            "contested_shots_3pt":    _v(hus_def, "CONTESTED_SHOTS_3PT"),
            "deflections":            _v(hus_def, "DEFLECTIONS"),
            # LeagueDashPtDefend 'Less Than 6Ft' actual column names
            "defended_at_rim_fga":    _v(rim, "FGA_LT_06"),
            "defended_at_rim_fg_pct": _v(rim, "LT_06_PCT"),
        })
        if dfn:
            succeeded.append("LeagueDashPtStats/Defense")
        else:
            failed.append("LeagueDashPtStats/Defense")
        if rim:
            succeeded.append("LeagueDashPtDefend/LessThan6Ft")
        else:
            failed.append("LeagueDashPtDefend/LessThan6Ft")
    else:
        failed.append("LeagueDashPtStats/Defense")
        failed.append("LeagueDashPtDefend/LessThan6Ft")

    # -----------------------------------------------------------------------
    # tracking_possessions — Possessions
    # -----------------------------------------------------------------------
    pos = row("possessions")
    if pos:
        blob["tracking_possessions"].update({
            "touches":             _v(pos, "TOUCHES"),
            "front_court_touches": _v(pos, "FRONT_CT_TOUCHES"),
            "time_of_possession":  _v(pos, "TIME_OF_POSS"),
            "avg_sec_per_touch":   _v(pos, "AVG_SEC_PER_TOUCH"),
        })
        succeeded.append("tracking_possessions")
    else:
        failed.append("tracking_possessions")

    # -----------------------------------------------------------------------
    # tracking_rebounding — Rebounding
    # -----------------------------------------------------------------------
    reb = row("rebounding")
    if reb:
        blob["tracking_rebounding"].update({
            "oreb_chances":    _v(reb, "OREB_CHANCES"),
            "oreb_contest_pct": _v(reb, "OREB_CONTEST_PCT"),
            "dreb_chances":    _v(reb, "DREB_CHANCES"),
            "dreb_contest_pct": _v(reb, "DREB_CONTEST_PCT"),
        })
        succeeded.append("tracking_rebounding")
    else:
        failed.append("tracking_rebounding")

    # -----------------------------------------------------------------------
    # tracking_paint_touch — PaintTouch
    # -----------------------------------------------------------------------
    pt = row("painttouch")
    if pt:
        blob["tracking_paint_touch"].update({
            "paint_touches":    _v(pt, "PAINT_TOUCHES"),
            "paint_touch_fg_pct": _v(pt, "PAINT_TOUCH_FG_PCT"),
            "paint_touch_pts":  _v(pt, "PAINT_TOUCH_PTS"),
        })
        succeeded.append("tracking_paint_touch")
    else:
        failed.append("tracking_paint_touch")

    # -----------------------------------------------------------------------
    # tracking_post_touch — PostTouch
    # -----------------------------------------------------------------------
    post = row("posttouch")
    if post:
        blob["tracking_post_touch"].update({
            "post_touches":     _v(post, "POST_TOUCHES"),
            "post_touch_fg_pct": _v(post, "POST_TOUCH_FG_PCT"),
            "post_touch_pts":   _v(post, "POST_TOUCH_PTS"),
            "post_touch_fta":   _v(post, "POST_TOUCH_FTA"),
            "post_touch_tov":   _v(post, "POST_TOUCH_TOV"),
        })
        succeeded.append("tracking_post_touch")
    else:
        failed.append("tracking_post_touch")

    # -----------------------------------------------------------------------
    # tracking_elbow_touch — ElbowTouch
    # -----------------------------------------------------------------------
    elb = row("elbowtouch")
    if elb:
        blob["tracking_elbow_touch"].update({
            "elbow_touches":     _v(elb, "ELBOW_TOUCHES"),
            "elbow_touch_fg_pct": _v(elb, "ELBOW_TOUCH_FG_PCT"),
            "elbow_touch_pts":   _v(elb, "ELBOW_TOUCH_PTS"),
        })
        succeeded.append("tracking_elbow_touch")
    else:
        failed.append("tracking_elbow_touch")

    # -----------------------------------------------------------------------
    # shot_zones — LeagueDashPlayerShotLocations
    # -----------------------------------------------------------------------
    sl = row("shot_locations")
    if sl:
        # API pre-computes combined Corner 3 (Left + Right) — use it directly
        blob["shot_zones"].update({
            "restricted_area_fga":    _v(sl, "RESTRICTED_AREA_FGA"),
            "restricted_area_fg_pct": _v(sl, "RESTRICTED_AREA_FG_PCT"),
            "paint_non_ra_fga":       _v(sl, "IN_THE_PAINT_NON_RA_FGA"),
            "paint_non_ra_fg_pct":    _v(sl, "IN_THE_PAINT_NON_RA_FG_PCT"),
            "mid_range_fga":          _v(sl, "MID_RANGE_FGA"),
            "mid_range_fg_pct":       _v(sl, "MID_RANGE_FG_PCT"),
            "above_break_3_fga":      _v(sl, "ABOVE_THE_BREAK_3_FGA"),
            "above_break_3_fg_pct":   _v(sl, "ABOVE_THE_BREAK_3_FG_PCT"),
            "corner_3_fga":           _v(sl, "CORNER_3_FGA"),
            "corner_3_fg_pct":        _v(sl, "CORNER_3_FG_PCT"),
        })
        succeeded.append("shot_zones")
    else:
        failed.append("shot_zones")

    # -----------------------------------------------------------------------
    # shot_detail + dunk_fga/dunk_fg_pct — ShotChartDetail (per-player)
    # -----------------------------------------------------------------------
    if shot_chart_df is not None and not shot_chart_df.empty and games_played:
        try:
            gp = games_played

            def _shot_counts(action_substr: str) -> tuple[float, float]:
                """Return (fgm_per_game, fga_per_game) for shots matching action substring."""
                mask = shot_chart_df["ACTION_TYPE"].str.contains(action_substr, case=False, na=False)
                sub = shot_chart_df[mask]
                fga = len(sub) / gp
                fgm = sub["SHOT_MADE_FLAG"].sum() / gp
                return round(float(fgm), 4), round(float(fga), 4)

            # "Alley Oop" covers both "Alley Oop Dunk Shot" and "Alley Oop Layup Shot"
            ao_fgm, ao_fga = _shot_counts("Alley Oop")
            # "Driving Dunk|Running Dunk" covers driving and running dunk variants
            dd_df = shot_chart_df[
                shot_chart_df["ACTION_TYPE"].str.contains("Driving Dunk|Running Dunk", case=False, na=False)
            ]
            dd_fga = round(len(dd_df) / gp, 4)
            dd_fgm = round(float(dd_df["SHOT_MADE_FLAG"].sum()) / gp, 4)
            # "Floating Jump shot" — exact casing varies on ESPN/nba.com
            fj_fgm, fj_fga = _shot_counts("Floating Jump")

            blob["shot_detail"].update({
                "alley_oop_fgm":             ao_fgm,
                "alley_oop_fga":             ao_fga,
                "driving_dunk_fgm":          dd_fgm,
                "driving_dunk_fga":          dd_fga,
                "floating_jump_shot_fgm":    fj_fgm,
                "floating_jump_shot_fga":    fj_fga,
                "floating_jump_shot_fg_pct": round(fj_fgm / fj_fga, 4) if fj_fga else None,
            })

            # Dunk totals: alley-oop dunks + driving dunks + any other dunks
            all_dunk_mask = shot_chart_df["ACTION_TYPE"].str.contains("Dunk", case=False, na=False)
            all_dunks = shot_chart_df[all_dunk_mask]
            dunk_fga = round(len(all_dunks) / gp, 4)
            dunk_fgm = round(float(all_dunks["SHOT_MADE_FLAG"].sum()) / gp, 4)
            blob["shot_zones"]["dunk_fga"] = dunk_fga
            blob["shot_zones"]["dunk_fg_pct"] = round(dunk_fgm / dunk_fga, 4) if dunk_fga else None

            succeeded.append("ShotChartDetail")
        except Exception as exc:
            logger.warning("shot_detail assembly failed for %d: %s", nba_api_id, exc)
            failed.append("ShotChartDetail")
    else:
        failed.append("ShotChartDetail")

    # -----------------------------------------------------------------------
    # play_type — SynergyPlayTypes (9 play types)
    # -----------------------------------------------------------------------
    synergy_map = [
        ("spotup",        "spotup"),
        ("offscreen",     "offscreen"),
        ("handoff",       "handoff"),
        ("prballhandler", "pr_ball_handler"),
        ("prrollman",     "pr_roll_man"),
        ("postup",        "postup"),
        ("cut",           "cut"),
        ("transition",    "transition"),
        ("isolation",     "isolation"),
    ]
    synergy_ok = False
    for api_key, blob_key in synergy_map:
        syn = row(f"synergy_{api_key}")
        if syn:
            blob["play_type"][f"{blob_key}_freq"] = _v(syn, "POSS_PCT")
            blob["play_type"][f"{blob_key}_ppp"]  = _v(syn, "PPP")
            # Store as float (not int) to preserve per-game precision (e.g. 1.4, not 1).
            # The evaluator multiplies by games_played when per="season" is used in conditions.
            blob["play_type"][f"{blob_key}_poss"] = _v(syn, "POSS")
            synergy_ok = True
    if synergy_ok:
        succeeded.append("play_type")
    else:
        failed.append("play_type")

    # -----------------------------------------------------------------------
    # hustle — LeagueHustleStatsPlayer
    # -----------------------------------------------------------------------
    hus = row("hustle")
    if hus:
        blob["hustle"].update({
            "screen_assists":        _v(hus, "SCREEN_ASSISTS"),
            "screen_assist_pts":     _v(hus, "SCREEN_AST_PTS"),
            "charges_drawn":         _v(hus, "CHARGES_DRAWN"),
            "loose_balls_recovered": _v(hus, "LOOSE_BALLS_RECOVERED"),
            "box_outs_off":          _v(hus, "OFF_BOXOUTS"),   # actual column name
            "box_outs_def":          _v(hus, "DEF_BOXOUTS"),   # actual column name
        })
        succeeded.append("hustle")
    else:
        failed.append("hustle")

    # -----------------------------------------------------------------------
    # matchup_defense — computed from LeagueSeasonMatchups (per-player)
    # -----------------------------------------------------------------------
    matchup_result = _compute_matchup_defense(nba_api_id, matchup_df, bulk_data, player_index or {})
    if matchup_result is not None:
        blob["matchup_defense"].update(matchup_result)
        succeeded.append("LeagueSeasonMatchups")
    else:
        failed.append("LeagueSeasonMatchups")

    # -----------------------------------------------------------------------
    # salary — from ESPN scraper (passed in from players_service)
    # -----------------------------------------------------------------------
    if salary is not None:
        blob["salary"]["annual_salary"] = salary

    # -----------------------------------------------------------------------
    # metadata
    # -----------------------------------------------------------------------
    blob["metadata"].update({
        "season":           season,
        "games_played":     games_played,
        "minutes_per_game": minutes_per_game,
        "weight":           weight,   # lbs from players table; used in threshold conditions
        "sources_succeeded": succeeded,
        "sources_failed":   failed,
    })

    return blob


# ---------------------------------------------------------------------------
# Matchup defense computation
# ---------------------------------------------------------------------------

def _compute_matchup_defense(
    nba_api_id: int,
    matchup_df: pd.DataFrame | None,
    bulk_data: dict[str, dict[int, dict]],
    player_index: dict[int, dict],
) -> dict | None:
    """
    Compute the matchup_defense section from LeagueSeasonMatchups data.

    Returns None if data is unavailable or insufficient (< 200 total PARTIAL_POSS).
    Otherwise returns a dict with all matchup_defense keys populated.

    Uses player_index (bulk PlayerIndex data) for position lookups to avoid
    making individual CommonPlayerInfo API calls for every opponent.
    """
    POSITIONS = ["PG", "SG", "SF", "PF", "C"]
    MIN_TOTAL_POSS = 200
    MEANINGFUL_THRESHOLD = 0.20  # 20% of total possessions — 10% was too low,
    # causing almost every player to reach 3 groups due to switches

    if matchup_df is None or matchup_df.empty:
        return None

    # Require minimum possession count to avoid noisy data
    total_poss = matchup_df["PARTIAL_POSS"].sum() if "PARTIAL_POSS" in matchup_df.columns else 0
    if total_poss < MIN_TOTAL_POSS:
        logger.debug("Insufficient matchup data for %d: %.1f PARTIAL_POSS", nba_api_id, total_poss)
        return None

    # --- Group matchups by offensive player position ---
    group_poss: dict[str, float] = {p: 0.0 for p in POSITIONS}
    group_fgm_sum: dict[str, float] = {p: 0.0 for p in POSITIONS}
    group_fga_sum: dict[str, float] = {p: 0.0 for p in POSITIONS}

    for _, matchup_row in matchup_df.iterrows():
        off_id = int(matchup_row.get("OFF_PLAYER_ID", 0))
        poss = float(matchup_row.get("PARTIAL_POSS", 0))
        fg_pct = matchup_row.get("MATCHUP_FG_PCT")

        # Resolve position from pre-fetched PlayerIndex to avoid per-player API calls.
        # PlayerIndex uses "POSITION" field (e.g. "G", "F", "C", "G-F", "F-C").
        # Fall back to CommonPlayerInfo only if the player isn't in PlayerIndex.
        index_entry = player_index.get(off_id, {})
        raw_pos = index_entry.get("position") or ""
        position = nba_api_client._map_position(raw_pos) if raw_pos else nba_api_client.get_player_position(off_id)
        if not position or position not in POSITIONS:
            continue  # Skip players whose position can't be resolved

        group_poss[position] += poss
        if fg_pct is not None and poss > 0:
            # Reconstruct FGM from weighted FG% to aggregate correctly
            group_fgm_sum[position] += float(fg_pct) * poss
            group_fga_sum[position] += poss

    # --- Compute per-group weighted-average FG% ---
    group_fg_pct: dict[str, float | None] = {}
    for pos in POSITIONS:
        if group_fga_sum[pos] > 0:
            group_fg_pct[pos] = round(group_fgm_sum[pos] / group_fga_sum[pos], 4)
        else:
            group_fg_pct[pos] = None

    # --- Determine meaningfully guarded groups ---
    total = total_poss
    meaningful_groups = [p for p in POSITIONS if group_poss[p] / total >= MEANINGFUL_THRESHOLD]
    positional_groups_guarded = len(meaningful_groups)

    # --- cross_group_fg_pct_diff: compare against league-average FG% per position ---
    league_avg_fg_pct = _compute_league_avg_fg_pct_by_position(bulk_data, player_index)
    cross_diff = _compute_cross_group_diff(
        meaningful_groups, group_fg_pct, group_poss, league_avg_fg_pct
    )

    return {
        "positional_groups_guarded": positional_groups_guarded,
        "matchup_poss_at_pg":        round(group_poss["PG"], 2),
        "matchup_poss_at_sg":        round(group_poss["SG"], 2),
        "matchup_poss_at_sf":        round(group_poss["SF"], 2),
        "matchup_poss_at_pf":        round(group_poss["PF"], 2),
        "matchup_poss_at_c":         round(group_poss["C"], 2),
        "matchup_fg_pct_at_pg":      group_fg_pct.get("PG"),
        "matchup_fg_pct_at_sg":      group_fg_pct.get("SG"),
        "matchup_fg_pct_at_sf":      group_fg_pct.get("SF"),
        "matchup_fg_pct_at_pf":      group_fg_pct.get("PF"),
        "matchup_fg_pct_at_c":       group_fg_pct.get("C"),
        "cross_group_fg_pct_diff":   cross_diff,
        "total_matchup_poss":        round(total_poss, 2),
    }


def _compute_league_avg_fg_pct_by_position(
    bulk_data: dict[str, dict[int, dict]],
    player_index: dict[int, dict],
) -> dict[str, float | None]:
    """
    Approximate league-average FG% per positional group.

    Uses PlayerIndex (not base stats) for position lookup — LeagueDashPlayerStats
    does not include a position column. PlayerIndex uses "G" for all guards, so the
    SG bucket accumulates all guard FGA; PG will typically be empty. This is a known
    data limitation — cross_group_fg_pct_diff is only computed over positions with data.
    """
    POSITIONS = ["PG", "SG", "SF", "PF", "C"]
    totals: dict[str, dict] = {p: {"fga": 0.0, "fgm": 0.0} for p in POSITIONS}

    base_data = bulk_data.get("base", {})
    for pid, r in base_data.items():
        # Resolve position from PlayerIndex — base stats have no position column
        index_entry = player_index.get(int(pid), {})
        raw_pos = str(index_entry.get("position") or "").strip()
        pos = nba_api_client._map_position(raw_pos)
        if pos not in POSITIONS:
            continue
        fga = float(r.get("FGA") or 0)
        fgm = float(r.get("FGM") or 0)
        totals[pos]["fga"] += fga
        totals[pos]["fgm"] += fgm

    result: dict[str, float | None] = {}
    for pos in POSITIONS:
        fga = totals[pos]["fga"]
        result[pos] = round(totals[pos]["fgm"] / fga, 4) if fga > 0 else None
    return result


def _compute_cross_group_diff(
    meaningful_groups: list[str],
    group_fg_pct: dict[str, float | None],
    group_poss: dict[str, float],
    league_avg: dict[str, float | None],
) -> float | None:
    """
    Weighted average of (matchup_fg_pct - league_avg_fg_pct) across meaningful groups.
    Negative means opponents shoot below average against this defender (good).
    """
    if not meaningful_groups:
        return None

    weighted_diff = 0.0
    total_weight = 0.0
    for pos in meaningful_groups:
        mpct = group_fg_pct.get(pos)
        lavg = league_avg.get(pos)
        if mpct is None or lavg is None:
            continue
        weight = group_poss[pos]
        weighted_diff += (mpct - lavg) * weight
        total_weight += weight

    if total_weight == 0:
        return None
    return round(weighted_diff / total_weight, 4)


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def _compute_per48_pct(stat: Any, minutes: Any) -> float | None:
    """
    Normalize a counting stat to a per-48-minute rate, stored as a decimal fraction.
    Used to approximate STL% / BLK% when the API does not return them directly.

    Stored as a decimal (e.g. 0.0164 for ~1.6%) to match every other _pct stat in
    the blob. The frontend multiplies _pct keys by 100 for display.

    Returns None if either input is missing or minutes is zero.
    """
    if stat is None or minutes is None:
        return None
    try:
        m = float(minutes)
        return round(float(stat) * 48.0 / m / 100.0, 4) if m > 0 else None
    except (TypeError, ValueError):
        return None


def _v(row: dict, key: str) -> Any:
    """Safe row value accessor — returns None for missing keys and NaN values."""
    import math
    val = row.get(key)
    if val is None:
        return None
    # Convert numpy/pandas scalars to plain Python types
    try:
        if hasattr(val, "item"):
            val = val.item()
    except Exception:
        pass
    # Treat NaN as missing — pandas rows use NaN for absent numeric fields
    if isinstance(val, float) and math.isnan(val):
        return None
    return val
