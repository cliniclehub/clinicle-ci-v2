"""Lets an Agent raise a flag onto the shared Review Queue for a human to
action -- the mechanism behind the "flag and report, never auto-act"
boundary written into Quality Supervisor, Revenue Optimizer, VAT Compliance,
and Financial Controller's own AGENT.md personas. A plain, always-available
BaseTool like TeamManageTool/SchedulerTool -- no special-casing needed in
the tool-loading loop.

This tool can only create a flag in the 'open' state. Nothing in this
codebase can move a flag to 'approved'/'dismissed' except a human acting
through the Review Queue page (channel/web/api/review_queue.py) -- that
asymmetry is the actual safety boundary, not a policy comment.
"""

from __future__ import annotations

from agent.tools.base_tool import BaseTool, ToolResult
from agent.workspace import review_queue_store
from common.log import logger


class RaiseFlagTool(BaseTool):
    name: str = "raise_flag"
    description: str = (
        "Raise a flag onto the shared Review Queue for a human to review and action -- "
        "use this instead of only mentioning a finding in chat, so it doesn't get lost. "
        "You cannot approve, dismiss, or otherwise act on a flag yourself, by design: "
        "this tool only ever creates flags in the 'open' state. A human reviews every "
        "flag from the Review Queue page."
    )
    params: dict = {
        "type": "object",
        "properties": {
            "agent_id": {"type": "string", "description": "Your own Agent id."},
            "category": {
                "type": "string",
                "enum": list(review_queue_store.CATEGORIES),
                "description": "quality (Quality Supervisor), revenue (Revenue Optimizer), "
                               "vat_compliance (VAT Compliance), financial (Financial Controller), "
                               "inventory (Inventory & Procurement), or other.",
            },
            "title": {"type": "string", "description": "One-line summary of the finding."},
            "detail": {"type": "string", "description": "Fuller explanation of what was found and why it matters."},
            "evidence_ref": {"type": "string", "description": "What this finding is based on -- a transcript id, "
                                                                "transaction id, or other concrete reference. Never leave this vague."},
            "severity": {
                "type": "string",
                "enum": list(review_queue_store.SEVERITIES),
                "description": "Default 'medium' if unsure.",
            },
        },
        "required": ["agent_id", "category", "title"],
    }

    def execute(self, params: dict) -> ToolResult:
        try:
            from common.runtime_identity import current_identity

            flag = review_queue_store.raise_flag(
                org_id=current_identity().org_id,
                source_agent_id=str(params.get("agent_id") or "").strip(),
                category=str(params.get("category") or "").strip(),
                title=str(params.get("title") or "").strip(),
                detail=params.get("detail"),
                evidence_ref=params.get("evidence_ref"),
                severity=str(params.get("severity") or "medium").strip(),
            )
            return ToolResult.success({"flag_id": flag["id"], "status": flag["status"]})
        except ValueError as e:
            return ToolResult.fail(str(e))
        except Exception as e:
            logger.error(f"[RaiseFlagTool] failed: {e}")
            return ToolResult.fail("Could not raise flag")
