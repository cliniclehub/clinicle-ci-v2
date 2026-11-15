"""The pages the browser loads directly, and the assets they pull in.

RootHandler and ChatHandler both serve the console shell -- every in-app
path renders the same page and the frontend router takes it from there.
AssetsHandler serves everything under static/, and decides what may be
cached immutably.
"""

import json
import mimetypes
import os
import re

import web

from channel.web.core import template
from common import i18n
from common.log import logger

# Mirrors static/js/core/router.js's ROUTE_PATHS (path segment -> view id).
# Keep the two in sync by hand -- this side only needs the top-level view a
# path names, never tabs, so it stays a plain dict rather than pulling in a
# JS-parsing step at render time.
_ROUTE_VIEWS = {
    '': 'overview', 'home': 'chat', 'agents': 'agents', 'settings': 'settings',
    'memory': 'memory', 'knowledge': 'knowledge', 'scheduler': 'tasks', 'logs': 'logs',
    'review-queue': 'review-queue', 'workflows': 'workflows', 'teams': 'teams',
    'meetings': 'meetings', 'board': 'board', 'alerts': 'alerts', 'analytics': 'analytics',
}


def _mark_active_view(html: str, path: str, *, force_chat: bool = False) -> str:
    """Swap which #view-<id> and .sidebar-item[data-view=<id>] the shipped
    HTML marks active, so the very first paint already shows the requested
    view instead of always shipping Dashboard active and waiting for
    client-side JS to correct it after the deferred bundle runs and auth
    settles -- that gap was a visible flash of Dashboard on every reload of
    any other page.

    Falls back to leaving the HTML untouched (Dashboard stays active, same
    as before this existed) for any path this table doesn't recognize --
    router.js's own _routeParse falls back to Dashboard for the same reason,
    so this stays consistent with what the client would have landed on
    anyway."""
    if force_chat:
        target = 'chat'
    else:
        segment = path.strip('/').split('/', 1)[0]
        target = _ROUTE_VIEWS.get(segment)
    if not target or target == 'overview':
        return html

    html = html.replace('id="view-overview" class="view active"', 'id="view-overview" class="view"', 1)
    html = re.sub(
        rf'id="view-{re.escape(target)}" class="view"',
        f'id="view-{target}" class="view active"',
        html, count=1,
    )
    html = html.replace('class="sidebar-item active ', 'class="sidebar-item ', 1)
    html = re.sub(
        rf'class="sidebar-item ([^"]*?)"\s*\n(\s*)data-view="{re.escape(target)}"',
        rf'class="sidebar-item active \1"\n\2data-view="{target}"',
        html, count=1,
    )
    return html


class RootHandler:
    """Where /chat used to live. The console is at / now, so that the address
    bar reads as paths into one app rather than as a page with state after it.
    Kept as a redirect because /chat is what older bookmarks, and the startup
    banner of any running instance, still point at."""

    def GET(self):
        raise web.seeother('/')


class HealthHandler:
    # Unauthenticated liveness probe. The desktop shell polls this to know the
    # backend is up; it must never require auth (a set web_password would
    # otherwise make startup hang). Returns no sensitive data.
    def GET(self):
        web.header('Content-Type', 'application/json; charset=utf-8')
        web.header('Cache-Control', 'no-store')
        return json.dumps({"status": "ok"})


class ChatHandler:
    def GET(self):
        # Content-Type must be explicit: behind a reverse proxy that sends
        # X-Content-Type-Options: nosniff, a missing type makes browsers
        # refuse to sniff and render the page as plain text source.
        web.header('Content-Type', 'text/html; charset=utf-8')
        web.header('Cache-Control', 'no-cache, no-store, must-revalidate')
        web.header('Pragma', 'no-cache')
        # A Teams grid column embeds this same page in an iframe and is
        # always already cookie-authenticated same-origin -- never redirect
        # it away to a top-level /login navigation. Every other unauthenticated
        # top-level visit now lands on the dedicated login page instead of the
        # in-app overlay (see login.html / LoginPageHandler).
        # ctx fields are read defensively (see AssetsHandler below): this
        # handler is also driven directly in tests, outside a live request,
        # where ctx is empty -- there is no request to gate in that case.
        if web.ctx.get('env') is not None and 'embed=1' not in web.ctx.get('query', ''):
            from channel.web.core._common import _check_auth
            if not _check_auth():
                raise web.seeother('/login?next=' + web.urlquote(web.ctx.get('fullpath', '/')))
        # The shell pulls its layout, views and modals in from templates/;
        # render() assembles them and stamps every first-party asset with its
        # own mtime, so an upgraded console never runs against cached old
        # scripts while unchanged ones stay cacheable.
        html = template.render('chat.html')
        # Inject the backend-resolved default language for first-load fallback.
        html = html.replace("{{COW_DEFAULT_LANG}}", i18n.get_language())
        # Pre-mark which view is active in the HTML itself, instead of
        # shipping every request with Dashboard marked active and letting
        # client-side JS correct it after the deferred bundle runs: that gap
        # was a visible flash of Dashboard on every reload of any other page.
        # An embedded Teams grid column (query has embed=1, see
        # ChatHandler.GET's auth-gate check above and EMBED_MODE in
        # chat/state.js) is chat-only regardless of path, same reasoning as
        # router.js's own EMBED_MODE guard in _routeParse.
        is_embed = web.ctx.get('env') is not None and 'embed=1' in web.ctx.get('query', '')
        path = '/' if is_embed else (web.ctx.get('path', '/') if web.ctx.get('env') is not None else '/')
        html = _mark_active_view(html, path, force_chat=is_embed)
        return html


