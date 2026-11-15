# encoding:utf-8
"""agent/memory/conversation_store.py: the usage_events table, record_usage,
and get_usage_summary. Same isolation contract as the runs table (see
test_conversation_runs.py) -- auxiliary, opt-in, never able to take
conversation storage down."""

import tempfile
import time
from pathlib import Path

from agent.memory.conversation_store import ConversationStore


def _store(tmpdir):
    return ConversationStore(Path(tmpdir) / "index.db")


def _backdate_usage(store, run_id, days_ago):
    conn = store._raw_connect()
    try:
        conn.execute(
            "UPDATE usage_events SET created_at = ? WHERE run_id = ?",
            (int(time.time()) - days_ago * 86400, run_id),
        )
        conn.commit()
    finally:
        conn.close()


def test_record_usage_persists_a_row():
    with tempfile.TemporaryDirectory() as tmp:
        store = _store(tmp)
        assert store.record_usage(
            run_id="r1", agent_id="boss", session_id="s1", model="claude-sonnet-5",
            usage={"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150},
            cost_usd=0.021,
        ) is True

        summary = store.get_usage_summary(agent_id="boss")
        assert summary["total_tokens"] == 150
        assert summary["total_cost_usd"] == 0.021
        assert summary["by_model"][0]["model"] == "claude-sonnet-5"
        assert summary["by_model"][0]["calls"] == 1


def test_record_usage_without_a_priced_model_leaves_cost_null():
    with tempfile.TemporaryDirectory() as tmp:
        store = _store(tmp)
        store.record_usage(
            run_id="r1", agent_id="boss", session_id="s1", model="unpriced-model",
            usage={"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
            cost_usd=None,
        )
        summary = store.get_usage_summary(agent_id="boss")
        assert summary["total_tokens"] == 15
        assert summary["total_cost_usd"] == 0.0  # COALESCE(NULL) -> 0, not an error


def test_get_usage_summary_scopes_by_agent_id():
    with tempfile.TemporaryDirectory() as tmp:
        store = _store(tmp)
        store.record_usage(agent_id="a", model="m", usage={"total_tokens": 10}, cost_usd=0.01)
        store.record_usage(agent_id="b", model="m", usage={"total_tokens": 20}, cost_usd=0.02)

        assert store.get_usage_summary(agent_id="a")["total_tokens"] == 10
        assert store.get_usage_summary(agent_id="b")["total_tokens"] == 20
        assert store.get_usage_summary()["total_tokens"] == 30  # omitted -> every Agent


def test_get_usage_summary_since_filters_by_created_at():
    with tempfile.TemporaryDirectory() as tmp:
        store = _store(tmp)
        store.record_usage(agent_id="a", model="m", usage={"total_tokens": 10}, cost_usd=0.01)
        far_future = 9999999999
        assert store.get_usage_summary(agent_id="a", since=far_future)["total_tokens"] == 0


def test_get_usage_summary_groups_multiple_models():
    with tempfile.TemporaryDirectory() as tmp:
        store = _store(tmp)
        store.record_usage(agent_id="a", model="m1", usage={"total_tokens": 10}, cost_usd=0.01)
        store.record_usage(agent_id="a", model="m2", usage={"total_tokens": 20}, cost_usd=0.02)
        store.record_usage(agent_id="a", model="m1", usage={"total_tokens": 5}, cost_usd=0.005)

        by_model = {row["model"]: row for row in store.get_usage_summary(agent_id="a")["by_model"]}
        assert by_model["m1"]["total_tokens"] == 15
        assert by_model["m1"]["calls"] == 2
        assert by_model["m2"]["total_tokens"] == 20


def test_empty_store_returns_zeroed_summary():
    with tempfile.TemporaryDirectory() as tmp:
        store = _store(tmp)
        summary = store.get_usage_summary()
        assert summary == {"total_tokens": 0, "total_cost_usd": 0.0, "by_model": []}


def test_daily_usage_trend_buckets_by_utc_day():
    with tempfile.TemporaryDirectory() as tmp:
        store = _store(tmp)
        store.record_usage(run_id="today-1", agent_id="a", model="m", usage={"total_tokens": 10}, cost_usd=0.01)
        store.record_usage(run_id="today-2", agent_id="a", model="m", usage={"total_tokens": 5}, cost_usd=0.005)
        store.record_usage(run_id="yesterday", agent_id="a", model="m", usage={"total_tokens": 20}, cost_usd=0.02)
        _backdate_usage(store, "yesterday", days_ago=1)

        trend = store.get_daily_usage_trend(agent_id="a", days=14)

        assert len(trend) == 2
        assert trend[0]["tokens"] == 20  # oldest (yesterday) first
        assert trend[1]["tokens"] == 15  # today's two calls summed
        assert round(trend[1]["cost_usd"], 3) == 0.015


def test_daily_usage_trend_excludes_points_outside_the_window():
    with tempfile.TemporaryDirectory() as tmp:
        store = _store(tmp)
        store.record_usage(run_id="old", agent_id="a", model="m", usage={"total_tokens": 99}, cost_usd=0.5)
        _backdate_usage(store, "old", days_ago=30)

        assert store.get_daily_usage_trend(agent_id="a", days=7) == []


def test_daily_usage_trend_on_an_empty_store_is_an_empty_list():
    with tempfile.TemporaryDirectory() as tmp:
        store = _store(tmp)
        assert store.get_daily_usage_trend() == []


def test_daily_usage_trend_omitted_agent_id_sums_every_agent():
    with tempfile.TemporaryDirectory() as tmp:
        store = _store(tmp)
        store.record_usage(run_id="r1", agent_id="a", model="m", usage={"total_tokens": 10}, cost_usd=0.01)
        store.record_usage(run_id="r2", agent_id="b", model="m", usage={"total_tokens": 5}, cost_usd=0.005)

        trend = store.get_daily_usage_trend(days=14)
        assert len(trend) == 1
        assert trend[0]["tokens"] == 15


def test_daily_usage_trend_unavailable_degrades_to_empty_list():
    with tempfile.TemporaryDirectory() as tmp:
        store = _store(tmp)
        store._usage_events_ready = False
        assert store.get_daily_usage_trend() == []


def test_usage_tracking_unavailable_degrades_to_noop():
    """Same contract as _runs_ready: if the table setup ever fails, recording
    must return False rather than raise, and conversation storage (sessions/
    messages) must be completely unaffected."""
    with tempfile.TemporaryDirectory() as tmp:
        store = _store(tmp)
        store._usage_events_ready = False
        assert store.record_usage(agent_id="a", model="m", usage={"total_tokens": 1}) is False
        assert store.get_usage_summary() == {"total_tokens": 0, "total_cost_usd": 0.0, "by_model": []}
