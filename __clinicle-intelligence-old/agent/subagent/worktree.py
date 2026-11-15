"""Per-task git worktree isolation for parallel sub agent work.

Opt-in per SubagentTask (``isolate_workspace=True`` -- see ``runner.py``'s
``_run_one``). Nothing here changes the default path: ``_build_child``'s
``child.project_dir = parent.project_dir`` stays the unconditional default
for every task that does not opt in; this module only supplies an
alternate directory for the ones that do.

Worktrees live under the system temp dir, never inside ``project_dir``
itself -- nesting them in the repo would make every one show up as an
untracked path in the PARENT's own next `git status`/bash call, which is
exactly the kind of side effect isolation exists to prevent.

Ceiling (ponytail: real corner cut here, know the limit): a worktree that
never gets cleaned up -- the process is killed outright, not just an
ordinary exception/timeout/cancel, all of which DO reach the ``finally`` in
``_run_one`` -- is orphaned. Upgrade path: a startup sweep calling
``git worktree prune``, or running it by hand; not built for this v1
because the temp dir it lives under is itself reclaimed on reboot by the OS,
which already bounds how long an orphan can linger.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from common.log import logger

# A fixed, single-machine location -- worktrees are a dev/ops concept tied to
# one project_dir on this one host, not multi-tenant business data, so this
# deliberately skips the per-org shared_root() scoping every real business
# store in this app uses.
_REGISTRY_PATH = Path(os.path.expanduser("~/.cow/pending_worktrees.json"))
_LOCK = threading.Lock()
# Untracked (never `git add`ed), so it never shows up in the sub agent's own
# `git status`/diffs and needs no cleanup -- it just disappears with the rest
# of the worktree directory on remove_worktree.
_BASE_MARKER = ".cow-worktree-base"


def _run_git(args, cwd: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, timeout=30,
    )


def create_worktree(project_dir: str, task_id: str) -> Optional[str]:
    """A fresh git worktree off ``project_dir``'s current HEAD, on a new
    branch, for one sub agent task. Returns the worktree's absolute path, or
    None when ``project_dir`` is not a git repo or creation otherwise fails --
    callers must fall back to sharing ``project_dir`` as before, never raise:
    a sub agent's isolation preference must not be able to break the task
    itself."""
    if not project_dir:
        return None
    try:
        check = _run_git(["rev-parse", "--is-inside-work-tree"], cwd=project_dir)
    except (OSError, subprocess.SubprocessError) as e:
        logger.debug(f"[Subagent] git not usable in {project_dir}: {e}")
        return None
    if check.returncode != 0 or check.stdout.strip() != "true":
        logger.debug(f"[Subagent] {project_dir} is not a git repo; isolation skipped")
        return None

    # mkdtemp both reserves a unique path and creates it; `git worktree add`
    # wants to create the leaf itself, so the placeholder is removed right
    # back before handing the path to git.
    worktree_path = tempfile.mkdtemp(prefix=f"cow-subagent-{task_id}-")
    os.rmdir(worktree_path)
    branch = f"subagent/{task_id}"

    try:
        result = _run_git(["worktree", "add", "-b", branch, worktree_path], cwd=project_dir)
    except (OSError, subprocess.SubprocessError) as e:
        logger.warning(f"[Subagent] git worktree add failed: {e}")
        return None
    if result.returncode != 0:
        logger.warning(f"[Subagent] git worktree add failed: {result.stderr.strip()}")
        return None

    # Record the branch's own fork point so has_changes() can later tell "the
    # sub agent committed something" apart from "the branch just exists" --
    # reflog entry count for this turned out to vary by git version (some
    # write one entry for `worktree add -b`, some two), so a plain marker
    # file is the robust choice over parsing reflog output.
    try:
        base = _run_git(["rev-parse", "HEAD"], cwd=worktree_path)
        if base.returncode == 0:
            (Path(worktree_path) / _BASE_MARKER).write_text(base.stdout.strip())
    except (OSError, subprocess.SubprocessError) as e:
        logger.debug(f"[Subagent] could not record worktree base commit: {e}")
    return worktree_path


def has_changes(worktree_path: str) -> bool:
    """Whether the isolated worktree has anything worth reviewing -- an
    uncommitted change, or a commit the sub agent made on its own branch.
    A clean worktree (task made no edits) is removed immediately by the
    caller instead of cluttering the merge-back queue with a no-op."""
    try:
        # The base marker itself is untracked and would otherwise always
        # show up as a change; excluded via pathspec rather than skipped by
        # name in Python, so it's excluded the same way regardless of which
        # git subcommand does the looking.
        status = _run_git(["status", "--porcelain", "--", ".", f":!{_BASE_MARKER}"], cwd=worktree_path)
        if status.returncode == 0 and status.stdout.strip():
            return True
        # No uncommitted changes -- check whether the sub agent also ran its
        # own `git commit` on top of the branch's recorded fork point.
        base_file = Path(worktree_path) / _BASE_MARKER
        if not base_file.exists():
            # No marker (e.g. a worktree from before this existed, or the
            # write failed) -- fall back to "has changes" rather than assume
            # a clean history we can't actually verify.
            return True
        base = base_file.read_text().strip()
        ahead = _run_git(["rev-list", "--count", f"{base}..HEAD"], cwd=worktree_path)
        return ahead.returncode == 0 and ahead.stdout.strip() != "0"
    except (OSError, subprocess.SubprocessError) as e:
        logger.debug(f"[Subagent] could not check worktree status for {worktree_path}: {e}")
        # Unknown state -- treat as "has changes" so nothing is silently
        # discarded; the admin can still discard it explicitly.
        return True


def _load_registry() -> List[Dict[str, Any]]:
    if not _REGISTRY_PATH.exists():
        return []
    try:
        return json.loads(_REGISTRY_PATH.read_text())
    except (OSError, ValueError):
        return []


def _save_registry(entries: List[Dict[str, Any]]) -> None:
    _REGISTRY_PATH.parent.mkdir(parents=True, exist_ok=True)
    _REGISTRY_PATH.write_text(json.dumps(entries, indent=2, ensure_ascii=False))


def register_pending_worktree(
    *, worktree_path: str, project_dir: str, branch: str, run_id: str,
    task_name: str = "", agent_id: str = "", summary: str = "", status: str = "completed",
) -> Dict[str, Any]:
    """Records a finished isolated-worktree task for a human's later
    Merge/Discard, instead of ``_run_one`` discarding it immediately."""
    entry = {
        "id": f"wt_{uuid.uuid4().hex[:12]}", "worktree_path": worktree_path,
        "project_dir": project_dir, "branch": branch, "run_id": run_id,
        "task_name": task_name, "agent_id": agent_id, "summary": summary,
        "status": status, "created_at": time.time(),
    }
    with _LOCK:
        entries = _load_registry()
        entries.append(entry)
        _save_registry(entries)
    return entry


def list_pending_worktrees() -> List[Dict[str, Any]]:
    return sorted(_load_registry(), key=lambda e: e.get("created_at", 0), reverse=True)


def merge_worktree(entry_id: str) -> Dict[str, Any]:
    """Merges the isolated branch back into ``project_dir``'s current branch
    with ``--no-ff`` (so the sub agent's work stays visible as its own merge
    commit), then removes the worktree and its registry entry.

    On conflict, the merge is left IN PROGRESS (not aborted): ``project_dir``
    sits mid-merge with conflict markers in the affected files, exactly the
    state ``get_merge_conflicts``/``resolve_conflict_hunks``/
    ``complete_merge`` below are built to work with (the Worktrees page's
    conflict-resolution UI). An admin who'd rather not use that UI can still
    resolve at the CLI as before -- this only stops silently discarding the
    attempt out from under them.
    """
    with _LOCK:
        entries = _load_registry()
        entry = next((e for e in entries if e["id"] == entry_id), None)
        if entry is None:
            return {"ok": False, "message": "Not found"}

        result = _run_git(["merge", "--no-ff", entry["branch"], "-m", f"Merge {entry['branch']}"], cwd=entry["project_dir"])
        if result.returncode != 0:
            entry["merge_conflict"] = True
            _save_registry(entries)
            return {
                "ok": False,
                "conflict": True,
                "message": f"Merge conflict -- resolve it below, or abort to leave {entry['worktree_path']} untouched.",
            }

        remove_worktree(entry["project_dir"], entry["worktree_path"])
        entries = [e for e in entries if e["id"] != entry_id]
        _save_registry(entries)
        return {"ok": True, "message": "Merged"}


def abort_merge_conflict(entry_id: str) -> Dict[str, Any]:
    """Backs out of a conflicted merge started by merge_worktree above,
    returning project_dir to clean and leaving the worktree + registry
    entry in place, same as the old auto-abort behavior -- just triggered
    by the admin's own choice now instead of happening automatically."""
    with _LOCK:
        entries = _load_registry()
        entry = next((e for e in entries if e["id"] == entry_id), None)
        if entry is None:
            return {"ok": False, "message": "Not found"}
        _run_git(["merge", "--abort"], cwd=entry["project_dir"])
        entry["merge_conflict"] = False
        _save_registry(entries)
        return {"ok": True, "message": "Merge aborted"}


