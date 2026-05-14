"""Test import bootstrap for backend package and legacy service imports."""

from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent

for path in (REPO_ROOT, BACKEND_DIR):
    path_string = str(path)
    if path_string not in sys.path:
        sys.path.insert(0, path_string)
