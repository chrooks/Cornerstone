"""
salary_scraper.py — ESPN salary scraping service.

Scrapes salary data from ESPN's publicly accessible salary listing pages:
  https://www.espn.com/nba/salaries/_/year/2026/page/{n}  (40 players per page)

Falls back to team roster pages if needed:
  https://www.espn.com/nba/team/roster/_/name/{team_abbrev}

This scraper never raises — it logs errors and returns {} on failure.
Add 1-2 second delays between page requests to be respectful.
"""

import json
import logging
import re
import time
import unicodedata
from typing import Any

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_SALARY_BASE_URL = "https://www.espn.com/nba/salaries/_/year/2026/page/{page}"
_ROSTER_URL      = "https://www.espn.com/nba/team/roster/_/name/{abbrev}"
_PAGE_DELAY      = 1.5   # seconds between HTTP requests
_MAX_PAGES       = 20    # safety cap — 20 * 40 = 800 players max
_REQUEST_TIMEOUT = 15    # seconds

# Realistic browser headers to avoid 403 blocks
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
}


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------

def scrape_all_salaries() -> dict[str, int]:
    """
    Scrape salary data for the entire NBA by paginating ESPN's salary listing.
    Returns {normalised_player_name: annual_salary_dollars}.
    Never raises — returns {} on total failure.
    """
    salaries: dict[str, int] = {}

    for page in range(1, _MAX_PAGES + 1):
        url = _SALARY_BASE_URL.format(page=page)
        time.sleep(_PAGE_DELAY)

        page_data = _fetch_salary_page(url)
        if not page_data:
            logger.info("Salary scrape complete: no data on page %d, stopping.", page)
            break

        salaries.update(page_data)
        logger.debug("Scraped page %d: %d salaries (running total %d)", page, len(page_data), len(salaries))

        # ESPN returns fewer than 40 on the last page — stop early
        if len(page_data) < 5:
            break

    logger.info("ESPN salary scrape finished: %d players found.", len(salaries))
    return salaries


