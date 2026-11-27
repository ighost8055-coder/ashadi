"""Sithiji - Content Assistor. Dashboard + Telegram bot in one process.
Run:  python sithiji/app_sithiji.py   ->  http://127.0.0.1:5070
"""
from __future__ import annotations
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from flask import Flask, jsonify, render_template, request, send_from_directory

import analyze
import core
import social_fetch
from _env import env

app = Flask(__name__, static_folder="static", template_folder="templates")
import os
PORT = int(os.environ.get("SITHIJI_PORT", "5070"))


# ---------------------------------------------------------------- public-hosting guard
# On the VPS (https://pricelens.lanka.info/sithiji) set in .env: SITHIJI_PUBLIC=1, SITHIJI_WEB_PASSWORD (12+ chars),
# SITHIJI_ALLOWED_HOSTS, SITHIJI_ALLOWED_ORIGINS. Then every page/API call needs HTTP Basic auth and every state-changing
# call must come from this site's own pages (Origin check; browsers attach Basic credentials to cross-site requests too).
# Exempt, because they authenticate themselves: /webhook/whatsapp (Meta's signature) and /api/worker/* (X-Worker-Key).
# Locally (SITHIJI_PUBLIC unset) nothing changes.
import base64
import hmac
import time

_E = env()
PUBLIC = (os.environ.get("SITHIJI_PUBLIC") or _E.get("SITHIJI_PUBLIC") or "") == "1"
_WEB_USER = os.environ.get("SITHIJI_WEB_USER") or _E.get("SITHIJI_WEB_USER") or "kapruka"
_WEB_PW = os.environ.get("SITHIJI_WEB_PASSWORD") or _E.get("SITHIJI_WEB_PASSWORD") or ""
_HOSTS = {h.strip().lower() for h in (os.environ.get("SITHIJI_ALLOWED_HOSTS") or _E.get("SITHIJI_ALLOWED_HOSTS") or "").split(",") if h.strip()}
_ORIGINS = {o.strip().lower() for o in (os.environ.get("SITHIJI_ALLOWED_ORIGINS") or _E.get("SITHIJI_ALLOWED_ORIGINS") or "").split(",") if o.strip()}
_OPEN = (os.environ.get("SITHIJI_OPEN") or _E.get("SITHIJI_OPEN") or "") == "1"   # 1 = no sign-in, no Origin check
if PUBLIC and not _OPEN and (len(_WEB_PW) < 12 or not _HOSTS or not _ORIGINS):
    raise SystemExit("SITHIJI_PUBLIC=1 needs SITHIJI_WEB_PASSWORD (12+ chars), SITHIJI_ALLOWED_HOSTS and SITHIJI_ALLOWED_ORIGINS. Refusing to start.")
_fails = {"n": 0, "t": 0.0}


@app.before_request
def _public_guard():
    if not PUBLIC or _OPEN:
        return None
    p = request.path
    if p == "/healthz" or p == "/webhook/whatsapp" or p.startswith("/api/worker/"):
        return None
    host_full = (request.host or "").lower()
    if host_full not in _HOSTS and host_full.split(":")[0] not in _HOSTS and host_full.split(":")[0] not in ("127.0.0.1", "localhost"):
        return "forbidden", 403
    if _fails["n"] >= 10 and time.time() - _fails["t"] < 300:
        time.sleep(2)
        return "too many failed sign-ins, wait a few minutes", 429
    auth = request.headers.get("Authorization", "")
    ok = False
    if auth.startswith("Basic "):
        try:
            u, _, pw = base64.b64decode(auth[6:]).decode("utf-8").partition(":")
            ok = hmac.compare_digest(u, _WEB_USER) and hmac.compare_digest(pw, _WEB_PW)
        except Exception:
            ok = False
    if not ok:
        if auth:
            if time.time() - _fails["t"] > 300:
                _fails["n"] = 0
            _fails["n"] += 1
            _fails["t"] = time.time()
        return "Sign in required.", 401, {"WWW-Authenticate": 'Basic realm="Sithiji", charset="UTF-8"'}
    if request.method in ("POST", "PUT", "DELETE", "PATCH") and (request.headers.get("Origin") or "").lower() not in _ORIGINS:
        return "forbidden (cross-site request)", 403
    return None


