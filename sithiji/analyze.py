"""Gather the media for a content item, then have the Claude CLI look at it.

Claude reads images through its Read tool, so frames/photos are saved under
data/media/<id>/ and the CLI runs with that folder as its cwd and ONLY Read
enabled (no bash, no web, no MCP).
"""
from __future__ import annotations
import json
import queue
import re
import subprocess
import threading
import traceback
from pathlib import Path

import requests

import social_fetch

import core
from claude_cli import claude_cli_env, extract_json, find_claude_cli, _no_mcp_args

MODEL = "claude-sonnet-5-5"
IMG_EXT = {".jpg", ".jpeg", ".png", ".webp"}
VID_EXT = {".mp4", ".mov", ".mkv", ".webm", ".m4v"}
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"

PLATFORM_NOTES = {
    "tiktok": "(Platform: TikTok. Short vertical video: judge the hook in the first 2 seconds, pacing, on-screen text, "
              "and any sound or trend it rides. Note what must be reshot vs. what can be generated.)",
    "linkedin": "(Platform: LinkedIn. Professional audience: corporate gifting, employee appreciation, B2B buyers, employer "
                "brand. The post may be text-only, an image, a video or a document carousel. Translate the idea to a Kapruka "
                "corporate angle; keep the tone professional and specific, no hype.)",
    "facebook": "(Platform: Facebook. Broad, family and community audience: occasions, offers, events, share-with-a-friend "
                "mechanics. Feed posts, reels and stories can all be sources.)",
    "youtube": "(Platform: YouTube. Judge the opening hook and structure; Shorts are vertical and under a minute.)",
}

PROMPT = """You are Sithiji, the content analyst for Kapruka (Sri Lanka's online gifting and shopping site: cakes, flowers, gifts, electronics, grocery, delivery islandwide, prices in LKR). You help Chamudhi, a Kapruka social-media content creator, decide what to make and exactly how to make it.

Item #{cid}
Source: {source}
Source link: {url}
Text / caption / the owner's own words:
\"\"\"{text}\"\"\"
{media_block}

Look at every listed image file with your Read tool before answering. Then decide:

GROUP - exactly one of:
  laptop_image  = made at a desk: AI image generation + Canva edits, no real shoot
  laptop_video  = made at a desk: AI video/animation generation + Canva edits, no real shoot
  walk_image    = Chamudhi walks around (a store, a street, a product, an event) and takes REAL photos, then edits
  walk_video    = Chamudhi walks around and shoots REAL footage, then edits
A carousel of photos counts as an image group. If ANY slide or the main piece is a video (including a carousel of videos or mixed photo+video), it is a VIDEO group. Pick the group that is the honest way to reproduce this piece well, not the easiest one.

DIFFICULTY 1-5 (1 = under an hour, no skill; 3 = half a day, some editing skill; 5 = full day, multiple locations/tools, advanced editing). Judge by time, equipment, skill, and number of steps.

ORIGIN: "original" if this is the owner's own idea or own footage; "inspired" if it is someone else's post being used as inspiration.

STEPS: concrete and in order, but SHORT. Max 7 steps, each detail one or two short lines (max 25 words): name the tool/screen and the exact action. Give a ready-to-use AI prompt or exact shot angle only where it matters. Never vague ("make it nice"). Never invent facts, prices or offers for Kapruka.
PERSONA_WALKTHROUGH: first person, how a skilled social-media creator would do it after studying this content. 4-6 bullet points, each max 15 words (what I notice, what I copy, what I change for Kapruka, what I avoid).
STYLE: point form everywhere. No paragraphs. Short fragments, plain words.
Brand voice for any caption: practical and specific. Never use the words premium, luxury, exclusive, high-end, best, leading, biggest, amazing, incredible, premier. No price or range commentary about Kapruka.

If you could not actually see enough to judge (no media and almost no text), say so in "confidence" instead of guessing.

Reply with ONLY a JSON object, no prose, with exactly these keys:
{{"title": "<short title, max 8 words>",
 "content_format": "image|video|carousel|text_idea",
 "origin": "original|inspired",
 "source_platform": "<instagram|tiktok|facebook|youtube|own|other>",
 "what_it_is": ["<bullet, max 12 words>", "<max 3 bullets>"],
 "why_it_works": ["<bullet, max 12 words>", "<max 2 bullets>"],
 "group": "laptop_image|laptop_video|walk_image|walk_video",
 "group_reason": "<max 12 words>",
 "difficulty": <1-5 integer>,
 "difficulty_factors": {{"time": "<max 6 words>", "equipment": "<max 6 words>", "skill": "<max 6 words>", "steps": "<max 6 words>"}},
 "time_estimate": "<e.g. 2-3 hours>",
 "tools_needed": ["<..>"],
 "kapruka_angle": ["<bullet, max 15 words>", "<max 3 bullets>"],
 "steps": [{{"n": 1, "title": "<max 5 words>", "detail": "<max 25 words>"}}],
 "shot_list": ["<only for walk_* groups: shot, max 10 words>"],
 "persona_walkthrough": ["<first-person bullet, max 15 words>", "<4-6 bullets>"],
 "caption_suggestion": "<1-2 short lines + 3-5 hashtags>",
 "confidence": "high|medium|low"}}"""


