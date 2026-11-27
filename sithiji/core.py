"""Sithiji - Content Assistor: data layer + the weekly-pick rules.

One sqlite file. The rules live here (not in the UI or the bot) so the
dashboard and Telegram can never disagree about what is allowed.
"""
from __future__ import annotations
import datetime as dt
import json
import sqlite3
from pathlib import Path

HERE = Path(__file__).resolve().parent
import os
DATA = Path(os.environ.get("SITHIJI_DATA") or HERE / "data")
MEDIA = DATA / "media"
DB = DATA / "sithiji.sqlite"
DATA.mkdir(exist_ok=True)
MEDIA.mkdir(exist_ok=True)

GROUPS = {
    "laptop_image": "On Laptop · Image",
    "laptop_video": "On Laptop · Video",
    "walk_image": "Walk Around · Image",
    "walk_video": "Walk Around · Video",
}
GROUP_HELP = {
    "laptop_image": "AI generation + Canva edits",
    "laptop_video": "AI generation + Canva edits",
    "walk_image": "Walk around, take real photos, then edit",
    "walk_video": "Walk around, shoot real footage, then edit",
}
STATUSES = {"not_started": "Not started", "in_progress": "In progress", "done": "Done"}

WEEK_SLOTS = 10
MAX_PER_GROUP = WEEK_SLOTS // 2      # same 50% share the original 4-slot week used
MAX_LAPTOP_TOTAL = WEEK_SLOTS // 2   # on-laptop image + video combined
MAX_WALK_GAP = 1       # |walk image - walk video| must stay within this


def conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB, timeout=30)
    c.row_factory = sqlite3.Row
    return c


