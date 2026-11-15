# encoding:utf-8
"""agent/extensions/assistant_registry.py: an admin-installed extension's
assistant_code becomes a real, callable handle(query, context) function --
the same on-disk directory-scan pattern as ToolManager's extension tools
and channel_factory's extension channels."""

from unittest.mock import patch

from agent.extensions import assistant_registry


def teardown_function():
    assistant_registry._HANDLERS.clear()


def test_register_and_get_assistant_handler():
    fn = lambda query, context: "hi"
    assistant_registry.register_assistant_handler("demo", fn)
    assert assistant_registry.get_assistant_handler("demo") is fn


def test_get_assistant_handler_for_an_unknown_name_returns_none():
    assert assistant_registry.get_assistant_handler("nope") is None


def test_unregister_assistant_handler_removes_it():
    assistant_registry.register_assistant_handler("demo", lambda q, c: "hi")
    assistant_registry.unregister_assistant_handler("demo")
    assert assistant_registry.get_assistant_handler("demo") is None


def test_unregister_an_unknown_name_is_a_noop():
    assistant_registry.unregister_assistant_handler("never-registered")


def test_reload_extension_assistants_registers_a_handle_function(tmp_path):
    ext_dir = tmp_path / "extension_assistants"
    ext_dir.mkdir()
    (ext_dir / "demo.py").write_text(
        "def handle(query, context):\n    return 'echo: ' + query\n",
        encoding="utf-8",
    )
    with patch("config.get_data_root", return_value=str(tmp_path)):
        assistant_registry.reload_extension_assistants()

    handler = assistant_registry.get_assistant_handler("demo")
    assert handler is not None
    assert handler("hello", {}) == "echo: hello"


def test_reload_extension_assistants_is_a_noop_when_the_directory_is_missing(tmp_path):
    with patch("config.get_data_root", return_value=str(tmp_path)):
        assistant_registry.reload_extension_assistants()  # must not raise


def test_a_file_without_a_handle_function_is_not_registered(tmp_path):
    ext_dir = tmp_path / "extension_assistants"
    ext_dir.mkdir()
    (ext_dir / "broken.py").write_text("x = 1\n", encoding="utf-8")
    with patch("config.get_data_root", return_value=str(tmp_path)):
        assistant_registry.reload_extension_assistants()
    assert assistant_registry.get_assistant_handler("broken") is None
