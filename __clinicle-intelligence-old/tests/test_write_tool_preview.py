# encoding:utf-8
"""agent/tools/write/write.py's preview(): the approval gate's diff source
for the write tool. Must never touch the file on disk."""

import os
import tempfile

from agent.tools.write.write import Write


def _tool(work):
    return Write({"cwd": work})


def test_preview_of_a_new_file_leaves_nothing_on_disk():
    with tempfile.TemporaryDirectory() as work:
        path = os.path.join(work, "new.txt")
        result = _tool(work).preview({"path": path, "content": "hello\n"})

        assert result.status == "success"
        assert result.result["is_new_file"] is True
        assert not os.path.exists(path)


def test_preview_of_an_overwrite_diffs_against_existing_content():
    with tempfile.TemporaryDirectory() as work:
        path = os.path.join(work, "existing.txt")
        with open(path, "w", encoding="utf-8") as f:
            f.write("old\n")

        result = _tool(work).preview({"path": path, "content": "new\n"})

        assert result.status == "success"
        assert result.result["is_new_file"] is False
        assert "old" in result.result["diff"]
        assert "new" in result.result["diff"]
        # Untouched by preview.
        with open(path, encoding="utf-8") as f:
            assert f.read() == "old\n"


def test_preview_missing_path_fails_like_execute():
    with tempfile.TemporaryDirectory() as work:
        preview = _tool(work).preview({"content": "x"})
        applied = _tool(work).execute({"content": "x"})
        assert preview.status == "error" == applied.status
        assert preview.result == applied.result


def test_preview_rejects_line_numbered_content_like_execute():
    with tempfile.TemporaryDirectory() as work:
        path = os.path.join(work, "f.txt")
        args = {"path": path, "content": "12|some line\n13|another"}
        preview = _tool(work).preview(args)
        assert preview.status == "error"
        assert "line-number prefixes" in preview.result
        assert not os.path.exists(path)