# ------------------------------------------------------------- gathering
def _media_dir(cid: int) -> Path:
    d = core.MEDIA / str(cid)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _ffprobe_duration(p: Path) -> float:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
            capture_output=True, text=True, timeout=30).stdout.strip()
        return float(out)
    except Exception:
        return 0.0


def extract_frames(video: Path, out_dir: Path, prefix: str) -> list[Path]:
    dur = _ffprobe_duration(video)
    n = 8 if dur >= 30 else max(3, min(8, int(dur // 4) or 3))
    frames = []
    for i in range(n):
        t = dur * (i + 0.5) / n if dur else i * 2
        out = out_dir / f"{prefix}_frame{i + 1}.jpg"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", str(video),
                        "-frames:v", "1", "-vf", "scale=720:-2", str(out)],
                       capture_output=True, timeout=60)
        if out.exists() and out.stat().st_size > 0:
            frames.append(out)
    return frames


def _download_link(url: str, d: Path) -> str:
    """Best effort. Returns caption text found (may be ''). Never raises."""
    caption = ""
    if "instagram.com" in url:
        # Public embed JSON lists every carousel slide + the caption; yt-dlp can't do image posts.
        try:
            import ig_embed
            post = ig_embed.fetch_post(url)
            if post and post["slides"]:
                for i, sl in enumerate(post["slides"][:10], 1):
                    if sl["video"]:
                        r = requests.get(sl["video"], headers={"User-Agent": "Mozilla/5.0"}, timeout=60)
                        if r.ok and len(r.content) < 40 * 1024 * 1024:
                            (d / f"slide_{i:02d}.mp4").write_bytes(r.content)
                            continue
                    r = requests.get(sl["image"], headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
                    if r.ok and len(r.content) > 3000:
                        (d / f"slide_{i:02d}.jpg").write_bytes(r.content)
                if any(d.glob("slide_*")):
                    return (post["caption"] or "").strip()
        except Exception:
            pass
    plat = social_fetch.platform_of(url)
    if plat == "tiktok":
        caption = social_fetch.tiktok(url, d) or caption       # oEmbed caption + thumbnail, then the video below
    elif plat == "linkedin":
        caption = social_fetch.linkedin(url, d)
        if caption or any(d.glob("linkedin_*")):
            return caption
    try:
        import yt_dlp
        opts = {"outtmpl": str(d / "dl_%(autonumber)s.%(ext)s"), "format": "best[height<=720]/best",
                "quiet": True, "no_warnings": True, "socket_timeout": 20, "playlist_items": "1-8",
                "max_filesize": 80 * 1024 * 1024, "retries": 2}
        from _env import env
        ck = env().get("SITHIJI_IG_COOKIES")
        if ck and Path(ck).exists():
            opts["cookiefile"] = ck
        with yt_dlp.YoutubeDL(opts) as y:
            info = y.extract_info(url, download=True)
        if info:
            first = (info.get("entries") or [info])[0] or {}
            caption = (info.get("description") or first.get("description") or "").strip()
    except Exception:
        pass
    if not any(f.suffix.lower() in IMG_EXT | VID_EXT for f in d.iterdir()):
        # yt-dlp can't do Instagram image posts, and a browser-like UA gets a
        # login wall. A bare UA gets the public preview/embed page instead.
        import html as _h
        plain = {"User-Agent": "Mozilla/5.0"}
        clean = url.split("?")[0].rstrip("/")
        try:
            page = ""
            if "instagram.com" in clean:
                page = requests.get(clean + "/embed/captioned/", headers=plain, timeout=20).text
                m = re.search(r'class="EmbeddedMediaImage"[^>]*src="([^"]+)"', page)
                cap = re.search(r'class="Caption">.*?<br\s*/>\s*<br\s*/>(.*?)<div class="CaptionComments"', page, re.S)
                if cap and not caption:
                    caption = _h.unescape(re.sub(r"<[^>]+>", " ", cap.group(1))).strip()
                if m:
                    r = requests.get(_h.unescape(m.group(1)), headers=plain, timeout=20)
                    if r.ok and len(r.content) > 5000:
                        (d / "og_preview.jpg").write_bytes(r.content)
            if not (d / "og_preview.jpg").exists():
                page = requests.get(url, headers=plain, timeout=20).text
                img = re.search(r'property="og:image"\s+content="([^"]+)"', page)
                desc = re.search(r'property="og:description"\s+content="([^"]*)"', page)
                if desc and not caption:
                    caption = _h.unescape(desc.group(1))
                if img:
                    r = requests.get(_h.unescape(img.group(1)), headers=plain, timeout=20)
                    if r.ok and len(r.content) > 5000:
                        (d / "og_preview.jpg").write_bytes(r.content)
        except Exception:
            pass
    return caption


def gather(c: dict) -> tuple[list[Path], str]:
    d = _media_dir(c["id"])
    caption = ""
    if c["source_url"]:
        for stale in d.glob("og_preview*"):   # single-image preview from an older run; re-fetch the full post
            stale.unlink()
    if c["source_url"] and not any(f.suffix.lower() in IMG_EXT | VID_EXT for f in d.iterdir()):
        caption = _download_link(c["source_url"], d)
    imgs: list[Path] = []
    for f in sorted(d.iterdir()):
        if f.suffix.lower() in IMG_EXT and "_frame" not in f.name:
            imgs.append(f)
        elif f.suffix.lower() in VID_EXT:
            frames = sorted(d.glob(f"{f.stem}_frame*.jpg")) or extract_frames(f, d, f.stem)
            imgs.extend(frames)
    return imgs[:12], caption


# --------------------------------------------------------------- the call
def _run_claude(prompt: str, cwd: Path, timeout: int = 420) -> str:
    exe = find_claude_cli()
    proc = subprocess.run(
        [exe, "-p", "--model", MODEL, "--tools", "Read", "--allowedTools", "Read", *_no_mcp_args()],
        input=prompt, capture_output=True, text=True, timeout=timeout, encoding="utf-8",
        errors="replace", shell=False, env=claude_cli_env(), cwd=str(cwd))
    if proc.returncode != 0:
        raise RuntimeError(f"Claude CLI exited {proc.returncode}: {(proc.stderr or proc.stdout or '').strip()[:400]}")
    return (proc.stdout or "").strip()


def classify_intent(prompt: str) -> str:
    """Tool-free single call used by the Telegram bot for free-typed messages."""
    from claude_cli import run_claude_cli
    return run_claude_cli(prompt, model=MODEL, timeout=90)


def _txt(v) -> str:
    return " · ".join(str(x) for x in v) if isinstance(v, list) else (v or "")


def run_analysis(c: dict) -> dict:
    """Pure analysis: gathers media into data/media/<id>/ on THIS machine, runs
    Claude, returns the DB fields to store. No DB access, so it can run on the
    PC worker and be pushed to the VPS. Raises on failure."""
    cid = c["id"]
    d = core.MEDIA / str(cid)
    d.mkdir(parents=True, exist_ok=True)
    imgs, caption = gather(c)
    text = (c["raw_text"] or "").strip()
    if caption and caption not in text:
        text = (text + "\n" + caption).strip()
    if not imgs and len(text) < 30:
        return {"analysis_state": "needs_media", "raw_text": text or c["raw_text"]}
    source = {"instagram": "Instagram link", "tiktok": "TikTok link", "facebook": "Facebook link",
              "linkedin": "LinkedIn post link", "youtube": "YouTube link", "other_link": "web link",
              "own_upload": "owner's own upload", "text_idea": "owner's own written idea"}.get(c["source_type"], "unknown")
    plat_note = PLATFORM_NOTES.get(c["source_type"], "")
    if imgs:
        media_block = "Image files to Read (relative to the current folder):\n" + "\n".join(
            f"- {p.relative_to(d).as_posix()}" for p in imgs)
        if any(f.suffix.lower() in VID_EXT for f in d.iterdir()):
            media_block += "\n(Files named *_frameN are evenly spaced samples from a video, in order.)"
        n_slides = len(list(d.glob("slide_*"))) + len(list(d.glob("linkedin_*")))
        if n_slides > 1:
            media_block += (f"\n(This is a carousel post with {n_slides} slides; slide_01 / linkedin_01 is the first. "
                            "Set content_format to carousel. Read ALL slides and describe the whole sequence, "
                            "including what each slide contributes, not just the first.)")
        n_vid = len(list(d.glob("slide_*.mp4")))
        if n_vid:
            media_block += (f"\n({n_vid} of the slides are VIDEOS, shown as sampled frames. "
                            "This makes it a video group (laptop_video or walk_video), not an image group.)")
    else:
        media_block = "No images could be retrieved - judge from the text only and set confidence to low."
    if plat_note:
        media_block += "\n" + plat_note
    prompt = PROMPT.format(cid=cid, source=source, url=c["source_url"] or "(none)",
                           text=text[:4000] or "(none)", media_block=media_block)
    raw = _run_claude(prompt, d)
    a = extract_json(raw)
    grp = a.get("group")
    if grp not in core.GROUPS:
        raise RuntimeError(f"Claude returned an invalid group: {grp!r}")
    if list(d.glob("slide_*.mp4")) and grp.endswith("_image"):   # any video slide => video group, whatever the model said
        grp = grp.replace("_image", "_video")
        a["group"] = grp
        a["group_reason"] = (a.get("group_reason") or "") + " (post contains video slides)"
    diff = max(1, min(5, int(a.get("difficulty") or 3)))
    why = " · ".join(f"{k}: {v}" for k, v in (a.get("difficulty_factors") or {}).items())
    origin = a.get("origin") if a.get("origin") in ("original", "inspired") else         ("original" if c["source_type"] in ("text_idea", "own_upload") else "inspired")
    return dict(
        analysis_state="done", error=None, title=(a.get("title") or "Untitled")[:120],
        content_format=a.get("content_format"), origin=origin, grp=grp,
        group_reason=a.get("group_reason"), difficulty=diff, difficulty_why=why,
        time_estimate=a.get("time_estimate"), summary=_txt(a.get("what_it_is")),
        analysis_json=json.dumps(a, ensure_ascii=False),
        thumb=imgs[0].relative_to(d).as_posix() if imgs else None, raw_text=text)


def analyze(cid: int) -> dict:
    c = core.get_content(cid)
    if not c:
        raise RuntimeError("content not found")
    fields = run_analysis(c)
    core.update_content(cid, **fields)
    return fields


# ---------------------------------------------------------------- worker
# MODE "local": this process analyses (dev on a laptop).
# MODE "queue": this process (the VPS) only stores pending items; the PC
# worker (worker_pc.py) claims them over HTTPS, analyses, and pushes results.
def mode() -> str:
    import os
    from _env import env
    return (os.environ.get("SITHIJI_ANALYZE_MODE") or env().get("SITHIJI_ANALYZE_MODE") or "local").lower()


_q: "queue.Queue[int]" = queue.Queue()
_notify = None   # set by the bot: callable(chat_id, text)


def set_notifier(fn) -> None:
    global _notify
    _notify = fn


def enqueue(cid: int) -> None:
    core.update_content(cid, analysis_state="pending", claimed_at=None)
    if mode() == "local":
        _q.put(cid)


def queue_note() -> str:
    if mode() == "queue" and not core.worker_online():
        return "\nThe PC is offline, so it's queued - I'll analyse it as soon as the PC is back on."
    return ""


def result_message(c: dict) -> str:
    cid = c["id"]
    st = c["analysis_state"]
    if st == "needs_media":
        return (f"#{cid}: I couldn't open that link (Instagram often blocks it) and there's no text to go on.\n"
                f"Send me a screenshot or screen recording with the caption \"#{cid}\" and I'll analyse it.")
    if st == "failed":
        return f"#{cid}: analysis failed - {(c.get('error') or '')[:200]}\nSend /retry {cid} to try again."
    return format_summary(c)


def notify_result(cid: int) -> None:
    c = core.get_content(cid)
    if c and c.get("chat_id") and _notify:
        try:
            _notify(c["chat_id"], result_message(c))
        except Exception:
            traceback.print_exc()


def _loop() -> None:
    while True:
        cid = _q.get()
        try:
            core.update_content(cid, analysis_state="analyzing")
            analyze(cid)
        except Exception as e:
            traceback.print_exc()
            core.update_content(cid, analysis_state="failed", error=str(e)[:500])
        notify_result(cid)


def format_summary(c: dict) -> str:
    return (f"✅ #{c['id']} {c['title']}\n"
            f"{core.GROUPS[c['grp']]} · {c['content_format'] or 'image'} · {c['origin']} · difficulty {c['difficulty']}/5 · {c['time_estimate'] or '?'}\n"
            f"{c['summary'] or ''}\n"
            f"Why this group: {c['group_reason'] or ''}\n"
            f"Send /show {c['id']} for the step-by-step.")


def start_worker() -> None:
    if mode() != "local":
        print("[sithiji] queue mode: analysis is done by the PC worker")
        return
    for c in core.list_content():
        if c["analysis_state"] in ("pending", "analyzing"):
            _q.put(c["id"])
    threading.Thread(target=_loop, daemon=True, name="sithiji-analyzer").start()
