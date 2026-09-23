"""
One-shot script: publish Evaluation Version v11 for the #119 Legend clip
(M4.11).

Sets one values key, ``normalization_legend_clip_axes``, to the two defense
axes. ``composites.build_distributions`` then caps each Legend's raw composite
at the best active player's raw value on those axes only, so Legends stop
setting the top of the defense scale and an active defender's normalized value
stops being squashed toward the bottom (D6). A clipped Legend still normalizes
to 10.0 through the clamp — but Legend ratings DO move: the clip lowers the
empirical max of those two axes for everyone, and every Legend above the
breakpoint rises with it. Measured on dev (EV v10, release 8602ece7): 18 of 36
Legend `overall`s move by up to 2.40, and 13 of 36 Legend prices shift rank.

The axes are checked against ``cohesion_engine.weights.COMPOSITE_NAMES``, never
trusted as a literal: an axis the engine builds no distribution for would clip
nothing at all, and the published Version would silently claim a fix it does
not make.

A dry run is the default and writes nothing: it patches a copy of the current
draft (or the active Version) in memory, validates it, and prints the patch
operations plus any blocking violations. ``--publish`` does the real work —
reuse the open draft if one exists, else clone the active Version, patch it,
validate, and publish.

Usage:
    cd backend && source venv/bin/activate
    python scripts/publish_119_legend_clip.py            # dry run
    python scripts/publish_119_legend_clip.py --publish
"""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Iterable
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

# Register handlers before validation
import services.cohesion_engine.handlers.composites_v1  # noqa: F401,E402
import services.cohesion_engine.handlers.composites_v2  # noqa: F401,E402

from services.cohesion_engine.weights import COMPOSITE_NAMES  # noqa: E402
from services.evaluation_versions import repo, validator  # noqa: E402

VALUES_KEY = "normalization_legend_clip_axes"
CLIP_AXES: tuple[str, ...] = ("perimeter_defense", "interior_defense")

DEFAULT_SLUG = "cohesion-v11-legend-clip"
CHANGELOG = (
    "Clip each Legend's raw composite at the best active player's raw value on "
    "the two defense axes, perimeter_defense and interior_defense (#119). "
    "Legends are rated on the same 21-Skill taxonomy as actives and their raw "
    "defense values run past every active, which stretched the normalization "
    "and squashed active defenders toward the bottom of the scale. A clipped "
    "Legend still normalizes to 10.0 through the clamp, but Legend ratings do "
    "move: the clip lowers those two axes' empirical max for everyone, so "
    "every Legend above the breakpoint rises with it. Measured on dev before "
    "publishing, 18 of 36 Legend overalls move by up to 2.40 and 13 of 36 "
    "Legend prices shift rank. Offense axes are untouched."
)


def build_patch_ops(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """The JSON-Patch ops that set the clip axes. Empty when already set."""
    unknown = [a for a in CLIP_AXES if a not in COMPOSITE_NAMES]
    if unknown:
        raise ValueError(
            f"{unknown} are not composites in cohesion_engine.weights."
            "COMPOSITE_NAMES, so build_distributions builds no distribution "
            "for them and the clip would do nothing."
        )

    values = payload.get("values") or {}
    if list(values.get(VALUES_KEY) or []) == list(CLIP_AXES):
        return []
    # 'add' so the op lands whether or not the key exists yet.
    return [{"op": "add", "path": f"/values/{VALUES_KEY}", "value": list(CLIP_AXES)}]


def _patched(payload: dict[str, Any]) -> dict[str, Any]:
    """Dry-run mirror of repo.patch_draft for this script's single shallow op."""
    return {**payload, "values": {**(payload.get("values") or {}), VALUES_KEY: list(CLIP_AXES)}}


def next_free_slug(taken: Iterable[str], base: str = DEFAULT_SLUG) -> str:
    """`base` when it is free, else the first free `base-2`, `base-3`, ..."""
    taken = set(taken)
    if base not in taken:
        return base
    n = 2
    while f"{base}-{n}" in taken:
        n += 1
    return f"{base}-{n}"


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


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--publish",
        action="store_true",
        help="Actually create/patch the draft and publish it. Default is a dry run.",
    )
    parser.add_argument(
        "--slug",
        default=None,
        help=f"Slug to publish under (default: {DEFAULT_SLUG}, or the next free one).",
    )
    parser.add_argument(
        "--allow-prod",
        action="store_true",
        help="Permit a *.supabase.co SUPABASE_URL. This script is for dev.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    from dotenv import load_dotenv

    load_dotenv(BACKEND_DIR / ".env")
    url = os.environ.get("SUPABASE_URL", "")
    if ".supabase.co" in url and not args.allow_prod:
        print(f"REFUSED: SUPABASE_URL is the production cloud project ({url}).")
        print("This script publishes against dev. Pass --allow-prod only on purpose.")
        return 2

    draft = repo.get_draft()
    base = draft if draft is not None else repo.get_active()
    print(f"Base Version: {base.slug} (id={base.id}, status={base.status})")

    ops = build_patch_ops(base.payload)
    if not ops:
        print(f"\n{VALUES_KEY} already reads {list(CLIP_AXES)} — nothing to publish.")
        return 0

    print(f"\n{len(ops)} patch operation(s):")
    for op in ops:
        print(f"  {op['op']} {op['path']} = {op['value']}")

    taken = {v.slug for v in repo.list_versions()}
    slug = args.slug or next_free_slug(taken)
    if slug in taken:
        print(f"\nERROR: slug '{slug}' is already used. Free: {next_free_slug(taken)}")
        return 1
    print(f"Slug: {slug}")

    if not args.publish:
        print("\nDry run — validating in memory, writing nothing.")
        ok = _report(validator.validate(_patched(base.payload), CHANGELOG))
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

    published = repo.publish_draft(draft.id, slug, CHANGELOG)
    print(f"\nPublished: {published.slug} (id={published.id})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
