#!/usr/bin/env python3
"""One-time setup: wire the 10 Allure Clinics AI agents (created by
create_allure_ai_agents.py) across this app's real existing surfaces --
Teams, Knowledge Base, Workflows -- instead of leaving them as standalone
personas nobody can actually delegate to. See
docs/allure-clinics-ai-transformation-plan.md.

What this creates, all through existing platform primitives (no new store,
no new page):

1. A Team "Allure Clinics AI" -- the default Orchestrator as Leader, all 10
   use-case Agents as teammates, addressable via team_manage/the Teams grid
   like any other multi-agent Team in this app.
2. Knowledge Base category folders for the domains that need real content
   ingested later (SOPs, HR policies, VAT/compliance rules) -- empty
   placeholders, no fabricated content.
3. Three real Workflows (the actual DAG engine, not a mockup) demonstrating
   cross-agent orchestration:
   - "New Patient Inquiry Intake" (webhook trigger -> logs to Patient
     Journey -> flagged to Quality Supervisor) -- the intake point Contact
     Center's real channel integration will call once it's wired.
   - "Daily Quality Review" (cron, 08:00 daily -> Quality Supervisor)
   - "Weekly KPI Report" (cron, Monday 09:00 -> Management Copilot)
   Each action.team_task node creates a real Task Board task assigned to
   that Agent's Team slot -- Task Board's existing Autopilot loop is what
   actually works it, this script does not invent a parallel execution path.

Usage:
    python3 scripts/setup_allure_ai_orchestration.py [--dry-run]
"""

from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

TEAM_NAME = "Allure Clinics AI"

USE_CASE_AGENT_IDS = [
    "quality-supervisor", "revenue-optimizer", "contact-center", "patient-journey",
    "employee-copilot", "doctor-copilot", "management-copilot", "vat-compliance",
    "inventory-procurement", "financial-controller",
]

KNOWLEDGE_CATEGORIES = [
    "SOPs & Protocols",
    "HR Policies",
    "VAT & Compliance Rules",
]


def _find_existing_team(team_store, name: str):
    for team in team_store.list_teams():
        if team.get("name") == name:
            return team
    return None


def _ensure_team(team_store, dry_run: bool):
    existing = _find_existing_team(team_store, TEAM_NAME)
    if existing:
        print(f"team '{TEAM_NAME}' already exists ({existing['id']}), leaving as-is")
        return existing

    members = [{"agent_id": "default", "role": "leader"}] + [
        {"agent_id": aid, "role": "teammate"} for aid in USE_CASE_AGENT_IDS
    ]
    if dry_run:
        print(f"[dry-run] would create team '{TEAM_NAME}' with {len(members)} members")
        return None
    team = team_store.create_team(TEAM_NAME, members)
    print(f"created team '{TEAM_NAME}' ({team['id']}) with {len(team['members'])} members")
    return team


def _ensure_knowledge_categories(dry_run: bool):
    from agent.knowledge.service import KnowledgeService
    from agent.registry import get_agent_registry

    default_workspace = get_agent_registry().get("default").workspace
    svc = KnowledgeService(default_workspace)
    for category in KNOWLEDGE_CATEGORIES:
        if dry_run:
            print(f"[dry-run] would create knowledge category '{category}'")
            continue
        result = svc.create_category(category)
        if result.get("created"):
            print(f"created knowledge category '{category}'")
        else:
            print(f"knowledge category '{category}' already exists")


def _slot_id(team: dict, agent_id: str) -> str:
    for m in team["members"]:
        if m["agent_id"] == agent_id:
            return m["slot_id"]
    raise ValueError(f"agent '{agent_id}' is not a member of team '{team['id']}'")


def _ensure_workflow(workflow_store, org_id, name: str, description: str, nodes: list, edges: list,
                      activate: bool, existing_names: set, dry_run: bool):
    if name in existing_names:
        print(f"workflow '{name}' already exists, leaving as-is")
        return
    if dry_run:
        print(f"[dry-run] would create workflow '{name}' ({len(nodes)} nodes)")
        return
    wf = workflow_store.create_workflow(name, description, org_id)
    workflow_store.update_graph(wf["id"], nodes, edges)
    if activate:
        workflow_store.set_active(wf["id"], True)
    print(f"created workflow '{name}' ({wf['id']}){' [active]' if activate else ''}")