@app.get("/healthz")
def healthz():
    return jsonify({"ok": True})


def _ws() -> str:
    raw = request.args.get("week") or (request.get_json(silent=True) or {}).get("week")
    return core.norm_week(raw) if raw else core.week_start()


@app.get("/")
def index():
    r = app.make_response(render_template("sithiji.html"))
    r.headers["Cache-Control"] = "no-store"        # always the current page (a cached copy hid the Ashadi button)
    return r


@app.get("/media/<int:cid>/<path:fn>")
def media(cid, fn):
    return send_from_directory(core.MEDIA / str(cid), fn)


@app.get("/api/state")
def state():
    core.rollover()          # carry unfinished picks from earlier weeks into the current one
    ws = _ws()
    items = core.list_content()
    return jsonify({
        "groups": core.GROUPS, "group_help": core.GROUP_HELP, "statuses": core.STATUSES,
        "week": core.week_summary(ws), "this_week": core.week_start(),
        "content": items, "pick_map": core.pick_map(),
        "queue_mode": analyze.mode() == "queue", "worker_online": core.worker_online(),
        "stats": {
            "total": len(items),
            "not_started": sum(1 for i in items if i["status"] == "not_started"),
            "in_progress": sum(1 for i in items if i["status"] == "in_progress"),
            "done": sum(1 for i in items if i["status"] == "done"),
            "analysing": sum(1 for i in items if i["analysis_state"] in ("pending", "analyzing")),
        },
    })


