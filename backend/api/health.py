"""
Health check route.
GET /api/health — confirms the backend is reachable and reports readiness.

The response carries two distinct signals:
  - liveness: the process answered, so a 200 is always returned.
  - readiness: `status` is "ok" only when boot-time cohesion warmup succeeded;
    "degraded" with `reasons` when it fell back to theoretical maxima (e.g. no
    active Snapshot Release). Synthetic monitoring keys off `status`/`reasons`.
"""

from flask import Blueprint, jsonify

from services.warmup_state import get_warmup_health

# Blueprint prefix keeps all routes under /api
health_bp = Blueprint("health", __name__, url_prefix="/api")


@health_bp.route("/health", methods=["GET"])
def health_check():
    """Return backend reachability plus cohesion warmup readiness.

    A reachable backend with degraded warmup still returns 200 — the body
    carries the readiness signal so liveness probes stay green while dashboards
    can page on the degraded state.
    """
    warmup = get_warmup_health()
    return jsonify({
        "status": warmup["status"],
        "reasons": warmup["reasons"],
        "message": "Backend is running",
    }), 200
