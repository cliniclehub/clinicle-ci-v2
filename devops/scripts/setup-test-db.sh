#!/usr/bin/env bash
# Create/reset the local pytest database (schema-only copy from the local app DB).
# Never drops or modifies SOURCE_DB data — only TEST_DB.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DB_USER="${DB_USER:-ci_user}"
DB_PASSWORD="${DB_PASSWORD:-ci_user}"
SOURCE_DB="${SOURCE_DB:-ci_db}"
TEST_DB="${TEST_DB:-ci_db_unit_test}"
FORCE="${FORCE:-0}"
DB_PORT="${POSTGRES_PORT:-5432}"
CONTAINER="${DB_CONTAINER:-}"
ADMIN_USER="${DB_ADMIN_USER:-}"
ADMIN_DB="${DB_ADMIN_DB:-}"

if [[ -z "${CONTAINER}" || -z "${ADMIN_USER}" || -z "${ADMIN_DB}" ]]; then
  # shellcheck source=/dev/null
  eval "$("${SCRIPT_DIR}/resolve-local-db-container.sh")"
  CONTAINER="${CONTAINER:-${LOCAL_DB_DOCKER_CONTAINER:-}}"
  ADMIN_USER="${ADMIN_USER:-${LOCAL_DB_ADMIN_USER:-${DB_USER}}}"
  ADMIN_DB="${ADMIN_DB:-${LOCAL_DB_ADMIN_DB:-${SOURCE_DB}}}"
fi

if [[ -z "${CONTAINER}" ]]; then
  echo "No local Postgres container found. Run: make start-db" >&2
  echo "Or set DB_CONTAINER / LOCAL_DB_CONTAINER=<running-postgres-container>" >&2
  exit 1
fi

if [[ "${TEST_DB}" == "${SOURCE_DB}" || "${TEST_DB}" == "ci_db" || "${TEST_DB}" == "app_db" ]]; then
  echo "Refusing to reset: TEST_DB ('${TEST_DB}') must not be the source/dev database." >&2
  exit 1
fi

if ! docker exec "${CONTAINER}" pg_isready -U "${ADMIN_USER}" -d "${ADMIN_DB}" >/dev/null 2>&1; then
  echo "Postgres not ready in container '${CONTAINER}'. Run: make start-db" >&2
  exit 1
fi

if ! docker exec "${CONTAINER}" psql -U "${ADMIN_USER}" -d "${ADMIN_DB}" -tAc \
  "SELECT 1 FROM pg_database WHERE datname = '${SOURCE_DB}'" | grep -q 1; then
  echo "Source database '${SOURCE_DB}' is missing in container '${CONTAINER}'." >&2
  exit 1
fi

exists="$(docker exec "${CONTAINER}" psql -U "${ADMIN_USER}" -d "${ADMIN_DB}" -tAc \
  "SELECT 1 FROM pg_database WHERE datname = '${TEST_DB}'" || true)"

if [[ -n "${exists}" && "${FORCE}" != "1" ]]; then
  echo "Test database ${TEST_DB} already exists (set FORCE=1 to reset from ${SOURCE_DB})."
  exit 0
fi

echo "Resetting ${TEST_DB} only (source ${SOURCE_DB} is untouched) — schema-only copy..."
docker exec "${CONTAINER}" psql -U "${ADMIN_USER}" -d "${ADMIN_DB}" -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${TEST_DB}' AND pid <> pg_backend_pid();" \
  >/dev/null
docker exec "${CONTAINER}" psql -U "${ADMIN_USER}" -d "${ADMIN_DB}" -c "DROP DATABASE IF EXISTS ${TEST_DB};"
docker exec "${CONTAINER}" psql -U "${ADMIN_USER}" -d "${ADMIN_DB}" -c \
  "CREATE DATABASE ${TEST_DB} OWNER ${DB_USER};"
docker exec -t "${CONTAINER}" pg_dump -U "${ADMIN_USER}" -d "${SOURCE_DB}" --schema-only --no-owner \
  | docker exec -i "${CONTAINER}" psql -U "${ADMIN_USER}" -d "${TEST_DB}" -q
# pg_dump --no-owner still creates objects as ADMIN_USER; hand everything to the app role.
docker exec "${CONTAINER}" psql -U "${ADMIN_USER}" -d "${TEST_DB}" -v ON_ERROR_STOP=1 -c \
  "DO \$\$
   DECLARE
     r record;
   BEGIN
     FOR r IN
       SELECT nspname
       FROM pg_namespace
       WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND nspname NOT LIKE 'pg_toast%'
         AND nspname NOT LIKE 'pg_temp%'
     LOOP
       EXECUTE format('GRANT ALL ON SCHEMA %I TO %I', r.nspname, '${DB_USER}');
       EXECUTE format('ALTER SCHEMA %I OWNER TO %I', r.nspname, '${DB_USER}');
       EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO %I', r.nspname, '${DB_USER}');
       EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA %I TO %I', r.nspname, '${DB_USER}');
       EXECUTE format('GRANT ALL ON ALL FUNCTIONS IN SCHEMA %I TO %I', r.nspname, '${DB_USER}');
     END LOOP;

     FOR r IN
       SELECT n.nspname AS schema_name, c.relname AS rel_name, c.relkind
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND n.nspname NOT LIKE 'pg_toast%'
         AND n.nspname NOT LIKE 'pg_temp%'
         AND c.relkind IN ('r', 'p', 'S', 'v', 'm')
     LOOP
       IF r.relkind = 'S' THEN
         EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO %I', r.schema_name, r.rel_name, '${DB_USER}');
       ELSIF r.relkind IN ('v') THEN
         EXECUTE format('ALTER VIEW %I.%I OWNER TO %I', r.schema_name, r.rel_name, '${DB_USER}');
       ELSIF r.relkind = 'm' THEN
         EXECUTE format('ALTER MATERIALIZED VIEW %I.%I OWNER TO %I', r.schema_name, r.rel_name, '${DB_USER}');
       ELSE
         EXECUTE format('ALTER TABLE %I.%I OWNER TO %I', r.schema_name, r.rel_name, '${DB_USER}');
       END IF;
     END LOOP;
   END
   \$\$;"
echo "Test database ready: postgresql://${DB_USER}:${DB_PASSWORD}@localhost:${DB_PORT}/${TEST_DB}"
