"""One-off / repair: push thumbnail files the VPS is missing (older video items
whose frame thumbnail never left this PC). Safe to re-run; only uploads files
the server answers 404 for. Run from the project root:  python sithiji/backfill_thumbs.py
"""
from __future__ import annotations
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "scripts"))

import requests

import core
from _env import env


def main() -> None:
    e = env()
    base = (e.get("SITHIJI_REMOTE_URL") or "").rstrip("/")
    key = e.get("SITHIJI_WORKER_KEY")
    if not base or not key:
        sys.exit("SITHIJI_REMOTE_URL / SITHIJI_WORKER_KEY missing in .env")
    hdr = {"X-Worker-Key": key}
    items = requests.get(f"{base}/api/state", timeout=30).json()["content"]
    fixed = missing_local = ok = 0
    for c in items:
        t = c.get("thumb")
        if not t:
            continue
        head = requests.get(f"{base}/media/{c['id']}/{t}", timeout=30, stream=True)
        if head.status_code == 200:
            ok += 1
            continue
        local = core.MEDIA / str(c["id"]) / t
        if not local.exists():
            print(f"#{c['id']}: thumb {t} is not on the server or on this PC - re-run its analysis")
            missing_local += 1
            continue
        with open(local, "rb") as fh:
            r = requests.post(f"{base}/api/worker/media_push/{c['id']}", headers=hdr,
                              files=[("files", (local.name, fh))], timeout=120)
        print(f"#{c['id']}: pushed {t} -> HTTP {r.status_code}")
        fixed += r.ok
    print(f"already fine: {ok} · pushed: {fixed} · not recoverable here: {missing_local}")


if __name__ == "__main__":
    main()
