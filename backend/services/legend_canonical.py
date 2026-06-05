"""
services/legend_canonical.py — keep a Legend linked to a canonical_players row.

The publish_snapshot_draft RPC freezes each legend into released_players by
joining legends -> canonical_players on nba_api_id. Legends who were never
current-season players (retired greats) never got a canonical_players row from
the current-player seed, so the RPC's legends_missing_canonical_player preflight
hard-blocks publish.

backend/scripts/backfill_legend_canonical_players.py covers existing data. This
module is the prevention Seam: whenever a Legend is saved with an nba_api_id,
ensure_canonical_player() upserts the matching canonical_players row so the gap
can never recur.

Idempotent by design: insert-on-conflict-do-nothing against the UNIQUE
nba_api_id constraint. Re-running never duplicates and never raises on conflict.
A null nba_api_id is a no-op (nothing to link yet).

canonical_players schema (existing table — no migration here):
    id uuid pk, nba_api_id integer UNIQUE NOT NULL,
    display_name text NOT NULL, created_at, updated_at
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def ensure_canonical_player(
    nba_api_id: int | None,
    display_name: str,
    *,
    client=None,
) -> bool:
    """Ensure a canonical_players row exists for the given Legend identity.

    Inserts ``{nba_api_id, display_name}`` into canonical_players, ignoring the
    row if one already exists for that nba_api_id (UNIQUE). This mirrors the
    insert shape in backfill_legend_canonical_players.py.

    Parameters
    ----------
    nba_api_id : int | None
        The Legend's NBA.com player id. When None, this is a no-op — there is
        nothing to link yet, so the function returns False without touching the
        database.
    display_name : str
        The Legend's name, stored as canonical_players.display_name.
    client : optional
        Supabase client to use. Defaults to the shared singleton; injectable so
        callers and tests can supply their own without a live connection.

    Returns
    -------
    bool
        True if an upsert was attempted (nba_api_id was non-null), False if the
        call was a no-op because nba_api_id was None.
    """
    if nba_api_id is None:
        return False

    from services.supabase_client import get_supabase

    sb = client or get_supabase()

    row = {"nba_api_id": nba_api_id, "display_name": display_name}

    # Insert-on-conflict-do-nothing: ignore_duplicates leaves any existing row
    # for this nba_api_id untouched instead of erroring on the UNIQUE conflict.
    (
        sb.table("canonical_players")
        .upsert(row, on_conflict="nba_api_id", ignore_duplicates=True)
        .execute()
    )

    logger.debug(
        "ensure_canonical_player: upserted canonical row nba_api_id=%s display_name=%r",
        nba_api_id,
        display_name,
    )
    return True
