# encoding:utf-8
"""Export / RTBF / retention / DR-backup module (agent/compliance/governance.py)."""

import json
import os
import tarfile
import time

import pytest

import agent.compliance.governance as gov
from agent.audit import log as audit_log
from agent.security.secrets_vault import SecretsVault
from agent.tenancy.store import TenancyStore
from common.runtime_identity import RuntimeIdentity


@pytest.fixture
def wired(tmp_path, monkeypatch):
    """A TenancyStore + SecretsVault wired into governance's singletons, and
    shared_root/tmp_dir/runs_dir redirected under tmp_path so nothing touches
    the real ~/.cow or workspace."""
    monkeypatch.setattr(audit_log, "_log_path", lambda: tmp_path / "events.jsonl")

    store = TenancyStore(db_path=tmp_path / "platform.db")
    vault = SecretsVault(db_path=tmp_path / "vault.db", key_path=tmp_path / "key")
    monkeypatch.setattr(gov, "get_tenancy_store", lambda: store)
    monkeypatch.setattr(gov, "get_secrets_vault", lambda: vault)

    def _org_dir(root_kind):
        def fn(identity=None, ensure=False, base=None):
            org_id = identity.org_id if identity and identity.org_id else "default"
            path = tmp_path / root_kind / org_id
            if ensure:
                path.mkdir(parents=True, exist_ok=True)
            return path
        return fn

    monkeypatch.setattr(gov.state_dir, "shared_root", _org_dir("workspace"))
    monkeypatch.setattr(gov.state_dir, "tmp_dir", _org_dir("tmp"))
    monkeypatch.setattr(gov.state_dir, "runs_dir", _org_dir("runs"))

    return store, vault, tmp_path


def _owner_and_org(store, actor="owner@example.com"):
    user = store.create_user(actor, "password123")
    org = store.create_organization("Acme")
    store.add_membership(user.id, org.id, role="owner", actor=actor)
    return user, org


# -- RBAC gate ------------------------------------------------------------


def test_export_denied_for_non_owner(wired):
    store, vault, tmp_path = wired
    member = store.create_user("member@example.com", "password123")
    org = store.create_organization("Acme")
    store.add_membership(member.id, org.id, role="member", actor="member@example.com")

    with pytest.raises(gov.PermissionDenied):
        gov.export_tenant_data(org.id, member.id, dest_dir=tmp_path / "out")


def test_purge_denied_for_non_owner(wired):
    store, vault, tmp_path = wired
    member = store.create_user("member@example.com", "password123")
    org = store.create_organization("Acme")
    store.add_membership(member.id, org.id, role="member", actor="member@example.com")

    with pytest.raises(gov.PermissionDenied):
        gov.purge_tenant_data(org.id, member.id)

    # Denial itself must not silently do nothing invisibly — it's audited.
    events = [e["event_type"] for e in audit_log.iter_events(tenant_id=str(org.id))]
    assert "compliance.denied" in events


def test_admin_role_is_not_enough_owner_only(wired):
    store, vault, tmp_path = wired
    admin = store.create_user("admin@example.com", "password123")
    org = store.create_organization("Acme")
    store.add_membership(admin.id, org.id, role="admin", actor="admin@example.com")

    with pytest.raises(gov.PermissionDenied):
        gov.export_tenant_data(org.id, admin.id, dest_dir=tmp_path / "out")


# -- export -----------------------------------------------------------------


def test_export_produces_archive_with_manifest_and_workspace(wired):
    store, vault, tmp_path = wired
    owner, org = _owner_and_org(store)
    vault.store_secret(str(org.id), "api_key", "super-secret-value", actor="owner@example.com")

    ws = tmp_path / "workspace" / str(org.id)
    ws.mkdir(parents=True)
    (ws / "notes.md").write_text("hello")

    archive = gov.export_tenant_data(org.id, owner.id, dest_dir=tmp_path / "out")
    assert archive.exists()

    with tarfile.open(archive) as tar:
        names = tar.getnames()
        assert "manifest.json" in names
        assert "workspace/notes.md" in names
        manifest = json.loads(tar.extractfile("manifest.json").read())

    assert manifest["org"]["id"] == org.id
    assert manifest["secret_names"] == ["api_key"]
    # Secret VALUES must never appear in the export.
    assert "super-secret-value" not in json.dumps(manifest)


def test_export_is_audit_logged(wired):
    store, vault, tmp_path = wired
    owner, org = _owner_and_org(store)
    gov.export_tenant_data(org.id, owner.id, dest_dir=tmp_path / "out")

    events = [e for e in audit_log.iter_events(tenant_id=str(org.id), event_type="compliance.export")]
    assert len(events) == 1


# -- purge (right to be forgotten) ------------------------------------------


def test_purge_removes_secrets_workspace_and_org(wired):
    store, vault, tmp_path = wired
    owner, org = _owner_and_org(store)
    vault.store_secret(str(org.id), "api_key", "value", actor="owner@example.com")
    ws = tmp_path / "workspace" / str(org.id)
    ws.mkdir(parents=True)
    (ws / "notes.md").write_text("hello")

    result = gov.purge_tenant_data(org.id, owner.id)

    assert result["secrets_deleted"] == 1
    assert result["workspace_purged"] is True
    assert not ws.exists()
    assert store.get_organization(org.id) is None
    assert vault.list_secret_names(str(org.id)) == []


def test_purge_does_not_delete_audit_trail(wired):
    store, vault, tmp_path = wired
    owner, org = _owner_and_org(store)
    gov.purge_tenant_data(org.id, owner.id)

    # The purge event itself, and everything before it, must survive.
    events = list(audit_log.iter_events(tenant_id=str(org.id)))
    assert any(e["event_type"] == "compliance.purged" for e in events)
    assert audit_log.verify_chain() is True


def test_purge_detail_carries_no_pii(wired):
    store, vault, tmp_path = wired
    owner, org = _owner_and_org(store)
    result = gov.purge_tenant_data(org.id, owner.id)

    event = next(e for e in audit_log.iter_events(event_type="compliance.purged"))
    assert "owner@example.com" not in json.dumps(event)
    assert result == event["detail"]


# -- retention ----------------------------------------------------------


def test_retention_removes_only_old_files(wired):
    store, vault, tmp_path = wired
    identity = RuntimeIdentity(org_id="org-1")

    tmp_dir = tmp_path / "tmp" / "org-1"
    tmp_dir.mkdir(parents=True)
    old_file = tmp_dir / "old.bin"
    new_file = tmp_dir / "new.bin"
    old_file.write_text("stale")
    new_file.write_text("fresh")
    old_ts = time.time() - 40 * 86400
    os.utime(old_file, (old_ts, old_ts))

    result = gov.apply_retention_policy(identity, max_age_days=30)

    assert result["tmp"] == 1
    assert not old_file.exists()
    assert new_file.exists()


def test_retention_rejects_nonpositive_age(wired):
    with pytest.raises(ValueError):
        gov.apply_retention_policy(RuntimeIdentity(org_id="org-1"), max_age_days=0)


# -- DR backup ------------------------------------------------------------


def test_backup_archives_shared_root(wired):
    store, vault, tmp_path = wired
    ws = tmp_path / "workspace" / "default"
    ws.mkdir(parents=True)
    (ws / "skills.json").write_text("{}")

    archive = gov.backup_state_dir(dest_dir=tmp_path / "backups")
    assert archive.exists()
    with tarfile.open(archive) as tar:
        assert "workspace/skills.json" in tar.getnames()
