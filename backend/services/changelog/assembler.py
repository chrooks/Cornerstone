"""
Public changelog assembler (issue #18).

Pure transform that merges published RuleSet Version, Evaluation Version, and
Snapshot Release rows into a single newest-first list of changelog entries for
the landing page.

Each entry is a JSON-safe dict with a stable shape the frontend mirrors:

    {
        "type": "ruleset_version" | "evaluation_version" | "snapshot_release",
        "date": ISO-8601 timestamp string,        # published_at
        "version_label": str,                      # human version label / slug
        "title": str,                              # short headline for the entry
        "summary": str,                            # one-line description
        "link": str | None,                        # relevant in-app link, when any
    }

Keeping the shaping logic here (separate from the Flask blueprint and Supabase
access) makes it unit-testable without a DB.
"""

from __future__ import annotations

from typing import Any

# Entry type discriminators — kept as constants so the API layer and tests
# reference one source of truth.
TYPE_RULESET = "ruleset_version"
TYPE_EVALUATION = "evaluation_version"
TYPE_SNAPSHOT = "snapshot_release"

# Default number of entries surfaced on the landing page.
DEFAULT_LIMIT = 10


def _ruleset_entry(row: dict[str, Any]) -> dict[str, Any] | None:
    """Normalize one published RuleSet Version row, or None if unpublishable."""
    published_at = row.get("published_at")
    if not published_at:
        return None

    label = row.get("version_label") or ""
    name = row.get("ruleset_name") or "Rule Set"
    slug = row.get("ruleset_slug")

    title = f"{name} {label}".strip()
    summary = (
        f"New version of the {name} Rule Set is live. "
        "Team-building constraints updated."
    )
    link = f"/lab/{slug}" if slug else None

    return {
        "type": TYPE_RULESET,
        "date": published_at,
        "version_label": label,
        "title": title,
        "summary": summary,
        "link": link,
    }


def _evaluation_entry(row: dict[str, Any]) -> dict[str, Any] | None:
    """Normalize one published Evaluation Version row, or None if unpublishable."""
    published_at = row.get("published_at")
    if not published_at:
        return None

    slug = row.get("slug") or "evaluation engine"
    note = (row.get("changelog_note") or "").strip()
    summary = note or (
        "The evaluation engine was updated. Team scores reflect the new model."
    )

    return {
        "type": TYPE_EVALUATION,
        "date": published_at,
        "version_label": slug,
        "title": f"Evaluation engine {slug}",
        "summary": summary,
        # Evaluation Versions are not a user-navigable surface.
        "link": None,
    }


def _snapshot_entry(row: dict[str, Any]) -> dict[str, Any] | None:
    """Normalize one published Snapshot Release row, or None if unpublishable."""
    published_at = row.get("published_at")
    if not published_at:
        return None

    season = (row.get("season") or "").strip()
    label = (row.get("label") or "").strip()

    # The season is what users recognize ("the 2025-26 pool"); the label is the
    # editorial name for that release. Prefer season for the headline, fall back
    # to the label so an entry never renders blank.
    version_label = season or label or "snapshot"
    title = f"{season} player snapshot".strip() if season else (label or "Player snapshot")
    summary = (
        f"A new player snapshot for the {season} season is live — "
        "refreshed ratings and the released player pool."
        if season
        else "A new player snapshot is live — refreshed ratings and the released player pool."
    )

    return {
        "type": TYPE_SNAPSHOT,
        "date": published_at,
        "version_label": version_label,
        "title": title,
        "summary": summary,
        # Snapshot Releases surface in the released player pool.
        "link": "/players",
    }


def assemble_changelog(
    ruleset_version_rows: list[dict[str, Any]],
    evaluation_version_rows: list[dict[str, Any]],
    snapshot_release_rows: list[dict[str, Any]] | None = None,
    limit: int = DEFAULT_LIMIT,
) -> list[dict[str, Any]]:
    """Merge published version rows into a newest-first changelog list.

    Args:
        ruleset_version_rows: published `ruleset_versions` rows, each carrying
            `version_label`, `published_at`, `ruleset_name`, `ruleset_slug`.
        evaluation_version_rows: published `evaluation_versions` rows, each
            carrying `slug`, `changelog_note`, `published_at`.
        snapshot_release_rows: published `snapshot_releases` rows, each carrying
            `label`, `season`, `published_at`. Optional so existing callers stay
            valid; defaults to no Snapshot Release entries.
        limit: maximum number of entries to return.

    Returns:
        A list of normalized changelog entry dicts, sorted by `date` descending.
        Rows missing `published_at` are dropped.
    """
    entries: list[dict[str, Any]] = []

    for row in ruleset_version_rows:
        entry = _ruleset_entry(row)
        if entry is not None:
            entries.append(entry)

    for row in evaluation_version_rows:
        entry = _evaluation_entry(row)
        if entry is not None:
            entries.append(entry)

    for row in snapshot_release_rows or []:
        entry = _snapshot_entry(row)
        if entry is not None:
            entries.append(entry)

    # Newest first. ISO-8601 timestamps sort correctly as strings when the
    # offset format is consistent; fall back to empty string defensively.
    entries.sort(key=lambda e: e.get("date") or "", reverse=True)

    if limit is not None and limit >= 0:
        return entries[:limit]
    return entries
