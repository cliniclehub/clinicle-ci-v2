# encoding:utf-8
"""agent/tools/plan/plan.py: a pure communication tool -- it validates and
echoes back the plan it's given, doing no work of its own. The result shape
(a dict, not a string) is what channel/web/static/js/chat/{render,send}.js
render as a checklist instead of the generic collapsed tool-call card."""

from agent.tools.base_tool import ToolResult
from agent.tools.plan.plan import PlanTool


def test_declares_the_expected_name_and_schema():
    tool = PlanTool()
    assert tool.name == "update_plan"
    assert "steps" in tool.params["properties"]
    assert tool.params["required"] == ["steps"]


def test_a_well_formed_plan_round_trips():
    tool = PlanTool()
    result = tool.execute({"steps": [
        {"content": "Read the config", "status": "completed"},
        {"content": "Write the migration", "status": "in_progress"},
        {"content": "Run the tests", "status": "pending"},
    ]})
    assert result.status == "success"
    assert result.result == {"steps": [
        {"content": "Read the config", "status": "completed"},
        {"content": "Write the migration", "status": "in_progress"},
        {"content": "Run the tests", "status": "pending"},
    ]}


def test_a_step_s_content_is_trimmed():
    tool = PlanTool()
    result = tool.execute({"steps": [{"content": "  do the thing  ", "status": "pending"}]})
    assert result.result["steps"][0]["content"] == "do the thing"


def test_rejects_an_empty_steps_list():
    tool = PlanTool()
    result = tool.execute({"steps": []})
    assert result.status == "error"


def test_rejects_a_missing_steps_field():
    tool = PlanTool()
    result = tool.execute({})
    assert result.status == "error"


def test_rejects_steps_that_is_not_a_list():
    tool = PlanTool()
    result = tool.execute({"steps": "do the thing"})
    assert result.status == "error"


def test_rejects_a_step_with_no_content():
    tool = PlanTool()
    result = tool.execute({"steps": [{"content": "", "status": "pending"}]})
    assert result.status == "error"


def test_rejects_a_step_with_an_invalid_status():
    tool = PlanTool()
    result = tool.execute({"steps": [{"content": "do it", "status": "done"}]})
    assert result.status == "error"


def test_rejects_a_step_that_is_not_an_object():
    tool = PlanTool()
    result = tool.execute({"steps": ["do it"]})
    assert result.status == "error"


def test_result_is_a_ToolResult_instance():
    tool = PlanTool()
    result = tool.execute({"steps": [{"content": "x", "status": "pending"}]})
    assert isinstance(result, ToolResult)
