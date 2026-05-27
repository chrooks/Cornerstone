"""
services/snapshots_active.py — per-request memoization Seam for the active Snapshot Release.

Wraps snapshot_versions.repo.get_active_release so all Lab read paths share one
cached lookup per Flask request. Cohesion warmup (no request context) calls this
with an explicit client and gets the result without memoization.
"""

from __future__ import annotations

import logging

import flask

logger = logging.getLogger(__name__)

_G_KEY = "_active_release_id"


class ActiveReleaseMissingError(RuntimeError):
    """Raised when no snapshot_releases row has is_active=true."""


def get_active_release_id(client=None) -> str:
    """Return the id of the active Snapshot Release.

    Memoized via flask.g when called inside a request context so repeated
    calls within one request hit the cache. Falls through to a live DB query
    when called outside a request context (e.g. cohesion warmup at boot).

    Args:
        client: optional Supabase client to use for the DB query. When None
                the default get_supabase() client is used. Accepted here so
                callers that already hold a client avoid creating a second one.

    Raises:
        ActiveReleaseMissingError: no active release found.
    """
    # Memoize inside a request context only
    in_request = flask.has_request_context()
    if in_request:
        cached = flask.g.get(_G_KEY)
        if cached is not None:
            return cached

    release_id = _query_active_release_id(client)

    if in_request:
        setattr(flask.g, _G_KEY, release_id)

    return release_id


def _query_active_release_id(client=None) -> str:
    """Execute the DB query — one level of indirection so tests can patch cheaply.

    Only translates the no-active-release path into ActiveReleaseMissingError.
    Unexpected exceptions (network timeouts, auth failures, config errors)
    propagate so operators see a 500 with a real stack trace instead of being
    misdiagnosed as a missing release.
    """
    from postgrest.exceptions import APIError

    from services.snapshot_versions.repo import get_active_release

    try:
        release = get_active_release(client)
    except APIError as exc:
        # PostgREST returns PGRST116 when `.single()` finds zero rows. That is
        # the canonical "no active release" signal. Other APIError codes
        # (auth, schema, syntax) propagate untouched.
        if getattr(exc, "code", None) == "PGRST116" or "PGRST116" in str(exc):
            raise ActiveReleaseMissingError(
                "No active Snapshot Release found — cannot serve Lab reads"
            ) from exc
        raise

    if not release or not release.id:
        raise ActiveReleaseMissingError(
            "No active Snapshot Release found — cannot serve Lab reads"
        )

    return release.id