def init_db() -> None:
    with conn() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS content(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created TEXT NOT NULL,
            chat_id INTEGER,
            source_url TEXT,
            source_type TEXT,          -- instagram | other_link | own_upload | text_idea
            raw_text TEXT,
            analysis_state TEXT DEFAULT 'pending',  -- pending|analyzing|done|failed|needs_media
            error TEXT,
            title TEXT,
            content_format TEXT,       -- image | video | carousel | text_idea
            origin TEXT,               -- original | inspired
            grp TEXT,
            group_reason TEXT,
            difficulty INTEGER,
            difficulty_why TEXT,
            time_estimate TEXT,
            summary TEXT,
            analysis_json TEXT,
            thumb TEXT,
            status TEXT DEFAULT 'not_started',
            done_at TEXT
        );
        CREATE TABLE IF NOT EXISTS picks(
            week_start TEXT NOT NULL,
            content_id INTEGER NOT NULL,
            picked_at TEXT NOT NULL,
            PRIMARY KEY(week_start, content_id)
        );
        CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
        CREATE TABLE IF NOT EXISTS chats(
            chat_id INTEGER PRIMARY KEY,
            name TEXT,
            is_owner INTEGER DEFAULT 0
        );
        """)
        cols = {r[1] for r in c.execute("PRAGMA table_info(content)")}
        if "claimed_at" not in cols:
            c.execute("ALTER TABLE content ADD COLUMN claimed_at TEXT")
        for col in ("ashadi_state", "ashadi_msg", "ashadi_canva", "ashadi_claimed_at", "ashadi_at"):
            if col not in cols:
                c.execute(f"ALTER TABLE content ADD COLUMN {col} TEXT")
        pcols = {r[1] for r in c.execute("PRAGMA table_info(picks)")}
        if "override" not in pcols:
            c.execute("ALTER TABLE picks ADD COLUMN override INTEGER DEFAULT 0")
        if "carried_from" not in pcols:
            c.execute("ALTER TABLE picks ADD COLUMN carried_from TEXT")
        _repair_week_keys(c)


def _repair_week_keys(c) -> None:
    """Older builds let the browser send a non-Monday date (timezone bug), so some picks are
    filed under e.g. a Sunday. Re-file them under the Monday of that week."""
    rows = c.execute("SELECT week_start, content_id FROM picks").fetchall()
    for wk, cid in rows:
        good = norm_week(wk)
        if good != wk:
            dup = c.execute("SELECT 1 FROM picks WHERE week_start=? AND content_id=?", (good, cid)).fetchone()
            if dup:
                c.execute("DELETE FROM picks WHERE week_start=? AND content_id=?", (wk, cid))
            else:
                c.execute("UPDATE picks SET week_start=? WHERE week_start=? AND content_id=?", (good, wk, cid))


def set_meta(k: str, v: str) -> None:
    with conn() as c:
        c.execute("INSERT OR REPLACE INTO meta(k, v) VALUES(?,?)", (k, v))


def get_meta(k: str) -> str | None:
    with conn() as c:
        r = c.execute("SELECT v FROM meta WHERE k=?", (k,)).fetchone()
    return r[0] if r else None


def worker_online(within_s: int = 90) -> bool:
    ts = get_meta("worker_seen")
    return bool(ts) and (_now_sl() - dt.datetime.fromisoformat(ts)).total_seconds() < within_s


STALE_CLAIM_MIN = 25   # a claimed item whose PC vanished is handed out again after this


def claim_next() -> dict | None:
    """Atomically hand the oldest waiting item to the PC worker."""
    stale = (_now_sl() - dt.timedelta(minutes=STALE_CLAIM_MIN)).isoformat(timespec="seconds")
    c = conn()
    try:
        c.execute("BEGIN IMMEDIATE")
        r = c.execute(
            "SELECT id FROM content WHERE analysis_state='pending' "
            "OR (analysis_state='analyzing' AND (claimed_at IS NULL OR claimed_at < ?)) ORDER BY id LIMIT 1",
            (stale,)).fetchone()
        if not r:
            c.execute("COMMIT")
            return None
        c.execute("UPDATE content SET analysis_state='analyzing', claimed_at=? WHERE id=?", (now(), r[0]))
        c.execute("COMMIT")
    finally:
        c.close()
    return get_content(r[0])


# ---------------------------------------------------------- Ashadi (graphic designer)
# A card can be pushed to Ashadi, who recreates it as an editable Kapruka design in Canva.
# States: queued -> working -> done | failed.  "final_requested" asks the PC to pull the
# edited design back out of Canva (the downloaded PNG lands on the card as ashadi_final_*).
ASHADI_BUSY = ("queued", "working", "final_requested")


def claim_ashadi() -> dict | None:
    """Hand the oldest waiting Ashadi request (design or final) to the PC worker."""
    stale = (_now_sl() - dt.timedelta(minutes=STALE_CLAIM_MIN)).isoformat(timespec="seconds")
    c = conn()
    try:
        c.execute("BEGIN IMMEDIATE")
        r = c.execute(
            "SELECT id, ashadi_state FROM content WHERE ashadi_state IN ('queued','final_requested') "
            "AND (ashadi_claimed_at IS NULL OR ashadi_claimed_at < ?) ORDER BY id LIMIT 1", (stale,)).fetchone()
        if not r:
            c.execute("COMMIT")
            return None
        c.execute("UPDATE content SET ashadi_claimed_at=? WHERE id=?", (now(), r[0]))
        c.execute("COMMIT")
    finally:
        c.close()
    item = get_content(r[0])
    item["kind"] = "final" if r[1] == "final_requested" else "design"
    return item


SL_TZ = dt.timezone(dt.timedelta(hours=5, minutes=30))   # Asia/Colombo has no DST


def _now_sl() -> dt.datetime:
    """Naive datetime in Sri Lanka time. The VPS runs in a different timezone from the PC,
    and weeks must roll over on Monday in Colombo, not on the server's Monday."""
    return dt.datetime.now(SL_TZ).replace(tzinfo=None)


def today() -> dt.date:
    return _now_sl().date()


def now() -> str:
    return _now_sl().isoformat(timespec="seconds")


def week_start(d: dt.date | None = None) -> str:
    d = d or today()
    return (d - dt.timedelta(days=d.weekday())).isoformat()  # Monday


