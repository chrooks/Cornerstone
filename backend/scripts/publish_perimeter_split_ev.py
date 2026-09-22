"""
One-shot script: publish Evaluation Version v10 for the #152 Perimeter
Disruptor split (M3.14).

Patches the taxonomy (``perimeter_disruptor`` becomes
``point_of_attack_defender``, ``off_ball_disruptor`` is appended, orders
renumbered), the two new composite coefficients, and the declarative
``perimeter_defense`` formula.

The coefficients are read from ``cohesion_engine.weights`` and the formula from
``cohesion_engine.formula_export``, never from a literal in this file, so the
published Version cannot disagree with the engine that scores the Lab.

A dry run is the default and writes nothing: it patches a copy of the current
draft (or the active Version) in memory and validates it. ``--publish`` does the
real work — reuse the open draft if one exists, else clone the active Version,
patch it, validate, and publish.

Usage:
    cd backend && source venv/bin/activate
    python scripts/publish_perimeter_split_ev.py            # dry run
    python scripts/publish_perimeter_split_ev.py --publish
"""

from __future__ import annotations

import argparse
import copy
import sys
from pathlib import Path
from typing import Any

# Add backend to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Register handlers before validation
import services.cohesion_engine.handlers.composites_v1  # noqa: F401,E402
import services.cohesion_engine.handlers.composites_v2  # noqa: F401,E402

from services.cohesion_engine.formula_export import export_formulas  # noqa: E402
from services.cohesion_engine.weights import COMPOSITE_COEFFICIENTS  # noqa: E402
from services.evaluation_versions import repo, validator  # noqa: E402
from services.skills import SKILL_DEFINITIONS  # noqa: E402

OLD_SKILL = "perimeter_disruptor"
ON_BALL_SKILL = "point_of_attack_defender"
OFF_BALL_SKILL = "off_ball_disruptor"
SPLIT_COEFFICIENT_KEYS = ("perimeter_defense_poa", "perimeter_defense_off_ball")

DEFAULT_SLUG = "cohesion-v10-perimeter-split"
CHANGELOG = (
    "Split Perimeter Disruptor into Point of Attack Defender (on-ball) and "
    "Off-Ball Disruptor (off-ball) (#152). perimeter_defense becomes "
    "0.6*POA + 0.4*OBD + 0.7*VD, falling back to 1.0*POA + 0.7*VD when a "
    "player has no off-ball rating, so a pre-split profile scores unchanged. "
    "Saved Teams scored under an earlier Version show the ADR-0002 taxonomy "
    "compat dialog when reopened in the Lab."
)


def split_coefficients() -> dict[str, float]:
    """The two new coefficients, straight from the engine's weights."""
    missing = [k for k in SPLIT_COEFFICIENT_KEYS if k not in COMPOSITE_COEFFICIENTS]
    if missing:
        raise ValueError(
            f"cohesion_engine.weights.COMPOSITE_COEFFICIENTS is missing {missing}. "
            "The engine side of the split (M3.6) must land before this Version "
            "can be published."
        )
    return {k: COMPOSITE_COEFFICIENTS[k] for k in SPLIT_COEFFICIENT_KEYS}


