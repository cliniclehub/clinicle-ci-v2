"""The version row's endpoints: /VERSION and /api/update/*.

The running version, whether a newer one exists, and the one-click update
itself -- started in the background, then polled for progress.
"""

import json

import web

from channel.web.core._common import _require_auth
from common.log import logger


class VersionHandler:
    def GET(self):
        web.header('Content-Type', 'application/json; charset=utf-8')
        from cli.update_service import version_payload
        # Local metadata only — never contacts GitHub.
        return json.dumps(version_payload(), ensure_ascii=False)


class UpdateCheckHandler:
    def POST(self):
        # This fork no longer tracks any upstream release feed (it doesn't
        # point at a GitHub repo of its own), so this never makes a network
        # call. Report "up to date, no channel" rather than silently
        # comparing against -- or git-pulling from -- someone else's repo.
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        from cli.update_service import version_payload
        payload = version_payload()
        return json.dumps({
            "up_to_date": True,
            "newer_releases": [],
            "latest": None,
            "current_release": {"tag": payload["version"]},
            "install_kind": payload["install_kind"],
            "update_supported": False,
            "unsupported_reason": "No update channel is configured for this build.",
        }, ensure_ascii=False)


class UpdateStartHandler:
    def POST(self):
        # Disabled alongside UpdateCheckHandler -- no update channel means no
        # git-pull-based self-update path either.
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        return json.dumps({
            "status": "error",
            "message": "No update channel is configured for this build.",
        }, ensure_ascii=False)


class UpdateStatusHandler:
    def GET(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        from cli.update_service import read_update_status
        return json.dumps(read_update_status(), ensure_ascii=False)
