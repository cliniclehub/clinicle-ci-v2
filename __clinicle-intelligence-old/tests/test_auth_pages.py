# encoding:utf-8
"""Guard the standalone /login and /signup pages' wiring.

These render outside the chat.html shell (see channel/web/login.html and
signup.html), so nothing in test_web_console_routing.py or
test_web_console_assets.py -- both scoped to chat.html -- exercises them.
"""

import os
import re

from channel.web.core import template

WEB = os.path.join(os.path.dirname(__file__), "..", "channel", "web")


def _backend_urls():
    with open(os.path.join(WEB, "web_channel.py"), encoding="utf-8") as f:
        source = f.read()
    table = re.search(r"\nURLS = \((.*?)\n\)", source, re.S)
    assert table, "the URL table is no longer where the tests can read it"
    return table.group(1)


def test_login_and_signup_routes_are_registered():
    urls = _backend_urls()
    assert re.search(r"'/login',\s*'LoginPageHandler'", urls)
    assert re.search(r"'/signup',\s*'SignupPageHandler'", urls)


def test_login_page_renders_the_login_form():
    page = template.render("login.html")
    assert 'id="login-form"' in page
    assert 'id="email"' in page
    assert 'id="password"' in page
    # Progressive MFA field -- hidden until AuthLoginHandler asks for it.
    assert 'id="mfa_code"' in page


def test_signup_page_renders_the_signup_form():
    page = template.render("signup.html")
    assert 'id="signup-form"' in page
    assert 'id="email"' in page
    assert 'id="org_name"' in page
    assert 'id="password_confirm"' in page


def test_signup_posts_to_the_existing_backend_endpoint():
    """No new signup logic -- the page has to call the handler that already
    creates the org, the user, and the "owner" membership."""
    page = template.render("signup.html")
    assert "/auth/signup" in page


def test_login_posts_to_the_existing_backend_endpoint():
    page = template.render("login.html")
    assert "/auth/login" in page


def test_unauthenticated_top_level_load_redirects_to_login():
    """ChatHandler now gates '/' itself: an unauthenticated, non-embed request
    is sent to /login instead of showing the chat shell (and, behind it, the
    now-narrowed-scope overlay)."""
    with open(os.path.join(WEB, "api", "pages.py"), encoding="utf-8") as f:
        source = f.read()
    chat_handler = source[source.index("class ChatHandler:"):source.index("class LoginPageHandler:")]
    assert "_check_auth" in chat_handler
    assert "seeother('/login" in chat_handler
    # The embed (Teams grid iframe) path must never redirect away.
    assert 'embed' in chat_handler
