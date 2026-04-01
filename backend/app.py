"""
Flask application entry point.
Initializes the app, registers blueprints, and configures CORS and env loading.
"""

import logging
import os

from flask import Flask
from flask_cors import CORS
from dotenv import load_dotenv

# Load environment variables from .env before anything else
load_dotenv()

# Configure logging — INFO by default, override with LOG_LEVEL env var
logging.basicConfig(
    level=getattr(logging, os.environ.get("LOG_LEVEL", "INFO").upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)

from api.health import health_bp
from api.players import players_bp
from api.salaries import salaries_bp
from api.skills import skills_bp
from api.composite import composite_bp


def create_app() -> Flask:
    """Application factory — creates and configures the Flask app."""
    app = Flask(__name__)

    # Allow cross-origin requests from the Next.js dev server
    CORS(app, resources={r"/api/*": {"origins": "*"}})

    # Register route blueprints
    app.register_blueprint(health_bp)
    app.register_blueprint(players_bp)
    app.register_blueprint(salaries_bp)
    app.register_blueprint(skills_bp)       # Prompt 4: skill evaluation endpoints
    app.register_blueprint(composite_bp)    # Prompt 5: Claude assessment + compositing

    return app


# Run directly with `flask run` or `python app.py`
app = create_app()

if __name__ == "__main__":
    app.run(debug=True, port=5001)
