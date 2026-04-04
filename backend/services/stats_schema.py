"""
stats_schema.py — Canonical empty stats blob template.

This is the source of truth for the shape of the stats JSONB blob stored in
player_stats.stats. Prompt 4 (skill mapping) reads directly from these keys.
All values are season averages (per game) unless noted.

Usage:
    from services.stats_schema import empty_stats_blob
    blob = empty_stats_blob()  # returns a fresh deep copy each call
"""

import copy


def empty_stats_blob() -> dict:
    """Return a fresh empty stats blob with all keys initialised to 0.0 / 0 / null."""
    return copy.deepcopy(_TEMPLATE)


# ---------------------------------------------------------------------------
# Template — do not modify keys without updating the assembler and Prompt 4.
# ---------------------------------------------------------------------------
_TEMPLATE: dict = {
    # Basic counting and shooting stats (per game)
    "box_score": {
        "pts": None,
        "reb": None,
        "ast": None,
        "stl": None,
        "blk": None,
        "fga": None,
        "fgm": None,
        "fg_pct": None,
        "fg3a": None,
        "fg3m": None,
        "fg3_pct": None,
        "fta": None,
        "ftm": None,
        "ft_pct": None,
        "oreb": None,
        "dreb": None,
        "tov": None,
        "pf": None,
        "min": None,
    },

    # Advanced per-game metrics
    "advanced": {
        "usage_rate": None,           # USG_PCT
        "true_shooting_pct": None,    # TS_PCT
        "offensive_rating": None,     # OFF_RATING
        "defensive_rating": None,     # DEF_RATING
        "ast_pct": None,              # AST_PCT
        "oreb_pct": None,             # OREB_PCT
        "dreb_pct": None,             # DREB_PCT
        "reb_pct": None,              # REB_PCT
        "stl_pct": None,              # STL_PCT (if available)
        "blk_pct": None,              # BLK_PCT (if available)
        "free_throw_rate": None,      # FTA / FGA (computed)
    },

    # Catch-and-shoot + pull-up tracking (LeagueDashPtStats)
    "tracking_shooting": {
        "catch_shoot_fg3_pct": None,
        "catch_shoot_fg3a": None,
        "catch_shoot_fga": None,
        "catch_shoot_fg_pct": None,
        "catch_shoot_pts": None,
        "pullup_fg3_pct": None,
        "pullup_fg3a": None,
        "pullup_fg2_pct": None,
        "pullup_fg2a": None,
        "pullup_fga": None,
        "pullup_fg_pct": None,
        "pullup_pts": None,
    },

    # Drive tracking (LeagueDashPtStats Drives, PerGame)
    "tracking_drives": {
        "drives_per_game": None,
        "drive_fg_pct": None,
        "drive_pts": None,
        "drive_fta": None,
    },

    # Passing tracking (LeagueDashPtStats Passing)
    "tracking_passing": {
        "potential_assists": None,
        "secondary_assists": None,
        "passes_made": None,
        "ast_adj": None,              # ADJUSTED_AST
    },

    # Defensive tracking (LeagueDashPtStats Defense + LeagueDashPtDefend)
    "tracking_defense": {
        "contested_shots": None,
        "contested_shots_2pt": None,
        "contested_shots_3pt": None,
        "deflections": None,
        "defended_at_rim_fga": None,  # LeagueDashPtDefend 'Less Than 6Ft'
        "defended_at_rim_fg_pct": None,
    },

    # Ball-handling and possession tracking (LeagueDashPtStats Possessions)
    "tracking_possessions": {
        "touches": None,
        "front_court_touches": None,
        "time_of_possession": None,
        "avg_sec_per_touch": None,
    },

    # Contested rebounding tracking (LeagueDashPtStats Rebounding)
    "tracking_rebounding": {
        "oreb_chances": None,
        "oreb_contest_pct": None,
        "dreb_chances": None,
        "dreb_contest_pct": None,
    },

    # Paint touch tracking (LeagueDashPtStats PaintTouch)
    "tracking_paint_touch": {
        "paint_touches": None,
        "paint_touch_fg_pct": None,
        "paint_touch_pts": None,
    },

    # Post touch tracking (LeagueDashPtStats PostTouch)
    "tracking_post_touch": {
        "post_touches": None,
        "post_touch_fg_pct": None,
        "post_touch_pts": None,
        "post_touch_fta": None,
        "post_touch_tov": None,
    },

    # Elbow touch tracking (LeagueDashPtStats ElbowTouch)
    "tracking_elbow_touch": {
        "elbow_touches": None,
        "elbow_touch_fg_pct": None,
        "elbow_touch_pts": None,
    },

    # Shot zone percentages and volume (LeagueDashPlayerShotLocations)
    "shot_zones": {
        "restricted_area_fga": None,
        "restricted_area_fg_pct": None,
        "paint_non_ra_fga": None,
        "paint_non_ra_fg_pct": None,
        "mid_range_fga": None,
        "mid_range_fg_pct": None,
        "above_break_3_fga": None,
        "above_break_3_fg_pct": None,
        "corner_3_fga": None,        # LEFT + RIGHT corner combined
        "corner_3_fg_pct": None,
        "dunk_fga": None,            # From ShotChartDetail (per-player, lazy)
        "dunk_fg_pct": None,
    },

    # Shot action type detail (ShotChartDetail per-player, lazy fetch)
    "shot_detail": {
        "alley_oop_fgm": None,
        "alley_oop_fga": None,
        "driving_dunk_fgm": None,
        "driving_dunk_fga": None,
        "floating_jump_shot_fgm": None,
        "floating_jump_shot_fga": None,
        "floating_jump_shot_fg_pct": None,
    },

    # Synergy play-type frequencies, PPP, and possession counts
    "play_type": {
        "spotup_freq": None,
        "spotup_ppp": None,
        "spotup_poss": None,
        "offscreen_freq": None,
        "offscreen_ppp": None,
        "offscreen_poss": None,
        "handoff_freq": None,
        "handoff_ppp": None,
        "handoff_poss": None,
        "pr_ball_handler_freq": None,
        "pr_ball_handler_ppp": None,
        "pr_ball_handler_poss": None,
        "pr_roll_man_freq": None,
        "pr_roll_man_ppp": None,
        "pr_roll_man_poss": None,
        "postup_freq": None,
        "postup_ppp": None,
        "postup_poss": None,
        "cut_freq": None,
        "cut_ppp": None,
        "cut_poss": None,
        "transition_freq": None,
        "transition_ppp": None,
        "transition_poss": None,
        "isolation_freq": None,
        "isolation_ppp": None,
        "isolation_poss": None,
    },

    # Hustle metrics (LeagueHustleStatsPlayer)
    "hustle": {
        "screen_assists": None,
        "screen_assist_pts": None,
        "charges_drawn": None,
        "loose_balls_recovered": None,
        "box_outs_off": None,
        "box_outs_def": None,
    },

    # Computed matchup-defense diversity (LeagueSeasonMatchups per-player, lazy)
    "matchup_defense": {
        "positional_groups_guarded": None,
        "matchup_poss_at_pg": None,
        "matchup_poss_at_sg": None,
        "matchup_poss_at_sf": None,
        "matchup_poss_at_pf": None,
        "matchup_poss_at_c": None,
        "matchup_fg_pct_at_pg": None,
        "matchup_fg_pct_at_sg": None,
        "matchup_fg_pct_at_sf": None,
        "matchup_fg_pct_at_pf": None,
        "matchup_fg_pct_at_c": None,
        "cross_group_fg_pct_diff": None,  # Negative = good (opponents shoot below league avg)
        "total_matchup_poss": None,
    },

    # Salary (from ESPN scraper, stored separately in players table)
    "salary": {
        "annual_salary": None,
    },

    # Fetch metadata: which data sources succeeded or failed
    "metadata": {
        "season": None,
        "games_played": None,
        "minutes_per_game": None,
        "sources_succeeded": [],
        "sources_failed": [],
    },
}
