"""
Health check route.
GET /api/health — confirms the backend is reachable and running.
"""

from flask import Blueprint, jsonify

# Blueprint prefix keeps all routes under /api
health_bp = Blueprint("health", __name__, url_prefix="/api")


@health_bp.route("/health", methods=["GET"])
def health_check():
    """Return a simple OK response so the frontend can confirm backend connectivity."""
    return jsonify({"status": "ok", "message": "Backend is running"}), 200
