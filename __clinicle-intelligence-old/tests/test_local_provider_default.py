# encoding:utf-8
"""
The local (zero-cloud) inference backend must be selected by default when no
cloud provider is explicitly configured — Clinicle Intelligence's promise is that an
unconfigured install never silently calls a public cloud API.

Covers:
  - AgentLLMModel._resolve_bot_type() falling back to const.LOCAL, not a cloud
    provider, when bot_type/model name out an explicit choice
  - Bridge.__init__ defaulting self.btype["chat"] to const.LOCAL the same way
  - ChatGPTBot resolving local_api_key/local_api_base/local_model when built
    for bot_type "local"
  - An explicitly configured cloud provider still wins (opt-in, not removed)
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import config as config_module
from common import const
from config import Config


def set_conf(d):
    """Install a fresh Config as the global config used by conf()."""
    config_module.config = Config(d)


class TestAgentLLMModelDefaultsLocal:
    def test_no_model_or_bot_type_resolves_to_local(self, monkeypatch):
        set_conf({})
        from bridge.agent_bridge import AgentLLMModel

        model = AgentLLMModel.__new__(AgentLLMModel)
        assert model._resolve_bot_type("") == const.LOCAL

    def test_unrecognized_model_name_resolves_to_local(self, monkeypatch):
        """A local model name (e.g. one pulled in Ollama) matches no cloud
        provider prefix, so it must stay on the local backend rather than
        falling through to a cloud default."""
        set_conf({"model": "llama3.1"})
        from bridge.agent_bridge import AgentLLMModel

        model = AgentLLMModel.__new__(AgentLLMModel)
        assert model._resolve_bot_type("llama3.1") == const.LOCAL

    def test_explicit_cloud_model_still_wins(self, monkeypatch):
        """A cloud provider stays available as an opt-in choice."""
        set_conf({"model": "deepseek-chat"})
        from bridge.agent_bridge import AgentLLMModel

        model = AgentLLMModel.__new__(AgentLLMModel)
        assert model._resolve_bot_type("deepseek-chat") == const.DEEPSEEK


class TestBridgeDefaultsLocal:
    def test_bridge_defaults_chat_to_local(self):
        set_conf({})
        from bridge.bridge import Bridge

        # Bridge is @singleton; new_instance() builds an uncached one so this
        # test doesn't depend on (or disturb) process-wide Bridge state.
        bridge = Bridge.new_instance()
        assert bridge.get_bot_type("chat") == const.LOCAL


class TestChatGPTBotResolvesLocalCredentials:
    def test_default_local_endpoint_and_key(self):
        set_conf({"model": "llama3.1"})
        from models.bot_factory import create_bot

        # Real callers (AgentLLMModel.bot) pass the resolved type as both the
        # bot_type and the credential_bot_type; mirror that here.
        bot = create_bot(const.LOCAL, credential_bot_type=const.LOCAL)
        assert bot._api_base == "http://localhost:11434/v1"
        assert bot._api_key == "ollama"

    def test_configured_local_endpoint_and_model_override(self):
        set_conf({
            "model": "llama3.1",
            "local_api_key": "sk-local",
            "local_api_base": "http://localhost:8000/v1",
            "local_model": "qwen2.5:14b",
        })
        from models.bot_factory import create_bot

        bot = create_bot(const.LOCAL, credential_bot_type=const.LOCAL)
        assert bot._api_base == "http://localhost:8000/v1"
        assert bot._api_key == "sk-local"
        assert bot.args["model"] == "qwen2.5:14b"
