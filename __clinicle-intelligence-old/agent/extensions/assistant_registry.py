"""Admin-installed extension assistant handlers (channel/web/api/
extensions.py's assistant_code field) -- a real Python callable loaded from
an on-disk .py file under get_data_root()/extension_assistants/<id>.py,
same exec-a-file-from-disk pattern as agent/tools/tool_manager.py's
ToolManager.reload_extension_tools and channel/channel_factory.py's
reload_extension_channels, not a separate mechanism.

An extension's assistant_code must define a module-level function
``handle(query: str, context: dict) -> str``. An Agent opts into it by
setting its own AgentProfile.custom_handler to the extension's id --
bridge/agent_bridge.py's agent_reply() checks that field early and, if
set, calls this handler directly instead of running the normal LLM tool
loop for that Agent's turns. Every existing Agent (and every new one by
default) has custom_handler=None, so nothing changes unless an admin
deliberately opts an Agent in.
"""

from pathlib import Path
from typing import Callable, Dict

_HANDLERS: Dict[str, Callable] = {}


def register_assistant_handler(name: str, fn: Callable) -> None:
    _HANDLERS[name] = fn


def unregister_assistant_handler(name: str) -> None:
    _HANDLERS.pop(name, None)


def get_assistant_handler(name: str):
    return _HANDLERS.get(name)


def reload_extension_assistants() -> None:
    """Scans get_data_root()/extension_assistants/*.py, registering each
    file's handle() function under the file's stem (== the extension's id).
    Safe to call again after install/toggle."""
    from config import get_data_root

    ext_dir = Path(get_data_root()) / "extension_assistants"
    if not ext_dir.is_dir():
        return
    for py_file in ext_dir.glob("*.py"):
        _load_extension_assistant_file(py_file)


def _load_extension_assistant_file(py_file) -> bool:
    """Loads one .py file's handle() function and registers it. Returns
    True if a callable handle() was found."""
    import importlib.util

    from common.log import logger

    py_file = Path(py_file)
    name = py_file.stem
    try:
        spec = importlib.util.spec_from_file_location(name, py_file)
        if not (spec and spec.loader):
            return False
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        handler = getattr(module, "handle", None)
        if callable(handler):
            register_assistant_handler(name, handler)
            return True
        logger.error(f"[AssistantRegistry] {py_file} has no callable 'handle(query, context)' function")
    except Exception as e:
        logger.error(f"[AssistantRegistry] Failed to load extension assistant {name!r}: {e}")
    return False
