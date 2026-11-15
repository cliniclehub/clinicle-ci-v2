"""Lets an Agent manage its Team roster, and actually hand work to a
teammate's own pane -- the piece that makes the Teams grid a real swarm
instead of one Leader column doing everything while the rest sit idle.

Deliberately does NOT hook into the per-turn context/identity injection every
other multi-agent tool (agent_delegate) uses: that machinery lives in
bridge/agent_bridge.py, which already carries unrelated in-flight changes
this session. Instead this tool takes ``agent_id`` as an explicit parameter
the model passes itself -- an Agent's own id is already in its system
context, so nothing new has to be threaded through the turn. That keeps this
tool a plain, always-available BaseTool like WebFetch or SchedulerTool: it
needs zero special-casing in the tool-loading loop (bridge/agent_initializer.py
already loads any BaseTool subclass in agent.tools.__all__ generically), so
adding it carries none of the blast radius a context-injection hook would.

``delegate`` is the exception that needs a live call into the running
instance -- there is no way around actually running the target's turn. It
reuses the exact mechanism agent/tools/scheduler/integration.py already
proves safe for exactly this ("run this Agent, against this session_id,
right now, outside the HTTP request that's asking for it"):
``Bridge().get_agent_bridge().agent_reply(...)``, a stable public method, not
a change to bridge/agent_bridge.py's internals. Pointed at the *team
member's own* session_id (not a synthetic derived one, the way
agent_delegate's shared-conversation delegation works) so the reply lands
exactly where the Teams grid's column for that member is already polling.

Every team-scoped action checks the caller is actually a member of that team
before doing anything -- knowing a team_id must not be enough to manage it.
"""

from __future__ import annotations

import threading

from agent.tools.base_tool import BaseTool, ToolResult
from agent.workspace import team_store
from common.log import logger

# Cycle guard for delegate: the agent ids currently "in flight" on this
# thread's own delegation chain (Leader -> Data Worker -> back to Leader
# would otherwise recurse forever, since each hop is a synchronous,
# blocking call on the same call stack). Thread-local because agent_reply()
# runs the target's turn inline on the calling thread -- there is no
# request boundary to hang shared state off between hops.
_delegation_chain = threading.local()

MAX_DELEGATION_DEPTH = 4


