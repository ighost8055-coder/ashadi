"""Per-platform readers for public social links (TikTok, LinkedIn, Facebook).

Only public, intended-for-embedding routes are used (oEmbed / embed pages) with
an honest user agent. Nothing here impersonates a crawler or works around a
login wall: if a post is not publicly readable the caller falls back to asking
for a screenshot or screen recording.
"""
from __future__ import annotations
import html as _h
import re
from pathlib import Path

import requests

UA = {"User-Agent": "Mozilla/5.0 (compatible; SithijiContentAssistant/1.0)"}
IMG_MIN_BYTES = 4000


def platform_of(url: str) -> str:
    u = (url or "").lower()
    if "instagram.com" in u or "instagr.am" in u:
        return "instagram"
    if "tiktok.com" in u:
        return "tiktok"
    if "linkedin.com" in u or "lnkd.in" in u:
        return "linkedin"
    if "facebook.com" in u or "fb.watch" in u or "fb.com" in u:
        return "facebook"
    if "youtube.com" in u or "youtu.be" in u:
        return "youtube"
    return "other_link"


def _save_image(url: str, dest: Path) -> bool:
    try:
        r = requests.get(url, headers=UA, timeout=25)
        if r.ok and len(r.content) > IMG_MIN_BYTES:
            dest.write_bytes(r.content)
            return True
    except Exception:
        pass
    return False


# ---------------------------------------------------------------- TikTok
def tiktok(url: str, d: Path) -> str:
    """TikTok's public oEmbed gives the caption, author and a thumbnail without login."""
    try:
        r = requests.get("https://www.tiktok.com/oembed", params={"url": url}, headers=UA, timeout=20)
        if not r.ok:
            return ""
        j = r.json()
        if j.get("thumbnail_url"):
            _save_image(j["thumbnail_url"], d / "tiktok_thumb.jpg")
        title = (j.get("title") or "").strip()
        author = (j.get("author_name") or "").strip()
        return f"{title}\n(TikTok by @{author})" if author else title
    except Exception:
        return ""


# --------------------------------------------------------------- LinkedIn
_URN = re.compile(r"urn:li:(activity|ugcPost|share):(\d+)")
_SLUG = re.compile(r"-(activity|ugcPost|share)-(\d{15,})")


def _linkedin_urn(url: str) -> str | None:
    m = _URN.search(url)
    if m:
        return f"urn:li:{m.group(1)}:{m.group(2)}"
    m = _SLUG.search(url)
    if m:
        return f"urn:li:{m.group(1)}:{m.group(2)}"
    return None


def linkedin(url: str, d: Path) -> str:
    """LinkedIn's own 'embed this post' page: public for posts that allow embedding.
    Returns the post text; saves any post images. Empty if the post isn't publicly embeddable."""
    urn = _linkedin_urn(url)
    if not urn:
        return ""
    try:
        r = requests.get(f"https://www.linkedin.com/embed/feed/update/{urn}", headers=UA, timeout=25)
        if not r.ok:
            return ""
        page = r.text
        if "authwall" in r.url or "login" in r.url.split("?")[0]:
            return ""
        texts = re.findall(r'class="[^"]*attributed-text-segment-list__content[^"]*"[^>]*>(.*?)</p>', page, re.S)
        if not texts:
            texts = re.findall(r'<p[^>]*class="[^"]*(?:feed-shared-text|break-words)[^"]*"[^>]*>(.*?)</p>', page, re.S)
        text = "\n".join(_h.unescape(re.sub(r"<[^>]+>", " ", t)).strip() for t in texts)
        text = re.sub(r"[ \t]+", " ", text).strip()
        # post media (images, document-carousel pages) live in attributes/JSON; unescape first
        flat = _h.unescape(page)
        imgs: dict[str, str] = {}
        for u in re.findall(r"https://media\.licdn\.com/dms/image/[^\"'\s<>\\]+", flat):
            if any(x in u for x in ("profile-displayphoto", "company-logo", "profile-framedphoto", "_100_100", "_48_48")):
                continue
            imgs.setdefault(u.split("?")[0], u)          # one entry per image, keep a signed URL
        # document carousels: .../feedshare-document-cover-images_480/<id>/<page>/<ts>...: order by page
        def _page_no(path: str) -> int:
            m = re.search(r"/(\d+)/\d{10,}", path)
            return int(m.group(1)) if m else 0
        ordered = sorted(imgs.items(), key=lambda kv: _page_no(kv[0]))
        for i, (_, u) in enumerate(ordered[:10], 1):
            _save_image(u, d / f"linkedin_{i:02d}.jpg")
        return text
    except Exception:
        return ""
