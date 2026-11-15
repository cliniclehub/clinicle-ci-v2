"""Call a third-party API through a connected account, via Composio.

Per the approved plan (~/.claude/plans/typed-pondering-owl.md, Phase 2): one
tool, registered once, available to every agent automatically (tool
registration is workspace-instance-wide — see ``agent/tools/tool_manager.py``
and ``agent/registry.py``'s per-org registries). The org whose connection to
use is never passed by the model: it's read off the ambient
``RuntimeIdentity`` the same way ``state_root()``/``shared_root()`` already
do, via the request-scoped identity threaded through every web request.

Originally built against Nango; rebuilt against Composio after the user
pointed out Composio's setup (hosted, single API key, no self-host, no admin
account to create) is the actual bar this feature should meet. Composio is
also a better architectural fit than Nango's raw-proxy model: instead of a
generic ``provider``/``endpoint``/``method``/``data`` HTTP proxy call, it
exposes discrete, pre-built tool slugs per app (e.g. ``SLACK_SEND_MESSAGE``)
with their own argument schemas — the agent picks a tool slug, not a raw
REST path.

API surface below is not from documentation (which this session's research
flagged as incomplete on the exact connection-initiation call) — it's
confirmed directly from the installed ``composio`` package's own source
(``composio/core/models/tool_router_session.py``): ``composio.create(user_id=...)``
returns a session; ``session.execute(tool_slug, arguments=...)`` runs a tool.
"""

from __future__ import annotations

from typing import Optional

from agent.audit.log import record_event
from agent.tools.base_tool import BaseTool, ToolResult
from common.log import logger
from common.runtime_identity import current_identity
from config import conf


def _org_user_id() -> str:
    """Composio's `user_id` is the sole isolation key for a tenant's
    connected accounts (confirmed from the SDK source — no separate
    connection-id bookkeeping needed for the common case). Collapses onto a
    fixed placeholder when there is no org context (a single-operator
    instance with no tenancy set up) — same non-breaking shape every other
    layer of this plan uses."""
    org_id = current_identity().org_id
    return f"org-{org_id}" if org_id else "default"


class ConnectorCallTool(BaseTool):
    name = "connector_call"
    description = (
        "Call a third-party API (Slack, GitHub, Google, HubSpot, Notion, and "
        "1,500+ others) through an account the user has already connected in "
        "the Connectors page. `tool_slug` is Composio's tool identifier for "
        "the specific action (e.g. 'SLACK_SEND_MESSAGE', "
        "'GITHUB_CREATE_AN_ISSUE') — these follow the pattern "
        "TOOLKIT_ACTION_NAME. `arguments` is the JSON object of parameters "
        "that specific tool expects."
    )
    params = {
        "type": "object",
        "properties": {
            "tool_slug": {
                "type": "string",
                "description": "Composio tool identifier, e.g. 'SLACK_SEND_MESSAGE'.",
            },
            "arguments": {
                "type": "object",
                "description": "Arguments for this tool call, matching that tool's own schema.",
            },
        },
        "required": ["tool_slug"],
    }

    def is_available(self) -> bool:
        return bool(str(conf().get("composio_api_key") or "").strip())

    def execute(self, params: dict) -> ToolResult:
        tool_slug = str(params.get("tool_slug") or "").strip()
        arguments: Optional[dict] = params.get("arguments") if isinstance(params.get("arguments"), dict) else {}

        if not tool_slug:
            return ToolResult.fail("tool_slug is required")

        api_key = str(conf().get("composio_api_key") or "").strip()
        if not api_key:
            return ToolResult.fail("Connectors are not configured (composio_api_key is unset)")

        try:
            from composio import Composio
        except ImportError:
            return ToolResult.fail("The composio package is not installed")

        identity = current_identity()
        record_event(
            tenant_id=identity.org_id or "default",
            actor=identity.agent_id or identity.user_id or "system",
            event_type="egress",
            detail={"tool": "connector_call", "tool_slug": tool_slug, "arguments": arguments},
        )
        try:
            client = Composio(api_key=api_key)
            session = client.create(user_id=_org_user_id())
            result = session.execute(tool_slug, arguments=arguments)
        except Exception as e:
            logger.warning(f"[ConnectorCall] {tool_slug} failed: {e}")
            return ToolResult.fail(f"Call to {tool_slug} failed: {e}")

        if getattr(result, "error", None):
            return ToolResult.fail(f"{tool_slug} returned an error: {result.error}")

        return ToolResult.success(result.data)


def list_connected_apps() -> list:
    """The org's currently-connected Composio apps, same shape and same
    ``is_connected=True`` filter channel/web/api/connectors.py's
    ConnectorsListHandler uses, so a workflow node and the Connectors page
    can never disagree about what "connected" means.

    Returns ``[]`` (never raises) when Composio isn't configured or the call
    fails -- callers (workflow node handlers) treat an empty result as "no
    connected apps yet", not as an error that should stop the workflow."""
    api_key = str(conf().get("composio_api_key") or "").strip()
    if not api_key:
        return []
    try:
        from composio import Composio

        client = Composio(api_key=api_key)
        session = client.create(user_id=_org_user_id())
        result = session.toolkits(is_connected=True)
    except Exception as e:
        logger.warning(f"[ConnectorCall] list_connected_apps failed: {e}")
        return []

    apps = []
    for item in getattr(result, "items", []) or []:
        if item.connection and item.connection.is_active:
            apps.append({
                "provider": str(getattr(item, "slug", "") or ""),
                "name": str(getattr(item, "name", "") or getattr(item, "slug", "") or ""),
            })
    return apps
