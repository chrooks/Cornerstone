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


class _ColorFormatter(logging.Formatter):
    """
    Logging formatter that adds ANSI color to the level name.
    Works in any terminal that supports 256-color ANSI codes (macOS Terminal,
    iTerm2, VS Code integrated terminal, etc.).
    Falls back to plain text if the output is not a TTY (e.g. piped to a file).
    """
    _RESET  = "\x1b[0m"
    _BOLD   = "\x1b[1m"
    _LEVEL_COLORS = {
        logging.DEBUG:    "\x1b[36m",    # cyan
        logging.INFO:     "\x1b[32m",    # green
        logging.WARNING:  "\x1b[33m",    # yellow
        logging.ERROR:    "\x1b[31m",    # red
        logging.CRITICAL: "\x1b[35;1m",  # bold magenta
    }
    # Dim grey for the timestamp and logger name so the message stands out
    _DIM = "\x1b[2;37m"

    def format(self, record: logging.LogRecord) -> str:
        color   = self._LEVEL_COLORS.get(record.levelno, "")
        level   = f"{color}{self._BOLD}[{record.levelname:<8}]{self._RESET}"
        time    = f"{self._DIM}{self.formatTime(record, self.datefmt)}{self._RESET}"
        name    = f"{self._DIM}{record.name}{self._RESET}"
        message = record.getMessage()

        # Colorize error/critical messages themselves for extra visibility
        if record.levelno >= logging.ERROR:
            message = f"{color}{message}{self._RESET}"

        formatted = f"{time} {level} {name}: {message}"

        # Append exception traceback if present (no extra color — keeps it readable)
        if record.exc_info:
            formatted += "\n" + self.formatException(record.exc_info)

        return formatted


class _TruncatingFilter(logging.Filter):
    """
    Truncates log messages that exceed a character threshold.

    Primarily targets httpx's HTTP Request log lines which can contain
    thousands of characters when PostgREST IN(...) queries encode hundreds
    of UUIDs in the URL.
    """
    _MAX_LEN = 200

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        if len(msg) > self._MAX_LEN:
            # Keep the first portion so the URL path is still readable
            record.msg = msg[: self._MAX_LEN] + f"... [{len(msg) - self._MAX_LEN} chars truncated]"
            record.args = ()  # args already interpolated above
        return True


def _configure_logging() -> None:
    """Set up the root logger with the color formatter."""
    level = getattr(logging, os.environ.get("LOG_LEVEL", "INFO").upper(), logging.INFO)

    handler = logging.StreamHandler()
    handler.setFormatter(_ColorFormatter(datefmt="%H:%M:%S"))

    root = logging.getLogger()
    root.setLevel(level)
    # Replace any handlers basicConfig may have added before us
    root.handlers = [handler]

    # Truncate very long httpx request log lines (e.g. PostgREST IN queries
    # with hundreds of UUIDs encoded in the URL)
    logging.getLogger("httpx").addFilter(_TruncatingFilter())


_configure_logging()

from api.health import health_bp
from api.players import players_bp
from api.salaries import salaries_bp
from api.skills import skills_bp
from api.composite import composite_bp
from api.calibration import calibration_bp
from api.pipeline import pipeline_bp
from api.review import review_bp
from api.legends import legends_bp
from api.rosters import rosters_bp
from api.builder import builder_bp


def create_app() -> Flask:
    """Application factory — creates and configures the Flask app."""
    app = Flask(__name__)

    # Hard cap on incoming request bodies — prevents oversized payload attacks.
    # 64 KB is well above any legitimate API payload in this project.
    app.config["MAX_CONTENT_LENGTH"] = 64 * 1024

    # Restrict CORS to known frontend origins.
    # FRONTEND_ORIGIN can be a comma-separated list for multi-environment setups
    # (e.g. "http://localhost:3000,https://cornerstone.example.com").
    # Falls back to localhost in development. A wildcard is intentionally avoided
    # now that write endpoints carry JWTs — any origin could otherwise make
    # credentialed cross-origin requests to the API.
    raw_origins = os.environ.get("FRONTEND_ORIGIN", "http://localhost:3000")
    allowed_origins = [o.strip() for o in raw_origins.split(",") if o.strip()]
    CORS(app, resources={r"/api/*": {"origins": allowed_origins}})

    # Register route blueprints
    app.register_blueprint(health_bp)
    app.register_blueprint(players_bp)
    app.register_blueprint(salaries_bp)
    app.register_blueprint(skills_bp)       # Prompt 4: skill evaluation endpoints
    app.register_blueprint(composite_bp)    # Prompt 5: Claude assessment + compositing
    app.register_blueprint(calibration_bp)  # Prompt 6: calibration tool endpoints
    app.register_blueprint(pipeline_bp)     # Prompt 7: pipeline status dashboard
    app.register_blueprint(review_bp)       # Prompt 7: review queue + flag resolution
    app.register_blueprint(legends_bp)      # Prompt 8: legends profile builder
    app.register_blueprint(rosters_bp)      # Prompt 9: roster builder persistence
    app.register_blueprint(builder_bp)      # Phase 4: roster evaluation engine

    return app


# Run directly with `flask run` or `python app.py`
app = create_app()

if __name__ == "__main__":
    app.run(debug=True, port=5001)
