"""
skill_engine/evaluation_only.py — Evaluation-only pipeline path.

Reads existing player_stats, evaluates against draft thresholds (or override),
and stages results in pipeline_run_results. Does NOT call the NBA API.

Calls Claude only when asked to (with_claude, a Skill-scoped composite
recompute); the default path is source='stats' only, per blueprint Q1.

Public Surface:
  evaluate_skills_for_run(run_id, player_ids, season, skill_filter,
                          thresholds_override, recompute_composite, with_claude) -> None
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

from services.supabase_client import get_supabase, in_chunks, paged_rows, run_query
from services.skill_engine.cache import get_thresholds, get_league_averages
from services.skill_engine.evaluator import evaluate_all_skills, apply_auto_promotions
from services.claude_assessment import get_claude_assessment
from services.compositing import composite_skill, _tier_index
from services.notability import get_notability_score
from services.skills import HIGH_CONFIDENCE_SKILLS, HUMAN_DECISION_SOURCES
from services.pipeline_run_results.repo import (
    StagedProfileRow,
    StagedFlagRow,
    stage_profile_rows,
    stage_flag_rows,
)

# Import referenced here only for patching in tests (never called in this module)
from services.players_service import _blob_has_data, get_or_fetch_player_stats  # noqa: F401

logger = logging.getLogger(__name__)

# Local alias for the one definition in services.skills — see it for the why.
_HUMAN_DECISION_SOURCES = HUMAN_DECISION_SOURCES

# At most this many Claude calls in flight during a with_claude run.
# ponytail: a fixed pool, not a rate limiter; raise it if the Anthropic tier allows.
_CLAUDE_PARALLELISM = 5


def _usable_fresh_claude(fresh_claude: Optional[dict], skill_name: str) -> Optional[dict]:
    """Return this Skill's fresh Claude entry, or None when it is unusable.

    An entry Claude failed to produce must never displace the tier already
    stored for that Skill — a failed rating is missing data, not a new opinion.
    """
    entry = (fresh_claude or {}).get(skill_name) or {}
    if entry.get("claude_failed") or not entry.get("tier"):
        return None
    return entry


def _get_client():
    """Indirection point so tests can patch without touching get_supabase."""
    return get_supabase()


def _merge_composite_for_skills(
    skills_result: dict,
    affected_skills: list[str],
    existing_composite: dict,
    notability_score: int,
    player_id: str,
    season: str,
    fresh_claude: Optional[dict] = None,
    kept_calls: Optional[set] = None,
) -> tuple[dict, list[StagedFlagRow]]:
    """Recompute the affected skills' composite entries, merged into the existing profile.

    The commit RPC replaces the whole composite JSONB, so the returned profile
    must carry every skill — start from the player's existing composite and
    overwrite only the affected skills. Claude context is reconstructed from the
    existing composite entry (None for high-confidence skills, which composite
    purely from stats).

    fresh_claude is this run's Claude assessment, keyed by skill ({"tier",
    "justification", "confidence", "claude_failed"} per entry). A usable fresh
    entry replaces the stale claude_tier from the existing composite; a failed
    one falls back to what is stored. Human-decision entries stay verbatim
    either way, and their contradiction flag records the FRESH tier — that is
    the opinion Chris is being asked to adjudicate.

    Issue #120 guardrail: an entry whose `source` is a recorded human decision
    (resolved / manual_override) is kept EXACTLY as-is — never overwritten. The
    recompute still runs so we can compare; if the fresh stat-derived final_tier
    contradicts the human's final_tier, a review flag is raised so a human
    re-adjudicates in /admin/review instead of the decision silently standing
    against new thresholds. Returns (merged_profile, human_contradiction_flags).

    Issue #177: kept_calls holds (player_id, skill, stats_tier, claude_tier,
    final_tier) for every call a reviewer already kept against those opinions
    (_read_kept_calls). A contradiction that matches one is not raised again; a
    new stats tier or a new Claude opinion still asks. None = no history.
    """
    merged = dict(existing_composite)
    protected_flags: list[StagedFlagRow] = []
    for skill_name in affected_skills:
        stat_result = skills_result.get(skill_name)
        if stat_result is None:
            continue
        existing_entry = existing_composite.get(skill_name) or {}
        fresh_entry = _usable_fresh_claude(fresh_claude, skill_name)
        # The tier a flag should show as Claude's opinion, and the reason behind it.
        flag_claude_tier = existing_entry.get("claude_tier")
        flag_justification = None
        if skill_name in HIGH_CONFIDENCE_SKILLS:
            claude_result = None
        elif fresh_entry is not None:
            claude_result = {
                "tier": fresh_entry.get("tier"),
                "confidence": fresh_entry.get("confidence"),
                "claude_failed": False,
            }
            flag_claude_tier = fresh_entry.get("tier")
            flag_justification = fresh_entry.get("justification")
        else:
            claude_tier = existing_entry.get("claude_tier")
            claude_result = {
                "tier": claude_tier,
                "confidence": existing_entry.get("claude_confidence"),
                "claude_failed": claude_tier is None,
            }
        recomputed = composite_skill(
            skill_name, stat_result, claude_result, notability_score
        )

        if existing_entry.get("source") in _HUMAN_DECISION_SOURCES:
            # Human decision — keep the entry verbatim. Flag only when the fresh
            # recompute disagrees with the human's final_tier (agreement = no-op).
            merged[skill_name] = existing_entry
            human_tier = existing_entry.get("final_tier")
            fresh_tier = recomputed.get("final_tier")
            stats_tier = stat_result.get("tier") or "None"
            already_kept = (player_id, skill_name, stats_tier, flag_claude_tier or "None",
                            human_tier) in (kept_calls or ())
            if _tier_index(fresh_tier) != _tier_index(human_tier) and not already_kept:
                protected_flags.append(StagedFlagRow(
                    player_id=player_id,
                    skill_name=skill_name,
                    flag_reason=(
                        f"human_decision_contradicted:"
                        f"{existing_entry.get('source')}:{human_tier}"
                    ),
                    season=season,
                    claude_tier=flag_claude_tier,
                    # #165: the RAW stats tier, as on every other flag. Trust Stats
                    # writes this value under a "Stats" label; the recomputed
                    # blend only decides whether to flag.
                    stats_tier=stats_tier,
                    claude_justification=flag_justification,
                    stat_values=stat_result.get("driving_stats") or None,
                ))
            continue

        merged[skill_name] = recomputed
    return merged, protected_flags


def _stage_composite_for_player(
    player_id: str,
    season: str,
    skills_result: dict,
    affected_skills: list[str],
    existing_composite: dict,
    notability_score: int,
    fresh_claude: Optional[dict] = None,
    kept_calls: Optional[set] = None,
) -> tuple[StagedProfileRow, list[StagedFlagRow]]:
    """Build the merged composite profile row + any review flags for one player."""
    merged_composite, protected_flags = _merge_composite_for_skills(
        skills_result, affected_skills, existing_composite, notability_score,
        player_id, season, fresh_claude=fresh_claude, kept_calls=kept_calls,
    )
    profile_row = StagedProfileRow(
        player_id=player_id,
        season=season,
        source="composite",
        profile=merged_composite,
    )
    # Human-decision contradictions (issue #120) are flagged inside the merge —
    # start from those. The commit RPC persists all staged flags into
    # draft_skill_flags and marks the profile review_required.
    flag_rows: list[StagedFlagRow] = list(protected_flags)
    for skill_name in affected_skills:
        # Protected (resolved / manual_override) skills are handled above — skip
        # them here so a single player+skill never gets two flags for one run.
        if (existing_composite.get(skill_name) or {}).get("source") in _HUMAN_DECISION_SOURCES:
            continue
        # Stage a review flag for any affected skill the composite flagged (Claude
        # disagreement / low-notability).
        entry = merged_composite.get(skill_name) or {}
        if entry.get("flagged"):
            fresh_entry = _usable_fresh_claude(fresh_claude, skill_name)
            flag_rows.append(StagedFlagRow(
                player_id=player_id,
                skill_name=skill_name,
                flag_reason=entry.get("flag_reason") or "flagged",
                season=season,
                claude_tier=entry.get("claude_tier"),
                stats_tier=entry.get("stat_tier"),
                claude_justification=(
                    fresh_entry.get("justification") if fresh_entry else None
                ),
                stat_values=(skills_result.get(skill_name) or {}).get("driving_stats") or None,
            ))
    return profile_row, flag_rows


def _fetch_fresh_claude(
    evaluated: dict[str, dict],
    season: str,
    skills: list[str],
    client,
) -> tuple[dict[str, dict], set[str]]:
    """Ask Claude to rate `skills` for each evaluated player, 5 calls in flight.

    Returns (fresh_by_player, failed_player_ids). A player whose call fails is
    reported as failed and never as an empty rating: the commit replaces a whole
    profile row per source, so staging a player Claude could not rate would
    write missing data over tiers that were fine.
    """
    fresh_by_player: dict[str, dict] = {}
    failed: set[str] = set()

    with ThreadPoolExecutor(max_workers=_CLAUDE_PARALLELISM) as pool:
        futures = {
            pool.submit(
                get_claude_assessment, player_id, season, skills_result, client,
                skills=skills,
            ): player_id
            for player_id, skills_result in evaluated.items()
        }
        for future in as_completed(futures):
            player_id = futures[future]
            try:
                result = future.result()
            except Exception:
                logger.exception(
                    "evaluate_skills_for_run: Claude call raised for player %s — "
                    "skipping the player", player_id,
                )
                failed.add(player_id)
                continue
            if result.get("claude_failed") or not result.get("skills"):
                logger.warning(
                    "evaluate_skills_for_run: Claude returned nothing for player %s — "
                    "skipping the player", player_id,
                )
                failed.add(player_id)
                continue
            fresh_by_player[player_id] = result["skills"]

    return fresh_by_player, failed


def _merged_claude_row(
    player_id: str,
    season: str,
    existing_claude: dict,
    fresh_claude: dict,
) -> Optional[StagedProfileRow]:
    """Merge this run's Claude tiers into the player's stored claude profile.

    The commit replaces a whole row per source, so a claude row holding only the
    Skills this run rated would erase every other Skill's Claude tier.
    """
    fresh_tiers: dict[str, str] = {}
    for skill_name in (fresh_claude or {}):
        entry = _usable_fresh_claude(fresh_claude, skill_name)
        if entry is not None:
            fresh_tiers[skill_name] = entry["tier"]
    if not fresh_tiers:
        return None
    return StagedProfileRow(
        player_id=player_id,
        season=season,
        source="claude",
        profile={**existing_claude, **fresh_tiers},
    )


def _read_rows_by_source(client, player_ids: list[str], season: str, source: str) -> dict[str, dict]:
    """Batch-read one draft_skill_profiles source into {player_id: {id, player_id, profile}}."""
    by_player: dict[str, dict] = {}
    for chunk in in_chunks(player_ids):
        result = run_query(
            lambda c=chunk: client.table("draft_skill_profiles")
            .select("id, player_id, profile")
            .eq("source", source)
            .eq("season", season)
            .in_("player_id", c)
            .execute()
        )
        for row in (result.data or []):
            by_player[row["player_id"]] = row
    return by_player


def _read_profiles_by_source(client, player_ids: list[str], season: str, source: str) -> dict[str, dict]:
    """Batch-read one draft_skill_profiles source into {player_id: profile}."""
    rows = _read_rows_by_source(client, player_ids, season, source)
    return {pid: row.get("profile") or {} for pid, row in rows.items()}


def _read_kept_calls(client, composites: dict[str, dict], skills: list[str]) -> set[tuple[str, str, str, str, str]]:
    """#177: the calls reviewers already kept, as (player_id, skill, stats_tier, claude_tier, final_tier).

    composites is player_id -> composite row ({"id", "profile"}). A resolved flag
    records the opinions the reviewer decided against (stat_rating, claude_rating)
    and the tier they kept (resolved_value), so the guard can skip asking the same
    question. A data_missing flag is left out: its "None" is not a stats verdict.
    Only players holding a human call in `skills` are read.
    """
    owners = {
        row["id"]: pid for pid, row in composites.items()
        if row.get("id") and any(
            isinstance(e, dict) and e.get("source") in _HUMAN_DECISION_SOURCES
            for e in ((row.get("profile") or {}).get(s) for s in skills)
        )
    }
    kept: set[tuple[str, str, str, str, str]] = set()
    for chunk in in_chunks(list(owners)):
        for f in paged_rows(
            lambda c=chunk: client.table("draft_skill_flags")
            .select("skill_profile_id, skill_name, stat_rating, claude_rating, resolved_value, flag_reason")
            .in_("skill_profile_id", c)
            .in_("skill_name", skills)
            .not_.is_("resolution", "null")
            .order("id")
        ):
            if (f.get("flag_reason") or "").startswith("data_missing"):
                continue
            kept.add((owners[f["skill_profile_id"]], f["skill_name"], f["stat_rating"] or "None",
                      f.get("claude_rating") or "None", f["resolved_value"]))
    return kept


def evaluate_skills_for_run(
    run_id: str,
    player_ids: list[str],
    season: str,
    skill_filter: Optional[list[str]] = None,
    thresholds_override: Optional[dict] = None,
    recompute_composite: bool = False,
    with_claude: bool = False,
) -> None:
    """Evaluate skills for the given players and stage results for the pipeline run.

    Args:
        run_id:              The pipeline_runs.id to attach staged rows to.
        player_ids:          List of player UUIDs to evaluate. Empty list → no-op.
        season:              Season string (e.g. '2025-26').
        skill_filter:        If provided, only include these skills in the staged profile.
                             Other skills are omitted from the staging row.
        thresholds_override: If provided, use these thresholds instead of the live
                             draft_skill_thresholds. Used by threshold_edit runs.
        recompute_composite: If True, stage source='composite' rows instead of
                             source='stats'. The affected skills' composite is
                             recomputed and merged into each player's existing
                             composite profile, so commit updates what the Player
                             Pool / publish read. Players without an existing
                             composite are skipped (never stage a partial profile,
                             which the replace-on-commit RPC would clobber).
                             Used by threshold_edit runs.
        with_claude:         If True, ask Claude to re-rate the non-HIGH skills in
                             skill_filter for each player and feed those FRESH tiers
                             into the composite merge. Requires recompute_composite
                             (ValueError otherwise) — a fresh tier only reaches the
                             profile through that merge. A player whose Claude call
                             fails is skipped entirely, never staged with missing
                             data. Also stages a merged source='claude' row.

    Side effects:
        - Reads player_stats from Supabase.
        - Calls evaluate_all_skills + apply_auto_promotions.
        - Calls stage_profile_rows (writes to pipeline_run_results).
        - When recompute_composite: also reads draft_skill_profiles (composite),
          the resolved draft_skill_flags of its human calls (#177) and
          notability, and calls composite_skill.
        - When skill_filter without recompute_composite: reads the stats profile
          so the filtered run keeps the skills it did not evaluate.
        - When with_claude: reads draft_skill_profiles (claude) and calls the
          Anthropic API, at most _CLAUDE_PARALLELISM calls in flight.
        - Does NOT call NBA API.
        - Does NOT call Claude unless with_claude is True.
    """
    if with_claude and not recompute_composite:
        raise ValueError(
            "with_claude requires recompute_composite — a fresh Claude tier only "
            "reaches the profile through the composite merge"
        )

    if not player_ids:
        stage_profile_rows(run_id, [])
        return

    client = _get_client()

    # Resolve thresholds — override wins; otherwise load from draft_skill_thresholds
    if thresholds_override is not None:
        thresholds = thresholds_override
    else:
        thresholds = get_thresholds(client)

    league_avgs = get_league_averages(season, client)

    # Batch-fetch stats for all players in one query.
    #
    # ORDER BY fetched_at DESC is load-bearing, not decoration. player_stats is
    # INSERTed (not upserted), so a player accumulates a row per fetch —
    # Wembanyama has fourteen. Without an explicit order, Postgres returns them
    # in whatever order it likes and the "first row wins" loop below picks one
    # ARBITRARILY: skill evaluation was silently nondeterministic, and could rate
    # a player off a stale April row, or off an all-null failed-fetch row.
    # Newest-first makes "first row wins" mean "newest row wins". Each player
    # sits in exactly one id chunk, so the order still holds per player.
    stats_rows: list[dict] = []
    for chunk in in_chunks(player_ids):
        stats_rows.extend(run_query(
            lambda c=chunk: client.table("player_stats")
            .select("player_id, season, stats, fetched_at")
            .eq("season", season)
            .in_("player_id", c)
            .order("fetched_at", desc=True)
            .execute()
        ).data or [])

    # Build lookup: player_id -> stats_blob. Newest USABLE row wins.
    #
    # Skipping all-null rows is defence in depth. get_or_fetch_player_stats now
    # refuses to persist an empty fetch, but rows written before that guard are
    # still in the table — and an empty row is newest for Luka, Jokic, Giannis
    # and Wembanyama right now. Without this skip, ordering newest-first would
    # hand the evaluator a blob with no stats and quietly wipe their profiles.
    stats_by_player: dict[str, dict] = {}
    skipped_empty = 0
    for row in stats_rows:
        pid = row["player_id"]
        if pid in stats_by_player:
            continue
        blob = row.get("stats") or {}
        if not _blob_has_data(blob):
            skipped_empty += 1
            continue
        stats_by_player[pid] = blob

    if skipped_empty:
        logger.warning(
            "evaluate_skills_for_run: skipped %d all-null stats row(s) — failed fetches "
            "shadowing real data. Purge them from player_stats.",
            skipped_empty,
        )

    # Evaluate every player up front. The Claude pass below needs each player's
    # stat result as prompt input, so the evaluation cannot stay inside the
    # staging loop without running twice.
    evaluated: dict[str, dict] = {}
    for player_id in player_ids:
        stats_blob = stats_by_player.get(player_id)
        if not stats_blob:
            logger.warning(
                "evaluate_skills_for_run: no stats for player %s season %s — skipping",
                player_id, season,
            )
            continue
        try:
            skills_result = evaluate_all_skills(stats_blob, thresholds, league_avgs)
            evaluated[player_id] = apply_auto_promotions(skills_result, thresholds)
        except Exception:
            logger.exception(
                "evaluate_skills_for_run: error evaluating player %s — skipping", player_id
            )

    # When recomputing composite, batch-fetch each player's existing composite
    # profile to merge the affected skills into (preserving untouched skills).
    existing_composite_by_player: dict[str, dict] = {}
    affected_skills: list[str] = []
    needs_notability = False
    kept_calls: set[tuple[str, str, str, str, str]] = set()
    if recompute_composite:
        affected_skills = list(skill_filter) if skill_filter else []
        needs_notability = any(s not in HIGH_CONFIDENCE_SKILLS for s in affected_skills)
        composite_rows = _read_rows_by_source(client, player_ids, season, "composite")
        existing_composite_by_player = {
            pid: row.get("profile") or {} for pid, row in composite_rows.items()
        }
        # #177: contradictions a reviewer already resolved are not asked again.
        kept_calls = _read_kept_calls(client, composite_rows, affected_skills)

    # A filtered stats run stages a whole row, and commit replaces it — so merge
    # the filtered result into what the player already has, or the skills this
    # run did not evaluate would be wiped.
    existing_stats_by_player: dict[str, dict] = {}
    if skill_filter and not recompute_composite:
        existing_stats_by_player = _read_profiles_by_source(
            client, player_ids, season, "stats"
        )

    # Scoped Claude pass — fresh tiers for the non-HIGH skills in the filter.
    fresh_claude_by_player: dict[str, dict] = {}
    claude_failed_players: set[str] = set()
    existing_claude_by_player: dict[str, dict] = {}
    if with_claude:
        claude_scope = [s for s in affected_skills if s not in HIGH_CONFIDENCE_SKILLS]
        if claude_scope:
            # Only players the staging loop can actually use. A player with no
            # composite row is dropped below, so asking Claude about him spends
            # an API call on an answer this run throws away.
            claude_input = {
                pid: result for pid, result in evaluated.items()
                if existing_composite_by_player.get(pid)
            }
            fresh_claude_by_player, claude_failed_players = _fetch_fresh_claude(
                claude_input, season, claude_scope, client
            )
            if claude_input and not fresh_claude_by_player:
                # Every call failed. Returning normally stages nothing and the
                # worker reports success over the full player count, which reads
                # as "nothing moved" — so the outage is invisible and the spend
                # gets repeated.
                raise RuntimeError(
                    "claude_unavailable — Claude rated no player in this run"
                )
            existing_claude_by_player = _read_profiles_by_source(
                client, player_ids, season, "claude"
            )
        else:
            logger.info(
                "evaluate_skills_for_run [%s]: with_claude requested but every "
                "filtered skill is high-confidence — Claude not called", run_id,
            )

    staged_profiles: list[StagedProfileRow] = []
    staged_flags: list[StagedFlagRow] = []
    skipped_no_composite = 0
    skipped_claude_failed = 0

    for player_id in player_ids:
        skills_result = evaluated.get(player_id)
        if skills_result is None:
            continue

        if recompute_composite:
            if player_id in claude_failed_players:
                skipped_claude_failed += 1
                continue
            # Stage the merged composite (what the Player Pool / publish read).
            existing_composite = existing_composite_by_player.get(player_id)
            if not existing_composite:
                skipped_no_composite += 1
                logger.warning(
                    "evaluate_skills_for_run: no existing composite for player %s "
                    "season %s — skipping (won't stage a partial profile)",
                    player_id, season,
                )
                continue
            notability = (
                get_notability_score(player_id, season, client)
                if needs_notability else 0
            )
            fresh_claude = fresh_claude_by_player.get(player_id)
            profile_row, flag_rows = _stage_composite_for_player(
                player_id, season, skills_result, affected_skills,
                existing_composite, notability, fresh_claude=fresh_claude,
                kept_calls=kept_calls,
            )
            staged_profiles.append(profile_row)
            staged_flags.extend(flag_rows)
            if with_claude and fresh_claude:
                claude_row = _merged_claude_row(
                    player_id, season,
                    existing_claude_by_player.get(player_id) or {},
                    fresh_claude,
                )
                if claude_row is not None:
                    staged_profiles.append(claude_row)
            continue

        # Apply skill filter — only keep requested skills in the staged profile,
        # merged over what the player already has (commit replaces the row).
        if skill_filter:
            filtered_profile = {
                **(existing_stats_by_player.get(player_id) or {}),
                **{
                    skill_name: data
                    for skill_name, data in skills_result.items()
                    if skill_name in skill_filter
                },
            }
        else:
            filtered_profile = skills_result

        staged_profiles.append(StagedProfileRow(
            player_id=player_id,
            season=season,
            source="stats",
            profile=filtered_profile,
        ))

    stage_profile_rows(run_id, staged_profiles)

    if staged_flags:
        stage_flag_rows(run_id, staged_flags)

    logger.info(
        "evaluate_skills_for_run [%s]: staged %d profile rows, %d flag rows"
        "%s%s",
        run_id, len(staged_profiles), len(staged_flags),
        f", skipped {skipped_no_composite} player(s) with no existing composite"
        if skipped_no_composite else "",
        f", skipped {skipped_claude_failed} player(s) Claude could not rate"
        if skipped_claude_failed else "",
    )
