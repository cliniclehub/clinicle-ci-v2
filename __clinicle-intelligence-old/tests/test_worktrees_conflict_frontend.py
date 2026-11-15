# encoding:utf-8
"""Frontend wiring for the Worktrees merge-conflict resolution modal
(channel/web/static/js/views/worktrees.js + templates/views/worktrees.html
+ static/css/worktrees.css) -- bounded v1: git's own conflict markers made
clickable, not a 3-way diff engine."""

from pathlib import Path

ROOT = Path(__file__).parents[1]


def _js():
    return (ROOT / "channel/web/static/js/views/worktrees.js").read_text(encoding="utf-8")


def _html():
    return (ROOT / "channel/web/templates/views/worktrees.html").read_text(encoding="utf-8")


def _css():
    return (ROOT / "channel/web/static/css/worktrees.css").read_text(encoding="utf-8")


def test_conflict_modal_exists_in_the_dom():
    html = _html()
    assert 'id="wt-conflict-modal"' in html
    assert 'id="wt-conflict-files"' in html
    assert 'onclick="wtAbortConflict()"' in html
    assert 'onclick="wtCompleteConflict()"' in html


def test_merge_action_response_with_conflict_flag_opens_the_modal():
    js = _js()
    body = js.split("function actionWorktree(entryId, action)")[1].split("\nfunction ")[0]
    assert "data.conflict" in body
    assert "wtOpenConflictModal(entryId)" in body


def test_default_hunk_choice_is_ours_and_picking_a_side_updates_the_dataset():
    js = _js()
    assert 'data-choice="ours"' in js
    assert "function wtChooseSide(el, side)" in js
    assert "hunk.dataset.choice = side" in js


def test_manual_edit_switches_the_hunk_choice_to_manual():
    js = _js()
    assert "function wtChooseManual(textarea)" in js
    assert "hunk.dataset.choice = 'manual'" in js


def test_completing_resolves_every_file_before_calling_complete():
    js = _js()
    complete_fn = js.split("function wtCompleteConflict()")[1].split("\nfunction ")[0]
    assert "_wtResolveAllFiles()" in complete_fn
    assert "/complete" in complete_fn


def test_abort_posts_the_abort_action_and_closes_the_modal():
    js = _js()
    abort_fn = js.split("function wtAbortConflict()")[1].split("\nfunction ")[0]
    assert "action: 'abort'" in abort_fn
    assert "wtCloseConflictModal()" in abort_fn


def test_modal_has_a_visible_hidden_state_toggle_in_css():
    css = _css()
    assert ".wt-conflict-modal.hidden" in css
    assert ".wt-conflict-ours.selected" in css
    assert ".wt-conflict-theirs.selected" in css


def test_binary_files_render_a_whole_file_ours_theirs_choice():
    js = _js()
    assert "blocks.binary" in js
    assert "function wtChooseBinarySide(el, side)" in js
    assert "resolve-binary" in js


def test_binary_choice_has_a_visible_selected_state_in_css():
    css = _css()
    assert ".wt-conflict-binary-btn.selected" in css
