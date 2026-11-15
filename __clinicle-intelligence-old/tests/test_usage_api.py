# encoding:utf-8
"""channel/web/api/usage.py: the HTTP surface over
ConversationStore.get_usage_summary. Auth/capability-gated like every other
read endpoint in this codebase; the store itself is exercised directly in
test_conversation_store_usage.py, so these tests focus on wiring."""

import json
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
import web

from agent.memory.conversation_store import ConversationStore


@pytest.fixture(autouse=True)
def _web_ctx_headers():
    web.ctx.headers = []


def test_returns_the_stores_summary():
    from channel.web.api.usage import UsageSummaryHandler

    with tempfile.TemporaryDirectory() as tmp:
        store = ConversationStore(Path(tmp) / "index.db")
        store.record_usage(agent_id="", model="claude-sonnet-5",
                            usage={"total_tokens": 10}, cost_usd=0.01)

        with patch("channel.web.api.usage.web.header"), \
             patch("channel.web.api.usage.web.input", return_value={}), \
             patch("channel.web.api.usage._require_auth"), \
             patch("channel.web.api.usage._require_capability"), \
             patch("channel.web.api.usage.get_conversation_store", return_value=store):
            response = json.loads(UsageSummaryHandler().GET())

    assert response["status"] == "success"
    assert response["total_tokens"] == 10


def test_unauthenticated_request_is_rejected():
    from channel.web.api.usage import UsageSummaryHandler

    with patch("channel.web.api.usage.web.header"), \
         patch("channel.web.api.usage._require_auth", side_effect=Exception("401 Unauthorized")):
        with pytest.raises(Exception) as exc_info:
            UsageSummaryHandler().GET()
    assert "401" in str(exc_info.value)


def test_response_includes_a_daily_trend_with_the_default_window():
    from channel.web.api.usage import UsageSummaryHandler

    with tempfile.TemporaryDirectory() as tmp:
        store = ConversationStore(Path(tmp) / "index.db")
        store.record_usage(agent_id="", model="m", usage={"total_tokens": 10}, cost_usd=0.01)

        with patch("channel.web.api.usage.web.header"), \
             patch("channel.web.api.usage.web.input", return_value={}), \
             patch("channel.web.api.usage._require_auth"), \
             patch("channel.web.api.usage._require_capability"), \
             patch("channel.web.api.usage.get_conversation_store", return_value=store):
            response = json.loads(UsageSummaryHandler().GET())

    assert response["trend_days"] == 14
    assert response["trend"] == [{"date": response["trend"][0]["date"], "tokens": 10, "cost_usd": 0.01}]


def test_days_query_param_is_restricted_to_the_allowed_set():
    from channel.web.api.usage import UsageSummaryHandler

    with tempfile.TemporaryDirectory() as tmp:
        store = ConversationStore(Path(tmp) / "index.db")

        with patch("channel.web.api.usage.web.header"), \
             patch("channel.web.api.usage.web.input", return_value={"days": "999"}), \
             patch("channel.web.api.usage._require_auth"), \
             patch("channel.web.api.usage._require_capability"), \
             patch("channel.web.api.usage.get_conversation_store", return_value=store):
            response = json.loads(UsageSummaryHandler().GET())

    assert response["trend_days"] == 14  # falls back to the default, not the bogus value


def test_agent_id_query_param_scopes_the_summary():
    from channel.web.api.usage import UsageSummaryHandler

    with tempfile.TemporaryDirectory() as tmp:
        store = ConversationStore(Path(tmp) / "index.db")
        store.record_usage(agent_id="sales", model="m", usage={"total_tokens": 5}, cost_usd=0.005)
        store.record_usage(agent_id="pm", model="m", usage={"total_tokens": 7}, cost_usd=0.007)

        with patch("channel.web.api.usage.web.header"), \
             patch("channel.web.api.usage.web.input", return_value={"agent_id": "sales"}), \
             patch("channel.web.api.usage._require_auth"), \
             patch("channel.web.api.usage._require_capability"), \
             patch("channel.web.api.usage.get_conversation_store", return_value=store):
            response = json.loads(UsageSummaryHandler().GET())

    assert response["total_tokens"] == 5
