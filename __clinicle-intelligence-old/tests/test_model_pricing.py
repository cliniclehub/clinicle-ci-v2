# encoding:utf-8
"""agent/memory/model_pricing.py: pure cost-estimate function."""

from agent.memory.model_pricing import estimate_cost


def test_known_model_computes_input_and_output_cost_separately():
    cost = estimate_cost("claude-sonnet-5", {"prompt_tokens": 2000, "completion_tokens": 1000})
    # 2000/1000 * 0.003 + 1000/1000 * 0.015 = 0.006 + 0.015 = 0.021
    assert cost == 0.021


def test_unknown_model_returns_none_not_zero():
    assert estimate_cost("some-future-model", {"prompt_tokens": 100, "completion_tokens": 50}) is None


def test_missing_usage_fields_default_to_zero_tokens():
    cost = estimate_cost("claude-sonnet-5", {})
    assert cost == 0.0
