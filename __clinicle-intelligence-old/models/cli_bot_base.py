"""Shared base for bots that shell out to an external CLI coding agent's own
headless mode instead of calling a hosted API (see ``common.const`` for the
``bot_type`` values, ``models/bot_factory.py`` for dispatch).

What's actually shared across CLI adapters: subprocess invocation with
timeout/cwd, wrapping the result back into an OpenAI-chat-completion shape
(stream and non-stream), resolving the calling Agent's
``require_approval_for_writes`` flag, and normalizing every failure mode
(missing binary, timeout, non-zero exit, unparseable output) into
``{"error": "..."}`` so a caller never sees an unhandled exception mid-turn.

What's deliberately NOT unified: each CLI's own governance knob. Claude
Code CLI's ``--disallowedTools`` is a tool-name blocklist; Codex CLI's
``-s/--sandbox`` is a mode enum. Forcing those into one shared shape would
be a false abstraction -- each concrete adapter defines its own
``governed_args()``.

Concrete adapters implement:
- ``cli_name`` (class attr): human-readable name for error messages.
- ``build_args(prompt) -> list[str]``: the full argv, including the binary
  path and the prompt, but NOT the governance flags (those are added
  separately via ``governed_args()`` so ``last_call_governed`` stays
  accurate regardless of adapter).
- ``governed_args() -> list[str]``: extra argv appended when the calling
  Agent has ``require_approval_for_writes`` set.
- ``parse_output(proc) -> dict``: given the completed ``subprocess.
  CompletedProcess`` (returncode already checked to be 0), return
  ``{"text": ..., "usage": {...}}``.
"""

from __future__ import annotations

import os
import subprocess
from typing import Any, Dict, List, Optional

from common.log import logger
from models.bot import Bot

HOST_VISIBLE_TOOL_LOOP = False


def flatten_messages(messages: List[Dict], system: Optional[str]) -> str:
    """One prompt string for a CLI's single positional/``-p`` argument. The
    CLI has no notion of this host's message-list format, so history
    collapses to a transcript it reads as plain text and manages its own
    context from."""
    parts = []
    if system:
        parts.append(f"[System instructions]\n{system}")
    for m in messages or []:
        role = m.get("role", "user")
        content = m.get("content")
        if isinstance(content, list):
            text = "\n".join(
                b.get("text", "") for b in content
                if isinstance(b, dict) and b.get("type") == "text"
            )
        else:
            text = str(content or "")
        if text.strip():
            parts.append(f"[{role}]\n{text.strip()}")
    return "\n\n".join(parts)


class CliBot(Bot):
    # Read back at agent_stream.py's usage/audit choke point -- the CLI runs
    # its own internal tool loop, never governed by agent/permission/*.
    HOST_VISIBLE_TOOL_LOOP = HOST_VISIBLE_TOOL_LOOP
    cli_name = "CLI"

    def __init__(self, config: Optional[Dict] = None):
        self.config = config or {}
        # Read back by agent_stream.py's disclosed-gap audit log right after
        # a turn, so the recorded reason reflects what this specific call
        # actually did rather than a static "always ungoverned" string.
        self.last_call_governed = False

    def _governed(self) -> bool:
        """Whether the calling Agent opted into require_approval_for_writes
        (agent/registry.py) -- resolved from runtime identity since this bot
        is constructed with no Agent reference (create_bot() takes none).
        Any resolution failure reads as False: an approval-gate malfunction
        must degrade to the already-disclosed default, never to silently
        blocking every call."""
        try:
            from agent.registry import get_agent_registry
            from common.runtime_identity import current_identity

            agent_id = current_identity().agent_id or ""
            if not agent_id:
                return False
            profile = get_agent_registry().get(agent_id, require_enabled=False)
            return bool(profile.require_approval_for_writes)
        except Exception as e:
            logger.debug(f"[{self.cli_name}] could not resolve governance flag: {e}")
            return False

    def build_args(self, prompt: str) -> List[str]:
        raise NotImplementedError

    def governed_args(self) -> List[str]:
        raise NotImplementedError

    def parse_output(self, proc: "subprocess.CompletedProcess") -> Dict:
        raise NotImplementedError

    def cwd_and_timeout(self):
        raise NotImplementedError

    def reply(self, query, context=None):
        from bridge.reply import Reply, ReplyType

        result = self._run_cli(str(query))
        return Reply(ReplyType.TEXT, result.get("text") or result.get("error") or "")

    def call_with_tools(self, messages, tools=None, stream=False, **kwargs) -> Any:
        prompt = flatten_messages(messages, kwargs.get("system"))
        result = self._run_cli(prompt)

        if result.get("error"):
            payload = {"error": True, "message": result["error"], "status_code": 500}
            if stream:
                def _error_stream():
                    yield payload
                return _error_stream()
            return payload

        usage = result.get("usage") or {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
        if not stream:
            return {
                "choices": [{
                    "index": 0,
                    "message": {"role": "assistant", "content": result["text"]},
                    "finish_reason": "stop",
                }],
                "usage": usage,
            }

        def _one_shot_stream():
            yield {"choices": [{"index": 0, "delta": {"role": "assistant", "content": result["text"]}}]}
            yield {"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}], "usage": usage}
        return _one_shot_stream()

    def _run_cli(self, prompt: str) -> Dict:
        """Blocking subprocess call. Never raises: every failure mode
        (missing binary, timeout, non-zero exit, unparseable output) comes
        back as {"error": "..."} so the caller can surface it as a normal
        failed turn instead of an unhandled exception mid-stream."""
        cwd, timeout = self.cwd_and_timeout()
        args = self.build_args(prompt)
        self.last_call_governed = self._governed()
        if self.last_call_governed:
            args += self.governed_args()
        try:
            proc = subprocess.run(
                args, cwd=cwd, env=os.environ.copy(), capture_output=True, text=True, timeout=timeout,
            )
        except FileNotFoundError:
            return {"error": f"'{args[0]}' CLI not found on PATH"}
        except subprocess.TimeoutExpired:
            return {"error": f"{self.cli_name} timed out after {timeout:g}s"}
        except (OSError, subprocess.SubprocessError) as e:
            return {"error": str(e)}

        if proc.returncode != 0:
            return {"error": proc.stderr.strip() or f"exit code {proc.returncode}"}

        return self.parse_output(proc)
