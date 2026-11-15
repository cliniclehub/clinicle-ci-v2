# encoding:utf-8
"""The Teams API over a real WSGI server: exercises the actual URL routing
table (regex ordering between /api/teams, /api/teams/<id>,
/api/teams/<id>/members and /api/teams/<id>/members/<slot>), not just the
store functions underneath it. No auth token needed -- these tests run with
no `web_password` configured, same as the store test's isolation, so
_require_auth() passes through same as it does for every other endpoint on a
password-less local instance.
"""

import json
import threading
import urllib.error
import urllib.request
from wsgiref.simple_server import WSGIRequestHandler, make_server

import pytest

from agent.workspace import project_store, team_store


class _QuietHandler(WSGIRequestHandler):
    def log_message(self, *args):
        pass


@pytest.fixture
def server(tmp_path, monkeypatch):
    monkeypatch.setattr(team_store, "_store_file", lambda: str(tmp_path / "teams.json"))
    monkeypatch.setattr(project_store, "_store_file", lambda: str(tmp_path / "projects.json"))
    from channel.web import web_channel

    app = web_channel.build_app()
    httpd = make_server("127.0.0.1", 0, app.wsgifunc(), handler_class=_QuietHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{httpd.server_address[1]}"
    finally:
        httpd.shutdown()


def _request(base_url, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"{base_url}{path}", data=data, method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def test_full_lifecycle_over_http(server):
    status, data = _request(server, "POST", "/api/teams", {
        "name": "prodectivety",
        "members": [
            {"agent_id": "boss", "role": "leader"},
            {"agent_id": "writer", "role": "teammate"},
        ],
    })
    assert status == 200
    assert data["status"] == "success"
    team = data["team"]
    assert team["members"][0]["role"] == "leader"
    team_id = team["id"]

    status, data = _request(server, "GET", "/api/teams")
    assert status == 200
    assert any(t["id"] == team_id for t in data["teams"])

    status, data = _request(server, "GET", f"/api/teams/{team_id}")
    assert status == 200
    assert data["team"]["name"] == "prodectivety"

    status, data = _request(server, "POST", f"/api/teams/{team_id}/members", {"agent_id": "third"})
    assert status == 200
    assert len(data["team"]["members"]) == 3

    slot_id = data["team"]["members"][-1]["slot_id"]
    status, data = _request(server, "DELETE", f"/api/teams/{team_id}/members/{slot_id}")
    assert status == 200
    assert len(data["team"]["members"]) == 2

    status, data = _request(server, "PUT", f"/api/teams/{team_id}", {"name": "renamed"})
    assert status == 200
    assert data["team"]["name"] == "renamed"

    status, data = _request(server, "DELETE", f"/api/teams/{team_id}")
    assert status == 200
    assert data["status"] == "success"


def test_missing_team_returns_404_not_500(server):
    status, data = _request(server, "GET", "/api/teams/does-not-exist")
    assert status == 404
    assert data["status"] == "error"


def test_create_with_workspace_over_http(server, tmp_path):
    folder = tmp_path / "shared-folder"
    folder.mkdir()
    status, data = _request(server, "POST", "/api/teams", {
        "name": "t",
        "members": [{"agent_id": "boss", "role": "leader"}],
        "workspace": str(folder),
    })
    assert status == 200
    assert data["team"]["workspace"] == str(folder.resolve())


def test_create_with_bad_workspace_returns_error_not_500(server, tmp_path):
    status, data = _request(server, "POST", "/api/teams", {
        "name": "t",
        "members": [{"agent_id": "boss", "role": "leader"}],
        "workspace": str(tmp_path / "nope"),
    })
    assert status == 200  # handled gracefully, not a 500
    assert data["status"] == "error"


def test_work_endpoint_reflects_slot_work_and_404s_for_foreign_id(server):
    _, data = _request(server, "POST", "/api/teams", {
        "name": "t", "members": [{"agent_id": "boss", "role": "leader"}],
    })
    team_id = data["team"]["id"]
    slot_id = data["team"]["members"][0]["slot_id"]

    status, data = _request(server, "GET", f"/api/teams/{team_id}/work")
    assert status == 200 and data["work"] == {}

    team_store.mark_slot_running(team_id, slot_id)
    status, data = _request(server, "GET", f"/api/teams/{team_id}/work")
    assert status == 200 and slot_id in data["work"]
    team_store.mark_slot_idle(team_id, slot_id)

    status, data = _request(server, "GET", "/api/teams/does-not-exist/work")
    assert status == 404


def test_removing_leader_returns_error_not_500(server):
    _, data = _request(server, "POST", "/api/teams", {
        "name": "t", "members": [{"agent_id": "boss", "role": "leader"}],
    })
    team_id = data["team"]["id"]
    leader_slot = data["team"]["members"][0]["slot_id"]
    status, data = _request(server, "DELETE", f"/api/teams/{team_id}/members/{leader_slot}")
    assert status == 200  # handled gracefully, not a crash
    assert data["status"] == "error"