def norm_week(ws: str | None) -> str:
    """Any date -> the Monday of its week; junk -> the current week."""
    try:
        return week_start(dt.date.fromisoformat((ws or "")[:10]))
    except ValueError:
        return week_start()


# ---------------------------------------------------------------- content
def add_content(**f) -> int:
    f.setdefault("created", now())
    cols = ", ".join(f)
    q = ", ".join("?" for _ in f)
    with conn() as c:
        return c.execute(f"INSERT INTO content({cols}) VALUES({q})", list(f.values())).lastrowid


def update_content(cid: int, **f) -> None:
    if not f:
        return
    sets = ", ".join(f"{k}=?" for k in f)
    with conn() as c:
        c.execute(f"UPDATE content SET {sets} WHERE id=?", [*f.values(), cid])


def get_content(cid: int) -> dict | None:
    with conn() as c:
        r = c.execute("SELECT * FROM content WHERE id=?", (cid,)).fetchone()
    return _row(r) if r else None


def find_by_url(url: str) -> dict | None:
    with conn() as c:
        r = c.execute("SELECT * FROM content WHERE source_url=? ORDER BY id DESC", (url,)).fetchone()
    return _row(r) if r else None


def list_content() -> list[dict]:
    with conn() as c:
        rows = c.execute("SELECT * FROM content ORDER BY id DESC").fetchall()
    return [_row(r, light=True) for r in rows]


def delete_content(cid: int) -> None:
    import shutil
    with conn() as c:
        c.execute("DELETE FROM picks WHERE content_id=?", (cid,))
        c.execute("DELETE FROM content WHERE id=?", (cid,))
    shutil.rmtree(MEDIA / str(cid), ignore_errors=True)


def ashadi_fit(d: dict) -> tuple[bool, str]:
    """Can Ashadi recreate this? Ashadi is a graphic designer: she rebuilds a STILL creative (picture + type +
    logo) in Canva, painting a fresh Kapruka picture with the image models - so it does not matter whether the
    original was shot or made on a laptop. Any assessed still image or carousel with a picture qualifies
    (human decision, 2026-11-17: the 'send flowers not DMs' poster and a stories-style photo must be pushable).
    Videos, bare text ideas, unassessed cards and cards with no picture do not."""
    if d.get("analysis_state") != "done":
        return False, "Not assessed yet"
    if d.get("content_format") not in ("image", "carousel"):
        return False, "Not a still design (video or text idea)"
    if d.get("grp") in ("walk_video", "laptop_video"):
        return False, "Video — Ashadi can't create videos"
    if d.get("grp") == "walk_image":
        return False, "Walk Around — shot with real people/places, done by hand in Canva"
    if not d.get("thumb"):
        return False, "No picture to copy"
    return True, ""


def _row(r: sqlite3.Row, light: bool = False) -> dict:
    d = dict(r)
    d["ashadi_ok"], d["ashadi_why"] = ashadi_fit(d)
    aj = d.pop("analysis_json", None)
    if aj:
        try:
            a = json.loads(aj)
        except Exception:
            a = {}
        if light:
            a = {k: a.get(k) for k in ("steps",)}   # list view only needs a step count
        d["analysis"] = a
    else:
        d["analysis"] = {}
    return d


# ------------------------------------------------------------------ rules
def _finals() -> list[dict]:
    out = []
    for li in range(MAX_PER_GROUP + 1):
        for lv in range(MAX_PER_GROUP + 1):
            if li + lv > MAX_LAPTOP_TOTAL:
                continue
            for wi in range(MAX_PER_GROUP + 1):
                for wv in range(MAX_PER_GROUP + 1):
                    if abs(wi - wv) > MAX_WALK_GAP:
                        continue
                    if li + lv + wi + wv == WEEK_SLOTS:
                        out.append({"laptop_image": li, "laptop_video": lv,
                                    "walk_image": wi, "walk_video": wv})
    return out


_FINALS = _finals()


