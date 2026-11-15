#!/usr/bin/env bash
# Security checks for deploy. Exit non-zero on failure.
#
# Tools:
#   Semgrep — code, secrets, supply-chain (source trees fe/ + be/)
#   Trivy   — HIGH/CRITICAL CVEs in local Docker images (post-build)
#
# Phases (SAST_PHASE):
#   code   — Semgrep only (run before images exist)
#   images — Trivy only (run after make build-docker; required gate)
#   all    — Semgrep then Trivy if images are present (standalone make sast)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVOPS_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${DEVOPS_ROOT}/.." && pwd)"

# shellcheck source=/dev/null
# deploy.env intentionally sets IMAGE_TAG= for Make auto-resolve; do not let that
# clobber a tag already provided by the caller (e.g. make sast-images IMAGE_TAG=…).
_PRESERVED_IMAGE_TAG="${IMAGE_TAG-}"
if [[ -f "${DEVOPS_ROOT}/deploy/deploy.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "${DEVOPS_ROOT}/deploy/deploy.env"
  set +a
fi
if [[ -n "${_PRESERVED_IMAGE_TAG}" ]]; then
  IMAGE_TAG="${_PRESERVED_IMAGE_TAG}"
fi
unset _PRESERVED_IMAGE_TAG

GIT_FE_REPO="${GIT_FE_REPO:-../fe}"
GIT_BE_REPO="${GIT_BE_REPO:-../be}"
# Space- or comma-separated Semgrep registry packs (default: CI + secrets + supply chain)
SEMGREP_CONFIG="${SEMGREP_CONFIG:-p/ci p/secrets p/supply-chain}"

resolve_repo_dir() {
  local rel="$1"
  local fallback="$2"
  if [[ "${rel}" == /* ]]; then
    echo "${rel}"
    return
  fi
  if [[ -d "${DEVOPS_ROOT}/${rel}" ]]; then
    echo "$(cd "${DEVOPS_ROOT}/${rel}" && pwd)"
    return
  fi
  if [[ -d "${REPO_ROOT}/${fallback}" ]]; then
    echo "${REPO_ROOT}/${fallback}"
    return
  fi
  echo ""
}

FE_DIR="$(resolve_repo_dir "${GIT_FE_REPO}" "fe")"
BE_DIR="$(resolve_repo_dir "${GIT_BE_REPO}" "be")"

SAST_SKIP="${SAST_SKIP:-0}"
SAST_SKIP_IMAGE="${SAST_SKIP_IMAGE:-0}"
# code | images | all
SAST_PHASE="${SAST_PHASE:-all}"
ENV_NAME="${ENV:-dev}"
IMAGE_TAG="${IMAGE_TAG:-}"
TRIVY_SEVERITY="${TRIVY_SEVERITY:-HIGH,CRITICAL}"

if [[ "${SAST_SKIP}" == "1" ]]; then
  echo "[sast] SAST_SKIP=1 — skipping all checks"
  exit 0
fi

# Back-compat: sast-pr / early deploy set SAST_SKIP_IMAGE=1 → code-only
if [[ "${SAST_SKIP_IMAGE}" == "1" && "${SAST_PHASE}" == "all" ]]; then
  SAST_PHASE="code"
fi

FAILED=0
RAN_ANY_REQUIRED=0
warn() { echo "[sast] WARN: $*"; }
fail() { echo "[sast] FAIL: $*"; FAILED=1; }
ok() { echo "[sast] OK: $*"; }

resolve_semgrep() {
  if command -v semgrep >/dev/null 2>&1; then
    echo "semgrep"
    return
  fi
  if [[ -n "${BE_DIR}" && -x "${BE_DIR}/.venv/bin/semgrep" ]]; then
    echo "${BE_DIR}/.venv/bin/semgrep"
    return
  fi
  echo ""
}

# Build --config args from SEMGREP_CONFIG (supports "p/ci p/secrets" or "p/ci,p/secrets")
SEMGREP_CONFIG_ARGS=()
build_semgrep_config_args() {
  SEMGREP_CONFIG_ARGS=()
  local normalized="${SEMGREP_CONFIG//,/ }"
  local cfg
  for cfg in ${normalized}; do
    [[ -n "${cfg}" ]] && SEMGREP_CONFIG_ARGS+=(--config "${cfg}")
  done
}

run_semgrep_in_dir() {
  local label="$1"
  local dir="$2"
  local target="${3:-.}"
  local semgrep_bin="$4"
  shift 4
  local extra_flags=("$@")

  if [[ -z "${dir}" || ! -d "${dir}" ]]; then
    fail "semgrep: ${label} directory missing"
    return 1
  fi

  build_semgrep_config_args
  if [[ "${#SEMGREP_CONFIG_ARGS[@]}" -eq 0 ]]; then
    fail "semgrep: no configs in SEMGREP_CONFIG"
    return 1
  fi

  echo "[sast] semgrep (${label}): ${dir} → ${target} [${SEMGREP_CONFIG}]"
  (
    cd "${dir}"
    local -a scan_cmd=(
      "${semgrep_bin}" scan "${SEMGREP_CONFIG_ARGS[@]}" --error --quiet
    )
    if ((${#extra_flags[@]} > 0)); then
      scan_cmd+=( "${extra_flags[@]}" )
    fi
    scan_cmd+=( "${target}" )
    "${scan_cmd[@]}"
  )
}

run_semgrep_phase() {
  echo "[sast] FE_DIR=${FE_DIR:-<missing>}"
  echo "[sast] BE_DIR=${BE_DIR:-<missing>}"
  echo "[sast] SEMGREP_CONFIG=${SEMGREP_CONFIG}"
  echo "[sast] === Semgrep (code + secrets + supply chain) ==="

  local semgrep_bin
  semgrep_bin="$(resolve_semgrep)"
  if [[ -z "${semgrep_bin}" ]]; then
    fail "semgrep not installed — brew install semgrep OR: make setup-sast"
    return
  fi

  RAN_ANY_REQUIRED=1
  local semgrep_failed=0
  if [[ -n "${FE_DIR}" ]]; then
    if ! run_semgrep_in_dir "frontend" "${FE_DIR}" "." "${semgrep_bin}"; then
      semgrep_failed=1
    fi
  else
    fail "frontend source not found for semgrep"
    semgrep_failed=1
  fi
  if [[ -n "${BE_DIR}" ]]; then
    if ! run_semgrep_in_dir "backend" "${BE_DIR}" "." "${semgrep_bin}" --exclude .venv; then
      semgrep_failed=1
    fi
  else
    fail "backend source not found for semgrep"
    semgrep_failed=1
  fi
  if [[ "${semgrep_failed}" -eq 0 ]]; then
    ok "semgrep (${SEMGREP_CONFIG}) on frontend + backend"
  else
    fail "semgrep reported findings — see output above"
  fi
}

# strict=1 → missing trivy/images/owner fails the gate (deploy post-build)
# strict=0 → warn and skip when images are not ready (standalone make sast)
run_trivy_phase() {
  local strict="${1:-0}"

  echo "[sast] === Trivy (container HIGH/CRITICAL) ==="
  echo "[sast] ENV=${ENV_NAME} IMAGE_TAG=${IMAGE_TAG:-<unset>} severity=${TRIVY_SEVERITY}"

  if [[ -z "${IMAGE_TAG}" || "${IMAGE_TAG}" == "local" || "${IMAGE_TAG}" == "unknown" ]]; then
    if [[ "${strict}" == "1" ]]; then
      fail "IMAGE_TAG required for Trivy (got '${IMAGE_TAG:-}')"
    else
      echo "[sast] IMAGE_TAG unset — skipping Trivy (run after make build-docker)"
    fi
    return
  fi

  if ! command -v trivy >/dev/null 2>&1; then
    if [[ "${strict}" == "1" ]]; then
      fail "trivy not installed — brew install trivy (required for deploy image gate)"
    else
      warn "trivy not installed — brew install trivy"
    fi
    return
  fi

  local ghcr_owner="${GHCR_OWNER:-}"
  local pkg_be="${GHCR_PACKAGE_BE:-ci_app_be}"
  local pkg_fe="${GHCR_PACKAGE_FE:-ci_app_fe}"
  if [[ -z "${ghcr_owner}" || "${ghcr_owner}" == "your-github-username" || "${ghcr_owner}" == "your-github-user-or-organization" ]]; then
    if [[ "${strict}" == "1" ]]; then
      fail "GHCR_OWNER not configured in devops/deploy/deploy.env — cannot resolve image names for Trivy"
    else
      warn "GHCR_OWNER not configured — skipping Trivy"
    fi
    return
  fi

  local be_image="ghcr.io/${ghcr_owner}/${pkg_be}:${IMAGE_TAG}"
  local fe_image="ghcr.io/${ghcr_owner}/${pkg_fe}:${ENV_NAME}-${IMAGE_TAG}"
  local trivy_ignore="${DEVOPS_ROOT}/.trivyignore"
  local img
  local scanned=0

  RAN_ANY_REQUIRED=1
  for img in "${be_image}" "${fe_image}"; do
    if ! docker image inspect "${img}" >/dev/null 2>&1; then
      if [[ "${strict}" == "1" ]]; then
        fail "image not local for Trivy: ${img} (build first)"
      else
        warn "image not local, skipping Trivy: ${img}"
      fi
      continue
    fi
    scanned=1
    echo "[sast] trivy image --severity ${TRIVY_SEVERITY} --pkg-types library ${img}"
    local -a trivy_args=(
      image
      --severity "${TRIVY_SEVERITY}"
      --exit-code 1
      --pkg-types library
      --skip-dirs /usr/local/lib/node_modules/npm
    )
    if [[ -f "${trivy_ignore}" ]]; then
      trivy_args+=(--ignorefile "${trivy_ignore}")
    fi
    trivy_args+=("${img}")
    if trivy "${trivy_args[@]}"; then
      ok "trivy ${img}"
    else
      fail "trivy found ${TRIVY_SEVERITY} issues in ${img}"
    fi
  done

  if [[ "${strict}" == "1" && "${scanned}" -eq 0 && "${FAILED}" -eq 0 ]]; then
    fail "Trivy ran but no images were scanned"
  fi
}

echo "[sast] SAST_PHASE=${SAST_PHASE}"

case "${SAST_PHASE}" in
  code)
    run_semgrep_phase
    ;;
  images)
    run_trivy_phase 1
    ;;
  all)
    run_semgrep_phase
    if [[ "${SAST_SKIP_IMAGE}" == "1" ]]; then
      echo "[sast] SAST_SKIP_IMAGE=1 — skipping Trivy"
    else
      run_trivy_phase 0
    fi
    ;;
  *)
    fail "unknown SAST_PHASE=${SAST_PHASE} (use code|images|all)"
    ;;
esac

if [[ "${SAST_PHASE}" == "code" || "${SAST_PHASE}" == "all" ]]; then
  if [[ "${RAN_ANY_REQUIRED}" -eq 0 ]]; then
    fail "no frontend or backend repo found — cannot run semgrep"
  fi
fi

if [[ "${FAILED}" -ne 0 ]]; then
  echo ""
  echo "[sast] === Summary ==="
  echo "[sast] FAILED — deploy blocked until fixed or SAST_SKIP=1 (emergency only)."
  case "${SAST_PHASE}" in
    code)
      echo "[sast] Fix Semgrep findings in fe/ and be/ (code, secrets, dependencies)."
      echo "[sast] Config packs: SEMGREP_CONFIG=\"${SEMGREP_CONFIG}\""
      ;;
    images)
      echo "[sast] Fix HIGH/CRITICAL CVEs in BE/FE images, rebuild, or SAST_SKIP_IMAGE=1 to bypass Trivy."
      echo "[sast] Install: brew install trivy"
      ;;
    all)
      echo "[sast] Fix Semgrep and/or Trivy findings above."
      ;;
  esac
  exit 1
fi

echo "[sast] All required checks passed"
exit 0
