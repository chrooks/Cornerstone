"""
One-shot backfill: fold existing position values onto the canonical enum.

Normalizes ``position`` across players, legends, and released_players using
services.positions.normalize_position — the same normalizer now applied at the
ingestion boundary, so this only fixes rows written before standardization.

Idempotent: re-running changes nothing once data is canonical.

Usage:
    cd backend && source venv/bin/activate
    python scripts/normalize_positions.py            # DRY RUN — prints planned changes
    python scripts/normalize_positions.py --apply    # writes the changes
"""

from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.positions import normalize_position  # noqa: E402
from services.supabase_client import get_supabase  # noqa: E402

# (table, primary key column)
_TARGETS = [
    ("players", "id"),
    ("legends", "id"),
    ("released_players", "id"),
]


def _plan(sb, table: str, pk: str) -> list[tuple]:
    """Return [(pk_value, old, new), ...] for rows whose position would change."""
    rows = sb.table(table).select(f"{pk}, position").execute().data or []
    changes = []
    for r in rows:
        old = r.get("position")
        new = normalize_position(old)
        if new != old:
            changes.append((r[pk], old, new))
    return changes


def main(apply: bool) -> None:
    sb = get_supabase()
    grand_total = 0

    for table, pk in _TARGETS:
        changes = _plan(sb, table, pk)
        grand_total += len(changes)
        summary = Counter((old, new) for _, old, new in changes)

        print(f"\n=== {table} === {len(changes)} row(s) to normalize")
        for (old, new), n in sorted(summary.items(), key=lambda x: -x[1]):
            print(f"  {repr(old):16} -> {repr(new):8} {n}")

        if apply and changes:
            for pk_value, _old, new in changes:
                sb.table(table).update({"position": new}).eq(pk, pk_value).execute()
            print(f"  applied {len(changes)} update(s).")

    print(f"\nTOTAL: {grand_total} row(s) {'updated' if apply else 'would change'}.")
    if not apply:
        print("Dry run — re-run with --apply to write.")


if __name__ == "__main__":
    main(apply="--apply" in sys.argv)
