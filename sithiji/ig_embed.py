"""Read an Instagram post's public embed page.

The embed HTML carries the whole post as an escaped JSON blob ("contextJSON"):
every carousel slide, the caption, and video URLs. No login needed for public
posts. Returns None if the page has no such blob (private/removed post, or
Instagram changed the markup), so callers fall back to the single preview.
"""
from __future__ import annotations
import json
import re

import requests

UA = {"User-Agent": "Mozilla/5.0"}
_CTX = re.compile(r'"contextJSON":"((?:[^"\\]|\\.)*)"')


def fetch_post(url: str) -> dict | None:
    clean = url.split("?")[0].rstrip("/")
    html = requests.get(clean + "/embed/captioned/", headers=UA, timeout=25).text
    m = _CTX.search(html)
    if not m:
        return None
    ctx = json.loads(json.loads('"' + m.group(1) + '"'))
    sm = (ctx.get("gql_data") or {}).get("shortcode_media")
    if not sm:
        return None
    nodes = [e["node"] for e in (sm.get("edge_sidecar_to_children") or {}).get("edges", [])] or [sm]
    slides = [{"image": n.get("display_url"), "video": n.get("video_url") if n.get("is_video") else None}
              for n in nodes if n.get("display_url")]
    cap = (sm.get("edge_media_to_caption") or {}).get("edges") or []
    return {
        "type": sm.get("__typename"),
        "caption": cap[0]["node"]["text"] if cap else "",
        "slides": slides,
    }
