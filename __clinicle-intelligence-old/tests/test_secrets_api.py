# encoding:utf-8
"""The Secrets Vault + Security & Access API over a real WSGI server: exercises
the actual URL routing table and the admin gate, not just the vault functions
underneath it. Same pattern as tests/test_teams_api.py.
"""

import json
import threading
import urllib.error
import urllib.request
from wsgiref.simple_server import WSGIRequestHandler, make_server

import pytest

from agent.security import secrets_vault
from config import conf


class _QuietHandler(WSGIRequestHandler):
    def log_message(self, *args):
        pass


@pytest.fixture
def server(tmp_path, monkeypatch):
    monkeypatch.setattr(secrets_vault, "_default_db_path", lambda: tmp_path / "vault.db")
    monkeypatch.setattr(secrets_vault, "_default_key_path", lambda: tmp_path / "key")
    secrets_vault._instance = None

    from agent.audit import log as audit_log
    monkeypatch.setattr(audit_log, "_log_path", lambda: tmp_path / "events.jsonl")

    from channel.web import web_channel

    app = web_channel.build_app()
    httpd = make_server("127.0.0.1", 0, app.wsgifunc(), handler_class=_QuietHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{httpd.server_address[1]}"
    finally:
        httpd.shutdown()
        secrets_vault._instance = None


def _request(base_url, method, path, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    req_headers = {"Content-Type": "application/json"} if data else {}
    req_headers.update(headers or {})
    req = urllib.request.Request(f"{base_url}{path}", data=data, method=method, headers=req_headers)
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def test_full_lifecycle_over_http(server):
    status, data = _request(server, "GET", "/api/secrets")
    assert status == 200
    assert data["status"] == "success"
    assert data["secrets"] == []

    status, data = _request(server, "POST", "/api/secrets", {"name": "stripe_key", "value": "sk_live_abc123"})
    assert status == 200
    assert data["status"] == "success"
    assert data["name"] == "stripe_key"

    status, data = _request(server, "GET", "/api/secrets")
    assert status == 200
    assert data["secrets"] == [{"name": "stripe_key"}]

    status, data = _request(server, "DELETE", "/api/secrets/stripe_key")
    assert status == 200
    assert data["status"] == "success"

    status, data = _request(server, "GET", "/api/secrets")
    assert data["secrets"] == []


def test_get_secrets_never_includes_a_value_field(server):
    _request(server, "POST", "/api/secrets", {"name": "openai_key", "value": "sk-super-secret-value"})

    status, data = _request(server, "GET", "/api/secrets")
    assert status == 200
    body_text = json.dumps(data)
    assert "value" not in json.dumps(data["secrets"])
    assert "sk-super-secret-value" not in body_text
    for entry in data["secrets"]:
        assert set(entry.keys()) == {"name"}


def test_post_secrets_never_echoes_the_value_back(server):
    status, data = _request(server, "POST", "/api/secrets", {"name": "openai_key", "value": "sk-super-secret-value"})
    assert status == 200
    assert "value" not in data
    assert "sk-super-secret-value" not in json.dumps(data)


def test_delete_missing_secret_returns_404(server):
    status, data = _request(server, "DELETE", "/api/secrets/does-not-exist")
    assert status == 404
    assert data["status"] == "error"


def test_mfa_coverage_reports_zero_on_a_legacy_single_tenant_install(server):
    status, data = _request(server, "GET", "/api/security/mfa-coverage")
    assert status == 200
    assert data["mfa_coverage"] == {
        "total_members": 0, "mfa_enabled": 0, "mfa_disabled": 0, "applicable": False,
    }


def test_secrets_endpoints_reject_unauthenticated_requests_once_password_enabled(server, monkeypatch):
    monkeypatch.setitem(conf(), "web_password", "secret123")
    try:
        status, data = _request(server, "GET", "/api/secrets")
        assert status == 401
        assert data["status"] == "error"

        status, data = _request(server, "POST", "/api/secrets", {"name": "x", "value": "y"})
        assert status == 401

        status, data = _request(server, "DELETE", "/api/secrets/x")
        assert status == 401

        status, data = _request(server, "GET", "/api/security/mfa-coverage")
        assert status == 401
    finally:
        conf().pop("web_password", None)