def scrape_team_salaries(team_abbrev: str) -> dict[str, int]:
    """
    Scrape salary data for a single team from ESPN's roster page.
    Returns {normalised_player_name: annual_salary_dollars}.
    Never raises — returns {} on failure.
    """
    url = _ROSTER_URL.format(abbrev=team_abbrev.lower())
    time.sleep(_PAGE_DELAY)

    try:
        resp = requests.get(url, headers=_HEADERS, timeout=_REQUEST_TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException as exc:
        logger.warning("ESPN roster page request failed for %s: %s", team_abbrev, exc)
        return {}

    # Strategy 1: extract embedded JSON from <script> tags
    json_result = _parse_salary_from_json(resp.text)
    if json_result:
        return json_result

    # Strategy 2: HTML table parsing
    return _parse_salary_table(resp.text)


# ---------------------------------------------------------------------------
# Internal fetch helpers
# ---------------------------------------------------------------------------

def _fetch_salary_page(url: str) -> dict[str, int]:
    """Fetch one paginated salary listing page and return {name: salary}."""
    try:
        resp = requests.get(url, headers=_HEADERS, timeout=_REQUEST_TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException as exc:
        logger.warning("ESPN salary page request failed (%s): %s", url, exc)
        return {}

    # Strategy 1: JSON embedded in page source
    json_result = _parse_salary_from_json(resp.text)
    if json_result:
        return json_result

    # Strategy 2: HTML table
    return _parse_salary_table(resp.text)


def _parse_salary_from_json(html: str) -> dict[str, int]:
    """
    Attempt to find and extract salary data from embedded JSON in the page source.
    ESPN sometimes embeds data in window.__espnfitt__ or similar script variables.
    Returns {} if the JSON approach doesn't find salary data.
    """
    # Look for salary amounts formatted as "$NN,NNN,NNN" near player names in JSON blocks
    salary_pattern = re.compile(r'"([^"]+?)"\s*,\s*"\$[\d,]+"')

    # Find all script tags and search for embedded JSON
    soup = BeautifulSoup(html, "html.parser")
    for script in soup.find_all("script"):
        text = script.string or ""
        if "salary" not in text.lower() and "$" not in text:
            continue

        # Try to extract name+salary pairs directly from raw text patterns
        # Pattern: "Player Name", "$40,231,758" (as seen in ESPN salary tables)
        raw_matches = re.findall(r'"([A-Z][a-z]+(?:\s+[A-Za-z\'.]+)+)"\s*,\s*"\$([0-9,]+)"', text)
        if raw_matches:
            result = {}
            for name, amount_str in raw_matches:
                salary = _parse_salary_amount(amount_str)
                if salary:
                    result[_normalize_name(name)] = salary
            if result:
                return result

        # Try to parse as JSON and traverse for salary fields
        # ESPN often uses window['__espnfitt__'] = {...}
        json_match = re.search(r"window\[.[^'\"]+.\]\s*=\s*(\{.+?\});", text, re.DOTALL)
        if json_match:
            try:
                data = json.loads(json_match.group(1))
                extracted = _extract_salaries_from_json(data)
                if extracted:
                    return extracted
            except (json.JSONDecodeError, ValueError):
                pass

    return {}


def _extract_salaries_from_json(data: Any, depth: int = 0) -> dict[str, int]:
    """
    Recursively search a parsed JSON structure for player name + salary pairs.
    Limits depth to 10 levels to avoid excessive recursion on large objects.
    """
    if depth > 10:
        return {}

    results: dict[str, int] = {}

    if isinstance(data, dict):
        name = data.get("displayName") or data.get("fullName") or data.get("name")
        salary_val = data.get("salary") or data.get("salaryFormatted")

        if name and salary_val:
            cleaned = str(salary_val).replace("$", "").replace(",", "").strip()
            if cleaned.isdigit():
                results[_normalize_name(str(name))] = int(cleaned)

        for v in data.values():
            results.update(_extract_salaries_from_json(v, depth + 1))

    elif isinstance(data, list):
        for item in data:
            results.update(_extract_salaries_from_json(item, depth + 1))

    return results


def _parse_salary_table(html: str) -> dict[str, int]:
    """
    Parse salary data from an HTML table on ESPN's salary or roster pages.
    Looks for a <table> containing rows with a dollar-formatted salary cell.
    """
    soup = BeautifulSoup(html, "html.parser")
    results: dict[str, int] = {}

    # ESPN uses multiple table structures — try to find one with salary data
    tables = soup.find_all("table")
    for table in tables:
        rows = table.find_all("tr")
        for tr in rows:
            cells = tr.find_all(["td", "th"])
            if len(cells) < 2:
                continue

            # Look for a cell that looks like a salary ($NN,NNN,NNN)
            name_text = None
            salary_int = None

            for cell in cells:
                text = cell.get_text(strip=True)
                if text.startswith("$") and re.match(r"\$[\d,]+$", text):
                    salary_int = _parse_salary_amount(text.lstrip("$"))
                elif name_text is None and len(text) > 4 and text[0].isupper() and " " in text:
                    # Heuristic: first cell that looks like "First Last"
                    name_text = text

            if name_text and salary_int:
                results[_normalize_name(name_text)] = salary_int

    return results


# ---------------------------------------------------------------------------
# Salary matching helpers
# ---------------------------------------------------------------------------

# ESPN salary pages append a position abbreviation to player names in the same
# table cell: e.g. "Stephen Curry G", "Nikola Jokic C", "Karl-Anthony Towns C".
# After normalization these become "stephen curry g", "nikola jokic c", etc.
# This pattern strips that trailing token when building a position-stripped lookup.
_TRAILING_POSITION = re.compile(
    r"\s+(pg|sg|sf|pf|g-f|f-g|f-c|c-f|g|f|c)$"
)


def _strip_position(key: str) -> str:
    """Remove a trailing ESPN position abbreviation from a normalized name key."""
    return _TRAILING_POSITION.sub("", key).strip()


def match_salaries_to_players(
    salary_map: dict[str, int],
    players: list[dict],
) -> tuple[int, int]:
    """
    Match scraped salary data to a list of player dicts (from Supabase).
    Updates the salary field on matched player dicts in-place.

    Returns (matched_count, unmatched_count).

    ESPN appends position abbreviations to player names in their salary tables
    (e.g. "stephen curry g"). We build a position-stripped mirror of salary_map
    so both the raw and stripped keys are checked on each lookup.
    """
    # Build a position-stripped mirror: "stephen curry g" → "stephen curry"
    stripped_map = {_strip_position(k): v for k, v in salary_map.items()}

    matched = 0
    for player in players:
        key = _normalize_name(player.get("name", ""))

        # 1. Direct match (raw ESPN key — works if ESPN stops appending positions)
        salary = salary_map.get(key)

        # 2. Position-stripped match (handles current ESPN format)
        if salary is None:
            salary = stripped_map.get(key)

        # 3. Alternate name key (handles common name variants like "Nic" → "Nicolas")
        if salary is None:
            key_alt = _alternate_name_key(player.get("name", ""))
            salary = salary_map.get(key_alt) or stripped_map.get(key_alt)

        if salary is not None:
            player["salary"] = salary
            matched += 1

    unmatched = len(players) - matched
    return matched, unmatched


# ---------------------------------------------------------------------------
# Name normalisation
# ---------------------------------------------------------------------------

def _normalize_name(name: str) -> str:
    """
    Normalise a player name for fuzzy matching:
      - lowercase
      - strip accents (Nikola → nikola)
      - remove Jr., Sr., III, II, .
      - collapse whitespace
    """
    # Decompose unicode characters and remove combining marks (accents)
    nfd = unicodedata.normalize("NFD", name)
    ascii_name = "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn")

    # Lowercase and remove suffixes
    cleaned = ascii_name.lower()
    cleaned = re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", cleaned)
    cleaned = re.sub(r"[^a-z\s]", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def _alternate_name_key(name: str) -> str:
    """
    Generate a secondary lookup key to handle common name mismatches.
    E.g. "Nic" → "Nicolas", "Naz" → "Nazreon", etc.
    """
    base = _normalize_name(name)
    # Expand common shortened first names
    expansions = {
        "nic ": "nicolas ",
        "naz ": "nazreon ",
        "mo ":  "moe ",
        "rob ": "robert ",
        "bob ": "robert ",
        "alex ": "alexander ",
        "tj ":  "tim ",
        "pj ":  "paul ",
        "cj ":  "coby ",
        "dj ":  "devin ",
        "og ":  "ogugua ",
    }
    for short, full in expansions.items():
        if base.startswith(short):
            return full + base[len(short):]
    return base


# ---------------------------------------------------------------------------
# Salary parsing
# ---------------------------------------------------------------------------

def _parse_salary_amount(amount_str: str) -> int | None:
    """
    Parse a salary string like "$40,231,758" or "40,231,758" into an integer.
    Returns None if the string can't be parsed.
    """
    cleaned = amount_str.replace("$", "").replace(",", "").strip()
    if cleaned.isdigit():
        return int(cleaned)
    return None
