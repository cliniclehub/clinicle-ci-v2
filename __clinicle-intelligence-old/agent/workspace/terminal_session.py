# encoding:utf-8
"""Persistent per-agent shell sessions backing the Code Editor's terminal.

One real bash process per agent, kept alive across requests so `cd` and
exported environment variables persist between commands -- replacing the
Code Editor's prior one-shot-per-command reuse of the Bash tool, where each
command ran in its own fresh subprocess and lost all shell state.

Reads the child's stdout as a raw fd via os.read(), not through a buffered
TextIOWrapper.readline(): a buffered reader can silently pull multiple
already-written lines out of the OS pipe in one internal read, after which
select() on the same fd correctly reports "nothing new" even though a
second command's output is still sitting unread in the wrapper's own
buffer -- reads then hang waiting for output that already arrived. Reading
the fd directly keeps what select() sees and what we've actually consumed
in sync.

Known limitation: a command that hangs past _READ_TIMEOUT_SECONDS returns
"(command timed out)" while the shell keeps running it in the background;
the next command's output may then start with that stale command's tail.
A real pty with job control (ctrl-C, interactive programs) is out of scope
for this v1 -- same tradeoff call as the rest of the Code Editor's terminal.
"""

from __future__ import annotations

import os
import select
import subprocess
import threading
import time

_LOCK = threading.Lock()
_SESSIONS: dict = {}
_IDLE_TIMEOUT_SECONDS = 1800
_READ_TIMEOUT_SECONDS = 20


class _Session:
    def __init__(self, root: str):
        self.root = root
        self.proc = subprocess.Popen(
            ["/bin/bash"], cwd=root, env=os.environ.copy(),
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            bufsize=0,
        )
        self.lock = threading.Lock()
        self.last_used = time.time()
        self.pending = b""  # bytes read past a marker but not yet claimed by the next command

    def alive(self) -> bool:
        return self.proc.poll() is None

    def close(self) -> None:
        try:
            self.proc.kill()
        except Exception:
            pass


def _reap_idle_locked() -> None:
    now = time.time()
    for agent_id, session in list(_SESSIONS.items()):
        if not session.alive() or now - session.last_used > _IDLE_TIMEOUT_SECONDS:
            session.close()
            _SESSIONS.pop(agent_id, None)


def run_command(agent_id: str, root: str, command: str) -> dict:
    """Runs `command` in the agent's persistent shell. Returns
    {"output": str, "exit_code": int}."""
    with _LOCK:
        _reap_idle_locked()
        session = _SESSIONS.get(agent_id)
        if session is None or not session.alive():
            session = _Session(root)
            _SESSIONS[agent_id] = session

    with session.lock:
        session.last_used = time.time()
        marker = f"__CE_DONE_{os.urandom(4).hex()}__".encode()
        session.proc.stdin.write(f"{command}\necho {marker.decode()} $?\n".encode())
        session.proc.stdin.flush()

        buf = session.pending
        session.pending = b""
        fd = session.proc.stdout.fileno()
        deadline = time.time() + _READ_TIMEOUT_SECONDS
        timed_out = False
        while marker not in buf:
            remaining = deadline - time.time()
            if remaining <= 0:
                timed_out = True
                break
            ready, _, _ = select.select([fd], [], [], remaining)
            if not ready:
                timed_out = True
                break
            chunk = os.read(fd, 65536)
            if not chunk:
                break  # shell process exited (e.g. the command itself was "exit")
            buf += chunk

        exit_code = 0
        if marker in buf:
            before, _, after = buf.partition(marker)
            newline = after.find(b"\n")
            tail, leftover = (after[:newline], after[newline + 1:]) if newline != -1 else (after, b"")
            try:
                exit_code = int(tail.strip())
            except ValueError:
                exit_code = 0
            session.pending = leftover
            output = before
        else:
            output = buf
            if timed_out:
                output += b"\n(command timed out)" if output else b"(command timed out)"

        if output.endswith(b"\n"):
            output = output[:-1]
        return {"output": output.decode(errors="replace"), "exit_code": exit_code}


def reset_session(agent_id: str) -> None:
    """Kills the agent's persistent shell, if any -- the next command starts fresh."""
    with _LOCK:
        session = _SESSIONS.pop(agent_id, None)
    if session:
        session.close()
