# encoding:utf-8
"""agent.permission.policy.check_connector_call: per-toolkit on/off switches
and Outlook's mandatory recipient allow-list. Mode-independent -- these run
even under full-access, unlike check_tool_call."""

import pytest

from agent.permission.policy import ALLOW, check_connector_call
from config import conf


@pytest.fixture(autouse=True)
def clean_config(monkeypatch):
    monkeypatch.setitem(conf(), "connector_toolkit_toggles", {})
    monkeypatch.setitem(conf(), "outlook_allowed_recipients", [])


def test_non_composio_tool_names_pass_through():
    assert check_connector_call("read", {"path": "/tmp/x"}) is ALLOW
    assert check_connector_call("bash", {"command": "ls"}).allowed


def test_composio_tool_with_no_config_is_allowed():
    decision = check_connector_call("JIRA_CREATE_ISSUE", {"summary": "bug"})
    assert decision.allowed


def test_toggled_off_toolkit_is_blocked(monkeypatch):
    monkeypatch.setitem(conf(), "connector_toolkit_toggles", {"JIRA": False})
    decision = check_connector_call("JIRA_CREATE_ISSUE", {"summary": "bug"})
    assert not decision.allowed
    assert "JIRA" in decision.reason


def test_toggled_on_toolkit_is_unaffected(monkeypatch):
    monkeypatch.setitem(conf(), "connector_toolkit_toggles", {"JIRA": True})
    assert check_connector_call("JIRA_CREATE_ISSUE", {"summary": "bug"}).allowed


def test_outlook_send_with_empty_allowlist_fails_closed():
    decision = check_connector_call("OUTLOOK_SEND_EMAIL", {"to": ["jane@acme.com"]})
    assert not decision.allowed
    assert "allow-list" in decision.reason.lower()


def test_outlook_send_to_allowlisted_address_is_allowed(monkeypatch):
    monkeypatch.setitem(conf(), "outlook_allowed_recipients", ["jane@acme.com"])
    decision = check_connector_call("OUTLOOK_SEND_EMAIL", {"to": ["jane@acme.com"]})
    assert decision.allowed


def test_outlook_send_to_non_allowlisted_address_is_blocked(monkeypatch):
    monkeypatch.setitem(conf(), "outlook_allowed_recipients", ["jane@acme.com"])
    decision = check_connector_call("OUTLOOK_SEND_EMAIL", {"to": ["mallory@evil.com"]})
    assert not decision.allowed
    assert "mallory@evil.com" in decision.reason


def test_outlook_domain_allowlist_covers_any_address_in_it(monkeypatch):
    monkeypatch.setitem(conf(), "outlook_allowed_recipients", ["@acme.com"])
    decision = check_connector_call("OUTLOOK_SEND_EMAIL", {"to": ["anyone@acme.com"]})
    assert decision.allowed


def test_outlook_calendar_invite_attendees_are_checked_too(monkeypatch):
    monkeypatch.setitem(conf(), "outlook_allowed_recipients", ["jane@acme.com"])
    decision = check_connector_call(
        "OUTLOOK_CREATE_EVENT",
        {"subject": "Sync", "attendees": [{"emailAddress": {"address": "mallory@evil.com"}}]},
    )
    assert not decision.allowed


def test_outlook_read_only_action_is_not_gated_by_recipients():
    # No allow-list configured, but LIST is not a mutating verb, so it's not
    # a send/invite -- reading a calendar with attendee data in the response
    # shape should not require an allow-list.
    decision = check_connector_call("OUTLOOK_LIST_EVENTS", {"attendee": "someone@example.com"})
    assert decision.allowed


def test_connector_call_proxy_is_unwrapped_to_the_real_slug(monkeypatch):
    monkeypatch.setitem(conf(), "connector_toolkit_toggles", {"OUTLOOK": False})
    decision = check_connector_call(
        "connector_call",
        {"tool_slug": "OUTLOOK_SEND_EMAIL", "arguments": {"to": ["jane@acme.com"]}},
    )
    assert not decision.allowed
    assert "OUTLOOK" in decision.reason


def test_connector_call_proxy_enforces_outlook_allowlist_too(monkeypatch):
    monkeypatch.setitem(conf(), "outlook_allowed_recipients", ["jane@acme.com"])
    decision = check_connector_call(
        "connector_call",
        {"tool_slug": "OUTLOOK_SEND_EMAIL", "arguments": {"to": ["mallory@evil.com"]}},
    )
    assert not decision.allowed
