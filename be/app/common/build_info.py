"""Release and build metadata for /health and logging."""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]


def _read_version_file() -> str:
    candidates = (
        _REPO_ROOT / "VERSION",
        Path("/app/VERSION"),
    )
    for path in candidates:
        if path.is_file():
            return path.read_text(encoding="utf-8").strip()
    return "0.0.0-dev"


def _git_sha_short() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short=7", "HEAD"],
            cwd=_REPO_ROOT,
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return "local"


def _runtime_environment() -> str:
    """Deploy target from Render env group (ENVIRONMENT). Not baked into the BE image."""
    return (os.getenv("ENVIRONMENT") or "local").strip() or "local"


def get_build_info() -> dict[str, str]:
    """Return release/build metadata for /api/v1/health.

    Backend images bake only APP_RELEASE_VERSION and APP_GIT_SHA at Docker build.
    ``environment`` and the build label prefix come from runtime ENVIRONMENT
    (set per Render env group: local, dev, test, production, …).

    Local dev re-reads VERSION + git HEAD when APP_GIT_SHA is unset.
    """
    release = os.getenv("APP_RELEASE_VERSION") or _read_version_file()
    git_sha = os.getenv("APP_GIT_SHA") or _git_sha_short()
    environment = _runtime_environment()
    return {
        "release": release,
        "build": f"{environment}-{git_sha}",
        "git_sha": git_sha,
        "environment": environment,
    }
