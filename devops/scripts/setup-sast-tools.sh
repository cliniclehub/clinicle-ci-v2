#!/usr/bin/env bash
# Install semgrep for make sast / make deploy-*
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVOPS_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BE_DIR="${DEVOPS_ROOT}/../be"

echo "[setup-sast] Installing semgrep into be venv (fallback when brew semgrep is missing)..."
if [[ ! -d "${BE_DIR}/.venv" ]]; then
  echo "[setup-sast] Creating venv in be..."
  (cd "${BE_DIR}" && python3.12 -m venv .venv)
fi

"${BE_DIR}/.venv/bin/pip" install --upgrade pip semgrep

echo "[setup-sast] CLI (Homebrew on macOS):"
if command -v brew >/dev/null 2>&1; then
  if brew list semgrep >/dev/null 2>&1; then
    echo "  semgrep: already installed ($(command -v semgrep))"
  else
    echo "  installing semgrep..."
    brew install semgrep || echo "  WARN: failed to install semgrep via brew — use venv: ${BE_DIR}/.venv/bin/semgrep"
  fi
  echo "  optional (post-build image scan): brew install trivy"
else
  echo "  brew not found — use venv: ${BE_DIR}/.venv/bin/semgrep"
fi

if command -v semgrep >/dev/null 2>&1; then
  echo "[setup-sast] semgrep: $(semgrep --version 2>&1 | head -1)"
elif [[ -x "${BE_DIR}/.venv/bin/semgrep" ]]; then
  echo "[setup-sast] semgrep (venv): $("${BE_DIR}/.venv/bin/semgrep" --version 2>&1 | head -1)"
fi

echo "[setup-sast] Done. Deploy: Semgrep (code) before build; Trivy after build."
echo "[setup-sast] Install Trivy for the image gate: brew install trivy"
echo "[setup-sast] Run: make sast   then after images: make sast-images"