def _split_taxonomy(skills: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Replace the old Skill in place, append the off-ball Skill, renumber."""
    keys = [s.get("key") for s in skills]
    if OLD_SKILL not in keys:
        raise ValueError(
            f"taxonomy.skills has no '{OLD_SKILL}' entry — this Version is "
            "already split, or is not the one this script was written for."
        )
    for new_key in (ON_BALL_SKILL, OFF_BALL_SKILL):
        if new_key not in SKILL_DEFINITIONS:
            raise ValueError(
                f"services.skills.SKILL_DEFINITIONS is missing '{new_key}'. "
                "The taxonomy side of the split (M3.2) must land first."
            )

    out = [
        {**s, "key": ON_BALL_SKILL, "label": SKILL_DEFINITIONS[ON_BALL_SKILL]}
        if s.get("key") == OLD_SKILL
        else copy.deepcopy(s)
        for s in skills
    ]
    if OFF_BALL_SKILL not in keys:
        out.append({"key": OFF_BALL_SKILL, "label": SKILL_DEFINITIONS[OFF_BALL_SKILL]})
    return [{**s, "order": i} for i, s in enumerate(out)]


def build_patch_ops(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Build the JSON-Patch ops that turn `payload` into the split Version."""
    new_coefficients = split_coefficients()
    values = payload.get("values") or {}
    merged = {**(values.get("composite_coefficients") or {}), **new_coefficients}

    ops: list[dict[str, Any]] = [
        {
            "op": "replace",
            "path": "/taxonomy/skills",
            "value": _split_taxonomy((payload.get("taxonomy") or {}).get("skills") or []),
        }
    ]
    for key, value in new_coefficients.items():
        ops.append({
            "op": "replace",
            "path": f"/values/composite_coefficients/{key}",
            "value": value,
        })

    formulas = export_formulas(merged)
    if values.get("composite_formulas"):
        ops.append({
            "op": "replace",
            "path": "/values/composite_formulas/perimeter_defense",
            "value": formulas["perimeter_defense"],
        })
    else:
        # A payload predating the declarative formulas gets the whole map.
        ops.append({
            "op": "replace",
            "path": "/values/composite_formulas",
            "value": formulas,
        })
    return ops


def _apply_in_memory(payload: dict[str, Any], ops: list[dict[str, Any]]) -> dict[str, Any]:
    """Apply the ops to a copy of `payload`. Dry-run mirror of repo.patch_draft.

    # ponytail: the ops this script builds are all shallow replaces, so a full
    # JSON Pointer implementation would be dead weight.
    """
    out = copy.deepcopy(payload)
    for op in ops:
        parts = [p for p in op["path"].split("/") if p]
        target = out
        for part in parts[:-1]:
            target = target.setdefault(part, {})
        target[parts[-1]] = op["value"]
    return out


def _report(violations: list) -> bool:
    """Print violations. Returns True when nothing blocks a publish."""
    errors = [v for v in violations if v.severity == "error"]
    warnings = [v for v in violations if v.severity == "warning"]
    for v in warnings:
        print(f"  warning [{v.layer}] {v.message}")
    for v in errors:
        print(f"  ERROR   [{v.layer}] {v.message}")
    if errors:
        print(f"\n{len(errors)} blocking violation(s).")
        return False
    print(f"\nNo blocking violations ({len(warnings)} warning(s)).")
    return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--publish",
        action="store_true",
        help="Actually create/patch the draft and publish it. Default is a dry run.",
    )
    parser.add_argument(
        "--slug",
        default=DEFAULT_SLUG,
        help=f"Slug to publish under (default: {DEFAULT_SLUG}). Pass the next free "
             "slug if that one is taken.",
    )
    args = parser.parse_args(argv)

    draft = repo.get_draft()
    base = draft if draft is not None else repo.get_active()
    print(f"Base Version: {base.slug} (id={base.id}, status={base.status})")

    ops = build_patch_ops(base.payload)
    print(f"\n{len(ops)} patch operation(s):")
    for op in ops:
        print(f"  {op['op']} {op['path']}")

    if not args.publish:
        print("\nDry run — validating in memory, writing nothing.")
        ok = _report(validator.validate(_apply_in_memory(base.payload, ops), CHANGELOG))
        print("\nRe-run with --publish to apply." if ok else "\nFix the errors first.")
        return 0 if ok else 1

    if draft is None:
        print("\nNo open draft — cloning the active Version...")
        draft = repo.create_draft_from_published()
        print(f"  Draft created: {draft.slug} (id={draft.id})")
    else:
        print(f"\nReusing the open draft {draft.slug} (id={draft.id}).")

    draft = repo.patch_draft(draft.id, ops)
    print("  Patched.")

    if not _report(validator.validate(draft.payload, CHANGELOG)):
        print("Draft left in place for inspection. Discard manually if needed.")
        return 1

    published = repo.publish_draft(draft.id, args.slug, CHANGELOG)
    print(f"\nPublished: {published.slug} (id={published.id})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
