# encoding:utf-8
"""channel/web/api/extensions.py's _sync_extension_tool_file: the real
on-disk write/remove of an extension's tool_code, plus asking every live
ToolManager instance to pick it up via reload_extension_tools(). Kept in
its own file (unlike test_extensions_api.py) because it must call the REAL
function against a tmp_path -- test_extensions_api.py autouse-patches this
exact function to a no-op for its own (HTTP-layer) tests."""

import types
from unittest.mock import patch

from channel.web.api import extensions as extensions_module


def test_sync_writes_the_tool_code_file_when_enabled(tmp_path):
    with patch("config.get_data_root", return_value=str(tmp_path)), \
         patch("agent.tools.tool_manager.ToolManager.instances", return_value=[]):
        extensions_module._sync_extension_tool_file({"id": "my-ext", "tool_code": "x = 1", "enabled": True})

    written = (tmp_path / "extension_tools" / "my-ext.py").read_text(encoding="utf-8")
    assert written == "x = 1"


def test_sync_removes_the_file_when_disabled(tmp_path):
    ext_dir = tmp_path / "extension_tools"
    ext_dir.mkdir()
    (ext_dir / "my-ext.py").write_text("x = 1", encoding="utf-8")

    with patch("config.get_data_root", return_value=str(tmp_path)), \
         patch("agent.tools.tool_manager.ToolManager.instances", return_value=[]):
        extensions_module._sync_extension_tool_file({"id": "my-ext", "tool_code": "x = 1", "enabled": False})

    assert not (ext_dir / "my-ext.py").exists()


def test_sync_removes_the_file_when_tool_code_is_absent(tmp_path):
    ext_dir = tmp_path / "extension_tools"
    ext_dir.mkdir()
    (ext_dir / "my-ext.py").write_text("x = 1", encoding="utf-8")

    with patch("config.get_data_root", return_value=str(tmp_path)), \
         patch("agent.tools.tool_manager.ToolManager.instances", return_value=[]):
        extensions_module._sync_extension_tool_file({"id": "my-ext", "tool_code": "", "enabled": True})

    assert not (ext_dir / "my-ext.py").exists()


def test_sync_asks_every_live_tool_manager_instance_to_reload(tmp_path):
    fake_instance = types.SimpleNamespace(reload_extension_tools=lambda: fake_instance.__setattr__("reloaded", True))
    fake_instance.reloaded = False

    with patch("config.get_data_root", return_value=str(tmp_path)), \
         patch("agent.tools.tool_manager.ToolManager.instances", return_value=[fake_instance]):
        extensions_module._sync_extension_tool_file({"id": "my-ext", "tool_code": "x = 1", "enabled": True})

    assert fake_instance.reloaded is True
