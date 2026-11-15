# encoding:utf-8
"""Frontend wiring for agent/tools/plan/plan.py's execution-plan
visualization: a call to `update_plan` must render as its own checklist
card in both the live-stream path (chat/send.js) and history replay
(chat/render.js), not fall through to the generic collapsed tool-call
card."""

from pathlib import Path

ROOT = Path(__file__).parents[1]


def _send_js():
    return (ROOT / "channel/web/static/js/chat/send.js").read_text(encoding="utf-8")


def _render_js():
    return (ROOT / "channel/web/static/js/chat/render.js").read_text(encoding="utf-8")


def _markdown_css():
    return (ROOT / "channel/web/static/css/markdown.css").read_text(encoding="utf-8")


def test_the_tool_is_registered_with_the_agent():
    from agent.tools import __all__ as tools_all
    assert "PlanTool" in tools_all
    init_src = (ROOT / "agent/tools/__init__.py").read_text(encoding="utf-8")
    assert "from agent.tools.plan.plan import PlanTool" in init_src


def test_live_stream_special_cases_update_plan_at_tool_start():
    js = _send_js()
    assert "item.tool === 'update_plan'" in js
    assert "_renderPlanChecklistHtml" in js


def test_history_replay_special_cases_update_plan():
    js = _render_js()
    assert "tc.name === 'update_plan'" in js
    assert "function _renderPlanChecklistHtml" in js


def test_plan_card_has_its_own_css_distinct_from_the_generic_tool_card():
    css = _markdown_css()
    assert ".agent-plan-card" in css
    assert ".agent-plan-step-completed" in css
    assert ".agent-plan-step-in_progress" in css


def test_the_tool_is_documented_in_the_system_prompt_builder():
    src = (ROOT / "agent/prompt/builder.py").read_text(encoding="utf-8")
    assert '"update_plan":' in src
