"""Telegram front door for Sithiji (long polling, no webhook needed - works
from the laptop). Anything you send is saved to the content bank; free-typed
messages are interpreted by Claude into one of a few actions."""
from __future__ import annotations
import html
import json
import re
import threading
import time
import traceback

import requests

import analyze
import core
import social_fetch
from _env import env

URL_RE = re.compile(r"https?://[^\s<>]+")
API = "https://api.telegram.org"

HELP = (
    "Sithiji - Content Assistor\n\n"
    "Send me:\n"
    "• an Instagram (or any) link\n"
    "• a photo / video / screenshot (caption it with your idea, or \"#12\" to attach it to item 12)\n"
    "• or just type an idea\n\n"
    "I save it, read it, score the difficulty, put it in one of 4 groups and write the step-by-step.\n\n"
    "Commands (or just say them in words):\n"
    "/list - latest items in the bank\n"
    "/week - this week's picks + rule status\n"
    "/suggest - a rule-valid set of 4 to choose from\n"
    "/pick 12 - add #12 to this week\n"
    "/unpick 12 - remove it\n"
    "/show 12 - full step-by-step\n"
    "/start12, /progress 12, /done 12 - set status\n"
    "/group 12 walk_video - change the group\n"
    "/retry 12 - re-run analysis\n"
    "/delete 12"
)

INTENT_PROMPT = """You route Telegram messages for a content-bank bot. The user manages a bank of numbered content items (#id). Decide what the message wants.

Intents and args:
- add_idea {{"text": "..."}}  : the message is a new content idea to save (default when it is not clearly a command)
- list {{}}  : show the bank
- week {{}}  : show this week's picks
- suggest {{}}  : suggest what to pick this week
- pick {{"id": n}} / unpick {{"id": n}}
- show {{"id": n}} : show steps for an item
- status {{"id": n, "status": "not_started|in_progress|done"}}
- regroup {{"id": n, "group": "laptop_image|laptop_video|walk_image|walk_video"}}
- delete {{"id": n}}
- retry {{"id": n}}
- help {{}}

Message: \"\"\"{text}\"\"\"

Reply with ONLY JSON: {{"intent": "...", "args": {{...}}}}"""


def _tok() -> str:
    t = env().get("SITHIJI_BOT_TOKEN")
    if not t:
        raise SystemExit("SITHIJI_BOT_TOKEN missing in .env")
    return t


def tg(method: str, _timeout: int = 40, **params):
    r = requests.post(f"{API}/bot{_tok()}/{method}", data=params, timeout=_timeout)
    return r.json()


def tg_send(chat_id: int, text: str) -> None:
    for i in range(0, len(text), 3900):
        tg("sendMessage", chat_id=chat_id, text=text[i:i + 3900], disable_web_page_preview="true")


def send(chat_id, text: str) -> None:
    """Channel router: WhatsApp chats are stored as 'wa:<number>', everything else is Telegram."""
    if isinstance(chat_id, str) and chat_id.startswith("wa:"):
        import whatsapp
        whatsapp.send_text(chat_id[3:], text)
    else:
        tg_send(chat_id, text)


def _download(file_id: str, dest_dir, name_hint: str = "") -> str | None:
    info = tg("getFile", file_id=file_id)
    if not info.get("ok"):
        return None   # bots can only fetch files up to 20 MB
    path = info["result"]["file_path"]
    r = requests.get(f"{API}/file/bot{_tok()}/{path}", timeout=120)
    if not r.ok:
        return None
    ext = path.rsplit(".", 1)[-1] if "." in path else "bin"
    fn = f"tg_{int(time.time() * 1000)}.{ext}"
    (dest_dir / fn).write_bytes(r.content)
    return fn


# ----------------------------------------------------------------- views
def _line(c: dict) -> str:
    g = core.GROUPS.get(c["grp"], "…")
    st = core.STATUSES.get(c["status"], c["status"])
    t = c["title"] or (c["source_url"] or c["raw_text"] or "")[:40] or "(untitled)"
    if c["analysis_state"] != "done":
        g = f"[{c['analysis_state']}]"
    return f"#{c['id']} {t[:44]} · {g} · d{c['difficulty'] or '?'} · {st}"


