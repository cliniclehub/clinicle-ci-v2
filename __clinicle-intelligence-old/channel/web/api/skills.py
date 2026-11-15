"""The skills view's endpoints: /api/tools and /api/skills.

The built-in tools the Agent can call, the skills installed alongside them,
and the viewer that reads a skill's definition file.
"""

import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import web

from channel.web.core._common import (
    _get_workspace_root,
    _request_agent_id,
    _require_auth,
    _require_capability,
)
from common.log import logger

_GITHUB_SHORTHAND_RE = re.compile(r"^[\w.-]+/[\w.-]+$")


def _normalize_skill_source(source: str) -> str:
    """GitHub shorthand ('owner/repo') to a full clone URL, same convention
    npx skills/vercel-labs' own CLI accepts -- otherwise the URL as given.

    Restricted to https:// (or bare shorthand, which resolves to https)
    deliberately: this triggers a server-side git clone from user input, so
    file://, git://, ssh:// and similar schemes that could reach local paths
    or use unintended credentials are rejected outright.
    """
    source = source.strip()
    if _GITHUB_SHORTHAND_RE.match(source):
        return f"https://github.com/{source}.git"
    if not source.startswith("https://"):
        raise ValueError("source must be an https:// URL or an 'owner/repo' GitHub shorthand")
    return source


def install_skill_from_repo(source: str, *, agent_id: str = "") -> dict:
    """Clone a skill repo and copy its SKILL.md-defined skill into this
    Agent's skills directory -- same SKILL.md convention this app already
    uses for its own skills, so nothing about the loader changes.

    Only the repo root is checked for SKILL.md (the common case, and what
    a single-skill repo like most of vercel-labs/skills' examples use);
    a multi-skill monorepo needing a subdirectory is not handled here.
    """
    from common import state_dir

    url = _normalize_skill_source(source)
    with tempfile.TemporaryDirectory(prefix="skill-install-") as tmpdir:
        try:
            subprocess.run(
                ["git", "clone", "--depth", "1", url, tmpdir],
                capture_output=True, text=True, timeout=30, check=True,
            )
        except subprocess.CalledProcessError as e:
            raise ValueError(f"Could not clone {source}: {e.stderr.strip()[:300]}") from e
        except subprocess.TimeoutExpired as e:
            raise ValueError(f"Cloning {source} timed out") from e

        skill_md = Path(tmpdir) / "SKILL.md"
        if not skill_md.is_file():
            raise FileNotFoundError(
                f"No SKILL.md found at the root of {source} -- only single-skill "
                "repos (SKILL.md at the repo root) are supported"
            )

        name = Path(tmpdir).name
        match = re.search(r"^name:\s*(\S+)", skill_md.read_text(encoding="utf-8"), re.MULTILINE)
        if match:
            name = match.group(1).strip()

        workspace_root = _get_workspace_root(agent_id=agent_id)
        dest = state_dir.skills_dir(base=workspace_root, ensure=True) / name
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(tmpdir, dest, ignore=shutil.ignore_patterns(".git"))

    logger.info(f"[Skills] Installed '{name}' from {source} into agent '{agent_id or 'default'}'")
    return {"name": name, "source": source}


class ToolsHandler:
    def GET(self):
        _require_auth()
        _require_capability("settings.general")
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            from agent.tools.base_tool import is_tool_available
            from agent.tools.tool_manager import ToolManager
            from common import i18n
            tm = ToolManager()
            if not tm.tool_classes:
                tm.load_tools()
            tools = []
            lang = i18n.get_language()
            for name, cls in tm.tool_classes.items():
                try:
                    instance = cls()
                    desc = instance.description
                    if lang == "en" and name == "scheduler":
                        desc = (
                            "Create, query and manage scheduled tasks (reminders, periodic tasks, etc.).\n\n"
                            "⚠️ IMPORTANT: Only use this tool when delayed or periodic execution is needed."
                        )
                    tools.append({
                        "name": name,
                        "description": desc,
                        "available": is_tool_available(instance),
                    })
                except Exception:
                    tools.append({"name": name, "description": "", "available": True})
            return json.dumps({"status": "success", "tools": tools}, ensure_ascii=False)
        except Exception as e:
            logger.error(f"[WebChannel] Tools API error: {e}")
            return json.dumps({"status": "error", "message": str(e)})


