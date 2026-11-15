# encoding:utf-8
"""agent/tools/tool_manager.py's ToolManager.reload_extension_tools(): an
admin-installed extension's tool_code (channel/web/api/extensions.py) lands
on disk under get_data_root()/extension_tools/ and must become an
actually-callable tool through the same directory-scan path
_load_tools_from_directory() already uses -- no separate exec() mechanism
to audit."""

from unittest.mock import patch

import pytest

from agent.tools.tool_manager import ToolManager


@pytest.fixture(autouse=True)
def _isolated_tool_manager():
    """A fresh, unregistered instance per test -- ToolManager is a
    workspace-keyed singleton (see its own __new__), so leaving a test
    instance in _instances would leak into unrelated tests/processes."""
    ToolManager.reset_instances()
    yield
    ToolManager.reset_instances()


def test_reload_extension_tools_registers_a_basetool_subclass_from_disk(tmp_path):
    ext_dir = tmp_path / "extension_tools"
    ext_dir.mkdir()
    (ext_dir / "demo.py").write_text(
        "from agent.tools.base_tool import BaseTool\n"
        "class DemoExtTool(BaseTool):\n"
        "    name = 'demo_ext_tool'\n",
        encoding="utf-8",
    )

    tm = ToolManager()
    with patch("config.get_data_root", return_value=str(tmp_path)):
        tm.reload_extension_tools()

    assert "demo_ext_tool" in tm.tool_classes


def test_reload_extension_tools_is_a_noop_when_the_directory_does_not_exist(tmp_path):
    tm = ToolManager()
    before = dict(tm.tool_classes)
    with patch("config.get_data_root", return_value=str(tmp_path)):
        tm.reload_extension_tools()  # tmp_path/extension_tools was never created

    assert tm.tool_classes == before


def test_reload_extension_tools_can_be_called_again_after_a_file_is_removed(tmp_path):
    """Removing the file alone (without unregister_extension_tool) does not
    drop the tool from an already-loaded ToolManager instance -- that's
    exactly why unregister_extension_tool exists as an explicit second
    step (see the test below), not something reload figures out on its
    own from a missing file."""
    ext_dir = tmp_path / "extension_tools"
    ext_dir.mkdir()
    tool_file = ext_dir / "demo.py"
    tool_file.write_text(
        "from agent.tools.base_tool import BaseTool\n"
        "class DemoExtTool(BaseTool):\n"
        "    name = 'demo_ext_tool'\n",
        encoding="utf-8",
    )

    tm = ToolManager()
    with patch("config.get_data_root", return_value=str(tmp_path)):
        tm.reload_extension_tools()
        tool_file.unlink()
        tm.reload_extension_tools()  # must not raise even though the file is gone

    assert "demo_ext_tool" in tm.tool_classes


def test_unregister_extension_tool_drops_it_from_tool_classes(tmp_path):
    ext_dir = tmp_path / "extension_tools"
    ext_dir.mkdir()
    (ext_dir / "demo.py").write_text(
        "from agent.tools.base_tool import BaseTool\n"
        "class DemoExtTool(BaseTool):\n"
        "    name = 'demo_ext_tool'\n",
        encoding="utf-8",
    )

    tm = ToolManager()
    with patch("config.get_data_root", return_value=str(tmp_path)):
        tm.reload_extension_tools()
        assert "demo_ext_tool" in tm.tool_classes
        tm.unregister_extension_tool("demo")

    assert "demo_ext_tool" not in tm.tool_classes


def test_unregister_extension_tool_on_an_unknown_id_is_a_noop():
    tm = ToolManager()
    tm.unregister_extension_tool("never-installed")  # must not raise