class TeamManageTool(BaseTool):
    name: str = "team_manage"
    description: str = (
        "Manage a Team this Agent is a member of, and hand off real work to a teammate. "
        "Actions: list teams, get a team's roster, add_member, remove_member, rename, "
        "and delegate -- actually run a task on a teammate's own session (their column "
        "in the Teams grid) and get their result back. "
        "If you were briefed as the Leader of a Team, your teammates named there are "
        "real Agents with their own persistent conversations, not disposable workers -- "
        "use delegate to hand them real work, in preference to the generic subagent "
        "tool, whenever the task is naturally theirs. Only fall back to subagent for "
        "throwaway sub-steps nobody on the team owns. "
        "Every action needs your own agent_id (the id you were given in your system "
        "context) so the tool can tell who is asking; every action but list also needs "
        "team_id, which action='list' or action='get' will show you."
    )
    params: dict = {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["list", "get", "add_member", "remove_member", "rename", "delegate",
                         "task_create", "task_list", "task_update"],
                "description": "list: every team you belong to. get: one team's full roster. "
                               "add_member/remove_member/rename: change a team you belong to. "
                               "delegate: hand a task to a teammate and get their result. "
                               "task_create/task_list/task_update: track a task board -- for "
                               "multi-step work, create one task per teammate up front (with "
                               "blocked_task_ids for anything that depends on another task), "
                               "only delegate a task once every task it's blocked on is 'done', "
                               "and mark each task 'in_progress'/'done' as you go.",
            },
            "agent_id": {
                "type": "string",
                "description": "Your own Agent id. Required for every action.",
            },
            "team_id": {
                "type": "string",
                "description": "Required for every action except list.",
            },
            "member_agent_id": {
                "type": "string",
                "description": "For add_member: the Agent id to invite as a new teammate.",
            },
            "slot_id": {
                "type": "string",
                "description": "For remove_member: the slot_id to remove (from get's roster).",
            },
            "name": {
                "type": "string",
                "description": "For rename: the team's new name.",
            },
            "target_slot_id": {
                "type": "string",
                "description": "For delegate: the teammate's slot_id (from get's roster). "
                               "Preferred over target_agent_id when the same Agent has more "
                               "than one slot in this team.",
            },
            "target_agent_id": {
                "type": "string",
                "description": "For delegate: the teammate's Agent id, if you don't have their slot_id.",
            },
            "task": {
                "type": "string",
                "description": "For delegate: what to ask the teammate to do. Written to them "
                               "directly, the way you'd message a colleague -- they see this "
                               "exact text as their turn's input, with no extra framing added.",
            },
            "subject": {
                "type": "string",
                "description": "For task_create: a short title for the task.",
            },
            "owner_slot_id": {
                "type": "string",
                "description": "For task_create: the slot_id (from get's roster) of the teammate "
                               "this task belongs to.",
            },
            "blocked_task_ids": {
                "type": "array", "items": {"type": "string"},
                "description": "For task_create: ids of other tasks in this team that must be "
                               "'done' before this one can start. Leave empty if it can start now.",
            },
            "task_id": {
                "type": "string",
                "description": "For task_update: the task's id (from task_list).",
            },
            "status": {
                "type": "string", "enum": list(team_store.TASK_STATUSES),
                "description": "For task_update: the task's new status.",
            },
        },
        "required": ["action", "agent_id"],
    }

    def _teams_for(self, agent_id: str) -> list:
        return [t for t in team_store.list_teams() if any(m["agent_id"] == agent_id for m in t["members"])]

    def _membership_or_none(self, team: dict, agent_id: str):
        return next((m for m in team["members"] if m["agent_id"] == agent_id), None)

    def execute(self, params: dict) -> ToolResult:
        action = params.get("action")
        agent_id = str(params.get("agent_id") or "").strip()
        if not agent_id:
            return ToolResult.fail("agent_id is required")

        try:
            if action == "list":
                teams = self._teams_for(agent_id)
                return ToolResult.success({
                    "teams": [
                        {"id": t["id"], "name": t["name"], "member_count": len(t["members"]),
                         "your_role": self._membership_or_none(t, agent_id)["role"]}
                        for t in teams
                    ]
                })

            # Every action below is scoped to one team -- and every one of
            # them requires the caller to actually belong to it. A team_id
            # alone (e.g. guessed, or seen in another Agent's output) must
            # never be enough to read or change a roster you're not on.
            team_id = str(params.get("team_id") or "").strip()
            if not team_id:
                return ToolResult.fail("team_id is required for this action")
            team = team_store.get_team(team_id)
            if team is None:
                return ToolResult.fail(f"Team '{team_id}' not found")
            membership = self._membership_or_none(team, agent_id)
            if membership is None:
                return ToolResult.fail("You are not a member of this team")

            if action == "get":
                return ToolResult.success({
                    "id": team["id"], "name": team["name"], "workspace": team.get("workspace"),
                    "members": [
                        {"slot_id": m["slot_id"], "agent_id": m["agent_id"], "role": m["role"]}
                        for m in team["members"]
                    ],
                })

            if action == "add_member":
                member_agent_id = str(params.get("member_agent_id") or "").strip()
                if not member_agent_id:
                    return ToolResult.fail("member_agent_id is required")
                updated = team_store.add_member(team_id, member_agent_id)
                return ToolResult.success(
                    {"added": member_agent_id, "member_count": len(updated["members"])},
                    display=f"Added **{member_agent_id}** to team **{team['name']}**.",
                )

            if action == "remove_member":
                slot_id = str(params.get("slot_id") or "").strip()
                if not slot_id:
                    return ToolResult.fail("slot_id is required")
                updated = team_store.remove_member(team_id, slot_id)
                return ToolResult.success(
                    {"member_count": len(updated["members"])},
                    display=f"Removed that member from team **{team['name']}**.",
                )

            if action == "rename":
                new_name = str(params.get("name") or "").strip()
                if not new_name:
                    return ToolResult.fail("name is required")
                updated = team_store.rename_team(team_id, new_name)
                return ToolResult.success(
                    {"name": updated["name"]},
                    display=f"Renamed team to **{updated['name']}**.",
                )

            if action == "delegate":
                return self._delegate(params, team, agent_id)

            if action == "task_create":
                subject = str(params.get("subject") or "").strip()
                if not subject:
                    return ToolResult.fail("subject is required")
                task = team_store.create_task(
                    team_id, subject,
                    owner=str(params.get("owner_slot_id") or "").strip() or None,
                    blocked_by=params.get("blocked_task_ids") or [],
                )
                # Planning (task_create) and dispatching (delegate) are two
                # separate tool calls -- confirmed live: a Leader that only
                # ever calls task_create stalls forever with a fully-planned
                # board and zero actual work done, since nothing forces the
                # second call. Make the very next step explicit, right here,
                # where the model is most likely to act on it.
                next_step = (
                    f' Call team_manage now with action="delegate", '
                    f'target_slot_id="{task["owner"]}", task="{subject}" to actually run it.'
                    if task["status"] == "todo" and task["owner"]
                    else " It is blocked -- delegate it once its blockers are done."
                )
                return ToolResult.success(
                    task, display=f"Created task **{subject}** ({task['status']}).{next_step}"
                )

            if action == "task_list":
                return ToolResult.success({"tasks": team_store.list_tasks(team_id)})

            if action == "task_update":
                task_id = str(params.get("task_id") or "").strip()
                status = str(params.get("status") or "").strip()
                if not task_id:
                    return ToolResult.fail("task_id is required")
                task = team_store.update_task_status(team_id, task_id, status)
                return ToolResult.success(task, display=f"Task **{task['subject']}** is now **{status}**.")

            return ToolResult.fail(f"Unknown action: {action}")
        except ValueError as e:
            return ToolResult.fail(str(e))
        except Exception as e:
            logger.error(f"[TeamManageTool] {action} failed: {e}")
            return ToolResult.fail(f"Could not complete '{action}': {e}")

    def _resolve_delegate_target(self, team: dict, params: dict):
        slot_id = str(params.get("target_slot_id") or "").strip()
        if slot_id:
            return next((m for m in team["members"] if m["slot_id"] == slot_id), None)
        target_agent_id = str(params.get("target_agent_id") or "").strip()
        if target_agent_id:
            return next((m for m in team["members"] if m["agent_id"] == target_agent_id), None)
        return None

    def _delegate(self, params: dict, team: dict, agent_id: str) -> ToolResult:
        task = str(params.get("task") or "").strip()
        if not task:
            return ToolResult.fail("task is required")

        target = self._resolve_delegate_target(team, params)
        if target is None:
            return ToolResult.fail("target_slot_id or a valid target_agent_id is required")
        if target["agent_id"] == agent_id:
            return ToolResult.fail("Cannot delegate to yourself")

        chain = getattr(_delegation_chain, "agent_ids", None)
        if chain is None:
            chain = []
            _delegation_chain.agent_ids = chain
        if target["agent_id"] in chain:
            return ToolResult.fail(
                f"Delegation cycle detected: {' -> '.join(chain)} -> {target['agent_id']}. Not delegating."
            )
        if len(chain) >= MAX_DELEGATION_DEPTH:
            return ToolResult.fail(f"Delegation chain too deep (max {MAX_DELEGATION_DEPTH}). Not delegating.")

        leader = next((m for m in team["members"] if m["agent_id"] == agent_id), None)
        leader_session_id = leader["session_id"] if leader else None

        team_store.mark_slot_running(team["id"], target["slot_id"])
        # Async dispatch -- matches AionUi's model: the Leader's own turn is
        # never blocked waiting on a teammate. The teammate's turn runs on a
        # background thread; when it finishes, that same thread "wakes" the
        # Leader by running a fresh turn on the Leader's own session with the
        # result appended as a new message (AionUi's idle_notification
        # equivalent -- there is no push channel into an idle conversation
        # here, so waking IS running that next turn). The cycle chain is
        # captured now (calling thread) and re-applied inside the background
        # thread, since threading.local() does not follow a value across
        # threads on its own.
        chain_snapshot = list(chain) + [agent_id]

        def _run_then_notify():
            _delegation_chain.agent_ids = chain_snapshot
            from bridge.bridge import Bridge
            from bridge.context import Context, ContextType

            agent_bridge = Bridge().get_agent_bridge()
            try:
                context = Context(ContextType.TEXT, task)
                context["session_id"] = target["session_id"]
                context["agent_id"] = target["agent_id"]
                context["is_scheduled_task"] = True
                reply = agent_bridge.agent_reply(task, context=context, on_event=None, clear_history=False)
                content = (reply.content if reply else "") or "(the teammate returned no content)"
                notify = f'[Team] {target["agent_id"]} finished "{task}":\n\n{content}'
            except Exception as e:
                logger.error(f"[TeamManageTool] delegate to {target['agent_id']} failed: {e}")
                notify = f'[Team] Delegating "{task}" to {target["agent_id"]} failed: {e}'
            finally:
                team_store.mark_slot_idle(team["id"], target["slot_id"])

            if not leader_session_id:
                return
            try:
                wake_context = Context(ContextType.TEXT, notify)
                wake_context["session_id"] = leader_session_id
                wake_context["agent_id"] = agent_id
                wake_context["is_scheduled_task"] = True
                agent_bridge.agent_reply(notify, context=wake_context, on_event=None, clear_history=False)
            except Exception as e:
                logger.error(f"[TeamManageTool] waking leader {agent_id} after delegate failed: {e}")

        threading.Thread(target=_run_then_notify, daemon=True).start()
        return ToolResult.success(
            {"target_agent_id": target["agent_id"], "target_slot_id": target["slot_id"], "dispatched": True},
            display=f"Dispatched to **{target['agent_id']}** -- you'll be notified here when they're done.",
        )
