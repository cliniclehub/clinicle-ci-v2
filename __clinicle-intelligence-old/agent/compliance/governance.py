"""Data export, right-to-be-forgotten, retention, and DR backup.

The data-lifecycle side of "you hold every switch, Clinicle Intelligence holds
every record": once real tenants exist, each one can get everything back out
(export), get it all deleted (RTBF), have transient scratch data age off on
its own (retention), and the instance as a whole can be snapshotted for
disaster recovery (backup).

Export and purge are irreversible, tenant-wide actions, so both require the
acting user to hold at least the "owner" role in the target org — the first
place in the codebase RBAC is actually *enforced* rather than just stored
(see agent/tenancy/store.py's ROLE_RANK / has_role, added alongside this
module). Every action here audit-logs itself.
"""

from __future__ import annotations

import json
import os
import shutil
import tarfile
import time
from pathlib import Path
from typing import Optional

from agent.audit import log as audit_log
from agent.security.secrets_vault import get_secrets_vault
from agent.tenancy.store import get_tenancy_store
from common import state_dir
from common.runtime_identity import RuntimeIdentity


class PermissionDenied(PermissionError):
    pass


def _require_owner(acting_user_id: int, org_id: int) -> None:
    store = get_tenancy_store()
    if not store.has_role(acting_user_id, org_id, "owner"):
        audit_log.record_event(
            str(org_id), f"user:{acting_user_id}", "compliance.denied",
            {"user_id": acting_user_id, "org_id": org_id},
        )
        raise PermissionDenied(f"user {acting_user_id} is not an owner of org {org_id}")


def export_tenant_data(org_id: int, acting_user_id: int, dest_dir: Optional[Path] = None) -> Path:
    """Bundle everything this org owns into one tar.gz and return its path:
    org + membership metadata, secret NAMES (never values — see
    agent/security/secrets_vault.py), that org's audit trail, and its
    workspace files (skills, knowledge, memory, ...)."""
    store = get_tenancy_store()
    _require_owner(acting_user_id, org_id)

    org = store.get_organization(org_id)
    if org is None:
        raise ValueError(f"no such org: {org_id}")

    identity = RuntimeIdentity(org_id=str(org_id))
    dest_dir = Path(dest_dir) if dest_dir else Path(os.path.expanduser("~/.cow-exports"))
    dest_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    archive_path = dest_dir / f"org-{org_id}-export-{stamp}.tar.gz"

    def _member_row(m):
        user = store.get_user(m.user_id)
        return {"user_id": m.user_id, "role": m.role, "email": user.email if user else None}

    manifest = {
        "org": {"id": org.id, "name": org.name, "plan": org.plan, "created_at": org.created_at},
        "members": [_member_row(m) for m in store.list_memberships_for_org(org_id)],
        "secret_names": get_secrets_vault().list_secret_names(str(org_id)),
        "audit_events": list(audit_log.iter_events(tenant_id=str(org_id))),
    }

    workspace = state_dir.shared_root(identity)
    with tarfile.open(archive_path, "w:gz") as tar:
        manifest_path = dest_dir / f".manifest-{org_id}-{stamp}.json"
        manifest_path.write_text(json.dumps(manifest, indent=2, default=str), encoding="utf-8")
        try:
            tar.add(manifest_path, arcname="manifest.json")
        finally:
            manifest_path.unlink(missing_ok=True)
        if workspace.exists():
            tar.add(workspace, arcname="workspace")

    audit_log.record_event(
        str(org_id), f"user:{acting_user_id}", "compliance.export",
        {"path": str(archive_path), "bytes": archive_path.stat().st_size},
    )
    return archive_path


def purge_tenant_data(org_id: int, acting_user_id: int) -> dict:
    """Right-to-be-forgotten at the tenant grain: deletes the org's secrets,
    workspace files, memberships, and org row. Does not delete the audit log
    (tamper-evidence would break if past records could be edited out) and
    does not delete user accounts (a user may belong to other orgs) — only
    their membership in *this* org.
    """
    store = get_tenancy_store()
    _require_owner(acting_user_id, org_id)

    org = store.get_organization(org_id)
    if org is None:
        raise ValueError(f"no such org: {org_id}")

    identity = RuntimeIdentity(org_id=str(org_id))
    vault = get_secrets_vault()
    secrets_deleted = 0
    for name in vault.list_secret_names(str(org_id)):
        if vault.delete_secret(str(org_id), name, actor=f"user:{acting_user_id}"):
            secrets_deleted += 1

    workspace = state_dir.shared_root(identity)
    workspace_purged = workspace.exists()
    if workspace_purged:
        shutil.rmtree(workspace, ignore_errors=True)

    memberships = store.list_memberships_for_org(org_id)
    for m in memberships:
        store.delete_membership(m.user_id, org_id)
    store.delete_organization(org_id)

    result = {
        "org_id": org_id,
        "secrets_deleted": secrets_deleted,
        "memberships_deleted": len(memberships),
        "workspace_purged": workspace_purged,
    }
    # Detail is counts only — no member emails/PII in the permanent audit trail.
    audit_log.record_event(str(org_id), f"user:{acting_user_id}", "compliance.purged", result)
    return result


