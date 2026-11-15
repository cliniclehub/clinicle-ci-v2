# encoding:utf-8
"""agent/permission/execution_gate.py: the approval-gate decision layer.
Pure decision functions, tested against a fake registry rather than the
real one."""

from types import SimpleNamespace
from unittest.mock import patch

from agent.permission.execution_gate import is_gated_tool, requires_approval


def test_only_edit_and_write_are_gated_tools():
    assert is_gated_tool("edit") is True
    assert is_gated_tool("write") is True
    assert is_gated_tool("bash") is False
    assert is_gated_tool("read") is False


def _fake_registry(profile):
    registry = SimpleNamespace(get=lambda agent_id, require_enabled=False: profile)
    return registry


def test_requires_approval_true_when_agent_opted_in():
    profile = SimpleNamespace(require_approval_for_writes=True)
    with patch("agent.registry.get_agent_registry", return_value=_fake_registry(profile)):
        assert requires_approval("doctor", "edit") is True


def test_requires_approval_false_by_default():
    profile = SimpleNamespace(require_approval_for_writes=False)
    with patch("agent.registry.get_agent_registry", return_value=_fake_registry(profile)):
        assert requires_approval("doctor", "edit") is False


def test_requires_approval_false_for_a_non_gated_tool_even_if_opted_in():
    """The gate must never fire for a tool it doesn't cover, no matter what
    the Agent's flag says."""
    profile = SimpleNamespace(require_approval_for_writes=True)
    with patch("agent.registry.get_agent_registry", return_value=_fake_registry(profile)):
        assert requires_approval("doctor", "bash") is False


def test_requires_approval_degrades_to_false_on_a_broken_lookup():
    """A registry failure must never turn into 'block everything' -- it must
    read as 'not gated', same fallback discipline as every other
    agent/permission/* check in this codebase."""
    with patch("agent.registry.get_agent_registry", side_effect=RuntimeError("registry down")):
        assert requires_approval("doctor", "edit") is False


def test_requires_approval_degrades_to_false_for_an_unknown_agent_id():
    def _raise(agent_id, require_enabled=False):
        raise KeyError(agent_id)

    registry = SimpleNamespace(get=_raise)
    with patch("agent.registry.get_agent_registry", return_value=registry):
        assert requires_approval("ghost", "edit") is False
