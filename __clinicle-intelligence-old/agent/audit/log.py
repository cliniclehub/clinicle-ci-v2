"""Tamper-evident, append-only audit log ("flight recorder").

Every governance-relevant action (secret created, MFA enrolled, RBAC role
changed, tool invoked, connector call made, ...) is recorded here as one line
of JSONL. Each record chains to the previous one:

    hash = sha256(prev_hash + canonical_json(record_without_hash))

so ``verify_chain()`` can detect any edit, deletion, insertion or reorder
after the fact by recomputing the chain and comparing.

Lives at ``~/.cow/audit/events.jsonl`` — the same instance-wide (not
per-workspace) convention as ``~/.cow/platform.db`` (agent/tenancy/store.py)
and ``~/.cow/session_secret`` (channel/web/core/tenancy_session.py): an audit
trail is a property of the instance, not of one Agent's workspace.

Contract is shared with anything else that writes egress/action records
(e.g. a connectors module) — ``record_event``/``iter_events`` must stay
signature-compatible so both producers append to the same chain.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from pathlib import Path
from typing import Iterator, Optional

_GENESIS_HASH = "0" * 64
_LOCK = threading.Lock()


def _log_path() -> Path:
    return Path(os.path.expanduser("~/.cow/audit/events.jsonl"))


def _canonical_json(record: dict) -> str:
    return json.dumps(record, sort_keys=True, separators=(",", ":"))


def _tail_record(path: Path) -> Optional[dict]:
    """Last valid JSON line in the log, or None for an empty/missing log."""
    if not path.exists():
        return None
    last = None
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                last = line
    return json.loads(last) if last else None


def record_event(tenant_id: Optional[str], actor: str, event_type: str, detail: dict) -> dict:
    """Append one tamper-evident record and return it.

    Serialized with a lock plus a fresh read of the tail on every call —
    correct under concurrent writers within one process; cross-process
    writers would need file locking, which this instance does not need yet.
    """
    path = _log_path()
    is_new = not path.exists()
    path.parent.mkdir(parents=True, exist_ok=True)
    with _LOCK:
        tail = _tail_record(path)
        prev_hash = tail["hash"] if tail else _GENESIS_HASH
        seq = (tail["seq"] + 1) if tail else 1
        record = {
            "seq": seq,
            "ts": time.time(),
            "tenant_id": tenant_id,
            "actor": actor,
            "event_type": event_type,
            "detail": detail,
            "prev_hash": prev_hash,
        }
        record["hash"] = hashlib.sha256(
            (prev_hash + _canonical_json(record)).encode()
        ).hexdigest()
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
    if is_new:
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
    return record


def iter_events(event_type: Optional[str] = None, tenant_id: Optional[str] = None) -> Iterator[dict]:
    """Yield records in append order, optionally filtered."""
    path = _log_path()
    if not path.exists():
        return
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            record = json.loads(line)
            if event_type is not None and record.get("event_type") != event_type:
                continue
            if tenant_id is not None and record.get("tenant_id") != tenant_id:
                continue
            yield record


def verify_chain(tenant_id: Optional[str] = None) -> bool:
    """Recompute every hash and confirm the chain is unbroken.

    ``tenant_id`` is accepted for interface symmetry with ``iter_events``, but
    is not otherwise used: the hash chain covers the whole log, so a single
    tampered record breaks integrity regardless of which tenant it names.
    Returns False on any break (bad prev_hash, out-of-order seq, or a hash
    that no longer matches its record), True for an empty or intact log.
    """
    path = _log_path()
    if not path.exists():
        return True
    prev_hash = _GENESIS_HASH
    expected_seq = 1
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            record = json.loads(line)
            stored_hash = record.get("hash")
            body = {k: v for k, v in record.items() if k != "hash"}
            if body.get("prev_hash") != prev_hash or body.get("seq") != expected_seq:
                return False
            recomputed = hashlib.sha256((prev_hash + _canonical_json(body)).encode()).hexdigest()
            if recomputed != stored_hash:
                return False
            prev_hash = stored_hash
            expected_seq += 1
    return True


def demo() -> None:
    """ponytail: smallest runnable check for the hash-chain logic."""
    import shutil
    import tempfile

    tmp = Path(tempfile.mkdtemp())
    global _log_path
    original = _log_path
    _log_path = lambda: tmp / "events.jsonl"  # noqa: E731
    try:
        record_event("org-1", "hania", "secret.created", {"name": "stripe_key"})
        record_event("org-1", "hania", "secret.deleted", {"name": "stripe_key"})
        record_event(None, "system", "backup.run", {"bytes": 1234})
        assert verify_chain() is True
        events = list(iter_events(tenant_id="org-1"))
        assert len(events) == 2
        assert [e["seq"] for e in events] == [1, 2]

        # Tamper with one record's detail without recomputing its hash.
        lines = (tmp / "events.jsonl").read_text().splitlines()
        tampered = json.loads(lines[0])
        tampered["detail"]["name"] = "stolen"
        lines[0] = json.dumps(tampered)
        (tmp / "events.jsonl").write_text("\n".join(lines) + "\n")
        assert verify_chain() is False
        print("agent/audit/log.py demo: OK")
    finally:
        _log_path = original
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    demo()
