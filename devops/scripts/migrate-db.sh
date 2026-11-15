#!/usr/bin/env bash
# Apply numbered SQL migrations under devops/db-migrations/ (local + Render).
# Tracks applied files in <APP_SCHEMA>.schema_migrations so re-runs are skipped.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVOPS_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${DEVOPS_ROOT}/.." && pwd)"
MIGRATIONS_DIR="${DEVOPS_ROOT}/db-migrations"
DEPLOY_ENV_FILE="${DEVOPS_ROOT}/deploy/deploy.env"

LOCAL_DB_HOST="${LOCAL_DB_HOST:-localhost}"
LOCAL_DB_PORT="${LOCAL_DB_PORT:-5432}"
LOCAL_DB_USER="${LOCAL_DB_USER:-ci_user}"
LOCAL_DB_NAME="${LOCAL_DB_NAME:-ci_db}"
LOCAL_DB_TARGET="${LOCAL_DB_TARGET:-}"
LOCAL_DB_CONTAINER="${LOCAL_DB_CONTAINER:-}"
APP_SCHEMA="${APP_SCHEMA:-${DB_SCHEMA:-${LOCAL_APP_SCHEMA:-ci}}}"

RENDER_DB_USER="${RENDER_DB_USER:-app_user}"
RENDER_DB_PORT="${RENDER_DB_PORT:-5432}"
RENDER_INT_HOST="${RENDER_INT_HOST:-}"
RENDER_INT_DB="${RENDER_INT_DB:-app_db_int}"
RENDER_TST_HOST="${RENDER_TST_HOST:-}"
RENDER_TST_DB="${RENDER_TST_DB:-app_db_tst}"
RENDER_PRD_HOST="${RENDER_PRD_HOST:-}"
RENDER_PRD_DB="${RENDER_PRD_DB:-app_db_prd}"

TARGET="${TARGET:-}"
FILE="${FILE:-}"
DRY_RUN="${DRY_RUN:-0}"
YES="${MIGRATE_YES:-${YES:-0}}"
RECORD_ONLY="${RECORD_ONLY:-0}"
STATUS_ONLY=0
LIST_ONLY=0
DEPLOY_MODE=0

usage() {
  cat <<'EOF'
Apply numbered SQL migrations from devops/db-migrations/NNN_*.sql (or a specific FILE).

Usage:
  migrate-db.sh [--target local|int|tst|prod|render|all] [--file PATH]
                [--dry-run] [--yes] [--record-only] [--status] [--list-migrations]
                [--deploy]

  make migrate-db TARGET=all
  make migrate-db TARGET=prod FILE=devops/db-migrations/001_example.sql
  make migrate-db-status TARGET=int
  make migrate-dev / migrate-test / migrate-prd   # prompt [y/N] per env
  make migrate-all                                # prompt [y/N] for dev, test, prod

Targets:
  local     Local Docker Postgres (ci_db, or LOCAL_DB_TARGET=...)
  int|dev   Render integration
  tst|test  Render test
  prod|prd  Render production (type 'yes' unless --yes / MIGRATE_YES=1)
  render    int + tst + prod
  all       local + int + tst + prod

Flags:
  --file PATH        Apply one SQL file (root migrations or archive/ for catch-up)
  --dry-run          Print what would run; still connects to report applied status
  --yes              Skip production confirmation (MIGRATE_YES=1)
  --record-only      Mark file(s) applied without executing SQL (catch-up)
  --status           Show applied vs unapplied for the target(s)
  --list-migrations  Print migration SQL filenames and exit
  --deploy           Legacy flag (no-op for deploy coupling; deploy no longer runs migrations)

Migrations are separate from make deploy-* — use make migrate-dev / migrate-test / migrate-prd.
EOF
}

log() { echo "[migrate-db] $*"; }
die() { echo "[migrate-db] ERROR: $*" >&2; exit 1; }