def _bl(v) -> list[str]:
    v = v if isinstance(v, list) else ([v] if v else [])
    return [f"• {x}" for x in v]


def show_item(c: dict) -> str:
    if c["analysis_state"] != "done":
        return f"#{c['id']} is {c['analysis_state']}. {c.get('error') or ''}"
    a = c["analysis"]
    out = [f"#{c['id']} {c['title']}",
           f"{core.GROUPS[c['grp']]} ({core.GROUP_HELP[c['grp']]}) · {c['origin']} · difficulty {c['difficulty']}/5 · {c['time_estimate']}",
           f"Status: {core.STATUSES[c['status']]}", "",
           "WHAT IT IS"] + _bl(a.get("what_it_is")) + ["", "KAPRUKA ANGLE"] + _bl(a.get("kapruka_angle")) + [
           "", f"Tools: {', '.join(a.get('tools_needed') or [])}", "", "STEPS"]
    for s in a.get("steps") or []:
        out.append(f"{s.get('n')}. {s.get('title')}\n   {s.get('detail')}")
    if a.get("shot_list"):
        out += ["", "SHOT LIST"] + [f"• {x}" for x in a["shot_list"]]
    out += ["", "HOW A CREATOR WOULD DO IT"] + _bl(a.get("persona_walkthrough")) + [
            "", "CAPTION", a.get("caption_suggestion", "")]
    return "\n".join(out)


def week_text() -> str:
    core.rollover()
    s = core.week_summary(core.week_start())
    out = [f"Week of {s['week_start']} · {len(s['items'])}/{s['slots']} picked · {s['done']} done"]
    for i in s["items"]:
        out.append("• " + _line(i))
    out.append("")
    out.append("Groups: " + " · ".join(f"{core.GROUPS[g]} {n}/{core.MAX_PER_GROUP}" for g, n in s["counts"].items()))
    out.append(f"On Laptop total {s['laptop_total']}/{core.MAX_LAPTOP_TOTAL}")
    out += s["notes"]
    if not s["complete"]:
        out.append("Can still add: " + (", ".join(core.GROUPS[g] for g in s["allowed_groups"]) or "-"))
    return "\n".join(out)


# --------------------------------------------------------------- actions
def _need_item(args: dict):
    try:
        cid = int(args.get("id"))
    except Exception:
        return None, "Which item? Give me the number, e.g. /show 12"
    c = core.get_content(cid)
    return (c, None) if c else (None, f"No item #{cid}.")


def execute(intent: str, args: dict, chat_id: int, name: str = "") -> str:
    core.rollover()
    ws = core.week_start()
    if intent == "help":
        return HELP
    if intent == "list":
        items = core.list_content()[:15]
        return "\n".join(_line(c) for c in items) or "The bank is empty. Send me something."
    if intent == "week":
        return week_text()
    if intent == "suggest":
        s = core.suggest(ws)
        if not s:
            return "Not enough analysed, not-done items in the right groups to fill the week yet. Add more content."
        return "Rule-valid set for this week (easiest first):\n" + "\n".join(_line(c) for c in s) + \
            "\nPick with /pick <id>."
    if intent == "add_idea":
        text = (args.get("text") or "").strip()
        cid = core.add_content(chat_id=chat_id, source_type="text_idea", raw_text=text, origin="original")
        analyze.enqueue(cid)
        return f"Saved as #{cid}. Reading it now - I'll message you when it's categorised." + analyze.queue_note()
    c, err = _need_item(args) if intent in ("pick", "unpick", "show", "status", "regroup", "delete", "retry") else (None, None)
    if err:
        return err
    if intent == "pick":
        pw = args.get("password")
        if pw and not core.override_password_ok(pw):
            return "❌ Wrong password."
        ok, msg = core.add_pick(ws, c["id"], override=bool(pw))
        if ok:
            return f"Picked #{c['id']}{' (rule overridden)' if pw else ''}.\n\n" + week_text()
        hint = f"\nTo pick it anyway (special permission): /pick {c['id']} <password>" if msg.startswith("Rule:") else ""
        return f"❌ {msg}{hint}"
    if intent == "unpick":
        core.remove_pick(ws, c["id"])
        return f"Removed #{c['id']} from this week.\n\n" + week_text()
    if intent == "show":
        return show_item(c)
    if intent == "status":
        st = args.get("status")
        if st not in core.STATUSES:
            return "Status must be not_started, in_progress or done."
        core.update_content(c["id"], status=st, done_at=core.now() if st == "done" else None)
        return f"#{c['id']} → {core.STATUSES[st]}"
    if intent == "regroup":
        g = args.get("group")
        if g not in core.GROUPS:
            return "Group must be one of: " + ", ".join(core.GROUPS)
        core.update_content(c["id"], grp=g)
        return f"#{c['id']} moved to {core.GROUPS[g]}. (Steps were written for the old group - /retry {c['id']} to rewrite.)"
    if intent == "delete":
        core.delete_content(c["id"])
        return f"Deleted #{c['id']}."
    if intent == "retry":
        analyze.enqueue(c["id"])
        return f"Re-analysing #{c['id']}…" + analyze.queue_note()
    return HELP


