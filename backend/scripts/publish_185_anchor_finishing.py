"""
One-shot script: publish Evaluation Version v12 for the #185 anchor and
finishing route (M2).

Three changes to the ``values`` blob, all engine-readable today:

1. ``normalization_top_percentile`` = 0.98. ``composites._percentile_normalize``
   anchors the top of every axis scale on the single largest raw value in the
   pool, so one outlier squashes everyone else: Curry sets ``spacing`` at 40.0
   while the Elite Spot Up block sits at 8-9 and reads 6.8; Wembanyama sets
   ``interior_defense`` at 20.4 while Gobert's 10.7 reads 8.0. Anchoring on the
   98th percentile instead lets the block below the giraffe read as the block
   it is. The giraffe still reads 10.0 through the clamp.
2. ``composite_formulas.finishing.factors`` gains ``vertical_spacer`` 0.5 and
   ``pnr_finisher`` 0.35 beside ``crafty_finisher`` 1.3 and ``high_flyer`` 1.0,
   so a rim-runner is priced on his finishing, not only on shot creation.
3. ``overall_composite_weights`` and ``overall_mean_peak_blend`` are written
   explicitly, copied from today's resolved values (the blob carries neither
   and the engine falls back to ``weights.py``). No score moves from this
   alone; it makes the blob describe itself, so a future partial patch cannot
   silently drop axes (an early sweep collapsed Spearman to 0.14 that way).

The finishing factor keys are checked against ``services.skills.ALL_SKILLS``,
never trusted as a literal: ``tier_value`` reads a missing Skill as zero and
the route would price nothing while the published Version claimed it did.

A dry run is the default and writes nothing: it patches a copy of the current
draft (or the active Version) in memory, validates it, and prints the patch
operations plus any blocking violations. ``--publish`` does the real work:
reuse the open draft if one exists, else clone the active Version, patch it,
validate, and publish.

Usage:
    cd backend && source venv/bin/activate
    python scripts/publish_185_anchor_finishing.py            # dry run
    python scripts/publish_185_anchor_finishing.py --publish
"""

from __future__ import annotations

import argparse
import copy
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

from services.cohesion_engine.overall import overall_params_from_values  # noqa: E402
from services.evaluation_versions import repo, validator  # noqa: E402
from services.skills import ALL_SKILLS  # noqa: E402

ANCHOR_KEY = "normalization_top_percentile"
# ponytail: literal until weights.NORMALIZATION_TOP_PERCENTILE lands (M1); the
# target is a Version value, not the engine default, so the literal stays.
ANCHOR = 0.98
FINISHING_FACTORS: list[dict[str, Any]] = [
    {"key": "crafty_finisher", "type": "skill", "coefficient": 1.3},
    {"key": "high_flyer", "type": "skill", "coefficient": 1.0},
    {"key": "vertical_spacer", "type": "skill", "coefficient": 0.5},
    {"key": "pnr_finisher", "type": "skill", "coefficient": 0.35},
]
WEIGHTS_KEY = "overall_composite_weights"
BLEND_KEY = "overall_mean_peak_blend"

DEFAULT_SLUG = "cohesion-v12-anchor-finishing"
CHANGELOG = (
    "Anchor the top of every axis scale at the 98th percentile of the pool "
    "(normalization_top_percentile 0.98) instead of the single largest raw "
    "value, so one outlier (Curry 40.0 on spacing, Wembanyama 20.4 on "
    "interior_defense) no longer squashes the block below him. Add a finishing "
    "route: composite_formulas.finishing gains vertical_spacer 0.5 and "
    "pnr_finisher 0.35 beside crafty_finisher 1.3 and high_flyer 1.0, so "
    "rim-runners are priced on finishing. Write overall_composite_weights and "
    "overall_mean_peak_blend explicitly (today's resolved values, no score "
    "change) so the blob describes itself and a partial patch cannot drop "
    "axes. Measured on dev before publishing (release 020cbc9e, EV "
    "cohesion-v11-legend-clip): Gobert rank 218 -> 133, Allen 124 -> 71, "
    "Towns 77 -> 52, Holiday 23 -> 31; Ringer top 10 inside our top 15 9/10 "
    "(was 8/10); Spearman over the Ringer 100 0.730 (was 0.726); the stars "
    "hold (SGA 1, Giannis 2, Doncic 3, Wembanyama 4, Curry 5, Jokic 6). #185."
)


def _finishing_target(payload: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """(current finishing formula, the same object with factors replaced)."""
    formulas = (payload.get("values") or {}).get("composite_formulas") or {}
    current = formulas.get("finishing")
    if current is None:
        raise ValueError(
            "payload has no values.composite_formulas.finishing; this script "
            "only applies to a formulas-era Version."
        )
    return current, {**current, "factors": copy.deepcopy(FINISHING_FACTORS)}


def build_patch_ops(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """The JSON-Patch ops that set the anchor, route, weights and blend.

    Each op is skipped when its key already reads the target, so a second run
    on a patched Version emits nothing.
    """
    unknown = [f["key"] for f in FINISHING_FACTORS if f["key"] not in ALL_SKILLS]
    if unknown:
        raise ValueError(
            f"{unknown} are not Skills in services.skills.ALL_SKILLS, so "
            "tier_value would read them as zero and the finishing route "
            "would price nothing."
        )

    values = payload.get("values") or {}
    current_finishing, new_finishing = _finishing_target(payload)
    weights, blend = overall_params_from_values(values)

    targets = [
        ("add", f"/values/{ANCHOR_KEY}", values.get(ANCHOR_KEY), ANCHOR),
        ("replace", "/values/composite_formulas/finishing", current_finishing, new_finishing),
        ("add", f"/values/{WEIGHTS_KEY}", values.get(WEIGHTS_KEY), dict(weights)),
        ("add", f"/values/{BLEND_KEY}", values.get(BLEND_KEY), blend),
    ]
    return [
        {"op": op, "path": path, "value": target}
        for op, path, current, target in targets
        if current != target
    ]


def _patched(payload: dict[str, Any]) -> dict[str, Any]:
    """Dry-run mirror of repo.patch_draft: apply the ops to a deep copy."""
    out = copy.deepcopy(payload)
    for op in build_patch_ops(payload):
        parts = [p for p in op["path"].split("/") if p]
        target = out
        for part in parts[:-1]:
            target = target[part]
        target[parts[-1]] = op["value"]
    return out


def _describe(op: dict[str, Any]) -> str:
    if op["path"].endswith("/finishing"):
        factors = ", ".join(f"{f['key']} {f['coefficient']}" for f in op["value"]["factors"])
        return f"{op['op']} {op['path']} factors=[{factors}]"
    return f"{op['op']} {op['path']} = {op['value']}"


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
        print("\nEvery key already reads its target — nothing to publish.")
        return 0

    print(f"\n{len(ops)} patch operation(s):")
    for op in ops:
        print(f"  {_describe(op)}")

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
