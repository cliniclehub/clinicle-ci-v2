"""Wraps a single Composio action as a BaseTool — one instance per tool the
current org has actually connected, with its own real name/description/JSON
Schema (not a generic proxy the model has to guess arguments for).

Mirrors ``agent/tools/mcp/mcp_tool.py``'s ``McpTool`` exactly: MCP tools are
the existing precedent in this codebase for "one BaseTool instance per
dynamically-discovered remote tool, synced into a live agent's tool list at
request time" (see ``ToolManager.sync_mcp_into_agent``) — Composio's own
per-app actions are the same shape of problem, so this follows the same
pattern rather than inventing a new one.

Schemas come from ``client.tools.get_raw_composio_tools(toolkits=[...])`` —
NOT ``session.tools()``, which returns only the Tool Router meta-tools
(``COMPOSIO_SEARCH_TOOLS`` et al.) regardless of which apps are connected.
Execution goes through ``client.tools.execute(slug, ..., user_id=...)``,
which routes the call through that org's connected account (the same
isolation key ``connector_call.py`` uses).
"""

from agent.audit.log import record_event
from agent.tools.base_tool import BaseTool, ToolResult
from common.log import logger
from common.runtime_identity import current_identity


class ComposioTool(BaseTool):
    def __init__(self, client, user_id: str, raw_tool):
        """
        :param client: the Composio client this tool executes through.
        :param user_id: Composio user id scoping the connected account to
            use (``org-<id>`` or ``default``) — resolved by the caller from
            the ambient RuntimeIdentity, never taken from the model.
        :param raw_tool: one entry from
            ``client.tools.get_raw_composio_tools(toolkits=[...])`` — has
            ``slug`` (e.g. ``GMAIL_SEND_EMAIL``), ``description``,
            ``input_parameters`` (a JSON Schema dict), ``version`` and
            ``toolkit.slug``.
        """
        self._client = client
        self._user_id = user_id
        self.name = getattr(raw_tool, "slug", "") or ""
        self.description = getattr(raw_tool, "description", "") or ""
        params = getattr(raw_tool, "input_parameters", None)
        self.params = params if isinstance(params, dict) and params else {"type": "object", "properties": {}}
        # Manual client.tools.execute REQUIRES an explicit toolkit version
        # (ToolVersionRequiredError otherwise) — the raw tool carries one.
        self._version = getattr(raw_tool, "version", "") or ""
        self._toolkit_slug = getattr(getattr(raw_tool, "toolkit", None), "slug", "") or ""
        # Set by ToolManager at sync time: whether this org has actually
        # connected the app. The executor's catalog-mode fallback reads it —
        # never inject unconnected catalog tools unfiltered.
        self.connected = False

    def execute(self, params: dict) -> ToolResult:
        logger.info(f"[ComposioTool] tool={self.name} params={params}")
        identity = current_identity()
        record_event(
            tenant_id=identity.org_id or "default",
            actor=identity.agent_id or identity.user_id or "system",
            event_type="egress",
            detail={"tool": self.name, "toolkit": self._toolkit_slug, "arguments": params or {}},
        )
        try:
            kwargs = {"arguments": params or {}, "user_id": self._user_id}
            if self._version:
                kwargs["version"] = self._version
            result = self._client.tools.execute(self.name, **kwargs)
        except Exception as e:
            logger.error(f"[ComposioTool] tool={self.name} error: {e}")
            if "ConnectedAccountNotFound" in str(e) or "No connected account" in str(e):
                return ToolResult.fail(self._connect_hint())
            return ToolResult.fail(str(e))
        # ToolExecutionResponse is a TypedDict ({data, error, successful}) in
        # this SDK version; tolerate attribute-shaped results anyway.
        error = result.get("error") if isinstance(result, dict) else getattr(result, "error", None)
        if error:
            return ToolResult.fail(str(error))
        data = result.get("data") if isinstance(result, dict) else getattr(result, "data", None)
        return ToolResult.success(data)

    def _connect_hint(self) -> str:
        """Failure text that lets the agent prompt the user to connect the
        app — with a one-click Composio connect link when minting works
        (same ``session.authorize`` flow the Connectors page uses)."""
        label = self._toolkit_slug or "this app"
        try:
            session = self._client.create(user_id=self._user_id)
            url = session.authorize(self._toolkit_slug).redirect_url
            if url:
                return (
                    f"The app '{label}' is not connected yet. Ask the user to "
                    f"connect it by opening this link: {url} — then retry."
                )
        except Exception as e:
            logger.warning(f"[ComposioTool] connect-link mint failed for {label}: {e}")
        return (
            f"The app '{label}' is not connected yet. Ask the user to connect "
            f"it from the Connectors page, then retry."
        )
