"""
Supabase client singleton for the Flask backend.
Uses the service role key, which bypasses Row Level Security —
only use this on the server, never expose it to the frontend.
"""

import logging
import os
from collections.abc import Callable
from typing import TypeVar

import httpx
from supabase import create_client, Client
from dotenv import load_dotenv

# Load .env so this module works when run directly for verification
load_dotenv()

logger = logging.getLogger(__name__)

_client: Client | None = None

T = TypeVar("T")


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
