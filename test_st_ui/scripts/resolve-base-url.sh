#!/usr/bin/env bash
# Print Playwright base URL: CLI env > test_st_ui/.env > default local org host.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT="https://suhba.midad.local"

if [[ -n "${PLAYWRIGHT_BASE_URL:-}" ]]; then
  printf '%s\n' "${PLAYWRIGHT_BASE_URL}"
  exit 0
fi

if [[ -f "${ROOT}/.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "${ROOT}/.env"
  set +a
fi

printf '%s\n' "${PLAYWRIGHT_BASE_URL:-${DEFAULT}}"