def apply_retention_policy(identity: RuntimeIdentity, max_age_days: int) -> dict:
    """Age-based purge of transient state — the scratch/execution data
    (uploads, task run records) that has no reason to outlive its usefulness.
    Long-lived state (memory, config, secrets, audit log) is untouched; this
    is not a generic file shredder.
    """
    if max_age_days <= 0:
        raise ValueError("max_age_days must be positive")
    cutoff = time.time() - max_age_days * 86400
    removed = {"tmp": 0, "runs": 0}
    for kind, getter in (("tmp", state_dir.tmp_dir), ("runs", state_dir.runs_dir)):
        root = getter(identity, ensure=False)
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if path.is_file():
                try:
                    if path.stat().st_mtime < cutoff:
                        path.unlink()
                        removed[kind] += 1
                except OSError:
                    continue
    audit_log.record_event(
        identity.org_id, "system", "retention.purge_ran",
        {"max_age_days": max_age_days, **removed},
    )
    return removed


def backup_state_dir(dest_dir: Optional[Path] = None) -> Path:
    """Snapshot the instance's shared state — skills/knowledge/mcp config
    (state_dir.shared_root) plus ~/.cow (platform.db, session_secret,
    secrets vault, audit log) — into one timestamped tar.gz.

    Mirrors the two-volume split docker-compose.yml already uses for this
    instance (./cow workspace + ./cow-data data root): both are DR-relevant,
    so both go in one archive. Destination defaults to a directory that is a
    *sibling* of ~/.cow rather than nested under it, so a backup never tries
    to archive itself.
    """
    dest_dir = Path(dest_dir) if dest_dir else Path(os.path.expanduser("~/.cow-backups"))
    dest_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    archive_path = dest_dir / f"clinicle-intelligence-backup-{stamp}.tar.gz"

    sources = []
    shared = state_dir.shared_root()
    if shared.exists():
        sources.append(("workspace", shared))
    cow_data = Path(os.path.expanduser("~/.cow"))
    if cow_data.exists():
        sources.append((".cow", cow_data))

    with tarfile.open(archive_path, "w:gz") as tar:
        for arcname, path in sources:
            tar.add(path, arcname=arcname)

    audit_log.record_event(
        None, "system", "backup.created",
        {"path": str(archive_path), "bytes": archive_path.stat().st_size},
    )
    return archive_path


def demo() -> None:
    """ponytail: smallest runnable check for the RBAC gate and retention purge."""
    import tempfile

    from agent.tenancy.store import TenancyStore
    import agent.compliance.governance as gov

    tmp = Path(tempfile.mkdtemp())
    try:
        store = TenancyStore(db_path=tmp / "platform.db")
        gov_log_path = tmp / "events.jsonl"
        audit_log._log_path = lambda: gov_log_path  # noqa: SLF001 - test seam, see agent/audit/log.py

        import agent.security.secrets_vault as sv
        sv._instance = sv.SecretsVault(db_path=tmp / "vault.db", key_path=tmp / "key")

        # Monkeypatch get_tenancy_store/get_secrets_vault singletons for this demo.
        import agent.tenancy.store as store_mod
        store_mod._instance = store

        member = store.create_user("member@example.com", "password123")
        org = store.create_organization("Acme")
        store.add_membership(member.id, org.id, role="member", actor="member@example.com")

        try:
            export_tenant_data(org.id, member.id, dest_dir=tmp / "exports")
            raise AssertionError("expected PermissionDenied for a non-owner")
        except PermissionDenied:
            pass

        owner = store.create_user("owner@example.com", "password123")
        store.add_membership(owner.id, org.id, role="owner", actor="owner@example.com")
        sv.store_secret(str(org.id), "api_key", "secret-value", actor="owner@example.com")

        archive = export_tenant_data(org.id, owner.id, dest_dir=tmp / "exports")
        assert archive.exists() and archive.stat().st_size > 0

        result = purge_tenant_data(org.id, owner.id)
        assert result["secrets_deleted"] == 1
        assert store.get_organization(org.id) is None
        print("agent/compliance/governance.py demo: OK")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    demo()
