"""WhatsApp (Meta Cloud API) channel for Sithiji.

Inbound: Meta POSTs to /webhook/whatsapp (signature-checked with the app
secret). Only the numbers in WA_ADMIN_NUMBER / WA_CHAMUDHI_NUMBER are served;
everyone else is ignored. Messages go through the same intake as Telegram
(bot.process_text / bot.process_media) so both channels behave identically.

Outbound: plain text via the Graph API. WhatsApp only allows free-form
replies within 24h of the person's last message; a result that finishes after
that window (PC offline for a day) cannot be delivered and is logged instead.
"""
from __future__ import annotations
import hashlib
import hmac
import mimetypes
import threading
import time
import traceback

import requests

import core
from _env import env

API = "https://graph.facebook.com/v21.0"
_MEDIA_TYPES = ("image", "video", "document")


def _cfg() -> dict:
    return env()


def allowed_numbers() -> set[str]:
    c = _cfg()
    return {str(c.get(k)).strip().lstrip("+") for k in ("WA_ADMIN_NUMBER", "WA_CHAMUDHI_NUMBER") if c.get(k)}


def enabled() -> bool:
    c = _cfg()
    return bool(c.get("WA_TOKEN") and c.get("WA_PHONE_ID") and c.get("META_APP_SECRET"))


def verify_signature(raw: bytes, header: str) -> bool:
    secret = _cfg().get("META_APP_SECRET") or ""
    if not secret:
        return False
    expected = "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(header or "", expected)


def verify_token_ok(token: str) -> bool:
    want = _cfg().get("WA_WEBHOOK_VERIFY_TOKEN") or ""
    return bool(want) and hmac.compare_digest(token or "", want)


def send_text(to: str, text: str) -> None:
    import os
    if os.environ.get("SITHIJI_WA_DRYRUN"):
        print(f"[whatsapp DRYRUN] to {to}: {text[:300]!r}")
        return
    c = _cfg()
    tok, pid = c.get("WA_TOKEN"), c.get("WA_PHONE_ID")
    if not (tok and pid):
        print("[whatsapp] WA_TOKEN / WA_PHONE_ID not set - not sent")
        return
    for i in range(0, len(text), 3800):
        try:
            r = requests.post(f"{API}/{pid}/messages", timeout=30,
                              headers={"Authorization": f"Bearer {tok}"},
                              json={"messaging_product": "whatsapp", "to": to, "type": "text",
                                    "text": {"body": text[i:i + 3800], "preview_url": False}})
            if not r.ok:
                err = (r.json().get("error") or {}) if r.headers.get("content-type", "").startswith("application/json") else {}
                print(f"[whatsapp] send to {to} failed: HTTP {r.status_code} code={err.get('code')} {err.get('message')}")
                return
        except Exception as e:
            print(f"[whatsapp] send to {to} failed: {type(e).__name__}: {e}")
            return
        time.sleep(0.4)   # keep multi-part replies in order


def _download_media(media_id: str, dest_dir) -> str | None:
    tok = _cfg().get("WA_TOKEN")
    h = {"Authorization": f"Bearer {tok}"}
    try:
        meta = requests.get(f"{API}/{media_id}", headers=h, timeout=30).json()
        url, mime = meta.get("url"), meta.get("mime_type") or ""
        if not url:
            return None
        r = requests.get(url, headers=h, timeout=180)
        r.raise_for_status()
        ext = (mimetypes.guess_extension(mime.split(";")[0]) or ".bin").replace(".jpe", ".jpg")
        if ext == ".bin":
            return None
        fn = f"wa_{int(time.time() * 1000)}{ext}"
        (dest_dir / fn).write_bytes(r.content)
        return fn
    except Exception:
        traceback.print_exc()
        return None


def _handle_message(msg: dict, name: str) -> None:
    import bot   # late import: bot imports whatsapp lazily too
    sender = msg.get("from", "")
    chat_id = "wa:" + sender
    kind = msg.get("type")
    try:
        if kind == "text":
            reply = bot.process_text(chat_id, (msg.get("text") or {}).get("body", ""), name)
        elif kind in _MEDIA_TYPES:
            body = msg.get(kind) or {}
            if kind == "document" and not (body.get("mime_type") or "").startswith(("image/", "video/")):
                reply = "I can read images, videos, links and text. Send the content as a photo, video or link."
            else:
                reply = bot.process_media(chat_id, (body.get("caption") or "").strip(),
                                          lambda d: _download_media(body.get("id"), d))
        else:
            reply = "I can read links, text, photos and videos. Send one of those."
        if reply:
            send_text(sender, reply)
    except Exception:
        traceback.print_exc()
        send_text(sender, "Something went wrong handling that - please try again.")


def handle_payload(payload: dict) -> None:
    """Called off the request thread (Meta retries any webhook that answers slowly)."""
    allowed = allowed_numbers()
    for entry in payload.get("entry") or []:
        for change in entry.get("changes") or []:
            value = change.get("value") or {}
            names = {c.get("wa_id"): (c.get("profile") or {}).get("name") for c in value.get("contacts") or []}
            for msg in value.get("messages") or []:
                mid = msg.get("id")
                if mid:
                    if core.get_meta("wa_msg:" + mid):
                        continue    # Meta re-delivery
                    core.set_meta("wa_msg:" + mid, core.now())
                if msg.get("from") not in allowed:
                    print(f"[whatsapp] ignored message from non-allow-listed number {msg.get('from')!r}")
                    continue
                threading.Thread(target=_handle_message, args=(msg, names.get(msg.get("from")) or "user"),
                                 daemon=True).start()
