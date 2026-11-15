# encoding:utf-8
"""bridge/agent_bridge.py's opt-in custom_handler hook: an Agent whose
AgentProfile.custom_handler names an installed extension assistant
(agent/extensions/assistant_registry.py) gets that handler's answer
directly, bypassing the entire LLM tool loop. Every Agent that doesn't set
custom_handler must be completely unaffected -- confirmed by not stubbing
out any of the normal loop below the hook and instead asserting it never
gets there when the hook doesn't fire."""

import threading
from types import SimpleNamespace

import pytest

from agent.extensions import assistant_registry
from agent.registry import AgentRegistry
from bridge.agent_bridge import AgentBridge
from bridge.reply import ReplyType


@pytest.fixture(autouse=True)
def _clear_handlers():
    yield
    assistant_registry._HANDLERS.clear()


def _bridge(tmp_path, custom_handler=None):
    registry = AgentRegistry.from_config(
        {
            "default_agent_id": "primary",
            "agents": [
                {
                    "id": "primary",
                    "name": "Primary",
                    "workspace": str(tmp_path / "primary"),
                    **({"custom_handler": custom_handler} if custom_handler else {}),
                },
            ],
        }
    )
    bridge = object.__new__(AgentBridge)
    bridge.agent_registry = registry
    bridge._agent_instances = {}
    bridge._default_agents = {}
    bridge._agents_lock = threading.RLock()
    bridge.agents = {}
    bridge.default_agent = None
    bridge.initializer = None  # must never be reached when the hook fires
    bridge.agent_router = SimpleNamespace(resolve_context=lambda ctx: "primary")
    return bridge


def test_an_agent_with_a_registered_custom_handler_gets_its_answer_directly(tmp_path):
    assistant_registry.register_assistant_handler("my-ext", lambda query, context: f"echo: {query}")
    bridge = _bridge(tmp_path, custom_handler="my-ext")

    reply = bridge.agent_reply("hello", context=None)

    assert reply.type == ReplyType.TEXT
    assert reply.content == "echo: hello"


def test_an_agent_without_custom_handler_is_unaffected(tmp_path):
    """The normal path isn't stubbed here on purpose: if the hook wrongly
    fired for an Agent with no custom_handler, it would return the
    handler's own text instead of falling through to the real (here,
    deliberately broken -- initializer=None) loop below. agent_reply wraps
    the whole method in a top-level try/except, so the break surfaces as an
    ERROR reply mentioning the real failure, not a raised exception."""
    assistant_registry.register_assistant_handler("my-ext", lambda q, c: "should never be seen")
    bridge = _bridge(tmp_path, custom_handler=None)

    reply = bridge.agent_reply("hello", context=None)

    assert reply.type == ReplyType.ERROR
    assert reply.content != "should never be seen"


def test_an_unregistered_custom_handler_name_returns_an_error_reply_not_a_crash(tmp_path):
    bridge = _bridge(tmp_path, custom_handler="never-installed")

    reply = bridge.agent_reply("hello", context=None)

    assert reply.type == ReplyType.ERROR
    assert "never-installed" in reply.content


def test_a_handler_that_raises_returns_an_error_reply_not_a_crash(tmp_path):
    def _broken(query, context):
        raise ValueError("boom")

    assistant_registry.register_assistant_handler("my-ext", _broken)
    bridge = _bridge(tmp_path, custom_handler="my-ext")

    reply = bridge.agent_reply("hello", context=None)

    assert reply.type == ReplyType.ERROR
    assert "Custom assistant handler failed" in reply.content


def test_the_handler_receives_the_context_kwargs_dict(tmp_path):
    from bridge.context import Context

    received = {}

    def _capture(query, context):
        received.update(context)
        return "ok"

    assistant_registry.register_assistant_handler("my-ext", _capture)
    bridge = _bridge(tmp_path, custom_handler="my-ext")

    bridge.agent_reply("hello", context=Context(kwargs={"session_id": "s1"}))

    assert received.get("session_id") == "s1"
