#!/usr/bin/env bash
# Trigger Render deploy hooks for an environment (dev|tst|prod).
set -euo pipefail

ENV_TARGET="${1:-}"
if [[ -z "${ENV_TARGET}" ]]; then
  echo "Usage: $0 <dev|tst|prod>"
  exit 1
fi

case "${ENV_TARGET}" in
  dev|tst|prod) ;;
  test) ENV_TARGET=tst ;;
  *)
    echo "Invalid environment: ${ENV_TARGET} (use dev, tst, or prod)"
    exit 1
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVOPS_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEPLOY_ENV="${DEVOPS_ROOT}/deploy/deploy.env"

if [[ ! -f "${DEPLOY_ENV}" ]]; then
  echo "Missing ${DEPLOY_ENV} — copy from deploy.env.example"
  exit 1
fi

# shellcheck source=/dev/null
source "${DEPLOY_ENV}"

ENV_UPPER="$(echo "${ENV_TARGET}" | tr '[:lower:]' '[:upper:]')"
HOOK_FE_VAR="RENDER_HOOK_${ENV_UPPER}_FE"
HOOK_BE_VAR="RENDER_HOOK_${ENV_UPPER}_BE"
HOOK_FE="${!HOOK_FE_VAR:-}"
HOOK_BE="${!HOOK_BE_VAR:-}"

trigger_hook() {
  local name="$1"
  local url="$2"
  if [[ -z "${url}" ]]; then
    echo "[render-deploy] SKIP ${name}: hook URL not set (${HOOK_FE_VAR} / ${HOOK_BE_VAR})"
    return 0
  fi
  echo "[render-deploy] Triggering ${name}..."
  if curl -fsS -X POST "${url}" >/dev/null; then
    echo "[render-deploy] OK ${name}"
  else
    echo "[render-deploy] FAIL ${name}"
    return 1
  fi
}

FAILED=0
trigger_hook "frontend" "${HOOK_FE}" || FAILED=1
trigger_hook "backend" "${HOOK_BE}" || FAILED=1

if [[ "${FAILED}" -ne 0 ]]; then
  echo "[render-deploy] One or more deploy hooks failed"
  exit 1
fi

echo "[render-deploy] Deploy triggered for ${ENV_TARGET}"
if [[ -n "${IMAGE_TAG:-}" ]]; then
  pkg_be="${GHCR_PACKAGE_BE:-ci_app_be}"
  pkg_fe="${GHCR_PACKAGE_FE:-ci_app_fe}"
  echo "[render-deploy] SHA tags (audit): ${pkg_be}:${IMAGE_TAG} ${pkg_fe}:${ENV_TARGET}-${IMAGE_TAG}"
  echo "[render-deploy] Render should use rolling tags (set once in dashboard): ${pkg_be}:${ENV_TARGET} ${pkg_fe}:${ENV_TARGET}"
fi
