#!/usr/bin/env python3
"""Lint Supabase migrations for SECURITY DEFINER lockdown.

Every `CREATE [OR REPLACE] FUNCTION ... SECURITY DEFINER` in
`supabase/migrations/*.sql` must be paired in the same file with either:

  (a) `REVOKE EXECUTE ON FUNCTION <name>(...) FROM PUBLIC`, or
  (b) an opt-out comment immediately above the CREATE block of the form
      `-- secdef-lint: allow-public reason=<short text>`

Postgres grants EXECUTE to PUBLIC by default for SECURITY DEFINER functions,
and Supabase additionally auto-grants `anon` and `authenticated`. Without an
explicit REVOKE, any caller with the project's anon key can invoke the RPC.

Usage:
    python backend/scripts/lint_migrations.py [path/to/migrations]

Exit codes:
    0  all SECURITY DEFINER functions are locked down or explicitly exempted
    1  one or more violations found
    2  invocation error (bad path, no migrations directory)
"""
from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path

CREATE_FN_RE = re.compile(
    r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(?P<name>[a-zA-Z_][a-zA-Z0-9_]*)\s*\(",
    re.IGNORECASE,
)
SECDEF_RE = re.compile(r"\bSECURITY\s+DEFINER\b", re.IGNORECASE)
REVOKE_PUBLIC_RE = re.compile(
    r"REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+(?:public\.)?(?P<name>[a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*\)\s+FROM\s+PUBLIC",
    re.IGNORECASE,
)
ALLOW_COMMENT_RE = re.compile(
    r"--\s*secdef-lint:\s*allow-public\s+reason=", re.IGNORECASE
)


@dataclass(frozen=True)
class Violation:
    file: Path
    function: str
    line: int
    message: str

    def format(self, root: Path) -> str:
        rel = self.file.relative_to(root) if self.file.is_relative_to(root) else self.file
        return f"{rel}:{self.line}: {self.function}: {self.message}"


def _strip_comments(sql: str) -> str:
    """Blank out SQL line and block comments while preserving offsets and
    newlines, so regex matches inside comments don't fire but original line
    numbers stay accurate."""
    out = list(sql)
    i = 0
    n = len(sql)
    while i < n:
        ch = sql[i]
        if ch == "-" and i + 1 < n and sql[i + 1] == "-":
            j = sql.find("\n", i)
            j = n if j == -1 else j
            for k in range(i, j):
                out[k] = " "
            i = j
        elif ch == "/" and i + 1 < n and sql[i + 1] == "*":
            j = sql.find("*/", i + 2)
            j = n if j == -1 else j + 2
            for k in range(i, j):
                if sql[k] != "\n":
                    out[k] = " "
            i = j
        else:
            i += 1
    return "".join(out)


def _function_blocks(sql: str) -> list[tuple[str, int, int]]:
    """Return (name, line_no, start_offset) for every CREATE FUNCTION, ignoring
    matches inside SQL comments."""
    code_only = _strip_comments(sql)
    hits: list[tuple[str, int, int]] = []
    for m in CREATE_FN_RE.finditer(code_only):
        name = m.group("name")
        line_no = sql.count("\n", 0, m.start()) + 1
        hits.append((name, line_no, m.start()))
    return hits


def _is_security_definer(sql: str, start: int, next_start: int | None) -> bool:
    end = next_start if next_start is not None else len(sql)
    return SECDEF_RE.search(sql, start, end) is not None


def _has_opt_out(sql: str, create_start: int) -> bool:
    """Look backward from CREATE for an allow-public comment within a small
    window (skipping blank lines but stopping at non-comment, non-blank lines)."""
    line_start = sql.rfind("\n", 0, create_start) + 1
    cursor = line_start
    for _ in range(6):  # scan up to 6 preceding lines
        prev_line_end = cursor - 1
        if prev_line_end <= 0:
            return False
        prev_line_start = sql.rfind("\n", 0, prev_line_end) + 1
        line = sql[prev_line_start:prev_line_end].strip()
        if not line:
            cursor = prev_line_start
            continue
        if ALLOW_COMMENT_RE.search(line):
            return True
        if not line.startswith("--"):
            return False
        cursor = prev_line_start
    return False


def _revoked_public_names(sql: str) -> set[str]:
    return {m.group("name").lower() for m in REVOKE_PUBLIC_RE.finditer(sql)}


def lint_file(path: Path) -> list[Violation]:
    sql = path.read_text(encoding="utf-8")
    blocks = _function_blocks(sql)
    if not blocks:
        return []
    revoked = _revoked_public_names(sql)
    violations: list[Violation] = []
    for idx, (name, line_no, start) in enumerate(blocks):
        next_start = blocks[idx + 1][2] if idx + 1 < len(blocks) else None
        if not _is_security_definer(sql, start, next_start):
            continue
        if name.lower() in revoked:
            continue
        if _has_opt_out(sql, start):
            continue
        violations.append(
            Violation(
                file=path,
                function=name,
                line=line_no,
                message=(
                    "SECURITY DEFINER function missing "
                    "`REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC` "
                    "(or `-- secdef-lint: allow-public reason=...` opt-out)"
                ),
            )
        )
    return violations


def main(argv: list[str]) -> int:
    if len(argv) > 2:
        print(f"usage: {argv[0]} [migrations_dir]", file=sys.stderr)
        return 2

    repo_root = Path(__file__).resolve().parents[2]
    default_dir = repo_root / "supabase" / "migrations"
    migrations_dir = Path(argv[1]).resolve() if len(argv) == 2 else default_dir

    if not migrations_dir.is_dir():
        print(f"error: migrations directory not found: {migrations_dir}", file=sys.stderr)
        return 2

    sql_files = sorted(migrations_dir.glob("*.sql"))
    if not sql_files:
        print(f"warning: no .sql files in {migrations_dir}", file=sys.stderr)
        return 0

    all_violations: list[Violation] = []
    for path in sql_files:
        all_violations.extend(lint_file(path))

    if all_violations:
        print(
            f"secdef-lint: {len(all_violations)} violation(s) "
            f"across {len({v.file for v in all_violations})} file(s):",
            file=sys.stderr,
        )
        for v in all_violations:
            print(f"  {v.format(repo_root)}", file=sys.stderr)
        print(
            "\nFix: add `REVOKE EXECUTE ON FUNCTION public.<fn>(<args>) FROM PUBLIC` "
            "in the same migration, or add `-- secdef-lint: allow-public reason=...` "
            "directly above the CREATE FUNCTION block.",
            file=sys.stderr,
        )
        return 1

    print(f"secdef-lint: {len(sql_files)} migration(s) clean.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