SLASH = {"list": "list", "week": "week", "suggest": "suggest", "help": "help", "start": "help",
         "pick": "pick", "unpick": "unpick", "show": "show", "delete": "delete", "retry": "retry",
         "group": "regroup"}
STATUS_SLASH = {"start12": None}


def handle_text(chat_id: int, text: str, name: str) -> str:
    m = re.match(r"^/(\w+)(?:@\w+)?\s*(.*)$", text.strip(), re.S)
    if m:
        cmd, rest = m.group(1).lower(), m.group(2).strip()
        nums = re.findall(r"\d+", rest)
        cid = int(nums[0]) if nums else None
        if cmd in ("progress", "inprogress", "doing"):
            return execute("status", {"id": cid, "status": "in_progress"}, chat_id)
        if cmd == "done":
            return execute("status", {"id": cid, "status": "done"}, chat_id)
        if cmd in ("notstarted", "reset"):
            return execute("status", {"id": cid, "status": "not_started"}, chat_id)
        if cmd == "group":
            g = next((x for x in core.GROUPS if x in rest), None)
            return execute("regroup", {"id": cid, "group": g}, chat_id)
        if cmd == "allow":
            if core.owner_chat() != chat_id:
                return "Only the owner can do that."
            if not nums:
                return "Usage: /allow <chat_id>"
            core.add_chat(int(nums[0]), "added by owner")
            return f"Chat {nums[0]} can now use Sithiji."
        if cmd == "pick":
            parts = rest.split()
            return execute("pick", {"id": cid, "password": parts[1] if len(parts) > 1 else None}, chat_id)
        if cmd in SLASH:
            return execute(SLASH[cmd], {"id": cid}, chat_id)
        return "Unknown command.\n\n" + HELP
    # free text. A bare idea is the common case - only spend a Claude call
    # when the message could plausibly be a command (short, or mentions an id).
    if len(text) > 160 and not re.search(r"#\d+", text):
        return execute("add_idea", {"text": text}, chat_id)
    try:
        raw = analyze.classify_intent(INTENT_PROMPT.format(text=text[:600]))
        j = json.loads(re.search(r"\{.*\}", raw, re.S).group(0))
        return execute(j.get("intent", "add_idea"), j.get("args") or {"text": text}, chat_id)
    except Exception:
        traceback.print_exc()
        return execute("add_idea", {"text": text}, chat_id)


