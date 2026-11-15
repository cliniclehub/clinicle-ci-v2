# encoding:utf-8
"""The Task Board API over a real WSGI server -- same fixture pattern as
test_teams_api.py, since /api/board/* sits directly on top of team_store's
per-team task list.
"""

import json
import threading
import urllib.error
import urllib.request
from wsgiref.simple_server import WSGIRequestHandler, make_server

import pytest

from agent.tools.team import autopilot
from agent.workspace import team_store


class _QuietHandler(WSGIRequestHandler):
    def log_message(self, *args):
        pass


@pytest.fixture
def server(tmp_path, monkeypatch):
    monkeypatch.setattr(team_store, "_store_file", lambda: str(tmp_path / "teams.json"))
    from channel.web import web_channel

    app = web_channel.build_app()
    httpd = make_server("127.0.0.1", 0, app.wsgifunc(), handler_class=_QuietHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{httpd.server_address[1]}"
    finally:
        httpd.shutdown()
        # Autopilot loops are daemon threads keyed by team_id; stop any this
        # test started so they don't keep polling a store tmp_path deletes.
        for team_id in list(autopilot._threads.keys()):
            autopilot.stop(team_id)


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


def _make_team(server):
    _, data = _request(server, "POST", "/api/teams", {
        "name": "board team",
        "members": [{"agent_id": "boss", "role": "leader"}, {"agent_id": "writer", "role": "teammate"}],
    })
    team = data["team"]
    return team["id"], team["members"][1]["slot_id"]


def test_create_list_and_move_a_task(server):
    team_id, owner_slot = _make_team(server)

    status, data = _request(server, "POST", "/api/board/tasks", {
        "team_id": team_id, "subject": "write the docs", "owner_slot_id": owner_slot,
    })
    assert status == 200 and data["status"] == "success"
    task = data["task"]
    assert task["status"] == "todo"

    status, data = _request(server, "GET", f"/api/board/tasks?team_id={team_id}")
    assert status == 200
    assert [t["id"] for t in data["tasks"]] == [task["id"]]
    assert data["tasks"][0]["owner_agent_id"] == "writer"
    assert data["tasks"][0]["team_name"] == "board team"

    status, data = _request(server, "PUT", f"/api/board/tasks/{task['id']}", {
        "team_id": team_id, "status": "review",
    })
    assert status == 200
    assert data["task"]["status"] == "review"


def test_task_with_unmet_blocker_starts_in_backlog(server):
    team_id, owner_slot = _make_team(server)
    _, data = _request(server, "POST", "/api/board/tasks", {
        "team_id": team_id, "subject": "backend", "owner_slot_id": owner_slot,
    })
    blocker_id = data["task"]["id"]

    _, data = _request(server, "POST", "/api/board/tasks", {
        "team_id": team_id, "subject": "frontend", "owner_slot_id": owner_slot,
        "blocked_task_ids": [blocker_id],
    })
    assert data["task"]["status"] == "backlog"


def test_move_rejects_unknown_status(server):
    team_id, owner_slot = _make_team(server)
    _, data = _request(server, "POST", "/api/board/tasks", {
        "team_id": team_id, "subject": "x", "owner_slot_id": owner_slot,
    })
    task_id = data["task"]["id"]
    status, data = _request(server, "PUT", f"/api/board/tasks/{task_id}", {
        "team_id": team_id, "status": "nope",
    })
    assert status == 200  # handled gracefully, not a 500
    assert data["status"] == "error"


def test_autopilot_toggle_starts_and_stops_the_loop(server):
    team_id, _ = _make_team(server)

    status, data = _request(server, "GET", f"/api/board/autopilot?team_id={team_id}")
    assert status == 200 and data["enabled"] is False

    status, data = _request(server, "POST", "/api/board/autopilot", {"team_id": team_id, "enabled": True})
    assert status == 200 and data["enabled"] is True
    assert team_store.is_autopilot_enabled(team_id) is True
    assert autopilot.is_running(team_id) is True

    status, data = _request(server, "POST", "/api/board/autopilot", {"team_id": team_id, "enabled": False})
    assert status == 200 and data["enabled"] is False
    assert team_store.is_autopilot_enabled(team_id) is False


def test_autopilot_unknown_team_404s(server):
    status, data = _request(server, "GET", "/api/board/autopilot?team_id=does-not-exist")
    assert status == 404
