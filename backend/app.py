"""
Flask application entry point.
Initializes the app, registers blueprints, and configures CORS and env loading.
"""

from flask import Flask
from flask_cors import CORS
from dotenv import load_dotenv

# Load environment variables from .env before anything else
load_dotenv()

from api.health import health_bp


def create_app() -> Flask:
    """Application factory — creates and configures the Flask app."""
    app = Flask(__name__)

    # Allow cross-origin requests from the Next.js dev server
    CORS(app, resources={r"/api/*": {"origins": "*"}})

    # Register route blueprints
    app.register_blueprint(health_bp)

    return app


# Run directly with `flask run` or `python app.py`
app = create_app()

if __name__ == "__main__":
    app.run(debug=True, port=5001)
