"""
Database access for Snapshot Releases.

Mirrors the shape of services/evaluation_versions/repo.py.
All writes use the Supabase service-role client. Callers (Flask blueprints)
must verify admin auth before calling write methods.
"""

from __future__ import annotations

import uuid
import logging
from dataclasses import dataclass
from typing import Optional

from services.supabase_client import get_supabase, run_query

logger = logging.getLogger(__name__)

# Statuses that count as "an open draft exists"
_OPEN_STATUSES = ("draft", "review")


@dataclass(frozen=True)
class SnapshotRelease:
    id: str
    label: str
    season: str
    status: str            # 'draft' | 'review' | 'published' | 'archived'
    is_active: bool
    published_at: Optional[str]
    created_at: str
    # Issue #71: authoritative count of open flags this Release froze with.
    # None for legacy rows / non-published drafts.
    published_with_open_flags: Optional[int] = None


def _row_to_release(row: dict) -> SnapshotRelease:
    return SnapshotRelease(
        id=str(row["id"]),
        label=row["label"],
        season=row["season"],
        status=row["status"],
        is_active=bool(row.get("is_active", False)),
        published_at=row.get("published_at"),
        created_at=row["created_at"],
        published_with_open_flags=row.get("published_with_open_flags"),
    )


def _get_client():
    """Indirection point so tests can patch without touching get_supabase."""
    return get_supabase()


# ---------------------------------------------------------------------------
# Read helpers
# ---------------------------------------------------------------------------


def get_active_release(client=None) -> SnapshotRelease:
    """Return the single active published Snapshot Release."""
    c = client or _get_client()
    result = run_query(
        lambda: c.table("snapshot_releases")
        .select("*")
        .eq("is_active", True)
        .single()
        .execute()
    )
    return _row_to_release(result.data)


def get_draft(client=None) -> Optional[SnapshotRelease]:
    """Return the current open draft/review row, or None."""
    c = client or _get_client()
    result = run_query(
        lambda: c.table("snapshot_releases")
        .select("*")
        .in_("status", list(_OPEN_STATUSES))
        .execute()
    )
    if not result.data:
        return None
    return _row_to_release(result.data[0])


def get_release(release_id: str, client=None) -> SnapshotRelease:
    """Return a single Snapshot Release by ID."""
    c = client or _get_client()
    result = run_query(
        lambda: c.table("snapshot_releases")
        .select("*")
        .eq("id", release_id)
        .single()
        .execute()
    )
    return _row_to_release(result.data)


def get_working_season(client=None) -> str:
    """Return the season the editable working set belongs to (issue #72).

    Admin tooling that reads or re-evaluates the live working tables (calibration,
    cohesion calibration) should scope to the open draft's season when a draft is
    open, falling back to the active Release's season otherwise. This keeps those
    reads aligned with the season the publish RPC will freeze, instead of a
    hardcoded ``2025-26``.
    """
    draft = get_draft(client)
    if draft is not None:
        return draft.season
    return get_active_release(client).season


def list_releases(limit: int = 20, client=None) -> list[SnapshotRelease]:
    """Return recent published Snapshot Releases, newest first."""
    c = client or _get_client()
    result = run_query(
        lambda: c.table("snapshot_releases")
        .select("*")
        .eq("status", "published")
        .order("published_at", desc=True)
        .limit(limit)
        .execute()
    )
    return [_row_to_release(row) for row in (result.data or [])]


# ---------------------------------------------------------------------------
# Write methods
# ---------------------------------------------------------------------------


def create_draft(client=None) -> SnapshotRelease:
    """Create a new draft Snapshot Release.

    Raises ValueError('draft_already_exists') if one is already open.
    Auto-labels per A-5: 'draft-<8-hex-chars>'.
    """
    existing = get_draft(client)
    if existing is not None:
        raise ValueError("draft_already_exists")

    # Discover the active release's season so the draft inherits it
    active = get_active_release(client)
    auto_label = f"draft-{uuid.uuid4().hex[:8]}"

    c = client or _get_client()
    result = run_query(
        lambda: c.table("snapshot_releases")
        .insert({
            "season": active.season,
            "label": auto_label,
            "status": "draft",
            "is_active": False,
        })
        .execute()
    )
    return _row_to_release(result.data[0])


def update_draft_season(draft_id: str, season: str, client=None) -> SnapshotRelease:
    """Persist an edited season onto an open draft/review row (issue #72).

    The publish dialog lets the admin correct the draft's season inline; this
    writes it back so the draft owns the one season the freeze + gates derive
    from. Callers MUST validate the format first (services.season.validate_nba_season)
    so the column the publish RPC trusts is never set to a malformed value.

    Raises ValueError('draft_not_found_or_not_open') if no open row matches.
    """
    c = client or _get_client()
    result = run_query(
        lambda: c.table("snapshot_releases")
        .update({"season": season})
        .eq("id", draft_id)
        .in_("status", list(_OPEN_STATUSES))
        .execute()
    )
    if not result.data:
        raise ValueError("draft_not_found_or_not_open")
    return _row_to_release(result.data[0])