@app.get("/api/content/<int:cid>")
def one(cid):
    c = core.get_content(cid)
    if not c:
        return jsonify({"error": "not found"}), 404
    d = core.MEDIA / str(cid)
    c["media"] = sorted(f.name for f in d.iterdir()
                        if f.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov", ".webm"}) if d.exists() else []
    return jsonify(c)


@app.post("/api/idea")
def idea():
    """Quick add: link and/or text, AI does the rest (same as sending it to Telegram)."""
    j = request.get_json(force=True)
    text = (j.get("text") or "").strip()
    url = (j.get("url") or "").strip() or None
    if not text and not url:
        return jsonify({"error": "Add a link or some text."}), 400
    stype = "text_idea" if not url else social_fetch.platform_of(url)
    cid = core.add_content(source_url=url, source_type=stype, raw_text=text,
                           origin="original" if not url else "inspired")
    analyze.enqueue(cid)
    return jsonify({"id": cid})


@app.post("/api/log")
def log_manual():
    """Manual logging. Multipart so an optional image/video can ride along.
    If `ai` is on, only title/link/notes are needed and Claude fills the rest."""
    f = request.form
    title = (f.get("title") or "").strip()
    url = (f.get("url") or "").strip() or None
    notes = (f.get("notes") or "").strip()
    use_ai = f.get("ai") == "1"
    if not title and not use_ai:
        return jsonify({"error": "Give it a title."}), 400
    if not title and not (url or notes or request.files.get("file")):
        return jsonify({"error": "Add a title, link, notes or a file."}), 400
    stype = f.get("source_type") or (social_fetch.platform_of(url) if url else "text_idea")
    if request.files.get("file") and not url:
        stype = "own_upload"
    origin = f.get("origin") if f.get("origin") in ("original", "inspired") else "original"
    cid = core.add_content(source_url=url, source_type=stype, raw_text=notes, title=title or None, origin=origin)
    fl = request.files.get("file")
    thumb = None
    if fl and fl.filename:
        d = core.MEDIA / str(cid)
        d.mkdir(parents=True, exist_ok=True)
        name = "manual_" + Path(fl.filename).name.replace(" ", "_")
        fl.save(d / name)
        if Path(name).suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
            thumb = name
    if use_ai:
        if thumb:
            core.update_content(cid, thumb=thumb)
        analyze.enqueue(cid)
        return jsonify({"id": cid, "ai": True})
    grp = f.get("group")
    if grp not in core.GROUPS:
        core.delete_content(cid)
        return jsonify({"error": "Choose a group."}), 400
    try:
        diff = max(1, min(5, int(f.get("difficulty") or 3)))
    except ValueError:
        diff = 3
    steps = [{"n": i + 1, "title": s.strip()[:80], "detail": s.strip()}
             for i, s in enumerate((f.get("steps") or "").splitlines()) if s.strip()]
    fmt = "video" if grp.endswith("video") else "image"
    a = {"title": title, "content_format": fmt, "origin": origin, "what_it_is": notes,
         "group": grp, "steps": steps, "manual": True}
    core.update_content(
        cid, analysis_state="done", content_format=fmt, grp=grp, difficulty=diff,
        time_estimate=(f.get("time_estimate") or "").strip() or None,
        summary=notes, group_reason="Logged manually",
        status=f.get("status") if f.get("status") in core.STATUSES else "not_started",
        analysis_json=json.dumps(a, ensure_ascii=False), thumb=thumb,
        done_at=core.now() if f.get("status") == "done" else None)
    return jsonify({"id": cid})


@app.post("/api/content/<int:cid>/status")
def set_status(cid):
    st = (request.get_json(force=True) or {}).get("status")
    if st not in core.STATUSES:
        return jsonify({"error": "bad status"}), 400
    core.update_content(cid, status=st, done_at=core.now() if st == "done" else None)
    return jsonify({"ok": True})


@app.post("/api/content/<int:cid>/edit")
def edit(cid):
    j = request.get_json(force=True)
    upd = {}
    if j.get("grp") in core.GROUPS:
        upd["grp"] = j["grp"]
    if j.get("origin") in ("original", "inspired"):
        upd["origin"] = j["origin"]
    if j.get("difficulty"):
        upd["difficulty"] = max(1, min(5, int(j["difficulty"])))
    if j.get("title"):
        upd["title"] = j["title"][:120]
    core.update_content(cid, **upd)
    return jsonify({"ok": True})


@app.post("/api/content/<int:cid>/retry")
def retry(cid):
    analyze.enqueue(cid)
    return jsonify({"ok": True})


@app.delete("/api/content/<int:cid>")
def delete(cid):
    core.delete_content(cid)
    return jsonify({"ok": True})


@app.post("/api/pick/<int:cid>")
def pick(cid):
    j = request.get_json(silent=True) or {}
    pw = j.get("override_password")
    override = False
    if pw is not None:
        if not core.override_password_ok(pw):
            import time
            time.sleep(1)       # slow down guessing
            return jsonify({"ok": False, "message": "Wrong password.", "wrong_password": True}), 403
        override = True
    ok, msg = core.add_pick(_ws(), cid, override=override)
    return jsonify({"ok": ok, "message": msg, "overridable": (not ok and msg.startswith("Rule:"))}), (200 if ok else 409)


@app.post("/api/unpick/<int:cid>")
def unpick(cid):
    core.remove_pick(_ws(), cid)
    return jsonify({"ok": True})


@app.get("/api/suggest")
def suggest():
    return jsonify([{"id": c["id"], "title": c["title"], "grp": c["grp"], "difficulty": c["difficulty"]}
                    for c in core.suggest(_ws())])


# ------------------------------------------------------- WhatsApp webhook
@app.get("/webhook/whatsapp")
def wa_verify():
    import whatsapp
    if request.args.get("hub.mode") == "subscribe" and whatsapp.verify_token_ok(request.args.get("hub.verify_token", "")):
        return request.args.get("hub.challenge", ""), 200
    return "forbidden", 403


@app.post("/webhook/whatsapp")
def wa_receive():
    import threading
    import whatsapp
    raw = request.get_data()
    if not whatsapp.verify_signature(raw, request.headers.get("X-Hub-Signature-256", "")):
        return jsonify({"ok": False}), 403          # fail closed: the URL is public
    try:
        payload = json.loads(raw or b"{}")
    except ValueError:
        return jsonify({"ok": True}), 200
    threading.Thread(target=whatsapp.handle_payload, args=(payload,), daemon=True).start()
    return jsonify({"ok": True}), 200


# ------------------------------------------------- PC worker (queue mode)
_RESULT_FIELDS = {"analysis_state", "error", "title", "content_format", "origin", "grp", "group_reason",
                  "difficulty", "difficulty_why", "time_estimate", "summary", "analysis_json", "thumb", "raw_text"}
_MEDIA_EXT = {".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov", ".webm", ".mkv", ".m4v"}


def _worker_ok() -> bool:
    import hmac
    key = env().get("SITHIJI_WORKER_KEY") or ""
    return bool(key) and hmac.compare_digest(request.headers.get("X-Worker-Key", ""), key)


@app.post("/api/worker/claim")
def worker_claim():
    if not _worker_ok():
        return jsonify({"error": "unauthorized"}), 401
    core.set_meta("worker_seen", core.now())
    c = core.claim_next()
    if not c:
        return jsonify({"item": None})
    d = core.MEDIA / str(c["id"])
    c["media"] = sorted(f.name for f in d.iterdir() if f.suffix.lower() in _MEDIA_EXT) if d.exists() else []
    c.pop("analysis", None)
    return jsonify({"item": c})


@app.get("/api/worker/media/<int:cid>/<path:fn>")
def worker_media(cid, fn):
    if not _worker_ok():
        return jsonify({"error": "unauthorized"}), 401
    return send_from_directory(core.MEDIA / str(cid), fn)


@app.post("/api/worker/media_push/<int:cid>")
def worker_media_push(cid):
    """Files only (thumbnail backfill): no state change, no user notification."""
    if not _worker_ok():
        return jsonify({"error": "unauthorized"}), 401
    if not core.get_content(cid):
        return jsonify({"error": "gone"}), 404
    d = core.MEDIA / str(cid)
    d.mkdir(parents=True, exist_ok=True)
    n = 0
    for f in request.files.getlist("files"):
        name = Path(f.filename).name
        if Path(name).suffix.lower() in _MEDIA_EXT:
            f.save(d / name)
            n += 1
    return jsonify({"ok": True, "saved": n})


@app.post("/api/worker/result/<int:cid>")
def worker_result(cid):
    if not _worker_ok():
        return jsonify({"error": "unauthorized"}), 401
    core.set_meta("worker_seen", core.now())
    if not core.get_content(cid):
        return jsonify({"error": "gone"}), 404
    meta = json.loads(request.form.get("meta") or "{}")
    d = core.MEDIA / str(cid)
    d.mkdir(parents=True, exist_ok=True)
    for f in request.files.getlist("files"):
        name = Path(f.filename).name
        if Path(name).suffix.lower() in _MEDIA_EXT:
            f.save(d / name)
    if meta.get("analysis_state") == "pending":      # PC couldn't run it right now (e.g. Claude limit): requeue silently
        core.update_content(cid, analysis_state="pending", claimed_at=None)
        return jsonify({"ok": True, "requeued": True})
    upd = {k: v for k, v in meta.items() if k in _RESULT_FIELDS}
    upd["claimed_at"] = None
    core.update_content(cid, **upd)
    analyze.notify_result(cid)
    return jsonify({"ok": True})


# ------------------------------------------------------------- Ashadi
def _ref_images(cid: int) -> list[str]:
    """The card's own pictures (what Ashadi must recreate) - never Ashadi's own output."""
    d = core.MEDIA / str(cid)
    if not d.exists():
        return []
    ims = [f.name for f in sorted(d.iterdir()) if f.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}
           and not f.name.startswith("ashadi_") and "_frame" not in f.name]
    if any(n.startswith("slide_") for n in ims):                    # a carousel: the slides, not the link preview
        ims = [n for n in ims if n != "og_preview.jpg"]
    return ims