def _skill_service(agent_id: str = ''):
    """
    A SkillService over the skills the console manages.

    Skills stay anchored to the agent's state root even while a session has a
    project open, so this deliberately resolves the workspace without a session.
    ``agent_id`` selects which agent's skills to manage, so a multi-agent setup
    keeps each agent's library isolated.
    """
    from agent.skills.manager import SkillManager
    from agent.skills.service import SkillService
    from common import state_dir
    workspace_root = _get_workspace_root(agent_id=agent_id or None)
    custom_dir = str(state_dir.skills_dir(base=workspace_root))
    return SkillService(SkillManager(custom_dir=custom_dir))


class SkillsHandler:
    def GET(self):
        _require_auth()
        _require_capability("settings.general")
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            from common import i18n
            params = web.input(agent_id='')
            # The library page lists everything installed, unnarrowed by the
            # Agent's selection: a skill it has not selected still has to be
            # visible here for the selection to be editable at all.
            service = _skill_service(_request_agent_id(params))
            skills = service.query()
            return json.dumps({"status": "success", "skills": skills}, ensure_ascii=False)
        except Exception as e:
            logger.error(f"[WebChannel] Skills API error: {e}")
            return json.dumps({"status": "error", "message": str(e)})

    def POST(self):
        _require_auth()
        _require_capability("settings.general")
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            body = json.loads(web.data())
            action = body.get("action")
            if not action:
                return json.dumps({"status": "error", "message": "action is required"})
            if action == "install":
                source = str(body.get("source") or "").strip()
                if not source:
                    return json.dumps({"status": "error", "message": "source is required"})
                agent_id = _request_agent_id(body)
                try:
                    installed = install_skill_from_repo(source, agent_id=agent_id)
                except (ValueError, FileNotFoundError) as e:
                    return json.dumps({"status": "error", "message": str(e)})
                return json.dumps({"status": "success", "installed": installed}, ensure_ascii=False)

            name = body.get("name")
            if not name:
                return json.dumps({"status": "error", "message": "name is required"})
            service = _skill_service(_request_agent_id(body))
            if action == "open":
                service.open({"name": name})
            elif action == "close":
                service.close({"name": name})
            else:
                return json.dumps({"status": "error", "message": f"unknown action: {action}"})
            return json.dumps({"status": "success"}, ensure_ascii=False)
        except Exception as e:
            logger.error(f"[WebChannel] Skills POST error: {e}")
            return json.dumps({"status": "error", "message": str(e)})


class SkillContentHandler:
    """
    A skill's definition file, for the console's viewer and editor.

    Addressed by skill name rather than by path, because the loader is what
    resolves a name to a file: a workspace skill shadows a builtin of the same
    name, and a builtin sits outside the workspace that the file APIs are
    confined to.

    Unlike the skill list, the text is served exactly as stored - no
    simplified-to-traditional conversion. What comes back here is what a save
    would write, and rewriting someone's file into another script because of
    the console's display language is not a conversion they asked for.
    """

    def GET(self):
        _require_auth()
        _require_capability("settings.general")
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            params = web.input(name='', agent_id='')
            name = (params.name or '').strip()
            if not name:
                return json.dumps({"status": "error", "message": "name is required"})
            result = _skill_service(_request_agent_id(params)).read_content(name)
            return json.dumps({"status": "success", **result}, ensure_ascii=False)
        except (ValueError, FileNotFoundError) as e:
            return json.dumps({"status": "error", "message": str(e)})
        except Exception as e:
            logger.error(f"[WebChannel] Skill content error: {e}")
            return json.dumps({"status": "error", "message": str(e)})

    def POST(self):
        _require_auth()
        _require_capability("settings.general")
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            from agent.workspace.service import WorkspaceConflictError

            body = json.loads(web.data() or b'{}')
            name = (body.get("name") or "").strip()
            if not name:
                return json.dumps({"status": "error", "message": "name is required"})
            content = body.get("content")
            if not isinstance(content, str):
                return json.dumps({"status": "error", "message": "content must be a string"})

            try:
                result = _skill_service(_request_agent_id(body)).write_content(
                    name, content, expected_mtime=body.get("expected_mtime"),
                )
            except WorkspaceConflictError as e:
                return json.dumps({"status": "error", "code": "conflict", "message": str(e)})

            logger.info(f"[WebChannel] Skill saved: {name} ({result['size']} bytes)")
            return json.dumps({"status": "success", **result}, ensure_ascii=False)
        except (ValueError, FileNotFoundError) as e:
            return json.dumps({"status": "error", "message": str(e)})
        except PermissionError:
            return json.dumps({"status": "error", "message": "permission denied"})
        except Exception as e:
            logger.error(f"[WebChannel] Skill write error: {e}")
            return json.dumps({"status": "error", "message": str(e)})
