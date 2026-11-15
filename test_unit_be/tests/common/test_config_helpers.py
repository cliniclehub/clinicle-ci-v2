"""Tests for environment configuration parsing helpers."""

import pytest

from app.common import config


pytestmark = pytest.mark.unit


def test_parse_seconds_env_accepts_seconds_suffix(monkeypatch):
    monkeypatch.setenv("STATEMENT_TIMEOUT", "60s")

    assert config._parse_seconds_env("STATEMENT_TIMEOUT", 10, minimum=2, maximum=60) == 60


def test_parse_seconds_env_falls_back_when_out_of_range(monkeypatch):
    monkeypatch.setenv("STATEMENT_TIMEOUT", "90s")

    assert config._parse_seconds_env("STATEMENT_TIMEOUT", 10, minimum=2, maximum=60) == 10


def test_parse_int_env_falls_back_when_out_of_range(monkeypatch):
    monkeypatch.setenv("STATEMENT_TIMEOUT", "25")

    assert config._parse_int_env("STATEMENT_TIMEOUT", 1, minimum=1, maximum=10) == 1


def test_statement_timeout_defaults_to_five_minutes(monkeypatch):
    monkeypatch.delenv("STATEMENT_TIMEOUT", raising=False)

    assert config._parse_statement_timeout_seconds() == 300


def test_statement_timeout_parses_seconds_suffix(monkeypatch):
    monkeypatch.setenv("STATEMENT_TIMEOUT", "120s")

    assert config._parse_statement_timeout_seconds() == 120


def test_statement_timeout_ms_is_seconds_times_one_thousand(monkeypatch):
    monkeypatch.setenv("STATEMENT_TIMEOUT", "90")

    assert config._parse_statement_timeout_seconds() == 90
    assert config._parse_statement_timeout_seconds() * 1000 == 90000


def test_env_bool_defaults_false_outside_local(monkeypatch):
    monkeypatch.setattr(config, "ENVIRONMENT", "production")
    monkeypatch.delenv("ECHO", raising=False)

    assert config._env_bool("ECHO", default_local=True, default_non_local=False) is False


def test_env_bool_defaults_true_in_local(monkeypatch):
    monkeypatch.setattr(config, "ENVIRONMENT", "local")
    monkeypatch.delenv("ECHO", raising=False)

    assert config._env_bool("ECHO", default_local=True, default_non_local=False) is True

