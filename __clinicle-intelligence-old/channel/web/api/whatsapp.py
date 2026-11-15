"""Meta WhatsApp Cloud API webhook.

No separate HTTP server/port (unlike wechatmp's model) -- Cloud API just
needs one public HTTPS URL, and this deployment already has one via the web
console's own domain, so the webhook is two routes on it instead of new
infra. Reuses the same org-identity resolution and ChatService dispatch
channel/web/api/openai_compat.py's external entry point uses, for the same
reason: an inbound webhook has no session/org context of its own, so it
must be resolved explicitly rather than left to default to nothing.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time

import web

from common.log import logger
from common.runtime_identity import RuntimeIdentity, use_identity
from config import conf

GRAPH_API_BASE = "https://graph.facebook.com/v21.0"


def _default_org_id():
    """Same single-org fallback channel/web/api/openai_compat.py and
    common/state_dir.py use -- see either docstring for why an unset org_id
    must never silently mean "the ownerless global workspace"."""
    try:
        from agent.tenancy.store import get_tenancy_store

        store = get_tenancy_store()
        conn = store._connect()
        try:
            rows = conn.execute("SELECT id FROM organizations LIMIT 2").fetchall()
        finally:
            conn.close()
    except Exception:
        return None
    return str(rows[0][0]) if len(rows) == 1 else None


def _verify_signature(body: bytes, signature_header: str) -> bool:
    app_secret = str(conf().get("whatsapp_app_secret") or "").strip()
    if not app_secret:
        # No secret configured -- nothing to check against. Logged, not
        # silently accepted as "verified", so a misconfigured install is
        # visible rather than quietly insecure.
        logger.warning("[WhatsApp] whatsapp_app_secret is unset; skipping signature check")
        return True
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    expected = hmac.new(app_secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature_header[len("sha256="):], expected)


def _send_text(to: str, body: str) -> None:
    access_token = str(conf().get("whatsapp_access_token") or "").strip()
    phone_number_id = str(conf().get("whatsapp_phone_number_id") or "").strip()
    if not access_token or not phone_number_id:
        logger.warning("[WhatsApp] Cannot send reply: access token or phone number id unset")
        return
    try:
        import urllib.request

        payload = json.dumps({
            "messaging_product": "whatsapp",
            "to": to,
            "type": "text",
            "text": {"body": body},
        }).encode()
        req = urllib.request.Request(
            f"{GRAPH_API_BASE}/{phone_number_id}/messages",
            data=payload,
            method="POST",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
        )
        urllib.request.urlopen(req, timeout=15)
    except Exception as e:
        logger.warning(f"[WhatsApp] send to {to} failed: {e}")


def _run_chat_service(*args, **kwargs):
    from agent.chat.service import ChatService
    from bridge.bridge import Bridge

    return ChatService(Bridge().get_agent_bridge()).run(*args, **kwargs)


def _handle_inbound_message(msg: dict) -> None:
    sender = str(msg.get("from") or "").strip()
    text = ((msg.get("text") or {}).get("body") or "").strip()
    if not sender or not text:
        return  # non-text message types (image/audio/...) are out of scope for now

    identity = RuntimeIdentity(org_id=_default_org_id())
    content: list = []

    def send_chunk(chunk: dict) -> None:
        if chunk.get("chunk_type") == "content" and chunk.get("delta"):
            content.append(chunk["delta"])

    with use_identity(identity):
        try:
            _run_chat_service(
                text, f"whatsapp:{sender}", send_chunk,
                channel_type="whatsapp", agent_id=None, request_id=f"wa-{int(time.time() * 1000)}",
            )
        except Exception as e:
            logger.error(f"[WhatsApp] chat run failed for {sender}: {e}")
            return

    reply = "".join(content).strip()
    if reply:
        _send_text(sender, reply)


class WhatsAppWebhookHandler:
    """Public, unauthenticated by design -- Meta calls this directly, so
    the only gate is the verify token (GET) and the signature (POST)."""

    def GET(self):
        params = web.input(**{"hub.mode": "", "hub.verify_token": "", "hub.challenge": ""})
        expected = str(conf().get("whatsapp_verify_token") or "")
        if (params["hub.mode"] == "subscribe" and expected
                and hmac.compare_digest(params["hub.verify_token"], expected)):
            web.header("Content-Type", "text/plain; charset=utf-8")
            return params["hub.challenge"]
        web.ctx.status = "403 Forbidden"
        return ""

    def POST(self):
        body = web.data() or b"{}"
        if not _verify_signature(body, web.ctx.env.get("HTTP_X_HUB_SIGNATURE_256", "")):
            web.ctx.status = "403 Forbidden"
            return ""
        try:
            payload = json.loads(body)
        except Exception:
            web.ctx.status = "400 Bad Request"
            return ""

        # Cloud API's own contract: always 200 quickly, or Meta retries and
        # eventually disables the webhook -- process best-effort, never let
        # a bad message in the batch take the ack down with it.
        for entry in payload.get("entry", []) or []:
            for change in entry.get("changes", []) or []:
                for msg in (change.get("value", {}) or {}).get("messages", []) or []:
                    try:
                        _handle_inbound_message(msg)
                    except Exception as e:
                        logger.error(f"[WhatsApp] inbound message handling failed: {e}")

        web.header('Content-Type', 'application/json; charset=utf-8')
        return json.dumps({"status": "success"})
