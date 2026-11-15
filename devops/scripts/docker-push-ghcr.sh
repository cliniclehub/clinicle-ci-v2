#!/usr/bin/env bash
# Push to GHCR; treat "already on registry" / flaky "unknown" as success when tag exists.
set -euo pipefail

IMAGE="${1:-}"
if [[ -z "${IMAGE}" ]]; then
  echo "Usage: $0 <image:tag>"
  exit 1
fi

if docker push "${IMAGE}"; then
  echo "[push] OK ${IMAGE}"
  exit 0
fi

PUSH_EXIT=$?
if docker buildx imagetools inspect "${IMAGE}" >/dev/null 2>&1; then
  echo "[push] Push returned ${PUSH_EXIT} but tag already on GHCR — continuing: ${IMAGE}"
  exit 0
fi

echo "[push] FAILED ${IMAGE}"
exit "${PUSH_EXIT}"
