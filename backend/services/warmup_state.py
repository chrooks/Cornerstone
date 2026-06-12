"""
services/warmup_state.py — process-level record of cohesion warmup health.

At Flask boot, `_warm_cohesion_distributions` preloads the percentile
distributions used for cohesion composite normalization. When no active
Snapshot Release exists (or the load otherwise fails), the engine silently
degrades to theoretical-max fallback. That degradation is invisible from the
outside today — the only signal is a log line that is easy to miss in
production.

This module holds a tiny module-level record of the last warmup outcome so the
GET /api/health Surface can report it. Synthetic monitoring can then page or
dashboard on a degraded boot instead of discovering it through bad evaluations.

Contract:
  - record_warmup_ok()                  -> status "ok", no reasons
  - record_warmup_degraded(reason)      -> status "degraded", reason recorded
  - get_warmup_health()                 -> {"status": ..., "reasons": [...]}
  - reset()                             -> back to the pending (degraded) default

The default, before any warmup runs, is degraded with `cohesion_warmup_pending`
so a process that has not yet warmed (or whose warmup never ran) never reports a
misleading "ok".
"""

from __future__ import annotations

from typing import TypedDict

# Documented reason codes the warmup can record. Kept here as a single source
# of truth so monitoring config and tests reference stable strings.
REASON_PENDING = "cohesion_warmup_pending"
REASON_NO_ACTIVE_RELEASE = "cohesion_warmup_no_active_release"
REASON_DISTRIBUTIONS_UNAVAILABLE = "cohesion_warmup_distributions_unavailable"
REASON_ERROR = "cohesion_warmup_error"


class WarmupHealth(TypedDict):
    status: str  # "ok" | "degraded"
    reasons: list[str]


# Module-level process state. A list so future warmups could record multiple
# independent degradation reasons, though today exactly one is set at a time.
_reasons: list[str] = [REASON_PENDING]


def reset() -> None:
    """Return to the pending (degraded) default. Primarily for tests."""
    global _reasons
    _reasons = [REASON_PENDING]


def record_warmup_ok() -> None:
    """Mark warmup as healthy — distributions loaded against an active release."""
    global _reasons
    _reasons = []


def record_warmup_degraded(reason: str) -> None:
    """Mark warmup as degraded and record why.

    Replaces any prior reasons so the record reflects the latest warmup outcome
    rather than accumulating stale ones across re-warms.
    """
    global _reasons
    _reasons = [reason]


def get_warmup_health() -> WarmupHealth:
    """Return the current warmup health as a serializable dict.

    status is "ok" only when no degradation reasons are recorded.
    """
    return {
        "status": "ok" if not _reasons else "degraded",
        "reasons": list(_reasons),
    }
