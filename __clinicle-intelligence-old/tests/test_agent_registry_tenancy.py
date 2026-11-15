# encoding:utf-8
"""Proves the org isolation boundary before anything is wired to rely on it.

Per the approved plan (~/.claude/plans/typed-pondering-owl.md): two orgs must
resolve to disjoint AgentRegistry instances, rooted under disjoint directory
trees, purely from get_agent_registry(org_id=...). This must be green before
state_root()/auth.py are touched to actually use it.
"""

from agent.registry import get_agent_registry
from common import state_dir
from common.runtime_identity import RuntimeIdentity
from config import conf


def test_default_call_unaffected_by_org_support(monkeypatch, tmp_path):
    """The overwhelming majority of call sites pass no org_id at all — that
    path must behave exactly as it did before this feature existed."""
    monkeypatch.setitem(conf(), "agent_workspace", str(tmp_path / "cow"))
    registry = get_agent_registry()
    default = registry.get(require_enabled=False)
    assert default.workspace == str(tmp_path / "cow")


def test_two_orgs_get_disjoint_registries(monkeypatch, tmp_path):
    monkeypatch.setitem(conf(), "agent_workspace", str(tmp_path / "cow"))

    registry_a = get_agent_registry(org_id="org-a")
    registry_b = get_agent_registry(org_id="org-b")

    workspace_a = registry_a.get(require_enabled=False).workspace
    workspace_b = registry_b.get(require_enabled=False).workspace

    assert workspace_a != workspace_b
    # Neither tenant lands on the shared global default — a bug here would
    # mean every org's agent reads/writes the same directory.
    assert workspace_a != str(tmp_path / "cow")
    assert workspace_b != str(tmp_path / "cow")


def test_same_org_id_is_cached_not_rebuilt(monkeypatch, tmp_path):
    monkeypatch.setitem(conf(), "agent_workspace", str(tmp_path / "cow"))
    first = get_agent_registry(org_id="org-a")
    second = get_agent_registry(org_id="org-a")
    assert first is second


def test_org_registry_survives_alongside_default_registry(monkeypatch, tmp_path):
    """Calling with an org_id must not corrupt the no-org-id singleton path,
    and vice versa — they are separate caches by construction."""
    monkeypatch.setitem(conf(), "agent_workspace", str(tmp_path / "cow"))
    default_before = get_agent_registry()
    get_agent_registry(org_id="org-a")
    default_after = get_agent_registry()
    assert default_before.get(require_enabled=False).workspace == \
        default_after.get(require_enabled=False).workspace


def test_shared_root_isolates_credentials_and_knowledge_per_org(monkeypatch, tmp_path):
    """shared_root() is where skills/knowledge/MCP-config/API-key files live
    (env_file, mcp_config_file, knowledge_dir, skills_dir all go through it).
    Two orgs must never resolve to the same directory here — that would mean
    one org's agent could read another org's API keys."""
    monkeypatch.setitem(conf(), "agent_workspace", str(tmp_path / "cow"))

    root_a = state_dir.shared_root(RuntimeIdentity(org_id="org-a"))
    root_b = state_dir.shared_root(RuntimeIdentity(org_id="org-b"))
    root_default = state_dir.shared_root()

    assert root_a != root_b
    assert root_a != root_default
    assert root_b != root_default

    # The concrete paths that actually hold secrets/knowledge — not just the
    # root, in case a future refactor makes the root shared while a specific
    # file helper forgets to thread identity through.
    env_a = state_dir.env_file(RuntimeIdentity(org_id="org-a"))
    env_b = state_dir.env_file(RuntimeIdentity(org_id="org-b"))
    assert env_a != env_b
