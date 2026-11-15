#!/usr/bin/env bash
# Print IMAGE_TAG (short git SHA) from GIT_DEPLOY_BRANCH in the monorepo.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVOPS_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${DEVOPS_ROOT}/.." && pwd)"

# deploy.env leaves IMAGE_TAG= empty for auto-resolve; preserve a caller-provided tag.
# Makefile defaults IMAGE_TAG=local (and export it); treat local/unknown as unset so
# resolve-tag can still compute the branch short SHA for build/push/Trivy.
_PRESERVED_IMAGE_TAG="${IMAGE_TAG-}"
if [[ -f "${DEVOPS_ROOT}/deploy/deploy.env" ]]; then
    # shellcheck source=/dev/null
    source "${DEVOPS_ROOT}/deploy/deploy.env"
fi
if [[ -n "${_PRESERVED_IMAGE_TAG}" \
    && "${_PRESERVED_IMAGE_TAG}" != "local" \
    && "${_PRESERVED_IMAGE_TAG}" != "unknown" ]]; then
  IMAGE_TAG="${_PRESERVED_IMAGE_TAG}"
elif [[ "${IMAGE_TAG:-}" == "local" || "${IMAGE_TAG:-}" == "unknown" ]]; then
  IMAGE_TAG=""
fi
unset _PRESERVED_IMAGE_TAG

GIT_DEPLOY_BRANCH="${GIT_DEPLOY_BRANCH:-dev}"
GIT_REPO="${GIT_REPO:-${REPO_ROOT}}"

if [[ -n "${IMAGE_TAG:-}" && "${IMAGE_TAG}" != "local" && "${IMAGE_TAG}" != "unknown" ]]; then
  echo "${IMAGE_TAG}"
  exit 0
fi

if [[ ! -d "${GIT_REPO}/.git" ]]; then
  echo "unknown"
  exit 1
fi

git -C "${GIT_REPO}" fetch origin "${GIT_DEPLOY_BRANCH}" 2>/dev/null || true
SHA="$(git -C "${GIT_REPO}" rev-parse --short=7 "origin/${GIT_DEPLOY_BRANCH}" 2>/dev/null \
  || git -C "${GIT_REPO}" rev-parse --short=7 "${GIT_DEPLOY_BRANCH}" 2>/dev/null \
  || echo "")"

if [[ -n "${SHA}" ]]; then
  echo "${SHA}"
else
  echo "unknown"
  exit 1
fi
