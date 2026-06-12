"""
Evaluation Version taxonomy compat check.

Compares the taxonomy footprint of two Evaluation Version payloads — the one a
Saved Team was scored under and the active one — and classifies the difference
per taxonomy dimension (Skills, Impact Traits, Subscores) into:

  - ``added``    keys present only in the active Version
  - ``removed``  keys present only in the stored Version
  - ``renamed``  keys present in both whose label changed in place

Per ADR-0002 the check runs when a user opens a Saved Team as a Build in the Lab.
If no taxonomy dimension differs (only ``values`` changed), the diff reports
``needs_resolution = False`` so re-evaluation proceeds without a dialog.
"""

from __future__ import annotations

from typing import Any


def _skill_footprint(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Flatten Skills to a {key: entry} map."""
    taxonomy = payload.get("taxonomy") or {}
    return _index_entries(taxonomy.get("skills") or [])


def _impact_trait_footprint(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Flatten Impact Traits to a {key: entry} map keyed by stable key."""
    taxonomy = payload.get("taxonomy") or {}
    return _index_entries(taxonomy.get("impact_traits") or [])


def _flatten_subscores(node: Any) -> list[dict[str, Any]]:
    """Recursively collect leaf Subscore entries from a Subscore Tree.

    The tree nests categories that hold either ``subscores`` leaves directly or
    intermediate ``subcategories``; both shapes appear across published v1
    payloads, so we walk both keys at any depth.
    """
    collected: list[dict[str, Any]] = []
    if isinstance(node, list):
        for child in node:
            collected.extend(_flatten_subscores(child))
        return collected
    if isinstance(node, dict):
        for child_key in ("subcategories", "subscores"):
            if child_key in node:
                collected.extend(_flatten_subscores(node[child_key]))
        # A leaf Subscore carries a key but no further nesting.
        if node.get("key") and "subscores" not in node and "subcategories" not in node:
            collected.append(node)
    return collected


def _subscore_footprint(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Flatten the Subscore Tree leaves to a {key: entry} map."""
    taxonomy = payload.get("taxonomy") or {}
    return _index_entries(_flatten_subscores(taxonomy.get("subscore_tree") or []))


def _index_entries(entries: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Index a list of taxonomy entries by their ``key``, last write wins."""
    indexed: dict[str, dict[str, Any]] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        key = entry.get("key")
        if not key:
            continue
        indexed[key] = {"key": key, "label": entry.get("label")}
    return indexed


def _diff_footprints(
    stored: dict[str, dict[str, Any]],
    active: dict[str, dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    """Classify two key→entry footprints into added / removed / renamed."""
    added = [active[key] for key in active if key not in stored]
    removed = [stored[key] for key in stored if key not in active]
    renamed = [
        {
            "key": key,
            "from_label": stored[key].get("label"),
            "to_label": active[key].get("label"),
        }
        for key in stored
        if key in active and stored[key].get("label") != active[key].get("label")
    ]
    return {
        "added": sorted(added, key=lambda e: e["key"]),
        "removed": sorted(removed, key=lambda e: e["key"]),
        "renamed": sorted(renamed, key=lambda e: e["key"]),
    }


def diff_taxonomy(
    stored_payload: dict[str, Any],
    active_payload: dict[str, Any],
) -> dict[str, Any]:
    """Diff two Evaluation Version payloads by taxonomy footprint."""
    dimensions = {
        "skills": (_skill_footprint(stored_payload), _skill_footprint(active_payload)),
        "impact_traits": (
            _impact_trait_footprint(stored_payload),
            _impact_trait_footprint(active_payload),
        ),
        "subscores": (
            _subscore_footprint(stored_payload),
            _subscore_footprint(active_payload),
        ),
    }

    result: dict[str, Any] = {}
    totals = {"added": 0, "removed": 0, "renamed": 0}
    for name, (stored_fp, active_fp) in dimensions.items():
        diff = _diff_footprints(stored_fp, active_fp)
        result[name] = diff
        for bucket in totals:
            totals[bucket] += len(diff[bucket])

    result["summary"] = totals
    result["needs_resolution"] = any(totals.values())
    return result