@app.post("/api/content/<int:cid>/ashadi")
def ashadi_send(cid):
    c = core.get_content(cid)
    if not c:
        return jsonify({"error": "not found"}), 404
    if c.get("ashadi_state") in core.ASHADI_BUSY:
        return jsonify({"error": "Ashadi already has this one."}), 409
    if not c.get("ashadi_ok"):
        return jsonify({"error": f"Ashadi can't do this one: {c.get('ashadi_why')}."}), 400
    body = request.get_json(silent=True) or {}
    note = (body.get("note") or "").strip()[:380]
    # how closely Ashadi copies it; carried to the PC worker as a prefix on the note (no schema change)
    mode = {"direct": "Direct copy", "adapt": "Adapt more"}.get(body.get("mode"))
    if mode:
        note = f"{mode} | {note}" if note else mode
    if not _ref_images(cid) and not (c.get("source_url") or "").startswith("http"):
        return jsonify({"error": "This card has no picture or link for Ashadi to copy."}), 400
    core.update_content(cid, ashadi_state="queued", ashadi_msg=note or "Waiting for Ashadi", ashadi_claimed_at=None,
                        ashadi_at=core.now())
    return jsonify({"ok": True})


@app.post("/api/content/<int:cid>/ashadi/final")
def ashadi_final(cid):
    c = core.get_content(cid)
    if not c or not c.get("ashadi_canva"):
        return jsonify({"error": "Nothing in Canva to pull yet."}), 400
    if c.get("ashadi_state") in core.ASHADI_BUSY:
        return jsonify({"error": "Ashadi is busy with this one."}), 409
    core.update_content(cid, ashadi_state="final_requested", ashadi_msg="Waiting to pull the final from Canva",
                        ashadi_claimed_at=None)
    return jsonify({"ok": True})