def _team_task_node(node_id: str, x: int, y: int, team_id: str, slot_id: str, subject: str) -> dict:
    return {
        "id": node_id, "type": "action.team_task", "position": {"x": x, "y": y},
        "config": {"team_id": team_id, "subject": subject, "owner_slot_id": slot_id},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Print what would happen without writing anything.")
    args = parser.parse_args()

    from agent.registry import get_agent_registry
    from agent.workspace import team_store, workflow_store
    from common.runtime_identity import current_identity

    registry = get_agent_registry()
    missing = [aid for aid in USE_CASE_AGENT_IDS if not _agent_exists(registry, aid)]
    if missing:
        print(f"FAILED: these agents don't exist yet -- run create_allure_ai_agents.py first: {', '.join(missing)}",
              file=sys.stderr)
        return 1

    org_id = current_identity().org_id

    team = _ensure_team(team_store, args.dry_run)
    _ensure_knowledge_categories(args.dry_run)

    if team is None:
        if not args.dry_run:
            print("FAILED: no team to build workflows against", file=sys.stderr)
            return 1
        # Dry-run: fabricate slot ids just to show what nodes would look like.
        team = {"id": "wf_dry_run", "members": [{"agent_id": "default", "role": "leader", "slot_id": "leader"}] +
                [{"agent_id": aid, "role": "teammate", "slot_id": f"slot_{aid}"} for aid in USE_CASE_AGENT_IDS]}

    existing_names = {w["name"] for w in workflow_store.list_workflows(org_id)} if not args.dry_run else set()

    # 1. New Patient Inquiry Intake -- webhook trigger -> Patient Journey logs
    #    it -> Quality Supervisor reviews the interaction that generated it.
    intake_nodes = [
        {"id": "trigger", "type": "trigger.webhook", "position": {"x": 0, "y": 0}, "config": {}},
        _team_task_node("log_journey", 260, 0, team["id"], _slot_id(team, "patient-journey"),
                         "Log this new inquiry to the patient's journey record."),
        _team_task_node("qa_review", 520, 0, team["id"], _slot_id(team, "quality-supervisor"),
                         "Review the interaction that generated this inquiry for quality/compliance."),
    ]
    intake_edges = [
        {"id": "e1", "source": "trigger", "source_handle": None, "target": "log_journey"},
        {"id": "e2", "source": "log_journey", "source_handle": None, "target": "qa_review"},
    ]
    _ensure_workflow(
        workflow_store, org_id, "New Patient Inquiry Intake",
        "Intake point for a new patient inquiry -- Contact Center's real channel integration calls this "
        "webhook once wired. Logs to Patient Journey, then flags for Quality review.",
        intake_nodes, intake_edges, activate=True, existing_names=existing_names, dry_run=args.dry_run,
    )

    # 2. Daily Quality Review -- cron.
    daily_qa_nodes = [
        {"id": "trigger", "type": "trigger.schedule", "position": {"x": 0, "y": 0},
         "config": {"schedule": {"type": "cron", "expression": "0 8 * * *"}}},
        _team_task_node("daily_review", 260, 0, team["id"], _slot_id(team, "quality-supervisor"),
                         "Run the daily quality review of yesterday's patient interactions."),
    ]
    daily_qa_edges = [{"id": "e1", "source": "trigger", "source_handle": None, "target": "daily_review"}]
    _ensure_workflow(
        workflow_store, org_id, "Daily Quality Review",
        "Every day at 08:00, dispatches a quality-review task to the Quality Supervisor Agent.",
        daily_qa_nodes, daily_qa_edges, activate=True, existing_names=existing_names, dry_run=args.dry_run,
    )

    # 3. Weekly KPI Report -- cron.
    weekly_kpi_nodes = [
        {"id": "trigger", "type": "trigger.schedule", "position": {"x": 0, "y": 0},
         "config": {"schedule": {"type": "cron", "expression": "0 9 * * MON"}}},
        _team_task_node("weekly_report", 260, 0, team["id"], _slot_id(team, "management-copilot"),
                         "Compile this week's KPI report and produce management minutes with follow-ups."),
    ]
    weekly_kpi_edges = [{"id": "e1", "source": "trigger", "source_handle": None, "target": "weekly_report"}]
    _ensure_workflow(
        workflow_store, org_id, "Weekly KPI Report",
        "Every Monday at 09:00, dispatches a KPI-report task to the Management Copilot Agent.",
        weekly_kpi_nodes, weekly_kpi_edges, activate=True, existing_names=existing_names, dry_run=args.dry_run,
    )

    print("\nDone." if not args.dry_run else "\n[dry-run] Nothing was written.")
    return 0


def _agent_exists(registry, agent_id: str) -> bool:
    try:
        registry.get(agent_id, require_enabled=False)
        return True
    except KeyError:
        return False


if __name__ == "__main__":
    raise SystemExit(main())
