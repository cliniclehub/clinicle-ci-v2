# encoding:utf-8
"""Proves the identity processor's actual job: a request carrying a valid
multi-tenant session token must have org_id on the ambient RuntimeIdentity
*while the handler runs* — not just "doesn't crash" (test_upload_agent_scope.py
already covers that the processor doesn't corrupt unrelated requests).

Drives a real web.py app + real HTTP request, same style as
test_upload_agent_scope.py, because the bug this guards against
(_get_query_token draining a request body) only shows up under a real
request/response cycle, not a bare function call.
"""

import threading
import urllib.request
from wsgiref.simple_server import WSGIRequestHandler, make_server

import pytest
import web

from channel.web.core.tenancy_session import create_session_token
from common.runtime_identity import current_identity


class _QuietHandler(WSGIRequestHandler):
    def log_message(self, *args):
        pass


class _WhoAmIHandler:
    def GET(self):
        web.header("Content-Type", "text/plain")
        return current_identity().org_id or "none"


@pytest.fixture
def server(tmp_path, monkeypatch):
    from channel.web import web_channel
    from channel.web.core import tenancy_session

    monkeypatch.setattr(
        tenancy_session, "_secret_path", lambda: tmp_path / "session_secret"
    )

    urls = ("/whoami", "_WhoAmIHandler")
    namespace = dict(web_channel.__dict__)
    namespace["_WhoAmIHandler"] = _WhoAmIHandler
    app = web.application(urls, namespace, autoreload=False)
    app.add_processor(web_channel._identity_processor)

    httpd = make_server("127.0.0.1", 0, app.wsgifunc(), handler_class=_QuietHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{httpd.server_address[1]}"
    finally:
        httpd.shutdown()


def test_no_token_resolves_to_no_org(server):
    with urllib.request.urlopen(f"{server}/whoami", timeout=10) as response:
        assert response.read() == b"none"


def test_valid_token_puts_org_id_on_the_ambient_identity(server):
    token = create_session_token(user_id=1, org_id=42, expire_seconds=3600)
    request = urllib.request.Request(f"{server}/whoami")
    request.add_header("Cookie", f"cow_auth_token={token}")
    with urllib.request.urlopen(request, timeout=10) as response:
        assert response.read() == b"42"


def test_two_different_orgs_see_their_own_id_not_each_others(server):
    token_a = create_session_token(user_id=1, org_id=1, expire_seconds=3600)
    token_b = create_session_token(user_id=2, org_id=2, expire_seconds=3600)

    req_a = urllib.request.Request(f"{server}/whoami")
    req_a.add_header("Cookie", f"cow_auth_token={token_a}")
    req_b = urllib.request.Request(f"{server}/whoami")
    req_b.add_header("Cookie", f"cow_auth_token={token_b}")

    with urllib.request.urlopen(req_a, timeout=10) as response:
        assert response.read() == b"1"
    with urllib.request.urlopen(req_b, timeout=10) as response:
        assert response.read() == b"2"
