# encoding:utf-8
"""memory_search results must carry an unmissable source citation.

Faheem's knowledge base must answer strictly from the user's own indexed
documents and name which document an answer came from. The model writes the
final reply itself, so the only place a citation contract can be enforced in
code is the tool result it reads before writing that reply: each hit must
label its document path as a "Source:", not bury it in an unlabeled line the
model can drop while summarizing.
"""

import asyncio
import types

from agent.memory.config import MemoryConfig
from agent.memory.manager import MemoryManager
from agent.tools.memory.memory_search import MemorySearchTool


def _manager(workspace) -> MemoryManager:
    manager = MemoryManager(config=MemoryConfig(workspace_root=str(workspace)))
    manager._init_workspace()
    return manager


def test_search_result_labels_the_source_document(tmp_path):
    workspace = tmp_path / "workspace"
    (workspace / "knowledge" / "concepts").mkdir(parents=True)
    (workspace / "knowledge" / "concepts" / "moe.md").write_text(
        "# MoE\nMIXTUREOFEXPERTS4471 is a sparse routing architecture.\n",
        encoding="utf-8",
    )

    manager = _manager(workspace)
    asyncio.run(manager.sync())

    tool = MemorySearchTool(manager)
    result = tool.execute({"query": "MIXTUREOFEXPERTS4471"})

    assert result.status == "success"
    assert "Source: knowledge/concepts/moe.md" in result.result
    assert "cite the source path" in result.result


def test_no_results_still_returns_a_clear_message(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True)
    manager = _manager(workspace)

    tool = MemorySearchTool(manager)
    result = tool.execute({"query": "NONEXISTENTTOKEN0000"})

    assert result.status == "success"
    assert "No memories found" in result.result
