"""Bot that shells to the OpenAI Codex CLI's own headless mode (``codex
exec``) instead of calling a hosted API, for an Agent whose ``bot_type`` is
``common.const.CODEX_CLI`` (see ``models/bot_factory.py``). Built on the
shared ``models.cli_bot_base.CliBot`` -- the second concrete CLI adapter,
alongside ``models.claude_code_cli_bot.ClaudeCodeCliBot``.

Same disclosed-gap and partial-governance story as the Claude Code CLI
adapter (see that module's docstring): the CLI runs its own internal tool
loop, ungoverned by ``agent/permission/*``, with ``HOST_VISIBLE_TOOL_LOOP =
False`` read back at ``agent_stream.py``'s audit choke point. Governance
for ``require_approval_for_writes`` maps to Codex's OWN knob instead of
Claude Code's ``--disallowedTools`` blocklist: Codex's ``-s/--sandbox`` is a
mode enum (``read-only`` / ``workspace-write`` / ``danger-full-access``),
so a governed call runs with ``-s read-only`` (the CLI itself refuses any
write) while an ungoverned call uses ``-s workspace-write`` (its own
default posture for agentic use, short of the unsandboxed
``danger-full-access`` this app never passes).

``--json`` + ``-o <file>`` writes the CLI's own JSONL event stream to
stdout and the clean final message to a temp file, respectively -- reading
the file is simpler and more robust than parsing the JSONL for a
non-streaming v1 (Codex's ``--json`` mode does support real incremental
streaming; wiring that through is a natural v2, not done here to keep this
adapter's shape symmetric with the also-non-streaming Claude Code one).
"""

from __future__ import annotations

import os
import tempfile
from typing import Dict, List, Optional

from common.log import logger
from models.cli_bot_base import CliBot, HOST_VISIBLE_TOOL_LOOP


class CodexCliBot(CliBot):
    # Read back at agent_stream.py's usage/audit choke point.
    HOST_VISIBLE_TOOL_LOOP = HOST_VISIBLE_TOOL_LOOP
    cli_name = "Codex CLI"

    def __init__(self, config: Optional[Dict] = None):
        super().__init__(config)
        from config import conf

        self.cwd = self.config.get("cwd") or conf().get("codex_cli_cwd") or None
        self.timeout = float(self.config.get("timeout_seconds") or conf().get("codex_cli_timeout_seconds") or 300)
        self.cli_path = self.config.get("cli_path") or conf().get("codex_cli_path") or "codex"
        self._output_file: Optional[str] = None

    def cwd_and_timeout(self):
        return self.cwd, self.timeout

    def build_args(self, prompt: str) -> List[str]:
        fd, self._output_file = tempfile.mkstemp(prefix="codex_cli_", suffix=".txt")
        os.close(fd)
        return [
            self.cli_path, "exec", "--json", "--skip-git-repo-check",
            "-o", self._output_file, prompt,
        ]

    def governed_args(self) -> List[str]:
        return ["-s", "read-only"]

    def parse_output(self, proc) -> Dict:
        text = ""
        try:
            if self._output_file and os.path.exists(self._output_file):
                with open(self._output_file, "r", encoding="utf-8") as f:
                    text = f.read().strip()
        except OSError as e:
            logger.debug(f"[CodexCliBot] could not read output file: {e}")
        finally:
            if self._output_file:
                try:
                    os.unlink(self._output_file)
                except OSError:
                    pass
                self._output_file = None
        if not text:
            text = proc.stdout.strip()
        # No per-turn token usage exposed by `codex exec --json`'s final-
        # message file -- the JSONL event stream on stdout carries it, but
        # parsing that is deferred to the streaming v2 noted in the module
        # docstring, so usage always reports zero for this adapter.
        return {"text": text, "usage": {}}

    def _run_cli(self, prompt: str) -> Dict:
        # parse_output() only runs on the success path (returncode 0); a
        # missing binary, timeout, or non-zero exit all return early in the
        # base class without ever reading (or cleaning up) the temp file
        # build_args() created, so cleanup has to happen here regardless of
        # which path was taken.
        try:
            return super()._run_cli(prompt)
        finally:
            if self._output_file:
                try:
                    os.unlink(self._output_file)
                except OSError:
                    pass
                self._output_file = None
