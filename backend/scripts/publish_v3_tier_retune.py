"""
One-shot script: publish Evaluation Version v3 with retuned tier values.

Creates a draft from the active v2, patches tier_values and theoretical_max
to match the 0/1/4/8/16 scale, validates, and publishes as cohesion-v3.

Usage:
    cd backend && source venv/bin/activate
    python scripts/publish_v3_tier_retune.py
"""

from __future__ import annotations

import sys
from pathlib import Path

# Add backend to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Register handlers before validation
import services.cohesion_engine.handlers.composites_v1  # noqa: F401

from services.cohesion_engine.weights import TIER_VALUES, THEORETICAL_MAX
from services.evaluation_versions import repo, validator


def main() -> None:
    # Check for existing draft
    existing_draft = repo.get_draft()
    if existing_draft is not None:
        print(f"ERROR: Draft already exists ({existing_draft.slug}). Discard it first.")
        sys.exit(1)

    # Show current active version
    active = repo.get_active()
    print(f"Active version: {active.slug} (id={active.id})")
    current_tv = active.payload["values"]["tier_values"]
    print(f"  Current tier_values: {current_tv}")

    if current_tv == TIER_VALUES:
        print("Already up to date — nothing to publish.")
        return

    # Create draft from active
    print("\nCreating draft...")
    draft = repo.create_draft_from_published()
    print(f"  Draft created: {draft.slug} (id={draft.id})")

    # Build patch operations
    patch_ops: list[dict] = []
    for tier, value in TIER_VALUES.items():
        patch_ops.append({
            "op": "replace",
            "path": f"/values/tier_values/{tier}",
            "value": value,
        })
    for composite, value in THEORETICAL_MAX.items():
        patch_ops.append({
            "op": "replace",
            "path": f"/values/theoretical_max/{composite}",
            "value": value,
        })

    print(f"\nApplying {len(patch_ops)} patch operations...")
    draft = repo.patch_draft(draft.id, patch_ops)
    print(f"  Patched. New tier_values: {draft.payload['values']['tier_values']}")

    # Validate
    changelog = "Retune Skill Tier values to 0/1/4/8/16 and recompute theoretical maxima."
    violations = validator.validate(draft.payload, changelog)
    errors = [v for v in violations if v.severity == "error"]
    if errors:
        print(f"\nERROR: {len(errors)} publish gate violations:")
        for v in errors:
            print(f"  [{v.layer}] {v.message}")
        print("\nDraft left in place for inspection. Discard manually if needed.")
        sys.exit(1)

    warnings = [v for v in violations if v.severity == "warning"]
    if warnings:
        print(f"\n{len(warnings)} warning(s):")
        for v in warnings:
            print(f"  [{v.layer}] {v.message}")

    print("\nValidation passed. Publishing...")
    published = repo.publish_draft(draft.id, "cohesion-v3", changelog)
    print(f"  Published: {published.slug} (id={published.id})")
    print("\nDone.")


if __name__ == "__main__":
    main()
