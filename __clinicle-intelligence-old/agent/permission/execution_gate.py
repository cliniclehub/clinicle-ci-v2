"""Approval gate for file-mutating tool calls: a genuinely different axis
from ``agent/permission/policy.py``.

``policy.py`` answers "can this session ever run tool X" (a security
boundary). This answers "does this specific Agent want a human to bless an
edit/write before it lands" (a review preference) -- checked in
``agent/protocol/agent_stream.py``'s ``_execute_tool``, immediately after the
existing policy check passes, right before the tool would otherwise run.

Per-Agent, resolved live from the registry by agent_id rather than any new
attribute threaded through Agent construction -- one lookup, same "rebuilt on
every read" pattern already used elsewhere (e.g. the subagent tool's
description), and it means this feature needed zero changes to how an Agent
or a sub agent child gets built. Off (``False``) is what every Agent not
explicitly configured otherwise resolves to, including on any error --a
broken lookup here must degrade to "run normally", never to "silently start
blocking every edit".
"""

from __future__ import annotations

from typing import Any, Dict

from common.log import logger

# Only these two tools can mutate a file in one shot from a single call --
# the ones a diff can meaningfully preview before it lands. Nothing else is
# in scope for this gate.
GATED_TOOLS = ("edit", "write")


def is_gated_tool(tool_name: str) -> bool:
    return tool_name in GATED_TOOLS


def requires_approval(agent_id: str, tool_name: str) -> bool:
    """True only when ``tool_name`` is gated AND the named Agent has opted
    in. Never raises -- any failure to resolve the Agent's profile reads as
    "not gated", matching every other agent/permission/* fallback here."""
    if not is_gated_tool(tool_name):
        return False
    try:
        from agent.registry import get_agent_registry

        profile = get_agent_registry().get(agent_id, require_enabled=False)
        return bool(profile.require_approval_for_writes)
    except Exception as e:
        logger.debug(f"[ExecutionGate] Could not resolve approval flag for {agent_id!r}: {e}")
        return False


def preview_tool_call(tool, arguments: Dict[str, Any]):
    """Run the gated tool's own ``preview()`` (see edit.py/write.py) to get
    the diff a human will review, without executing anything. Returns the
    tool's ``ToolResult`` unchanged -- callers read ``.status``/``.result``
    exactly as they would from a real execution."""
    return tool.preview(arguments)
