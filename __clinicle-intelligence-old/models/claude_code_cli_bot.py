"""Bot that shells to the Claude Code CLI's own headless mode instead of
calling a hosted API, for an Agent whose ``bot_type`` is
``common.const.CLAUDE_CODE_CLI`` (see ``models/bot_factory.py``). Built on
the shared ``models.cli_bot_base.CliBot`` -- see that module's docstring
for what's shared across CLI adapters vs. adapter-specific.

Known, accepted gap (per the architecture decision -- allow it, don't
block, disclose it): the CLI runs ITS OWN internal tool loop with its own
permissions. ``agent/protocol/agent_stream.py``'s ``_execute_tool`` --
the one place this app's `agent/permission/*` governance applies -- never
sees or governs whatever the CLI does internally; `tools` passed to
``call_with_tools`` is accepted for interface compatibility and otherwise
ignored. ``HOST_VISIBLE_TOOL_LOOP = False`` is read back at the same
choke point in ``agent_stream.py`` to fire a disclosed-gap audit event
for every turn this bot answers -- logged, never blocking by default.

Partial real governance for an Agent that opts into
``require_approval_for_writes`` (``agent/registry.py``): headless (``-p``)
mode has no TTY to prompt a human interactively, so there is no live
approver to stage a diff for the way the host's own approval gate
(``agent/permission/execution_gate.py``) does for its own tools. The safer
equivalent is enforced at the CLI's OWN permission layer instead --
``governed_args()``/``_GOVERNED_DISALLOWED_TOOLS`` pass ``--disallowedTools``
to deny the CLI's mutating/network tools outright for that turn. This is
real enforcement (the CLI itself refuses the call), not audit-only, but it
is coarser than the host's own gate: all-or-nothing per turn, not a
per-call diff a human reviews. The audit event's ``governed`` field and
``reason`` text reflect whichever of these applied to a given turn.

No native streaming from the CLI's headless mode: the whole reply is
captured in one subprocess call and re-emitted as a single OpenAI-chat-
completion-shaped dict, or a one-chunk generator for stream=True, so the
caller cannot tell this apart from a slow non-streaming provider.
"""

from __future__ import annotations

import json
from typing import Dict, List, Optional

from common.log import logger
from models.cli_bot_base import CliBot, HOST_VISIBLE_TOOL_LOOP

# The CLI's own internal tools this app can actually deny at the CLI's own
# permission layer via --disallowedTools when the calling Agent opted into
# require_approval_for_writes (agent/permission/execution_gate.py's flag).
# Headless (-p) mode has no TTY to prompt a human interactively -- there is
# no live approver to stage a diff for the way the host's own approval gate
# does -- so "requires approval" here means the safer equivalent: fail
# closed and deny the mutating/network tools outright rather than let them
# run ungoverned. A call blocked this way is still visible to the model as
# an ordinary tool refusal in its own transcript; it just never reaches
# agent/permission/* to be logged as one.
_GOVERNED_DISALLOWED_TOOLS = "Bash,Write,Edit,MultiEdit,NotebookEdit,WebFetch"


class ClaudeCodeCliBot(CliBot):
    # Read back at agent_stream.py's usage/audit choke point.
    HOST_VISIBLE_TOOL_LOOP = HOST_VISIBLE_TOOL_LOOP
    cli_name = "Claude Code CLI"

    def __init__(self, config: Optional[Dict] = None):
        # create_bot() constructs every bot with no arguments (see
        # bot_factory.py) -- config is read from the global store directly,
        # same as every other bot's get_api_config() does, rather than
        # threading a project_dir through call_with_tools()'s shared kwargs
        # (every other bot type's interface, unchanged by this one).
        super().__init__(config)
        from config import conf

        self.cwd = self.config.get("cwd") or conf().get("claude_code_cli_cwd") or None
        self.timeout = float(self.config.get("timeout_seconds") or conf().get("claude_code_cli_timeout_seconds") or 300)
        self.cli_path = self.config.get("cli_path") or conf().get("claude_code_cli_path") or "claude"

    def cwd_and_timeout(self):
        return self.cwd, self.timeout

    def build_args(self, prompt: str) -> List[str]:
        return [self.cli_path, "-p", prompt, "--output-format", "json"]

    def governed_args(self) -> List[str]:
        return ["--disallowedTools", _GOVERNED_DISALLOWED_TOOLS]

    def parse_output(self, proc) -> Dict:
        try:
            data = json.loads(proc.stdout)
            text = data.get("result") or data.get("text") or proc.stdout.strip()
            usage = data.get("usage") or {}
        except (ValueError, AttributeError) as e:
            logger.debug(f"[ClaudeCodeCliBot] non-JSON CLI output, using raw stdout: {e}")
            text = proc.stdout.strip()
            usage = {}
        return {"text": text, "usage": usage}
