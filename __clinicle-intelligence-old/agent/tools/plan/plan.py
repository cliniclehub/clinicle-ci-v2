"""Plan tool - declare or update a step-by-step execution plan for a
multi-step task, rendered in chat as its own checklist, separate from the
thinking/tool-call cards (channel/web/static/js/chat/{render,send}.js).

Purely a communication tool: it does no work and touches nothing outside
the conversation. Calling it is how the model tells a human what it's
about to do before doing it -- a long agentic run (a worktree migration, a
multi-file refactor) reads very differently with the plan visible up front
versus only inferable after the fact from a scroll of tool-call cards.
"""

from __future__ import annotations

from typing import Any, Dict

from agent.tools.base_tool import BaseTool, ToolResult

_VALID_STATUSES = {"pending", "in_progress", "completed"}


class PlanTool(BaseTool):
    name = "update_plan"
    description = (
        "Share or update your step-by-step plan for a multi-step task, so the user "
        "can see it before and while you execute. Call this once before starting "
        "genuinely multi-step work (roughly 3 or more distinct steps), then call it "
        "again whenever a step's status changes -- mark the step you're working on "
        "'in_progress' and the ones before it 'completed'. Always send the FULL plan "
        "each time, not just the changed step. Skip this entirely for simple, "
        "single-step requests -- it adds noise there, not clarity."
    )
    params: dict = {
        "type": "object",
        "properties": {
            "steps": {
                "type": "array",
                "description": "The full plan, in execution order. Re-send the whole list on every call.",
                "items": {
                    "type": "object",
                    "properties": {
                        "content": {"type": "string", "description": "One step, described in a few words."},
                        "status": {"type": "string", "enum": sorted(_VALID_STATUSES)},
                    },
                    "required": ["content", "status"],
                },
            },
        },
        "required": ["steps"],
    }

    def execute(self, args: Dict[str, Any]) -> ToolResult:
        steps = args.get("steps")
        if not isinstance(steps, list) or not steps:
            return ToolResult.fail("Error: 'steps' must be a non-empty array")

        cleaned = []
        for i, step in enumerate(steps):
            if not isinstance(step, dict):
                return ToolResult.fail(f"Error: step {i} must be an object")
            content = str(step.get("content") or "").strip()
            status = step.get("status")
            if not content:
                return ToolResult.fail(f"Error: step {i} is missing 'content'")
            if status not in _VALID_STATUSES:
                return ToolResult.fail(
                    f"Error: step {i} has invalid status {status!r}; must be one of {sorted(_VALID_STATUSES)}"
                )
            cleaned.append({"content": content, "status": status})

        return ToolResult.success({"steps": cleaned})