def _is_binary_conflict(project_dir: str, rel_path: str) -> bool:
    """A binary conflict leaves the working-tree file as one side's raw
    content (git can't merge binaries, so it never inserts text conflict
    markers into it) -- git's own numstat/diff --stat output for an
    unmerged binary path is inconsistent to parse ("0\\t0" via --numstat,
    the literal word "Unmerged" via --stat), so this checks the file
    itself for a NUL byte in its first 8000 bytes, the same heuristic
    git's own buffer_is_binary uses."""
    try:
        with open(os.path.join(project_dir, rel_path), "rb") as f:
            return b"\x00" in f.read(8000)
    except OSError:
        return False


def get_merge_conflicts(entry_id: str) -> Dict[str, Any]:
    """The conflicting files of an in-progress merge (see merge_worktree).
    A text file is parsed into context/conflict blocks (a plain list) a UI
    can render side by side and resolve hunk by hunk -- see
    parse_conflict_markers/resolve_conflict_hunks. A binary file can't be
    hunk-diffed at all, so it comes back as {"binary": True} instead of a
    list -- resolve_binary_conflict is the only valid resolution for it, a
    whole-file pick of ours or theirs via git checkout --ours/--theirs.
    Returns {"ok": False, "message": ...} if there's no conflicted merge in
    progress for this entry."""
    entries = _load_registry()
    entry = next((e for e in entries if e["id"] == entry_id), None)
    if entry is None:
        return {"ok": False, "message": "Not found"}
    if not entry.get("merge_conflict"):
        return {"ok": False, "message": "No merge conflict in progress for this entry"}

    result = _run_git(["diff", "--name-only", "--diff-filter=U"], cwd=entry["project_dir"])
    files = [f for f in result.stdout.splitlines() if f.strip()]
    parsed: Dict[str, Any] = {}
    for rel_path in files:
        if _is_binary_conflict(entry["project_dir"], rel_path):
            parsed[rel_path] = {"binary": True}
            continue
        try:
            with open(os.path.join(entry["project_dir"], rel_path), "r", encoding="utf-8", errors="replace") as f:
                parsed[rel_path] = parse_conflict_markers(f.read())
        except OSError as e:
            logger.warning(f"[Worktree] could not read conflicted file {rel_path!r}: {e}")
    return {"ok": True, "files": parsed}