# ------------------------------------------------------------------ loop
def process_media(chat_id, text: str, save_fn) -> str:
    """Shared by Telegram + WhatsApp. save_fn(dest_dir) -> saved filename, or None if the download failed.
    A caption starting with #12 attaches the file to existing item 12."""
    attach = re.match(r"^\s*#(\d+)\b\s*(.*)$", text, re.S)
    if attach and core.get_content(int(attach.group(1))):
        cid = int(attach.group(1))
        text = attach.group(2).strip()
        new = False
    else:
        m = URL_RE.search(text) if text else None
        cid = core.add_content(chat_id=chat_id, source_url=m.group(0) if m else None,
                               source_type="own_upload", raw_text=text, origin="original")
        new = True
    d = core.MEDIA / str(cid)
    d.mkdir(parents=True, exist_ok=True)
    got = save_fn(d)
    if not got:
        if new:
            core.delete_content(cid)
        return ("I couldn't download that file (size limits apply: Telegram bots 20 MB). "
                "Send a shorter clip, a few screenshots, or the link instead.")
    if not new and text:
        c = core.get_content(cid)
        core.update_content(cid, raw_text=((c["raw_text"] or "") + "\n" + text).strip())
    analyze.enqueue(cid)
    return f"{'Saved as' if new else 'Added to'} #{cid}. Reading it now…" + analyze.queue_note()


def process_text(chat_id, text: str, name: str) -> str | None:
    """Shared by Telegram + WhatsApp: links get saved, everything else is a command or an idea."""
    text = (text or "").strip()
    if not text:
        return None
    urls = URL_RE.findall(text)
    if urls and not text.startswith("/"):
        note = URL_RE.sub("", text).strip()
        ids, dup = [], []
        for u in urls:
            u = u.rstrip(".,)")
            ex = core.find_by_url(u)
            if ex:
                dup.append(f"Already in the bank as #{ex['id']} ({core.STATUSES[ex['status']]}).")
                continue
            stype = social_fetch.platform_of(u)
            cid = core.add_content(chat_id=chat_id, source_url=u, source_type=stype,
                                   raw_text=note, origin="inspired")
            analyze.enqueue(cid)
            ids.append(cid)
        out = list(dup)
        if ids:
            out.append("Saved " + ", ".join(f"#{i}" for i in ids) +
                       ". Reading it now - I'll message you when it's categorised." + analyze.queue_note())
        return "\n".join(out)
    return handle_text(chat_id, text, name)


def _handle_message(msg: dict) -> None:
    chat_id = msg["chat"]["id"]
    name = " ".join(filter(None, [msg["from"].get("first_name"), msg["from"].get("last_name")])) or "user"
    text = (msg.get("text") or msg.get("caption") or "").strip()

    if not core.chat_known(chat_id):
        if core.owner_chat() is None:
            core.add_chat(chat_id, name, owner=True)
            send(chat_id, f"Hi {name}, you're registered as the owner.\n\n{HELP}")
            return
        send(chat_id, f"Not authorised. Your chat id is {chat_id} - ask the owner to send /allow {chat_id}.")
        owner = core.owner_chat()
        if owner:
            send(owner, f"{name} (chat id {chat_id}) tried to use Sithiji. Send /allow {chat_id} to let them in.")
        return

    if any(k in msg for k in ("photo", "video", "document", "video_note", "animation")):
        fid = None
        if "photo" in msg:
            fid = msg["photo"][-1]["file_id"]
        else:
            for k in ("video", "document", "video_note", "animation"):
                if k in msg:
                    fid = msg[k]["file_id"]
                    break
        send(chat_id, process_media(chat_id, text, lambda d: _download(fid, d) if fid else None))
        return

    reply = process_text(chat_id, text, name)
    if reply:
        send(chat_id, reply)


def poll_forever() -> None:
    analyze.set_notifier(send)
    offset = None
    print("[sithiji] Telegram polling started")
    while True:
        try:
            p = {"timeout": 30, "allowed_updates": json.dumps(["message"])}
            if offset:
                p["offset"] = offset
            r = tg("getUpdates", _timeout=45, **p)
            for u in r.get("result", []):
                offset = u["update_id"] + 1
                if "message" in u:
                    try:
                        _handle_message(u["message"])
                    except Exception:
                        traceback.print_exc()
                        try:
                            send(u["message"]["chat"]["id"], "Something went wrong handling that - try again.")
                        except Exception:
                            pass
        except Exception:
            traceback.print_exc()
            time.sleep(5)


def start_bot() -> None:
    threading.Thread(target=poll_forever, daemon=True, name="sithiji-bot").start()
