#!/usr/bin/env bash
#
# Apply pending Supabase migrations to the self-hosted dev database on hestia.
#
# Keeps the dev DB in step with supabase/migrations/ so schema never drifts from
# what's in git. Idempotent: a migration already recorded in
# supabase_migrations.schema_migrations is skipped, so re-running is a no-op.
#
# Each migration is applied and recorded in ONE transaction — a failure rolls the
# whole file back rather than leaving the DB half-migrated and the ledger lying.
#
# Run by .github/workflows/deploy-dev.yml on every push to develop.
# Dev DB only. Production migrations go through `supabase db push`.

set -euo pipefail

CONTAINER="${DEV_DB_CONTAINER:-cornerstone-dev-db}"
ENV_FILE="${DEV_DB_ENV:-/srv/compose/cornerstone-dev-db/.env}"
MIGRATIONS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/supabase/migrations"

PGPASSWORD="$(grep '^POSTGRES_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
export PGPASSWORD

psql_do() {
  docker exec -i -e PGPASSWORD="$PGPASSWORD" "$CONTAINER" \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

# The ledger must exist before we can ask what's pending.
psql_do -q <<'SQL'
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  statements text[],
  name text
);
SQL

applied=0
skipped=0

for file in $(ls "$MIGRATIONS_DIR"/*.sql | sort); do
  base="$(basename "$file")"
  version="${base%%_*}"
  name="${base#*_}"; name="${name%.sql}"

  recorded="$(psql_do -tAc \
    "SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '$version';")"
  if [[ -n "$recorded" ]]; then
    skipped=$((skipped + 1))
    continue
  fi

  echo "applying $base"
  # BEGIN/COMMIT wrap the migration and its ledger row together: if the SQL fails,
  # ON_ERROR_STOP aborts the transaction and nothing is recorded.
  {
    echo "BEGIN;"
    cat "$file"
    echo ";"
    echo "INSERT INTO supabase_migrations.schema_migrations (version, name)
          VALUES ('$version', '$name') ON CONFLICT (version) DO NOTHING;"
    echo "COMMIT;"
  } | psql_do -q

  applied=$((applied + 1))
done

echo "migrations: $applied applied, $skipped already present"
