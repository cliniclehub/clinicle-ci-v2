# encoding:utf-8
"""agent/workspace/file_browser.py: the built-in Code Editor's safe
tree/read/write over one Agent's workspace root. Path-traversal protection
is the load-bearing part of this file -- most of these tests exist to prove
a request can never escape the given root."""

import pytest

from agent.workspace import file_browser


@pytest.fixture
def workspace(tmp_path):
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "a.py").write_text("x = 1\n")
    (root / "sub").mkdir()
    (root / "sub" / "b.py").write_text("y = 2\n")
    (root / "node_modules").mkdir()
    (root / "node_modules" / "junk.js").write_text("noise")
    (root / ".git").mkdir()
    outside = tmp_path / "outside.txt"
    outside.write_text("must never be reachable")
    return root


def test_list_tree_returns_files_and_dirs_sorted_dirs_first(workspace):
    entries = file_browser.list_tree(str(workspace), "")
    names = [e["name"] for e in entries]
    assert "sub" in names
    assert "a.py" in names
    assert names.index("sub") < names.index("a.py")


def test_list_tree_hides_ignored_and_dot_names(workspace):
    entries = file_browser.list_tree(str(workspace), "")
    names = {e["name"] for e in entries}
    assert "node_modules" not in names
    assert ".git" not in names


def test_list_tree_descends_into_a_subdirectory(workspace):
    entries = file_browser.list_tree(str(workspace), "sub")
    assert [e["name"] for e in entries] == ["b.py"]
    assert entries[0]["path"] == "sub/b.py"


def test_list_tree_rejects_a_path_that_escapes_the_root(workspace):
    with pytest.raises(file_browser.WorkspacePathError):
        file_browser.list_tree(str(workspace), "../")


def test_list_tree_rejects_an_absolute_path_outside_the_root(workspace, tmp_path):
    with pytest.raises(file_browser.WorkspacePathError):
        file_browser.list_tree(str(workspace), str(tmp_path / "outside.txt"))


def test_list_tree_on_a_file_not_a_dir_is_rejected(workspace):
    with pytest.raises(file_browser.WorkspacePathError):
        file_browser.list_tree(str(workspace), "a.py")


def test_read_file_returns_its_content(workspace):
    result = file_browser.read_file(str(workspace), "a.py")
    assert result["content"] == "x = 1\n"
    assert result["binary"] is False


def test_read_file_includes_the_absolute_path_for_text_files(workspace):
    """Lets the Code Editor offer an image preview for a text/XML file like
    SVG, the same way it does for a binary PNG (channel/web/api/files.py's
    FileServeHandler serves either by absolute path)."""
    result = file_browser.read_file(str(workspace), "a.py")
    assert result["abs_path"] == str(workspace / "a.py")


def test_read_file_rejects_traversal_outside_the_root(workspace):
    with pytest.raises(file_browser.WorkspacePathError):
        file_browser.read_file(str(workspace), "../outside.txt")


def test_read_file_rejects_a_directory(workspace):
    with pytest.raises(file_browser.WorkspacePathError):
        file_browser.read_file(str(workspace), "sub")


def test_read_file_detects_binary_content(workspace):
    binary_path = workspace / "image.bin"
    binary_path.write_bytes(b"\x00\x01\x02binary")
    result = file_browser.read_file(str(workspace), "image.bin")
    assert result["binary"] is True
    assert result["content"] is None


def test_read_file_includes_the_absolute_path_for_binary_files(workspace):
    binary_path = workspace / "image.bin"
    binary_path.write_bytes(b"\x00\x01\x02binary")
    result = file_browser.read_file(str(workspace), "image.bin")
    assert result["abs_path"] == str(binary_path)


def test_read_file_truncates_beyond_the_size_cap(workspace, monkeypatch):
    monkeypatch.setattr(file_browser, "MAX_FILE_BYTES", 10)
    (workspace / "big.txt").write_text("x" * 100)
    result = file_browser.read_file(str(workspace), "big.txt")
    assert result["truncated"] is True
    assert len(result["content"]) == 10


def test_write_file_creates_and_overwrites(workspace):
    file_browser.write_file(str(workspace), "a.py", "x = 42\n")
    assert (workspace / "a.py").read_text() == "x = 42\n"

    file_browser.write_file(str(workspace), "new.txt", "hello")
    assert (workspace / "new.txt").read_text() == "hello"


def test_write_file_rejects_traversal_outside_the_root(workspace):
    with pytest.raises(file_browser.WorkspacePathError):
        file_browser.write_file(str(workspace), "../escape.txt", "pwned")
    assert not (workspace.parent / "escape.txt").exists()


def test_write_file_rejects_an_oversized_payload(workspace, monkeypatch):
    monkeypatch.setattr(file_browser, "MAX_FILE_BYTES", 10)
    with pytest.raises(file_browser.WorkspacePathError):
        file_browser.write_file(str(workspace), "a.py", "x" * 100)


def test_write_file_rejects_writing_over_a_directory(workspace):
    with pytest.raises(file_browser.WorkspacePathError):
        file_browser.write_file(str(workspace), "sub", "nope")


def test_delete_file_removes_it(workspace):
    file_browser.delete_file(str(workspace), "a.py")
    assert not (workspace / "a.py").exists()


def test_delete_file_rejects_traversal_outside_the_root(workspace, tmp_path):
    outside = tmp_path / "outside.txt"
    with pytest.raises(file_browser.WorkspacePathError):
        file_browser.delete_file(str(workspace), "../outside.txt")
    assert outside.exists()


def test_delete_file_rejects_a_directory(workspace):
    with pytest.raises(file_browser.WorkspacePathError):
        file_browser.delete_file(str(workspace), "sub")
    assert (workspace / "sub").exists()


def test_delete_file_rejects_a_missing_file(workspace):
    with pytest.raises(file_browser.WorkspacePathError):
        file_browser.delete_file(str(workspace), "does-not-exist.py")