@app.post("/api/content/<int:cid>/ashadi/cancel")
def ashadi_cancel(cid):
    c = core.get_content(cid)
    if not c:
        return jsonify({"error": "not found"}), 404
    if c.get("ashadi_state") not in ("queued", "final_requested"):
        return jsonify({"error": "Only a request still waiting can be cancelled."}), 409
    back = "done" if c.get("ashadi_canva") else None
    core.update_content(cid, ashadi_state=back, ashadi_msg=None, ashadi_claimed_at=None)
    return jsonify({"ok": True})


@app.post("/api/worker/ashadi_claim")
def worker_ashadi_claim():
    if not _worker_ok():
        return jsonify({"error": "unauthorized"}), 401
    core.set_meta("worker_seen", core.now())
    c = core.claim_ashadi()
    if not c:
        return jsonify({"item": None})
    c["media"] = _ref_images(c["id"])
    c.pop("analysis", None)
    return jsonify({"item": c})


@app.post("/api/worker/ashadi_update/<int:cid>")
def worker_ashadi_update(cid):
    if not _worker_ok():
        return jsonify({"error": "unauthorized"}), 401
    core.set_meta("worker_seen", core.now())
    if not core.get_content(cid):
        return jsonify({"error": "gone"}), 404
    meta = json.loads(request.form.get("meta") or "{}")
    d = core.MEDIA / str(cid)
    d.mkdir(parents=True, exist_ok=True)
    for f in request.files.getlist("files"):
        name = Path(f.filename).name
        if name.startswith("ashadi_") and Path(name).suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
            f.save(d / name)
    upd = {}
    if meta.get("ashadi_state") in ("working", "done", "failed", "queued"):
        upd["ashadi_state"] = meta["ashadi_state"]
    if "ashadi_msg" in meta:
        upd["ashadi_msg"] = str(meta["ashadi_msg"] or "")[:400]
    if "ashadi_canva" in meta:
        upd["ashadi_canva"] = json.dumps(meta["ashadi_canva"], ensure_ascii=False)
    if upd.get("ashadi_state") in ("done", "failed"):
        upd["ashadi_claimed_at"] = None
        upd["ashadi_at"] = core.now()
    core.update_content(cid, **upd)
    return jsonify({"ok": True})


def _rollover_loop() -> None:
    """Runs the carry-over at the Monday rollover even if nobody opens the dashboard,
    and tells the owner what moved."""
    import time
    import traceback
    while True:
        try:
            moved = core.rollover()
            if moved:
                import bot
                lines = "\n".join(f"• #{m['id']} {m['title'] or ''} (from week of {m['from']})" for m in moved)
                owner = core.owner_chat()
                if owner:
                    bot.send(owner, f"New week - {len(moved)} unfinished item(s) carried over:\n{lines}")
        except Exception:
            traceback.print_exc()
        time.sleep(600)


if __name__ == "__main__":
    import bot
    core.init_db()
    analyze.start_worker()
    import threading
    threading.Thread(target=_rollover_loop, daemon=True, name='sithiji-rollover').start()
    if not os.environ.get("SITHIJI_NO_BOT"):
        bot.start_bot()
    print(f"[sithiji] dashboard on http://127.0.0.1:{PORT}")
    app.run(host="127.0.0.1", port=PORT, debug=False, threaded=True)