def _counts(groups: list[str]) -> dict:
    c = {g: 0 for g in GROUPS}
    for g in groups:
        if g in c:
            c[g] += 1
    return c


def _reachable(counts: dict) -> bool:
    return any(all(f[g] >= counts[g] for g in GROUPS) for f in _FINALS)


def week_summary(ws: str) -> dict:
    with conn() as c:
        rows = c.execute(
            "SELECT c.*, p.override AS pick_override, p.carried_from AS carried_from FROM picks p JOIN content c ON c.id=p.content_id "
            "WHERE p.week_start=? ORDER BY p.picked_at", (ws,)).fetchall()
    items = [_row(r, light=True) for r in rows]
    counts = _counts([i["grp"] for i in items])
    laptop = counts["laptop_image"] + counts["laptop_video"]
    walk = counts["walk_image"] + counts["walk_video"]
    allowed = []
    if len(items) < WEEK_SLOTS:
        for g in GROUPS:
            t = dict(counts)
            t[g] += 1
            if _reachable(t):
                allowed.append(g)
    notes = []
    if len(items) < WEEK_SLOTS:
        need_walk = max(0, (WEEK_SLOTS - MAX_LAPTOP_TOTAL) - walk)
        if need_walk and WEEK_SLOTS - len(items) <= need_walk:
            notes.append(f"Remaining slots must all be Walk Around (need {need_walk} more).")
        if counts["walk_image"] and not counts["walk_video"]:
            notes.append("Add a Walk Around video to balance the Walk Around image.")
        if counts["walk_video"] and not counts["walk_image"]:
            notes.append("Add a Walk Around image to balance the Walk Around video.")
    return {
        "week_start": ws,
        "week_end": (dt.date.fromisoformat(ws) + dt.timedelta(days=6)).isoformat(),
        "slots": WEEK_SLOTS, "max_per_group": MAX_PER_GROUP, "max_laptop": MAX_LAPTOP_TOTAL, "items": items, "counts": counts,
        "laptop_total": laptop, "walk_total": walk,
        "allowed_groups": allowed, "complete": len(items) == WEEK_SLOTS,
        "notes": notes,
        "done": sum(1 for i in items if i["status"] == "done"),
    }


def check_pick(ws: str, cid: int) -> tuple[bool, str]:
    c = get_content(cid)
    if not c:
        return False, f"No content #{cid}."
    if c["analysis_state"] != "done" or not c["grp"]:
        return False, f"#{cid} hasn't been analysed/categorised yet, so it can't be picked."
    s = week_summary(ws)
    if any(i["id"] == cid for i in s["items"]):
        return False, f"#{cid} is already picked for this week."
    if len(s["items"]) >= WEEK_SLOTS:
        return False, f"This week already has {WEEK_SLOTS} picks. Remove one first."
    g = c["grp"]
    counts = dict(s["counts"])
    counts[g] += 1
    if counts[g] > MAX_PER_GROUP:
        return False, f"Rule: max {MAX_PER_GROUP} per group per week. You already have {MAX_PER_GROUP} × {GROUPS[g]}."
    if counts["laptop_image"] + counts["laptop_video"] > MAX_LAPTOP_TOTAL:
        return False, (f"Rule: max {MAX_LAPTOP_TOTAL} On Laptop items per week (image + video together). "
                       "Pick a Walk Around item instead.")
    if _reachable(s["counts"]) and not _reachable(counts):
        return False, ("Rule: Walk Around image and video must stay balanced. "
                       "Pick the other Walk Around type first.")
    return True, "ok"


def override_password_ok(pw: str) -> bool:
    """Special-permission password for picking past a rule. Lives in .env, never in the page."""
    import hmac
    from _env import env
    want = env().get("SITHIJI_OVERRIDE_PASSWORD") or os.environ.get("SITHIJI_OVERRIDE_PASSWORD") or ""
    return bool(want) and hmac.compare_digest((pw or "").strip().encode(), want.encode())