def move_to_review(draft_id: str, client=None) -> SnapshotRelease:
    """Flip draft → review.

    Raises ValueError('pipeline_runs_in_flight') if any run is active.
    """
    from services.pipeline_runs import repo as runs_repo

    if runs_repo.any_running(draft_id):
        raise ValueError("pipeline_runs_in_flight")

    c = client or _get_client()
    result = run_query(
        lambda: c.table("snapshot_releases")
        .update({"status": "review"})
        .eq("id", draft_id)
        .eq("status", "draft")
        .execute()
    )
    if not result.data:
        raise ValueError("draft_not_found_or_not_draft")
    return _row_to_release(result.data[0])


def move_to_draft(draft_id: str, client=None) -> SnapshotRelease:
    """Flip review → draft (revert the move-to-review action)."""
    c = client or _get_client()
    result = run_query(
        lambda: c.table("snapshot_releases")
        .update({"status": "draft"})
        .eq("id", draft_id)
        .eq("status", "review")
        .execute()
    )
    if not result.data:
        raise ValueError("review_not_found_or_not_review")
    return _row_to_release(result.data[0])


def discard_draft(draft_id: str, client=None) -> None:
    """Hard-delete a draft/review row. Live tables are left untouched."""
    c = client or _get_client()
    result = run_query(
        lambda: c.table("snapshot_releases")
        .delete()
        .eq("id", draft_id)
        .in_("status", list(_OPEN_STATUSES))
        .execute()
    )
    if not result.data:
        raise ValueError("draft_not_found_or_not_open")


def publish_draft(
    draft_id: str,
    label: str,
    allow_missing_composite: bool = False,
    allow_open_flags: bool = False,
    acknowledged_open_flags: int | None = None,
    client=None,
) -> SnapshotRelease:
    """Atomically publish a draft via the Postgres RPC, then rewarm the distribution cache.

    Steps:
    1. Guard: raise if any pipeline_run is still running for this draft (mirrors move_to_review).
    2. Call publish_snapshot_draft RPC (freezes released_players, flips is_active).
    3. distribution_cache.force_clear_distributions() to bypass the draft-pin guard.
    4. distribution_cache.ensure_distributions(force=True) to rewarm from the new active snapshot.

    Args:
        allow_missing_composite: bypass the missing-composite gate.
        allow_open_flags: bypass the open-flags Draft gate. The RPC's
            p_allow_open_flags parameter is the source of truth; we just
            forward the caller's intent.
        acknowledged_open_flags: issue #71 — the open-flags count the admin saw
            and acknowledged when arming the override. The RPC re-counts under its
            lock and raises open_flags_changed if more flags exist now, so the
            bypass is bound to what was actually reviewed. None means "unbounded"
            (only direct callers omit it; the API always sends a count).
    """
    from services.pipeline_runs import repo as runs_repo
    from services.snapshot_versions import validator

    if runs_repo.any_running(draft_id):
        raise ValueError("pipeline_runs_in_flight")

    if runs_repo.any_pending_commit(draft_id):
        raise ValueError("pending_commits_exist")

    # Preflight in Python so the API layer's except ValueError catches it.
    # The RPC retains its own hard backstop for defense-in-depth.
    if not allow_missing_composite:
        validation = validator.validate_publishable(draft_id, client=client)
        if validation["players_missing_composite"] > 0:
            raise ValueError("missing_composite_not_acknowledged")

    c = client or _get_client()

    try:
        run_query(
            lambda: c.rpc(
                "publish_snapshot_draft",
                params={
                    "p_draft_id": draft_id,
                    "p_label": label,
                    "p_allow_missing_composite": allow_missing_composite,
                    "p_allow_open_flags": allow_open_flags,
                    "p_acknowledged_open_flags": acknowledged_open_flags,
                },
            ).execute()
        )
    except Exception as exc:
        msg = str(exc).lower()
        # Translate known RPC RAISE EXCEPTION codes into ValueError so the
        # API layer's existing ValueError handler maps them to 422/409.
        for code in (
            "open_flags_not_acknowledged",
            # Issue #71: override count-pin tripped — more open flags exist than
            # the admin acknowledged; they must re-confirm against the new count.
            "open_flags_changed",
            "missing_composite_not_acknowledged",
            # Issue #67: the RPC rejects a non-review-state row with this code.
            # (Replaced draft_not_found_or_not_in_draft_state — the looser guard's
            # message — which the live function no longer raises.)
            "draft_not_in_review_state",
            "legends_missing_canonical_player",
            # Issue #72: the draft's season column was NULL/blank — the RPC
            # refuses rather than freezing an empty set.
            "season_missing",
        ):
            if code in msg:
                raise ValueError(code) from exc
        raise

    published = get_release(draft_id, client=c)

    # Issue #82: freeze the per-skill stat trace + resolved override history
    # into released_players.skill_trace_snapshot for the public "why" surface.
    # Never allowed to block a publish — see trace_snapshot.py's own docstring.
    try:
        from services.snapshot_versions import trace_snapshot

        updated = trace_snapshot.snapshot_skill_traces(published.id, published.season, client=c)
        logger.info("Froze skill trace snapshots for %d players (release %s)", updated, published.id)
    except Exception:
        logger.exception(
            "Skill trace snapshot freeze failed — public 'why' data will be empty for this release"
        )

    # Rewarm distribution cache against the freshly published snapshot.
    # Issue #72: warm against the published Release's own season, not the
    # hardcoded CURRENT_SEASON, so the cache key matches the freeze scope.
    try:
        from services.evaluation_versions.repo import get_active
        from services.snapshot_versions import distribution_cache

        # force_clear_distributions bypasses the draft-pin guard (A-1)
        distribution_cache.force_clear_distributions()
        active_version = get_active()
        distribution_cache.ensure_distributions(
            published.season, active_version.payload.get("values", {}), force=True
        )
        # #109: the value price ladder is derived from these distributions, so
        # rewarm it against the new active release in the same pass.
        from services.snapshot_versions import value_ladder_cache

        value_ladder_cache.force_clear_ladder()
        value_ladder_cache.ensure_ladder(published.season, force=True)
    except Exception:
        logger.exception(
            "Cache rewarm after publish failed — next evaluation will retry lazily"
        )

    return published