def resolve_binary_conflict(entry_id: str, rel_path: str, choice: str) -> Dict[str, Any]:
    """Whole-file resolution for a binary conflict -- there's no hunk to
    diff, so the only real choices are 'ours' or 'theirs' via git's own
    checkout --ours/--theirs, then stage it."""
    entries = _load_registry()
    entry = next((e for e in entries if e["id"] == entry_id), None)
    if entry is None:
        return {"ok": False, "message": "Not found"}
    if not entry.get("merge_conflict"):
        return {"ok": False, "message": "No merge conflict in progress for this entry"}
    if choice not in ("ours", "theirs"):
        return {"ok": False, "message": "choice must be 'ours' or 'theirs' for a binary file"}

    checkout_result = _run_git(["checkout", f"--{choice}", "--", rel_path], cwd=entry["project_dir"])
    if checkout_result.returncode != 0:
        return {"ok": False, "message": f"git checkout failed: {checkout_result.stderr.strip()}"}
    add_result = _run_git(["add", "--", rel_path], cwd=entry["project_dir"])
    if add_result.returncode != 0:
        return {"ok": False, "message": f"git add failed: {add_result.stderr.strip()}"}
    return {"ok": True, "message": "Resolved"}


def parse_conflict_markers(text: str) -> List[Dict[str, Any]]:
    """Splits a file's content at git's own conflict markers into an
    ordered list of blocks: {"type": "context", "text": ...} for
    unconflicted lines, {"type": "conflict", "ours": ..., "theirs": ...,
    "ours_label": ..., "theirs_label": ...} for each conflicting hunk.
    Reassembling a resolution is exactly picking one string per conflict
    block and concatenating everything back in order -- see
    resolve_conflict_hunks."""
    lines = text.split("\n")
    blocks: List[Dict[str, Any]] = []
    context: List[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("<<<<<<<"):
            if context:
                blocks.append({"type": "context", "text": "\n".join(context)})
                context = []
            ours_label = line[len("<<<<<<<"):].strip() or "ours"
            ours_lines: List[str] = []
            i += 1
            # diff3 style (git config merge.conflictstyle=diff3) inserts a
            # third "||||||| merged common ancestors" section between ours
            # and the ======= separator -- stop the ours scan there too, or
            # the base content would get folded into "ours".
            while i < len(lines) and not lines[i].startswith("=======") and not lines[i].startswith("|||||||"):
                ours_lines.append(lines[i])
                i += 1
            base_lines: Optional[List[str]] = None
            if i < len(lines) and lines[i].startswith("|||||||"):
                base_lines = []
                i += 1
                while i < len(lines) and not lines[i].startswith("======="):
                    base_lines.append(lines[i])
                    i += 1
            i += 1  # skip =======
            theirs_lines: List[str] = []
            while i < len(lines) and not lines[i].startswith(">>>>>>>"):
                theirs_lines.append(lines[i])
                i += 1
            theirs_label = lines[i][len(">>>>>>>"):].strip() if i < len(lines) else "theirs"
            block = {
                "type": "conflict",
                "ours": "\n".join(ours_lines),
                "theirs": "\n".join(theirs_lines),
                "ours_label": ours_label,
                "theirs_label": theirs_label,
            }
            if base_lines is not None:
                block["base"] = "\n".join(base_lines)
            blocks.append(block)
            i += 1  # skip >>>>>>> line
            continue
        context.append(line)
        i += 1
    if context:
        blocks.append({"type": "context", "text": "\n".join(context)})
    return blocks


def resolve_conflict_hunks(entry_id: str, rel_path: str, resolutions: List[str]) -> Dict[str, Any]:
    """Applies one resolution per conflict block ('ours'|'theirs'|<manual
    text>) in order, writes the reassembled file, and `git add`s it. The
    number of resolutions must match the number of conflict blocks the
    file actually has -- a mismatch means the client's view of the file is
    stale (e.g. the file changed between listing and resolving)."""
    entries = _load_registry()
    entry = next((e for e in entries if e["id"] == entry_id), None)
    if entry is None:
        return {"ok": False, "message": "Not found"}
    if not entry.get("merge_conflict"):
        return {"ok": False, "message": "No merge conflict in progress for this entry"}

    abs_path = os.path.join(entry["project_dir"], rel_path)
    try:
        with open(abs_path, "r", encoding="utf-8", errors="replace") as f:
            blocks = parse_conflict_markers(f.read())
    except OSError as e:
        return {"ok": False, "message": f"Could not read {rel_path}: {e}"}

    conflict_blocks = [b for b in blocks if b["type"] == "conflict"]
    if len(resolutions) != len(conflict_blocks):
        return {
            "ok": False,
            "message": f"Expected {len(conflict_blocks)} resolutions for {rel_path}, got {len(resolutions)}",
        }

    resolved_parts = []
    conflict_index = 0
    for block in blocks:
        if block["type"] == "context":
            resolved_parts.append(block["text"])
        else:
            choice = resolutions[conflict_index]
            conflict_index += 1
            if choice == "ours":
                resolved_parts.append(block["ours"])
            elif choice == "theirs":
                resolved_parts.append(block["theirs"])
            else:
                resolved_parts.append(choice)  # manual text, verbatim

    try:
        with open(abs_path, "w", encoding="utf-8") as f:
            f.write("\n".join(resolved_parts))
    except OSError as e:
        return {"ok": False, "message": f"Could not write {rel_path}: {e}"}

    add_result = _run_git(["add", rel_path], cwd=entry["project_dir"])
    if add_result.returncode != 0:
        return {"ok": False, "message": f"git add failed: {add_result.stderr.strip()}"}
    return {"ok": True, "message": "Resolved"}


def complete_merge(entry_id: str) -> Dict[str, Any]:
    """Finishes an in-progress merge once every conflicting file has been
    resolved (git add'ed) -- commits, then cleans up the worktree exactly
    like merge_worktree's own success path."""
    with _LOCK:
        entries = _load_registry()
        entry = next((e for e in entries if e["id"] == entry_id), None)
        if entry is None:
            return {"ok": False, "message": "Not found"}
        if not entry.get("merge_conflict"):
            return {"ok": False, "message": "No merge conflict in progress for this entry"}

        remaining = _run_git(["diff", "--name-only", "--diff-filter=U"], cwd=entry["project_dir"])
        unresolved = [f for f in remaining.stdout.splitlines() if f.strip()]
        if unresolved:
            return {"ok": False, "message": f"Still conflicted: {', '.join(unresolved)}"}

        commit_result = _run_git(["commit", "--no-edit"], cwd=entry["project_dir"])
        if commit_result.returncode != 0:
            return {"ok": False, "message": f"git commit failed: {commit_result.stderr.strip()}"}

        remove_worktree(entry["project_dir"], entry["worktree_path"])
        entries = [e for e in entries if e["id"] != entry_id]
        _save_registry(entries)
        return {"ok": True, "message": "Merged"}


def discard_worktree(entry_id: str) -> Dict[str, Any]:
    """Drops the isolated branch's work entirely: removes the worktree and
    its registry entry without merging."""
    with _LOCK:
        entries = _load_registry()
        entry = next((e for e in entries if e["id"] == entry_id), None)
        if entry is None:
            return {"ok": False, "message": "Not found"}
        remove_worktree(entry["project_dir"], entry["worktree_path"])
        entries = [e for e in entries if e["id"] != entry_id]
        _save_registry(entries)
        return {"ok": True, "message": "Discarded"}


def sweep_orphaned_worktrees(max_age_seconds: int = 86400) -> int:
    """Drops registry entries whose worktree directory no longer exists (the
    OS temp dir already reclaimed it, or a killed process left git's own
    metadata stale) and, for those, also runs ``git worktree prune`` in the
    project so git's own bookkeeping catches up. A registry entry whose
    directory still exists is left alone regardless of age -- age alone is
    never a reason to discard real, reachable work. Returns the number of
    entries pruned.

    Called twice, for two different reasons: once immediately at boot
    (``init_scheduler``, guarded there against its own frequent re-invocation
    -- see ``_worktree_swept_at_boot``), to catch orphans left by a crash
    before this process started; and again on its own recurring scheduled
    task (``_execute_worktree_sweep`` / ``system_worktree_sweep``, no guard
    needed since each firing is meant to do real work), to catch orphans a
    killed process leaves *during* this process's lifetime. Neither call site
    makes this function itself idempotent-by-skipping -- it always re-checks
    the registry against the real filesystem, which is cheap and correct to
    repeat."""
    with _LOCK:
        entries = _load_registry()
        keep, pruned_projects = [], set()
        for entry in entries:
            if os.path.isdir(entry.get("worktree_path", "")):
                keep.append(entry)
                continue
            age = time.time() - entry.get("created_at", 0)
            if age < max_age_seconds and entry.get("worktree_path"):
                # Directory momentarily missing but still recent -- keep it,
                # a transient filesystem hiccup shouldn't drop real work.
                keep.append(entry)
                continue
            pruned_projects.add(entry.get("project_dir", ""))
            logger.info(f"[Subagent] pruning orphaned worktree registry entry {entry.get('id')}")
        if len(keep) != len(entries):
            _save_registry(keep)
        for project_dir in pruned_projects:
            if project_dir:
                try:
                    _run_git(["worktree", "prune"], cwd=project_dir)
                except (OSError, subprocess.SubprocessError) as e:
                    logger.debug(f"[Subagent] git worktree prune failed for {project_dir}: {e}")
        return len(entries) - len(keep)


def remove_worktree(project_dir: str, worktree_path: str) -> None:
    """Best-effort cleanup, called from ``_run_one``'s ``finally``. Never
    raises: a cleanup failure must not surface as the task's own failure,
    since the task itself already finished by the time this runs."""
    if not worktree_path:
        return
    try:
        result = _run_git(["worktree", "remove", "--force", worktree_path], cwd=project_dir)
        if result.returncode != 0:
            logger.warning(
                f"[Subagent] could not remove worktree {worktree_path}: "
                f"{result.stderr.strip()}. It will be orphaned until a manual "
                "`git worktree prune` (or reclaimed with the OS temp dir)."
            )
    except (OSError, subprocess.SubprocessError) as e:
        logger.warning(f"[Subagent] could not remove worktree {worktree_path}: {e}")
