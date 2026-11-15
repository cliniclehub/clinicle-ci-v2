#!/usr/bin/env bash
# Run Playwright system tests. Invoked via: make test-st-ui-run [PROJECT=…] [SPEC=…] [HEADED=1] [SLOW=1] …
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

usage() {
  cat <<'EOF'
Usage (from repo root):
  make test-st-ui-run
  make test-st-ui-run PROJECT=smoke
  make test-st-ui-run PROJECT=security SPEC=tenant-isolation
  make test-st-ui-run SPEC=super-admin/platform
  make test-st-ui-run PROJECT=user GREP="user"
  make test-st-ui-run HEADED=1
  make test-st-ui-run SLOW=1
  make test-st-ui-run PROJECT=super-admin SPEC=platform SLOW=1
  make test-st-ui-run PROJECT=user DEBUG=1

No parameters — full suite, headless, fast.

Parameters:
  PROJECT   Playwright project (smoke, auth, security, user, org-admin, org-owner, super-admin, matrix-*)
  SPEC      Spec file (platform, super-admin/platform, tests/.../platform.spec.ts)
  GREP      Single test case — filter by title (Playwright -g)
  HEADED=1  Visible browser
  SLOW=1    Visible browser with slow-mo (default 500ms; override with PLAYWRIGHT_SLOW_MO=...)
  DEBUG=1   Playwright debug mode (step-through)

PAGE is a deprecated alias for SPEC.
EOF
}

normalize_project() {
  case "$1" in
    admin) printf '%s\n' org-admin ;;
    mobile) printf '%s\n' smoke-mobile ;;
    *) printf '%s\n' "$1" ;;
  esac
}

KNOWN_PROJECTS=(
  smoke smoke-mobile auth security
  user org-admin org-owner super-admin
  matrix-anonymous matrix-user matrix-org-admin matrix-org-owner matrix-super-admin
)

is_known_project() {
  local normalized
  normalized="$(normalize_project "$1")"
  local project
  for project in "${KNOWN_PROJECTS[@]}"; do
    if [[ "${project}" == "${normalized}" ]]; then
      printf '%s\n' "${normalized}"
      return 0
    fi
  done
  return 1
}

resolve_spec_path() {
  local spec_ref="$1"
  local project="${2:-}"

  # Full or partial path under tests/
  if [[ "${spec_ref}" == tests/* ]]; then
    if [[ "${spec_ref}" == *.spec.ts ]]; then
      printf '%s\n' "${spec_ref}"
    else
      printf '%s\n' "${spec_ref}.spec.ts"
    fi
    return 0
  fi

  if [[ "${spec_ref}" == *.spec.ts ]]; then
    if [[ -f "tests/${spec_ref}" ]]; then
      printf '%s\n' "tests/${spec_ref}"
      return 0
    fi
    if [[ -f "${spec_ref}" ]]; then
      printf '%s\n' "${spec_ref}"
      return 0
    fi
    echo "Spec not found: ${spec_ref}" >&2
    return 1
  fi

  # role-folder/spec (e.g. org-admin/courses)
  if [[ "${spec_ref}" == */* ]]; then
    local folder="${spec_ref%%/*}"
    local name="${spec_ref#*/}"
    name="${name%.spec.ts}"
    local spec="tests/${folder}/${name}.spec.ts"
    if [[ -f "${spec}" ]]; then
      printf '%s\n' "${spec}"
      return 0
    fi
    echo "Spec not found: ${spec}" >&2
    return 1
  fi

  # Bare spec name (e.g. courses, contact)
  local base="${spec_ref%.spec.ts}"

  if [[ -n "${project}" ]]; then
    local scoped="tests/${project}/${base}.spec.ts"
    if [[ -f "${scoped}" ]]; then
      printf '%s\n' "${scoped}"
      return 0
    fi
    echo "Spec not found: ${scoped}" >&2
    return 1
  fi

  matches=()
  while IFS= read -r match; do
    matches+=("${match}")
  done < <(find tests -path "*/${base}.spec.ts" | sort)
  if [[ "${#matches[@]}" -eq 1 ]]; then
    printf '%s\n' "${matches[0]}"
    return 0
  fi
  if [[ "${#matches[@]}" -gt 1 ]]; then
    echo "Multiple specs match SPEC=${spec_ref}:" >&2
    local match
    for match in "${matches[@]}"; do
      printf '  %s\n' "${match}" >&2
    done
    echo "Add PROJECT=... to pick the role folder." >&2
    return 1
  fi

  echo "Spec not found for SPEC=${spec_ref}" >&2
  return 1
}