def reset_working_state_from_active(client=None) -> None:
    """Call the reset_working_state_from_active() Postgres RPC."""
    c = client or _get_client()
    run_query(
        lambda: c.rpc("reset_working_state_from_active", {}).execute()
    )


def _check_structural_staleness(release_id: str, client) -> None:
    """Refuse to reactivate a Release frozen under an older schema era.

    A Release published before the legends-freeze migration has zero
    is_legend rows in released_players; reactivating it silently empties
    the Lab's legends (and any other surface reading frozen legend rows).
    Zero legend rows is only stale when legends exist to be frozen.
    """
    release_legends = run_query(
        lambda: client.table("released_players")
        .select("id", count="exact")
        .eq("snapshot_release_id", release_id)
        .eq("is_legend", True)
        .execute()
    )
    if getattr(release_legends, "count", None) != 0:
        return

    legends_total = run_query(
        lambda: client.table("legends").select("id", count="exact").execute()
    )
    if (getattr(legends_total, "count", None) or 0) > 0:
        raise ValueError("release_structurally_stale")


def reactivate_release(
    release_id: str, client=None, allow_stale: bool = False
) -> SnapshotRelease:
    """Atomically reactivate a previously published Snapshot Release.

    Calls reactivate_snapshot_release(p_release_id) Postgres RPC which
    atomically flips the current active row to is_active=false and the
    target to is_active=true (preserving data_cutoff_at). Then forces a
    cohesion distribution cache rewarm so the new active Snapshot's
    composites are used immediately.

    Raises:
        ValueError('release_not_found') if the target Release does not exist.
        ValueError('not_published') if the target Release is not published.
        ValueError('draft_in_flight') if any draft/review row is open.
        ValueError('release_structurally_stale') if the target Release has no
            frozen legend rows while legends exist (pre-legends-freeze era).
            Pass allow_stale=True to override deliberately.
    """
    c = client or _get_client()

    if not allow_stale:
        _check_structural_staleness(release_id, c)

    try:
        run_query(
            lambda: c.rpc(
                "reactivate_snapshot_release",
                {"p_release_id": release_id},
            ).execute()
        )
    except Exception as exc:
        msg = str(exc).lower()
        if "release_not_found" in msg:
            raise ValueError("release_not_found") from exc
        if "not_published" in msg:
            raise ValueError("not_published") from exc
        if "draft_in_flight" in msg:
            raise ValueError("draft_in_flight") from exc
        raise

    reactivated = get_release(release_id, client=c)

    # Rewarm distribution cache against the freshly reactivated snapshot.
    # Issue #72: warm against the reactivated Release's own season, not the
    # hardcoded CURRENT_SEASON. force_clear_distributions bypasses the
    # draft-pin guard (mirrors publish).
    try:
        from services.evaluation_versions.repo import get_active
        from services.snapshot_versions import distribution_cache

        distribution_cache.force_clear_distributions()
        active_version = get_active()
        distribution_cache.ensure_distributions(
            reactivated.season,
            active_version.payload.get("values", {}),
            force=True,
        )
        # #109: rewarm the value price ladder against the reactivated release.
        from services.snapshot_versions import value_ladder_cache

        value_ladder_cache.force_clear_ladder()
        value_ladder_cache.ensure_ladder(reactivated.season, force=True)
    except Exception:
        logger.exception(
            "Cache rewarm after reactivate failed — next evaluation will retry lazily"
        )

    return reactivated
