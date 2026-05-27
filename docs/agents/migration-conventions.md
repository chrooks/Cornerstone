# Migration conventions

## SECURITY DEFINER lockdown

Every `SECURITY DEFINER` function in `public.*` must REVOKE `EXECUTE` from
`PUBLIC`, `anon`, and `authenticated`, then GRANT `EXECUTE` only to
`service_role`. The default Postgres grant is `EXECUTE` to `PUBLIC`, and
Supabase additionally auto-grants `anon` and `authenticated` directly — so
without explicit REVOKEs the RPC is callable via `POST /rest/v1/rpc/<fn>` by
anyone holding the project's anon key.

### Canonical block

```sql
REVOKE EXECUTE ON FUNCTION public.<fn>(<arg_types>) FROM anon;
REVOKE EXECUTE ON FUNCTION public.<fn>(<arg_types>) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.<fn>(<arg_types>) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.<fn>(<arg_types>) TO service_role;
COMMENT ON FUNCTION public.<fn>(<arg_types>) IS
  '<short purpose>. SECURITY DEFINER; executable only by service_role.';
```

Use the type-only signature (`uuid, text, boolean`) — not the named-parameter
form — to avoid mismatches with how Postgres stores the function ACL.

### Opt-out

In the rare case a broader grant is intentional (e.g., a function that *must*
be callable by `authenticated` for an end-user feature, with explicit auth
checks inside the body), add an opt-out comment directly above the
`CREATE FUNCTION` block:

```sql
-- secdef-lint: allow-public reason=<short justification>
CREATE OR REPLACE FUNCTION public.<fn>(...)
```

The reason is required and should explain why the function is safely callable
by the broader role.

## Linter

`backend/scripts/lint_migrations.py` scans every `supabase/migrations/*.sql`
and fails when a `SECURITY DEFINER` function is missing either the REVOKE
block or the opt-out comment.

Run manually:

```bash
python backend/scripts/lint_migrations.py
```

Or install the pre-commit hook (one-time setup per checkout):

```bash
pip install pre-commit
pre-commit install
```

The hook runs the linter whenever a `supabase/migrations/*.sql` file is
staged.

## Migration ordering

Migrations are timestamped `YYYYMMDDhhmmss_<slug>.sql`. New migrations use the
next sequential timestamp after the latest file in `supabase/migrations/`.
`supabase db push` applies pending files in filename order.

## Function-body changes vs ACL changes

- **ACL-only changes** (REVOKE/GRANT) are safe as standalone migrations and
  are idempotent.
- **Return-type changes** require `DROP FUNCTION ... ; CREATE FUNCTION ...`
  because `CREATE OR REPLACE` cannot change the return type. See
  `supabase/migrations/20260527000007_commit_pipeline_run_rpc_hardening.sql`
  for the canonical pattern.