infer_project_from_spec() {
  local spec="$1"
  local folder
  folder="$(basename "$(dirname "${spec}")")"
  if is_known_project "${folder}" >/dev/null; then
    is_known_project "${folder}"
    return 0
  fi
  case "${folder}" in
    smoke) printf '%s\n' smoke ;;
    public) printf '%s\n' public ;;
    auth) printf '%s\n' auth ;;
    *) return 1 ;;
  esac
}

PROJECT="${PROJECT:-${E2E_PROJECT:-}}"
SPEC="${SPEC:-${E2E_SPEC:-${PAGE:-${E2E_PAGE:-${TARGET:-${E2E_TARGET:-}}}}}}"
GREP="${GREP:-${E2E_GREP:-}}"
HEADED="${HEADED:-${E2E_HEADED:-}}"
SLOW="${SLOW:-${E2E_SLOW:-}}"
DEBUG="${DEBUG:-${E2E_DEBUG:-}}"

if [[ -n "${PROJECT}" ]]; then
  project_input="${PROJECT}"
  if ! PROJECT="$(is_known_project "${project_input}")"; then
    echo "Unknown PROJECT: ${project_input}" >&2
    echo "Known projects: ${KNOWN_PROJECTS[*]}" >&2
    exit 1
  fi
fi

args=()
spec=""

if [[ -n "${SPEC}" ]]; then
  spec="$(resolve_spec_path "${SPEC}" "${PROJECT}")"
  args+=("${spec}")
  if [[ -z "${PROJECT}" ]]; then
    if PROJECT="$(infer_project_from_spec "${spec}")"; then
      :
    else
      echo "Could not infer PROJECT from ${spec}; pass PROJECT=... explicitly." >&2
      exit 1
    fi
  fi
fi

if [[ -n "${PROJECT}" ]]; then
  args+=(--project="${PROJECT}")
fi

if [[ -n "${GREP}" ]]; then
  args+=(-g "${GREP}")
fi

slow_mo_env=()
slow_mo_ms=""
single_worker_env=()
if [[ "${SLOW}" == 1 || "${SLOW}" == true || "${SLOW}" == yes ]]; then
  HEADED=1
  slow_mo_ms="${PLAYWRIGHT_SLOW_MO:-500}"
  slow_mo_env=(PLAYWRIGHT_SLOW_MO="${slow_mo_ms}")
fi

run_mode="headless"
if [[ "${DEBUG}" == 1 || "${DEBUG}" == true || "${DEBUG}" == yes ]]; then
  args+=(--debug)
  run_mode="debug"
  args+=(--workers=1)
  single_worker_env=(ST_SINGLE_WORKER=1)
elif [[ "${HEADED}" == 1 || "${HEADED}" == true || "${HEADED}" == yes ]]; then
  args+=(--headed)
  args+=(--workers=1)
  single_worker_env=(ST_SINGLE_WORKER=1)
  if [[ -n "${slow_mo_ms}" ]]; then
    run_mode="headed + slow-mo (1 worker)"
  else
    run_mode="headed (1 worker)"
  fi
fi

base_url="$("${ROOT}/scripts/resolve-base-url.sh")"
echo "Running Playwright system tests against ${base_url}..."
echo "  mode:    ${run_mode}"
if [[ -z "${PROJECT}" && -z "${SPEC}" ]]; then
  echo "  scope:   full suite"
elif [[ -n "${PROJECT}" && -n "${SPEC}" ]]; then
  echo "  project: ${PROJECT}"
  echo "  spec:    ${spec}"
elif [[ -n "${PROJECT}" ]]; then
  echo "  project: ${PROJECT}"
else
  echo "  spec:    ${spec}"
  echo "  project: ${PROJECT} (inferred)"
fi
if [[ -n "${GREP}" ]]; then
  echo "  grep:    ${GREP}"
fi
if [[ -n "${slow_mo_ms}" ]]; then
  echo "  slow-mo: ${slow_mo_ms}ms"
fi

run_env=(env -u PLAYWRIGHT_BROWSERS_PATH)
if [[ "${#slow_mo_env[@]}" -gt 0 ]]; then
  run_env+=("${slow_mo_env[@]}")
fi
if [[ "${#single_worker_env[@]}" -gt 0 ]]; then
  run_env+=("${single_worker_env[@]}")
fi

if [[ "${#args[@]}" -gt 0 ]]; then
  exec "${run_env[@]}" npx playwright test "${args[@]}"
else
  exec "${run_env[@]}" npx playwright test
fi
