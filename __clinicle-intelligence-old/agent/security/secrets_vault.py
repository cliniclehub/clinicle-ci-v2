"""A real secrets vault: credentials encrypted at rest, never LLM-visible.

Distinct from ``agent/tools/utils/credentials.py`` (a file-access denylist
that keeps ``~/.cow/.env`` out of file-reading tools) — this module is where
per-tenant third-party credentials (API keys, connector tokens, ...) actually
live. Values are encrypted with Fernet (AES-128-CBC + HMAC) before hitting
disk and are only ever decrypted for internal tool code; nothing here returns
a value into a place the model's context could pick it up. Callers that build
LLM-visible responses must use ``list_secret_names`` only.

Storage follows the same instance-wide ``~/.cow/`` convention as
``agent/tenancy/store.py`` (``platform.db``) and
``channel/web/core/tenancy_session.py`` (``session_secret``): one vault per
instance, rows scoped by ``tenant_id``.
"""

from __future__ import annotations

import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

from agent.audit import log as audit_log
from common.log import logger

_DEFAULT_TENANT = "default"


def _default_db_path() -> Path:
    return Path(os.path.expanduser("~/.cow/secrets_vault.db"))


def _default_key_path() -> Path:
    return Path(os.path.expanduser("~/.cow/secrets.key"))


class SecretNotFound(KeyError):
    pass


class SecretsVault:
    def __init__(self, db_path: Optional[Path] = None, key_path: Optional[Path] = None):
        self._db_path = db_path or _default_db_path()
        self._key_path = key_path or _default_key_path()
        self._lock = threading.Lock()
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        is_new = not self._db_path.exists()
        conn = self._connect()
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS secrets (
                    tenant_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    value_encrypted BLOB NOT NULL,
                    created_at INTEGER NOT NULL,
                    PRIMARY KEY (tenant_id, name)
                )
                """
            )
            conn.commit()
        finally:
            conn.close()
        if is_new:
            try:
                os.chmod(self._db_path, 0o600)
            except OSError as e:
                logger.debug(f"[SecretsVault] chmod 0600 skipped: {e}")
        self._fernet = Fernet(self._load_or_create_key())

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(str(self._db_path), timeout=10)

    def _load_or_create_key(self) -> bytes:
        self._key_path.parent.mkdir(parents=True, exist_ok=True)
        if self._key_path.exists():
            return self._key_path.read_bytes()
        key = Fernet.generate_key()
        with self._lock:
            if not self._key_path.exists():
                self._key_path.write_bytes(key)
                try:
                    os.chmod(self._key_path, 0o600)
                except OSError as e:
                    logger.debug(f"[SecretsVault] chmod 0600 skipped: {e}")
        return self._key_path.read_bytes()

    @staticmethod
    def _norm_tenant(tenant_id: Optional[str]) -> str:
        return tenant_id or _DEFAULT_TENANT

    def store_secret(self, tenant_id: Optional[str], name: str, value: str, *, actor: str = "system") -> None:
        tenant_id = self._norm_tenant(tenant_id)
        encrypted = self._fernet.encrypt(value.encode("utf-8"))
        conn = self._connect()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO secrets (tenant_id, name, value_encrypted, created_at) "
                "VALUES (?, ?, ?, ?)",
                (tenant_id, name, encrypted, int(time.time())),
            )
            conn.commit()
        finally:
            conn.close()
        audit_log.record_event(tenant_id, actor, "secret.stored", {"name": name})

    def get_secret(self, tenant_id: Optional[str], name: str) -> str:
        """Decrypted value, for internal tool code only — never for an
        LLM-visible response. Not audit-logged: reads happen on every tool
        call and would drown the log; writes (store/delete) are what matter
        for the governance trail."""
        tenant_id = self._norm_tenant(tenant_id)
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT value_encrypted FROM secrets WHERE tenant_id = ? AND name = ?",
                (tenant_id, name),
            ).fetchone()
        finally:
            conn.close()
        if row is None:
            raise SecretNotFound(name)
        try:
            return self._fernet.decrypt(row[0]).decode("utf-8")
        except InvalidToken as e:
            raise SecretNotFound(f"{name} (undecryptable: key mismatch)") from e

    def list_secret_names(self, tenant_id: Optional[str]) -> list:
        """Names only — never values. Safe to surface to the model or UI."""
        tenant_id = self._norm_tenant(tenant_id)
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT name FROM secrets WHERE tenant_id = ? ORDER BY name", (tenant_id,)
            ).fetchall()
        finally:
            conn.close()
        return [r[0] for r in rows]

    def delete_secret(self, tenant_id: Optional[str], name: str, *, actor: str = "system") -> bool:
        tenant_id = self._norm_tenant(tenant_id)
        conn = self._connect()
        try:
            cur = conn.execute(
                "DELETE FROM secrets WHERE tenant_id = ? AND name = ?", (tenant_id, name)
            )
            conn.commit()
            deleted = cur.rowcount > 0
        finally:
            conn.close()
        if deleted:
            audit_log.record_event(tenant_id, actor, "secret.deleted", {"name": name})
        return deleted


_instance: Optional[SecretsVault] = None
_instance_lock = threading.Lock()


def get_secrets_vault() -> SecretsVault:
    global _instance
    if _instance is None:
        with _instance_lock:
            if _instance is None:
                _instance = SecretsVault()
    return _instance


def store_secret(tenant_id: Optional[str], name: str, value: str, *, actor: str = "system") -> None:
    get_secrets_vault().store_secret(tenant_id, name, value, actor=actor)


def get_secret(tenant_id: Optional[str], name: str) -> str:
    return get_secrets_vault().get_secret(tenant_id, name)


def list_secret_names(tenant_id: Optional[str]) -> list:
    return get_secrets_vault().list_secret_names(tenant_id)


def delete_secret(tenant_id: Optional[str], name: str, *, actor: str = "system") -> bool:
    return get_secrets_vault().delete_secret(tenant_id, name, actor=actor)


def demo() -> None:
    """ponytail: smallest runnable check for encrypt/decrypt + audit trail."""
    import shutil
    import tempfile

    tmp = Path(tempfile.mkdtemp())
    try:
        vault = SecretsVault(db_path=tmp / "vault.db", key_path=tmp / "key")
        vault.store_secret("org-1", "stripe_key", "sk_live_abc123", actor="hania")
        assert vault.get_secret("org-1", "stripe_key") == "sk_live_abc123"
        assert vault.list_secret_names("org-1") == ["stripe_key"]
        # Raw DB bytes must never contain the plaintext.
        raw = (tmp / "vault.db").read_bytes()
        assert b"sk_live_abc123" not in raw
        assert vault.delete_secret("org-1", "stripe_key", actor="hania") is True
        assert vault.list_secret_names("org-1") == []
        try:
            vault.get_secret("org-1", "stripe_key")
            raise AssertionError("expected SecretNotFound")
        except SecretNotFound:
            pass
        print("agent/security/secrets_vault.py demo: OK")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    demo()