class LoginPageHandler:
    """GET /login -- the standalone login page (own document, hero + form,
    not the chat.html-embedded overlay). Posts to the existing /auth/login."""

    def GET(self):
        web.header('Content-Type', 'text/html; charset=utf-8')
        web.header('Cache-Control', 'no-cache, no-store, must-revalidate')
        return template.render('login.html')


class SignupPageHandler:
    """GET /signup -- standalone account-creation page. Posts to the existing
    /auth/signup, which already creates the org, the user, and grants them
    the "owner" role; nothing about that backend flow changes here."""

    def GET(self):
        web.header('Content-Type', 'text/html; charset=utf-8')
        web.header('Cache-Control', 'no-cache, no-store, must-revalidate')
        return template.render('signup.html')


class AssetsHandler:
    def GET(self, file_path):  # 修改默认参数
        try:
            # 如果请求是/static/，需要处理
            if file_path == '':
                # 返回目录列表...
                pass

            # This module lives in channel/web/api/, one level below the web
            # root that static/ sits in.
            web_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            static_dir = os.path.join(web_dir, 'static')

            full_path = os.path.normpath(os.path.join(static_dir, file_path))

            # 安全检查：确保请求的文件在static目录内
            if not os.path.abspath(full_path).startswith(os.path.abspath(static_dir)):
                logger.error(f"Security check failed for path: {full_path}")
                raise web.notfound()

            if not os.path.exists(full_path) or not os.path.isfile(full_path):
                # Browsers routinely probe optional asset variants (e.g. a
                # .ttf fallback declared alongside .woff2 in @font-face);
                # logging these as errors floods the console with harmless
                # noise. Keep it at debug level — real misconfigurations
                # will still surface via the network panel.
                logger.debug(f"Static file not found: {full_path}")
                raise web.notfound()

            # 设置正确的Content-Type
            content_type = mimetypes.guess_type(full_path)[0]
            if content_type:
                web.header('Content-Type', content_type)
            else:
                # 默认为二进制流
                web.header('Content-Type', 'application/octet-stream')

            # Without a validator a browser has nothing to cache on, so the
            # console re-downloaded every script, stylesheet, font and logo on
            # every reload. The ETag lets it ask instead, and a hit costs one
            # header rather than the file.
            info = os.stat(full_path)
            etag = '"%x-%x"' % (info.st_mtime_ns, info.st_size)
            web.header('ETag', etag)
            # ctx fields are read defensively: this handler is also driven
            # directly, outside a live request, where ctx is empty.
            if template.is_versioned(file_path) and 'v=' in web.ctx.get('query', ''):
                # render() stamps these with the file's own mtime, so the URL
                # cannot outlive the bytes it names: a changed file is a
                # changed URL. That is what makes it safe to promise the copy
                # never goes stale -- the promise is about this URL, not about
                # this path.
                web.header('Cache-Control', 'public, max-age=31536000, immutable')
            else:
                # Everything else (vendor bundles, fonts, logos) is served off
                # an unstamped URL, so it has to be revalidated. no-cache means
                # "keep it, but ask" -- not "do not keep it".
                web.header('Cache-Control', 'no-cache')
            if web.ctx.get('env', {}).get('HTTP_IF_NONE_MATCH') == etag:
                raise web.notmodified()

            # 读取并返回文件内容
            with open(full_path, 'rb') as f:
                return f.read()

        except web.HTTPError:
            # A 304 or the 404 above, both already handled; re-raise as-is so
            # web.py returns the original status to the client.
            raise
        except Exception as e:
            logger.error(f"Error serving static file: {e}", exc_info=True)
            raise web.notfound()
