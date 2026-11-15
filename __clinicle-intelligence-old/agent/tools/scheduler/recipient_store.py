"""Persistent directory of trusted scheduler delivery targets."""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional


# Sentinel default for `get()`/`list(org_id=...)`: distinguishes "caller did
# not ask to filter by org" from "filter to this org", including the falsy
# but meaningful `org_id=None` case (single-tenant / legacy entries predating
# org scoping, which carry no `org_id` field and so read back as `None`).
_ORG_NOT_FILTERED = object()


class RecipientStore:
    """Remember recipient identities learned from accepted inbound messages.

    The store deliberately contains no access tokens or channel credentials.
    Channel implementations remain responsible for authentication and their
    normal outbound readiness checks.

    The directory is shared across Agents, but keyed by ``(instance_id, receiver)``
    rather than by ``(channel_type, receiver)``. A channel *type* can run several
    *instances* (two Feishu bots, two WeChat logins), each with its own login,
    tokens and — crucially — its own id space for receivers: the same receiver
    string on two WeChat instances is two different people. Delivery therefore has
    to go back out through the exact instance that first saw the contact, so the
    instance is part of the identity, not just the type.

    Legacy single-instance installs use ``instance_id == channel_type`` (that is
    how the launcher already synthesizes them), so an old entry saved under just a
    channel type keeps resolving unchanged.

    The owning Agent of a scheduled delivery is derived from the recipient's
    channel instance (an instance binds to one Agent), so it is not stored here.
    """

    def __init__(self, store_path: str) -> None:
        self.store_path = Path(store_path)
        self._lock = threading.RLock()
        self.store_path.parent.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _key(instance_id: str, receiver: str) -> str:
        # ``:`` reads cleanly in the on-disk JSON. Both an instance_id and a
        # receiver id can themselves carry a colon (feishu group ids do), so the
        # key is only ever a joined form; downstream code uses the structured
        # fields, never a split of this key.
        return f"{instance_id}:{receiver}"

    def _load_unlocked(self) -> Dict[str, dict]:
        if not self.store_path.exists():
            return {}
        try:
            with self.store_path.open("r", encoding="utf-8") as handle:
                value = json.load(handle)
            recipients = value.get("recipients", {})
            return recipients if isinstance(recipients, dict) else {}
        except (OSError, ValueError, TypeError):
            return {}

    def _save_unlocked(self, recipients: Dict[str, dict]) -> None:
        payload = {"version": 1, "recipients": recipients}
        temporary = self.store_path.with_suffix(self.store_path.suffix + ".tmp")
        with temporary.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, self.store_path)

    @staticmethod
    def _normalize(entry: dict) -> dict:
        """Fill fields an older on-disk entry may predate, without rewriting it.

        ``instance_id`` predates multi-instance and defaults to the channel type,
        which is exactly the legacy single-instance id, so an old entry resolves
        and delivers the same as before.
        """
        result = dict(entry)
        if not result.get("instance_id"):
            result["instance_id"] = result.get("channel_type", "")
        return result

    def remember(
        self,
        channel_type: str,
        receiver: str,
        *,
        name: str = "",
        is_group: bool = False,
        session_id: str = "",
        instance_id: str = "",
        org_id: Optional[str] = None,
    ) -> Optional[dict]:
        channel_type = str(channel_type or "").strip()
        receiver = str(receiver or "").strip()
        # A missing instance_id means a legacy single-instance channel, whose id
        # is the channel type; this keeps old callers and old data on one path.
        instance_id = str(instance_id or "").strip() or channel_type
        if not channel_type or not receiver or channel_type in {"unknown", "web"}:
            return None
        entry = {
            "channel_type": channel_type,
            "instance_id": instance_id,
            "receiver": receiver,
            "name": str(name or receiver),
            "is_group": bool(is_group),
            "session_id": str(session_id or receiver),
            # Who this contact belongs to. ``None`` on a single-tenant install
            # (and for every legacy entry, which predates this field and reads
            # back as ``None`` via ``dict.get``) -- the same "unset == default
            # org" convention `agent/workspace/workflow_store.py` already uses.
            "org_id": org_id,
            "last_seen_at": datetime.now(timezone.utc).isoformat(),
        }
        with self._lock:
            recipients = self._load_unlocked()
            key = self._key(instance_id, receiver)
            previous = recipients.get(key)
            if previous:
                stable_fields = (
                    "channel_type",
                    "instance_id",
                    "receiver",
                    "name",
                    "is_group",
                    "session_id",
                    "org_id",
                )
                unchanged = all(previous.get(field) == entry[field] for field in stable_fields)
                if unchanged:
                    try:
                        last_seen = datetime.fromisoformat(previous["last_seen_at"])
                        if datetime.now(timezone.utc) - last_seen < timedelta(hours=1):
                            return dict(previous)
                    except (KeyError, TypeError, ValueError):
                        pass
            recipients[key] = entry
            self._save_unlocked(recipients)
        return dict(entry)

    def get(self, instance_id: str, receiver: str, org_id=_ORG_NOT_FILTERED) -> Optional[dict]:
        """Resolve one recipient by the instance that saw them.

        ``instance_id`` may be a legacy channel type, which is the id a
        single-instance channel runs under, so old lookups keep working.

        ``org_id``, when given (including ``None``), also requires the entry's
        stored ``org_id`` to match, so a tenant-scoped caller can never target
        another org's contact by guessing/reusing its instance_id+receiver.
        Left at its default, no org check is applied (internal callers that
        need to resolve delivery routing regardless of org).
        """
        instance_id = str(instance_id or "").strip()
        with self._lock:
            entry = self._load_unlocked().get(self._key(instance_id, receiver))
        if not entry:
            return None
        normalized = self._normalize(entry)
        if org_id is not _ORG_NOT_FILTERED and normalized.get("org_id") != org_id:
            return None
        return normalized

    def list(self, org_id=_ORG_NOT_FILTERED) -> List[dict]:
        """Every recipient, optionally scoped to one org.

        A tenant-scoped caller (the console API) must pass ``org_id`` --
        otherwise this is the full cross-org directory. Left at its default,
        no org filter is applied (internal delivery-routing callers that
        legitimately need to see every entry).
        """
        with self._lock:
            entries = [self._normalize(item) for item in self._load_unlocked().values()]
        if org_id is not _ORG_NOT_FILTERED:
            entries = [e for e in entries if e.get("org_id") == org_id]
        return sorted(
            entries,
            key=lambda item: (item["channel_type"], item["name"], item["receiver"]),
        )
