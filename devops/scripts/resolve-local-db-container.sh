#!/usr/bin/env bash
# Resolve a local Postgres Docker container for Makefile DB targets.
#
# Prints KEY=VALUE lines:
#   LOCAL_DB_DOCKER_CONTAINER
#   LOCAL_DB_ADMIN_USER
#   LOCAL_DB_ADMIN_DB
#   LOCAL_DB_VIA   (compose|container|none)
#
# Resolution order:
#   1. Compose service "db" in devops/docker-compose.yaml (if running)
#   2. LOCAL_DB_CONTAINER env override
#   3. First running container publishing LOCAL_DB_PORT (default 5432)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVOPS_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${DEVOPS_ROOT}/docker-compose.yaml"
LOCAL_DB_PORT="${LOCAL_DB_PORT:-${POSTGRES_PORT:-5432}}"
LOCAL_DB_CONTAINER="${LOCAL_DB_CONTAINER:-}"
LOCAL_DB_USER="${LOCAL_DB_USER:-ci_user}"
LOCAL_DB_NAME="${LOCAL_DB_NAME:-ci_db}"

compose_cmd() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    docker compose -f "${COMPOSE_FILE}" "$@"
  else
    docker-compose -f "${COMPOSE_FILE}" "$@"
  fi
}

container_env() {
  local container="$1" key="$2"
  docker inspect --format "{{range .Config.Env}}{{println .}}{{end}}" "$container" 2>/dev/null \
    | awk -F= -v k="$key" '$1 == k { print $2; exit }'
}

emit() {
  local container="$1" via="$2"
  local admin_user admin_db
  admin_user="$(container_env "$container" POSTGRES_USER)"
  admin_db="$(container_env "$container" POSTGRES_DB)"
  if [ -z "$admin_user" ]; then
    admin_user="${LOCAL_DB_USER}"
  fi
  if [ -z "$admin_db" ]; then
    admin_db="${LOCAL_DB_NAME}"
  fi
  printf 'LOCAL_DB_DOCKER_CONTAINER=%s\n' "$container"
  printf 'LOCAL_DB_ADMIN_USER=%s\n' "$admin_user"
  printf 'LOCAL_DB_ADMIN_DB=%s\n' "$admin_db"
  printf 'LOCAL_DB_VIA=%s\n' "$via"
}

# 1) Compose service db
if [ -f "${COMPOSE_FILE}" ]; then
  compose_id="$(compose_cmd ps -q db 2>/dev/null || true)"
  if [ -n "${compose_id}" ]; then
    running="$(docker inspect -f '{{.State.Running}}' "${compose_id}" 2>/dev/null || echo false)"
    if [ "${running}" = "true" ]; then
      name="$(docker inspect -f '{{.Name}}' "${compose_id}" | sed 's#^/##')"
      emit "$name" compose
      exit 0
    fi
  fi
fi

# 2) Explicit override
if [ -n "${LOCAL_DB_CONTAINER}" ]; then
  if ! docker inspect "${LOCAL_DB_CONTAINER}" >/dev/null 2>&1; then
    echo "LOCAL_DB_CONTAINER='${LOCAL_DB_CONTAINER}' was not found." >&2
    exit 1
  fi
  running="$(docker inspect -f '{{.State.Running}}' "${LOCAL_DB_CONTAINER}" 2>/dev/null || echo false)"
  if [ "${running}" != "true" ]; then
    echo "LOCAL_DB_CONTAINER='${LOCAL_DB_CONTAINER}' is not running." >&2
    exit 1
  fi
  emit "${LOCAL_DB_CONTAINER}" container
  exit 0
fi

# 3) Container publishing the local Postgres port
published="$(
  docker ps --format '{{.Names}}\t{{.Ports}}' 2>/dev/null \
    | awk -v port=":${LOCAL_DB_PORT}->" '
        index($0, port) { print $1; exit }
      '
)"
if [ -n "${published}" ]; then
  emit "${published}" container
  exit 0
fi

printf 'LOCAL_DB_DOCKER_CONTAINER=\n'
printf 'LOCAL_DB_ADMIN_USER=\n'
printf 'LOCAL_DB_ADMIN_DB=\n'
printf 'LOCAL_DB_VIA=none\n'
exit 1
