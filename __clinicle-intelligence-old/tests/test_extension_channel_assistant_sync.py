# encoding:utf-8
"""channel/web/api/extensions.py's _sync_extension_channel_file/
_sync_extension_assistant_file/_sync_extension_code: the real on-disk
write/remove + registry wiring for channel_code and assistant_code,
exercised against a tmp_path instead of the process's real get_data_root()
-- test_extensions_api.py autouse-patches the whole _sync_extension_code
entry point for its own (HTTP-layer) tests, so these must live separately."""

from unittest.mock import patch

from channel import channel_factory
from channel.web.api import extensions as extensions_module
from agent.extensions import assistant_registry


def teardown_function():
    channel_factory._EXTENSION_CHANNELS.clear()
    assistant_registry._HANDLERS.clear()
    from channel.web.api.channels import ChannelsHandler
    ChannelsHandler.CHANNEL_DEFS.pop("my-ext", None)


def test_sync_channel_file_writes_and_registers_when_enabled(tmp_path):
    ext = {"id": "my-ext", "name": "My Ext", "channel_code": "x = 1", "enabled": True}
    with patch("config.get_data_root", return_value=str(tmp_path)):
        extensions_module._sync_extension_channel_file(ext)

    written = (tmp_path / "extension_channels" / "my-ext.py").read_text(encoding="utf-8")
    assert written == "x = 1"

    from channel.web.api.channels import ChannelsHandler
    assert "my-ext" in ChannelsHandler.CHANNEL_DEFS
    assert ChannelsHandler.CHANNEL_DEFS["my-ext"]["label"] == "My Ext"


def test_sync_channel_file_uses_channel_label_and_fields_when_given(tmp_path):
    ext = {
        "id": "my-ext", "name": "My Ext", "channel_code": "x = 1", "enabled": True,
        "channel_label": "Custom Label",
        "channel_fields": [{"key": "k", "label": "K", "type": "text"}],
    }
    with patch("config.get_data_root", return_value=str(tmp_path)):
        extensions_module._sync_extension_channel_file(ext)

    from channel.web.api.channels import ChannelsHandler
    assert ChannelsHandler.CHANNEL_DEFS["my-ext"]["label"] == "Custom Label"
    assert ChannelsHandler.CHANNEL_DEFS["my-ext"]["fields"] == [{"key": "k", "label": "K", "type": "text"}]


def test_sync_channel_file_removes_and_unregisters_when_disabled(tmp_path):
    ext_dir = tmp_path / "extension_channels"
    ext_dir.mkdir()
    (ext_dir / "my-ext.py").write_text("x = 1", encoding="utf-8")
    from channel.web.api.channels import ChannelsHandler
    ChannelsHandler.CHANNEL_DEFS["my-ext"] = {"label": "x", "icon": "", "color": "", "fields": []}

    ext = {"id": "my-ext", "name": "My Ext", "channel_code": "x = 1", "enabled": False}
    with patch("config.get_data_root", return_value=str(tmp_path)):
        extensions_module._sync_extension_channel_file(ext)

    assert not (ext_dir / "my-ext.py").exists()
    assert "my-ext" not in ChannelsHandler.CHANNEL_DEFS
    assert "my-ext" not in channel_factory._EXTENSION_CHANNELS


def test_sync_assistant_file_writes_and_registers_when_enabled(tmp_path):
    ext = {"id": "my-ext", "assistant_code": "def handle(q, c): return q", "enabled": True}
    with patch("config.get_data_root", return_value=str(tmp_path)):
        extensions_module._sync_extension_assistant_file(ext)

    written = (tmp_path / "extension_assistants" / "my-ext.py").read_text(encoding="utf-8")
    assert written == "def handle(q, c): return q"
    handler = assistant_registry.get_assistant_handler("my-ext")
    assert handler is not None
    assert handler("hi", {}) == "hi"


def test_sync_assistant_file_removes_and_unregisters_when_disabled(tmp_path):
    ext_dir = tmp_path / "extension_assistants"
    ext_dir.mkdir()
    (ext_dir / "my-ext.py").write_text("def handle(q, c): return q", encoding="utf-8")
    assistant_registry.register_assistant_handler("my-ext", lambda q, c: q)

    ext = {"id": "my-ext", "assistant_code": "def handle(q, c): return q", "enabled": False}
    with patch("config.get_data_root", return_value=str(tmp_path)):
        extensions_module._sync_extension_assistant_file(ext)

    assert not (ext_dir / "my-ext.py").exists()
    assert assistant_registry.get_assistant_handler("my-ext") is None


def test_sync_extension_code_runs_all_three_domain_syncs(tmp_path):
    ext = {
        "id": "my-ext", "name": "My Ext", "enabled": True,
        "tool_code": "from agent.tools.base_tool import BaseTool\nclass T(BaseTool):\n    name = 'my_tool'\n",
        "channel_code": "x = 1",
        "assistant_code": "def handle(q, c): return q",
    }
    with patch("config.get_data_root", return_value=str(tmp_path)), \
         patch("agent.tools.tool_manager.ToolManager.instances", return_value=[]):
        extensions_module._sync_extension_code(ext)

    assert (tmp_path / "extension_tools" / "my-ext.py").exists()
    assert (tmp_path / "extension_channels" / "my-ext.py").exists()
    assert (tmp_path / "extension_assistants" / "my-ext.py").exists()