def add_pick(ws: str, cid: int, override: bool = False) -> tuple[bool, str]:
    """override=True (caller has verified the password) lets a pick past a RULE only;
    hard errors (not analysed, already picked, week full) are never overridable."""
    ok, msg = check_pick(ws, cid)
    used = 0
    if not ok:
        if not (override and msg.startswith("Rule:")):
            return ok, msg
        used = 1
    with conn() as c:
        c.execute("INSERT INTO picks(week_start, content_id, picked_at, override) VALUES(?,?,?,?)",
                  (ws, cid, now(), used))
    return True, "picked (rule overridden)" if used else "picked"


def remove_pick(ws: str, cid: int) -> None:
    with conn() as c:
        c.execute("DELETE FROM picks WHERE week_start=? AND content_id=?", (ws, cid))


def pick_map() -> dict:
    """content_id -> most recent week_start it was picked for."""
    with conn() as c:
        rows = c.execute("SELECT content_id, MAX(week_start) FROM picks GROUP BY content_id").fetchall()
    return {r[0]: r[1] for r in rows}


def rollover() -> list[dict]:
    """Unfinished picks from earlier weeks move into the CURRENT week automatically.
    An item is 'unfinished' while its status is not done; it follows the week it was last picked for.
    The old week keeps its record (history); the current week gets a carried-over copy that is
    exempt from the weekly rules (it was already accepted once) but still counts toward the 10 slots.
    Idempotent: safe to call on every request and from a timer."""
    cur = week_start()
    moved = []
    with conn() as c:
        rows = c.execute(
            "SELECT p.content_id, MAX(p.week_start) AS last_week FROM picks p GROUP BY p.content_id").fetchall()
        for cid, last in rows:
            if last >= cur:
                continue
            st = c.execute("SELECT status, title FROM content WHERE id=?", (cid,)).fetchone()
            if not st or st[0] == "done":
                continue
            c.execute("INSERT OR IGNORE INTO picks(week_start, content_id, picked_at, override, carried_from) "
                      "VALUES(?,?,?,0,?)", (cur, cid, now(), last))
            moved.append({"id": cid, "title": st[1], "from": last})
    return moved


def suggest(ws: str) -> list[dict]:
    """Rule-valid fill for the open slots, easiest first. A helper only -
    Chamudhi still decides."""
    s = week_summary(ws)
    picked = {i["id"] for i in s["items"]}
    pool = [c for c in list_content()
            if c["analysis_state"] == "done" and c["grp"] and c["status"] != "done" and c["id"] not in picked]
    pool.sort(key=lambda c: (c["difficulty"] or 3, c["id"]))
    by_g = {g: [c for c in pool if c["grp"] == g] for g in GROUPS}
    order = sorted(_FINALS, key=lambda f: (-(f["walk_image"] + f["walk_video"]), f["laptop_image"] + f["laptop_video"]))
    for f in order:
        if any(f[g] < s["counts"][g] for g in GROUPS):
            continue
        need = {g: f[g] - s["counts"][g] for g in GROUPS}
        if all(len(by_g[g]) >= n for g, n in need.items()):
            return [c for g, n in need.items() for c in by_g[g][:n]]
    return []


# ---------------------------------------------------------------- chats
def chat_known(chat_id: int) -> bool:
    with conn() as c:
        return c.execute("SELECT 1 FROM chats WHERE chat_id=?", (chat_id,)).fetchone() is not None


def owner_chat() -> int | None:
    with conn() as c:
        r = c.execute("SELECT chat_id FROM chats WHERE is_owner=1").fetchone()
    return r[0] if r else None


def add_chat(chat_id: int, name: str, owner: bool = False) -> None:
    with conn() as c:
        c.execute("INSERT OR REPLACE INTO chats(chat_id, name, is_owner) VALUES(?,?,?)",
                  (chat_id, name, 1 if owner else 0))


def all_chats() -> list[int]:
    with conn() as c:
        return [r[0] for r in c.execute("SELECT chat_id FROM chats").fetchall()]
