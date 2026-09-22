"""
Supabase client singleton for the Flask backend.
Uses the service role key, which bypasses Row Level Security —
only use this on the server, never expose it to the frontend.
"""

import logging
import os
from collections.abc import Callable, Sequence
from typing import TypeVar

import httpx
from supabase import create_client, Client
from dotenv import load_dotenv

# Load .env so this module works when run directly for verification
load_dotenv()

logger = logging.getLogger(__name__)

_client: Client | None = None

T = TypeVar("T")


def in_chunks(ids: Sequence[T], size: int = 100) -> list[list[T]]:
    """Split an id list into successive slices of at most `size` items.

    Every `.in_()` filter goes through this. The dev gateway (Kong) returns
    HTTP 414 (URI too long) above about 220 UUIDs in one query string. A
    100-id list also keeps a one-row-per-id read under PostgREST's 1,000-row
    cap; multi-row tables (player_stats, draft_skill_flags) must still page
    with `.range()` once rows per id can reach 10.
    """
    # ponytail: evaluation_only's stats read and drift_audit._fetch_latest_stats
    # do not page yet — dev averages ~3 player_stats rows per player (max 14),
    # about 310 rows per chunk; page them when a chunk nears 1,000 rows.
    return [list(ids[i : i + size]) for i in range(0, len(ids), size)]


# PostgREST's db-max-rows. A response is truncated at this many rows and says
# nothing about the rest, so a read that can exceed it must walk pages.
PAGE_SIZE = 1000


def paged_rows(build_query: Callable[[], object]) -> list[dict]:
    """Every row a query matches, walked in `.range()` pages.

    `build_query` returns a fresh, unexecuted query each call — the same
    filters, one page at a time. Use it for any read whose row count is not
    bounded by the id list (draft_skill_flags carries 5-15 rows per profile,
    so 100 profile ids can pass the cap).
    """
    out: list[dict] = []
    start = 0
    while True:
        size = PAGE_SIZE
        res = run_query(
            lambda s=start, n=size: build_query().range(s, s + n - 1).execute()
        )
        rows = res.data or []
        out.extend(rows)
        if len(rows) < size:
            return out
        start += size


def get_supabase() -> Client:
    """Return the shared Supabase client, creating it on first call."""
    global _client
    if _client is None:
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_KEY")

        if not url or not key:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env"
            )

        _client = create_client(url, key)

        # h2 is installed, so httpx negotiates HTTP/2 by default. Supabase's
        # PostgREST sends a GOAWAY frame after ~34 streams per connection, which
        # causes RemoteProtocolError on the 35th request. Swapping the transport
        # to HTTP/1.1-only prevents exhaustion entirely — connection pooling still
        # works, it just doesn't multiplex streams. All existing session headers
        # (apikey, Authorization, etc.) are preserved on the same session object.
        _client.postgrest.session._transport = httpx.HTTPTransport(http2=False)

    return _client


def reset_client() -> None:
    """
    Discard the current singleton so the next call to get_supabase() creates
    a fresh client with a new HTTP connection pool.

    Call this after catching an httpx.ReadError to recover from a stale
    HTTP/2 connection that was closed by the server (common on macOS with
    errno 35 / EAGAIN).
    """
    global _client
    _client = None


def run_query(fn: Callable[[], T]) -> T:
    """
    Execute a Supabase query with one automatic retry on HTTP connection errors.

    Usage:
        result = run_query(lambda: get_supabase().table("foo").select("*").execute())

    On the first httpx.ReadError the singleton is reset so the retry gets a
    fresh HTTP connection pool.  If the retry also fails the exception is
    re-raised normally.
    """
    try:
        return fn()
    except (httpx.ReadError, httpx.RemoteProtocolError) as exc:
        # httpx.ReadError: stale HTTP/2 connection (errno 35 / EAGAIN on macOS)
        # httpx.RemoteProtocolError: server closed the connection mid-stream
        # Both indicate a dead connection in the pool — reset and retry once.
        logger.warning(
            "Supabase connection error (stale HTTP/2) — "
            "resetting client and retrying once: %s",
            exc,
        )
        reset_client()
        # Re-run fn(); it will call get_supabase() internally, which now
        # builds a fresh client with a new connection pool.
        return fn()


def verify_connection() -> None:
    """
    Smoke-test the Supabase connection by querying the legends table.
    Prints the first few legend names to confirm data is reachable.
    """
    client = get_supabase()
    response = client.table("legends").select("name, peak_era").limit(5).execute()

    print("Supabase connection OK. Sample legends:")
    for legend in response.data:
        print(f"  - {legend['name']} ({legend['peak_era']})")


if __name__ == "__main__":
    verify_connection()