if [[ -f "${DEPLOY_ENV_FILE}" ]]; then
  set +u
  # shellcheck source=/dev/null
  source "${DEPLOY_ENV_FILE}"
  set -u
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --target) TARGET="${2:-}"; shift 2 ;;
    --file) FILE="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --yes) YES=1; shift ;;
    --record-only) RECORD_ONLY=1; shift ;;
    --status) STATUS_ONLY=1; shift ;;
    --list-migrations|--list-pending) LIST_ONLY=1; shift ;;
    --deploy) DEPLOY_MODE=1; shift ;;
    *) die "Unknown argument: $1 (see --help)" ;;
  esac
done

file_checksum() {
  local path="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$path" | awk '{print $1}'
  else
    shasum -a 256 "$path" | awk '{print $1}'
  fi
}

sql_escape() {
  printf "%s" "$1" | sed "s/'/''/g"
}

migration_sql_files() {
  local f base
  shopt -s nullglob
  for f in "${MIGRATIONS_DIR}"/*.sql; do
    base="$(basename "$f")"
    if [[ "$base" =~ ^[0-9]{3}_.+\.sql$ ]]; then
      printf '%s\n' "$f"
    fi
  done | LC_ALL=C sort
}

list_migrations() {
  local files file
  files="$(migration_sql_files || true)"
  if [[ -z "${files}" ]]; then
    log "No migration SQL in ${MIGRATIONS_DIR} (expected NNN_name.sql)"
    return 0
  fi
  log "Migration SQL:"
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    echo "  - $(basename "$file")"
  done <<< "$files"
}

normalize_target() {
  case "$1" in
    local) echo local ;;
    int|integration|dev) echo int ;;
    tst|test) echo tst ;;
    prod|prd|production) echo prod ;;
    render) echo render ;;
    all) echo all ;;
    "") echo "" ;;
    *) die "Invalid target '$1' (use local|int|tst|prod|render|all)" ;;
  esac
}

expand_targets() {
  case "$1" in
    local) echo local ;;
    int) echo int ;;
    tst) echo tst ;;
    prod) echo prod ;;
    render) printf '%s\n' int tst prod ;;
    all) printf '%s\n' local int tst prod ;;
    *) die "Cannot expand target '$1'" ;;
  esac
}

target_label() {
  case "$1" in
    local) echo "local (${LOCAL_DB_TARGET:-$LOCAL_DB_NAME})" ;;
    int) echo "integration (${RENDER_INT_DB})" ;;
    tst) echo "test (${RENDER_TST_DB})" ;;
    prod) echo "production (${RENDER_PRD_DB})" ;;
  esac
}

password_for_target() {
  local target="$1"
  if [[ -n "${RENDER_DB_PASSWORD:-}" ]]; then
    printf '%s' "${RENDER_DB_PASSWORD}"
    return 0
  fi
  case "$target" in
    int) printf '%s' "${RENDER_DEV_DB_PASSWORD:-}" ;;
    tst) printf '%s' "${RENDER_TST_DB_PASSWORD:-}" ;;
    prod) printf '%s' "${RENDER_PROD_DB_PASSWORD:-}" ;;
    *) printf '%s' "" ;;
  esac
}

prompt_password() {
  local target="$1" pw=""
  if [[ ! -t 0 ]]; then
    die "No password for $(target_label "$target"). Set RENDER_*_DB_PASSWORD in deploy.env"
  fi
  read -rs -p "[migrate-db] Password for $(target_label "$target"): " pw
  echo "" >&2
  printf '%s' "$pw"
}

# Sets: conn_mode (docker|psql), db_host, db_port, db_user, db_name, db_password
# For local docker: also sets db_container
resolve_conn() {
  local target="$1"
  db_password=""
  db_container=""
  case "$target" in
    local)
      conn_mode="docker"
      db_host="${LOCAL_DB_HOST}"
      db_port="${LOCAL_DB_PORT}"
      db_user="${LOCAL_DB_USER}"
      db_name="${LOCAL_DB_TARGET:-$LOCAL_DB_NAME}"
      local resolve_out
      if ! resolve_out="$(
        LOCAL_DB_PORT="${LOCAL_DB_PORT}" \
        LOCAL_DB_CONTAINER="${LOCAL_DB_CONTAINER:-}" \
        LOCAL_DB_USER="${LOCAL_DB_USER}" \
        LOCAL_DB_NAME="${LOCAL_DB_NAME}" \
        "${SCRIPT_DIR}/resolve-local-db-container.sh"
      )"; then
        die "Local Postgres container not found. Run: make start-db (or set LOCAL_DB_CONTAINER=...)"
      fi
      # shellcheck disable=SC2086
      eval "${resolve_out}"
      db_container="${LOCAL_DB_DOCKER_CONTAINER}"
      # Prefer configured app role when it can connect; otherwise container admin.
      if ! docker exec "${db_container}" psql -U "${db_user}" -d "${db_name}" -c 'SELECT 1' >/dev/null 2>&1; then
        db_user="${LOCAL_DB_ADMIN_USER}"
      fi
      ;;
    int)
      conn_mode="psql"
      db_host="${RENDER_INT_HOST}"
      db_port="${RENDER_DB_PORT}"
      db_user="${RENDER_DB_USER}"
      db_name="${RENDER_INT_DB}"
      db_password="$(password_for_target int)"
      ;;
    tst)
      conn_mode="psql"
      db_host="${RENDER_TST_HOST}"
      db_port="${RENDER_DB_PORT}"
      db_user="${RENDER_DB_USER}"
      db_name="${RENDER_TST_DB}"
      db_password="$(password_for_target tst)"
      ;;
    prod)
      conn_mode="psql"
      db_host="${RENDER_PRD_HOST}"
      db_port="${RENDER_DB_PORT}"
      db_user="${RENDER_DB_USER}"
      db_name="${RENDER_PRD_DB}"
      db_password="$(password_for_target prod)"
      ;;
    *) die "Unknown target '$target'" ;;
  esac
  if [[ "$conn_mode" == "psql" && -z "$db_host" ]]; then
    die "No host configured for $(target_label "$target"). Set the matching RENDER_*_HOST value in deploy.env"
  fi
  if [[ "$conn_mode" == "psql" && -z "$db_password" ]]; then
    db_password="$(prompt_password "$target")"
  fi
}

run_psql() {
  # Remaining args are passed to psql. SQL may be on stdin.
  if [[ "$conn_mode" == "docker" ]]; then
    if ! docker exec "${db_container}" pg_isready -U "$db_user" -d "$db_name" >/dev/null 2>&1; then
      die "Local Postgres not ready for ${db_name} in ${db_container}. Run: make start-db"
    fi
    docker exec -i "${db_container}" psql -U "$db_user" -d "$db_name" -v ON_ERROR_STOP=1 "$@"
  else
    command -v psql >/dev/null 2>&1 || die "psql not found. Install: brew install libpq && brew link --force libpq"
    PGPASSWORD="$db_password" PGSSLMODE=require \
      psql -h "$db_host" -p "$db_port" -U "$db_user" -d "$db_name" -v ON_ERROR_STOP=1 "$@"
  fi
}

ensure_tracker() {
  # APP_SCHEMA is validated as a simple identifier before interpolation.
  if [[ ! "${APP_SCHEMA}" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
    die "Invalid APP_SCHEMA '${APP_SCHEMA}' (expected a simple SQL identifier)"
  fi
  run_psql -q <<SQL
SET client_min_messages TO WARNING;
CREATE SCHEMA IF NOT EXISTS ${APP_SCHEMA};
CREATE TABLE IF NOT EXISTS ${APP_SCHEMA}.schema_migrations (
    version TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    applied_by TEXT
);
COMMENT ON TABLE ${APP_SCHEMA}.schema_migrations IS
  'SQL files applied by devops/scripts/migrate-db.sh; version is the filename.';
SQL
}

applied_checksum() {
  local version="$1"
  local escaped
  escaped="$(sql_escape "$version")"
  run_psql -tAc "SELECT checksum FROM ${APP_SCHEMA}.schema_migrations WHERE version = '${escaped}';" | tr -d '[:space:]'
}

list_applied() {
  run_psql -c "SELECT \"version\", applied_at, left(checksum, 12) AS checksum FROM ${APP_SCHEMA}.schema_migrations ORDER BY applied_at;"
}

record_applied() {
  local version="$1" checksum="$2"
  local escaped_version escaped_checksum
  escaped_version="$(sql_escape "$version")"
  escaped_checksum="$(sql_escape "$checksum")"
  run_psql -q -c "INSERT INTO ${APP_SCHEMA}.schema_migrations (version, checksum, applied_by) VALUES ('${escaped_version}', '${escaped_checksum}', 'migrate-db.sh') ON CONFLICT (version) DO NOTHING;"
}

resolve_sql_files() {
  local path files
  if [[ -n "$FILE" ]]; then
    if [[ "$FILE" = /* ]]; then
      path="$FILE"
    else
      path="${REPO_ROOT}/${FILE}"
    fi
    [[ -f "$path" ]] || die "SQL file not found: $FILE"
    printf '%s\n' "$path"
    return 0
  fi
  files="$(migration_sql_files || true)"
  if [[ -z "$files" ]]; then
    return 0
  fi
  printf '%s\n' "$files"
}

confirm_prod() {
  local answer
  if [[ "$YES" == "1" ]]; then
    log "Production confirmation skipped (MIGRATE_YES=1)"
    return 0
  fi
  if [[ ! -t 0 ]]; then
    die "Refusing to migrate production without a TTY. Re-run with MIGRATE_YES=1 after review."
  fi
  echo ""
  log "WARNING: about to change PRODUCTION (${RENDER_PRD_DB})"
  read -r -p "[migrate-db] Type 'yes' to continue: " answer
  if [[ "$answer" != "yes" ]]; then
    die "Production migration cancelled"
  fi
}

apply_one_file() {
  local target="$1" sql_path="$2"
  local version checksum existing
  version="$(basename "$sql_path")"
  checksum="$(file_checksum "$sql_path")"
  existing="$(applied_checksum "$version" || true)"

  if [[ -n "$existing" ]]; then
    if [[ "$existing" != "$checksum" ]]; then
      die "${version} already applied on $(target_label "$target") with a different checksum. Add a new numbered migration instead of editing the applied one."
    fi
    log "SKIP ${version} on $(target_label "$target") (already applied)"
    return 0
  fi

  if [[ "$DRY_RUN" == "1" ]]; then
    log "DRY-RUN would apply ${version} → $(target_label "$target")"
    return 0
  fi

  if [[ "$RECORD_ONLY" == "1" ]]; then
    record_applied "$version" "$checksum"
    log "RECORDED ${version} on $(target_label "$target") (SQL not executed)"
    return 0
  fi

  log "Applying ${version} → $(target_label "$target")"
  run_psql < "$sql_path"
  record_applied "$version" "$checksum"
  log "OK ${version} on $(target_label "$target")"
}

migrate_target() {
  local target="$1"
  local sql_files sql_path count=0

  resolve_conn "$target"
  if [[ "$target" == "prod" && "$STATUS_ONLY" != "1" && "$DRY_RUN" != "1" ]]; then
    confirm_prod
  fi

  log "Target $(target_label "$target") via ${conn_mode}"
  ensure_tracker

  if [[ "$STATUS_ONLY" == "1" ]]; then
    echo ""
    log "Applied on $(target_label "$target"):"
    list_applied
    echo ""
    log "Unapplied migration files on this DB:"
    sql_files="$(resolve_sql_files || true)"
    if [[ -z "$sql_files" ]]; then
      echo "  (none)"
      return 0
    fi
    while IFS= read -r sql_path; do
      [[ -z "$sql_path" ]] && continue
      version="$(basename "$sql_path")"
      existing="$(applied_checksum "$version" || true)"
      if [[ -z "$existing" ]]; then
        echo "  - ${version}"
        count=$((count + 1))
      fi
    done <<< "$sql_files"
    if [[ "$count" -eq 0 ]]; then
      echo "  (none — migration files already recorded)"
    fi
    return 0
  fi

  sql_files="$(resolve_sql_files || true)"
  if [[ -z "$sql_files" ]]; then
    log "No SQL files to apply on $(target_label "$target")"
    return 0
  fi

  while IFS= read -r sql_path; do
    [[ -z "$sql_path" ]] && continue
    apply_one_file "$target" "$sql_path"
  done <<< "$sql_files"
}

prompt_target() {
  local choice
  echo ""
  log "Select database target:"
  echo "  1. Local (Docker)"
  echo "  2. Integration (Render)"
  echo "  3. Test (Render)"
  echo "  4. Production (Render)"
  echo "  5. All Render (int + tst + prod)"
  echo "  6. All (local + Render)"
  echo ""
  read -r -p "[migrate-db] Enter selection (1-6): " choice
  case "$choice" in
    1) TARGET=local ;;
    2) TARGET=int ;;
    3) TARGET=tst ;;
    4) TARGET=prod ;;
    5) TARGET=render ;;
    6) TARGET=all ;;
    *) die "Invalid selection" ;;
  esac
}

prompt_file_if_needed() {
  local files file_num=0 selection path
  [[ -n "$FILE" ]] && return 0
  files="$(migration_sql_files || true)"
  if [[ -z "$files" ]]; then
    return 0
  fi
  echo ""
  log "SQL to apply:"
  echo "  0. All migrations"
  while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    file_num=$((file_num + 1))
    echo "  ${file_num}. $(basename "$path")"
  done <<< "$files"
  echo ""
  read -r -p "[migrate-db] Enter selection (0-${file_num}): " selection
  if [[ "$selection" == "0" ]]; then
    FILE=""
    return 0
  fi
  if [[ "$selection" -ge 1 && "$selection" -le "$file_num" ]] 2>/dev/null; then
    FILE="$(echo "$files" | sed -n "${selection} p")"
    return 0
  fi
  die "Invalid selection"
}

if [[ "$LIST_ONLY" == "1" ]]; then
  list_migrations
  exit 0
fi

TARGET="$(normalize_target "$TARGET")"

if [[ -z "$TARGET" ]]; then
  if [[ "$DEPLOY_MODE" == "1" ]]; then
    die "Deploy mode requires --target"
  fi
  if [[ ! -t 0 ]]; then
    die "Set TARGET=local|int|tst|prod|render|all (non-interactive)"
  fi
  prompt_target
  TARGET="$(normalize_target "$TARGET")"
  if [[ "$STATUS_ONLY" != "1" ]]; then
    prompt_file_if_needed
  fi
fi

if [[ "$STATUS_ONLY" != "1" && -z "$FILE" && -z "$(migration_sql_files || true)" ]]; then
  log "No migration SQL in ${MIGRATIONS_DIR} (expected NNN_name.sql)"
  exit 0
fi

targets="$(expand_targets "$TARGET")"
log "Plan: $(echo "$targets" | tr '\n' ' ')"
if [[ -n "$FILE" ]]; then
  log "File: $FILE"
else
  list_migrations
fi

while IFS= read -r one; do
  [[ -z "$one" ]] && continue
  echo ""
  migrate_target "$one"
done <<< "$targets"

log "Done."
