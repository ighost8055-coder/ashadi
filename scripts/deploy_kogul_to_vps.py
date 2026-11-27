#!/usr/bin/env python3
"""
deploy_kogul_to_vps.py — pushes Kogul (PC Agent) to the VPS at
C:\\apps\\kogul_project, preserving the same relative layout it needs
locally (kogul/ + scripts/ + data_store.sqlite as siblings — see
kogul/brand_discovery.py's PROJECT_ROOT/FETCH_PAGE_SCRIPT/DB_STORE_PATH),
then restarts it listening on port 5011 (not 5010, to avoid colliding with
local dev if both ever run against the same network at once).

Built 2026-10-06, user: "can u push the pc agent tot the vps i ahve given
all creds on the env" -> confirmed port 5011, copy local data, copy
data_store.sqlite too (full feature parity for the Daraz/Kapruka gap-search
stream, not just chat/outreach).

Reuses deploy_to_vps.py's proven paramiko throughput tuning (large window,
no mid-transfer rekey, TCP_NODELAY) — the same fixes that took a 54MB file
from 674s down to seconds on this exact VPS, needed here even more since
data_store.sqlite alone is ~610MB.

Usage:
  python scripts/deploy_kogul_to_vps.py                  # sync code + restart; kogul.sqlite NOT touched
  python scripts/deploy_kogul_to_vps.py --dry-run         # show what would change, upload nothing
  python scripts/deploy_kogul_to_vps.py --no-restart      # sync only, don't touch the remote process
  python scripts/deploy_kogul_to_vps.py --skip-data-store # skip the 610MB file (fast iteration on code-only changes)
  python scripts/deploy_kogul_to_vps.py --push-local-db   # DANGER: overwrites the VPS's live kogul.sqlite
                                                           # with this machine's local copy — see
                                                           # KOGUL_DB_RELATIVE_PATH's comment below for why
                                                           # this is excluded by default.
"""
from __future__ import annotations
import argparse, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REMOTE_ROOT = r"C:\apps\kogul_project"
REMOTE_PORT = 5011

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _env import env, require  # noqa: E402

# What actually needs to go to the VPS, and where, relative to REMOTE_ROOT —
# NOT the whole project (which also holds the unrelated SEO/blog pipeline,
# published posts, hundreds of other scripts, etc.). Each entry is
# (local_path, remote_rel_dir).
SYNC_ITEMS = [
    (ROOT / "kogul", "kogul"),
]
# Top-level files kogul/ needs as a PROJECT_ROOT-relative sibling. scripts/
# is NOT synced wholesale (2026-10-06 fix — a first dry-run pulled in 279
# files, every unrelated script in the whole SEO/blog pipeline, because the
# naive "sync the whole folder" approach doesn't know Kogul only actually
# imports 5 of them): fetch_page.py (brand_discovery's Playwright fetcher),
# _env.py (.env loader), openai_cost_tracker.py (vision-scan cost logging),
# notify_whatsapp.py (the real WhatsApp send path), notify_email.py (the real
# agreed/handover email path, added 2026-10-06) — see brand_discovery.py and
# app_kogul.py's dynamic `sys.path.insert(... / "scripts")` imports.
SYNC_FILES = [
    # 2026-10-22: the laptop .env is NOT synced any more. It replaced the VPS .env and wiped
    # KOGUL_ADMIN_PASSWORD (remote login stopped working) and the PC Follow-up keys. The VPS .env is VPS-owned.
    (ROOT / "scripts" / "fetch_page.py", "scripts/fetch_page.py"),
    (ROOT / "scripts" / "_env.py", "scripts/_env.py"),
    (ROOT / "scripts" / "openai_cost_tracker.py", "scripts/openai_cost_tracker.py"),
    (ROOT / "scripts" / "notify_whatsapp.py", "scripts/notify_whatsapp.py"),
    (ROOT / "scripts" / "notify_email.py", "scripts/notify_email.py"),
    # 2026-10-07, user: "try to get google ads demand" — Potential Product
    # Opportunities' real Ads-volume refresh (app_kogul.py's
    # /api/missing_items/refresh_ads) imports this the same dynamic-sys.path
    # way as the others above.
    (ROOT / "scripts" / "google_ads_keyword_ideas.py", "scripts/google_ads_keyword_ideas.py"),
    # 2026-10-07, user: "make sure ga4 transaction data also acts as idea to
    # what type of partners to find" — brand_discovery.py's GA4 real-purchase
    # lens (_fetch_ga4_purchased_items) imports this the same way.
    (ROOT / "scripts" / "ga4_pull.py", "scripts/ga4_pull.py"),
]
DATA_STORE_FILE = (ROOT / "data_store.sqlite", "data_store.sqlite")

# Local files/dirs never pushed — dev artifacts, not part of the running app.
SKIP_NAMES = {"__pycache__", ".git"}  # 2026-10-22: never push the laptop .git over the VPS checkout
SKIP_SUFFIXES = {".pyc"}
# Exact-path exclusions, checked against the path relative to ROOT — unlike
# SKIP_NAMES (which matches ANY path segment, so a bare filename check would
# wrongly also exclude kogul/data/kogul.sqlite). This is the stray 0-byte
# top-level kogul/kogul.sqlite only, plus the server log and point-in-time
# .bak- safety copies, none of which belong on a fresh deploy.
SKIP_RELATIVE_PATHS = {Path("kogul/kogul.sqlite"), Path("kogul/kogul_server.log")}

# kogul/data/kogul.sqlite — the REAL, live database — used to sync
# unconditionally on every deploy, same as any other file. REAL DATA LOSS
# BUG found live 2026-10-08 (user: "when i add opportunities and when i
# refresh the added opportunitiy is missing"): the VPS is the system the
# user actually works in day to day (adds Potential Product Opportunities,
# approves/rejects businesses, replies to partners), but every code-only
# deploy from this laptop ALSO re-uploaded this laptop's local kogul.sqlite
# (always a different size/mtime after any local edit/test run, so
# _upload_one's unchanged-skip never caught it), silently overwriting
# whatever the user had just added directly on the VPS with this machine's
# stale local copy. The VPS is the source of truth for live data; local is
# for dev/testing only. Excluded from the default sync now — pass
# --push-local-db to explicitly override (should be rare and deliberate,
# e.g. seeding a brand-new VPS for the first time, never a routine code push).
KOGUL_DB_RELATIVE_PATH = Path("kogul/data/kogul.sqlite")


def _is_skipped_relative(p: Path, root: Path, push_local_db: bool = False) -> bool:
    try:
        rel = p.relative_to(root)
    except ValueError:
        return False
    if rel in SKIP_RELATIVE_PATHS:
        return True
    if rel.name.startswith("kogul.sqlite.bak-"):
        return True
    # 2026-10-22: live state on the VPS (seen-URL lists, gap caches, the database) is VPS-owned; local backups and logs never go
    if rel.parts[:2] == ("kogul", "data") and not push_local_db:
        return True
    if ".bak" in rel.name or rel.name.endswith(".log"):
        return True
    if rel == KOGUL_DB_RELATIVE_PATH and not push_local_db:
        return True
    return False


def _connect(cfg):
    import paramiko
    vps, user, pw = require(cfg, "VPS", "VPS_USERNAME", "VPS_PASSWORD")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(vps, username=user, password=pw, timeout=20)
    transport = client.get_transport()
    transport.window_size = 2147483647
    transport.packetizer.REKEY_BYTES = pow(2, 40)
    transport.packetizer.REKEY_PACKETS = pow(2, 40)
    try:
        transport.sock.setsockopt(__import__("socket").IPPROTO_TCP, __import__("socket").TCP_NODELAY, 1)
    except Exception:
        pass
    return client


def _remote_path(rel: str) -> str:
    return REMOTE_ROOT + "\\" + rel.replace("/", "\\")


def _sftp_stat(sftp, remote_path: str):
    try:
        return sftp.stat(remote_path)
    except FileNotFoundError:
        return None


def _ensure_remote_dir(sftp, remote_dir_win: str, made: set) -> None:
    if remote_dir_win in made:
        return
    parts = remote_dir_win.split("\\")
    cur = parts[0] + "\\"
    for part in parts[1:]:
        cur = cur.rstrip("\\") + "\\" + part
        if cur in made:
            continue
        try:
            sftp.stat(cur)
        except FileNotFoundError:
            sftp.mkdir(cur)
        made.add(cur)


def _should_skip(p: Path, push_local_db: bool = False) -> bool:
    if any(part in SKIP_NAMES for part in p.parts):
        return True
    if p.suffix in SKIP_SUFFIXES:
        return True
    if _is_skipped_relative(p, ROOT, push_local_db=push_local_db):
        return True
    return False


def _upload_one(sftp, local_file: Path, remote_rel: str, made_dirs: set, dry_run: bool) -> str:
    """Returns 'uploaded' | 'skipped' | 'failed'."""
    remote_win = _remote_path(remote_rel)
    remote_dir_win = remote_win.rsplit("\\", 1)[0]
    local_stat = local_file.stat()
    remote_stat = _sftp_stat(sftp, remote_win)

    if (remote_stat is not None
            and remote_stat.st_size == local_stat.st_size
            and abs((remote_stat.st_mtime or 0) - local_stat.st_mtime) < 2):
        return "skipped"

    size_mb = local_stat.st_size / 1_048_576
    if dry_run:
        print(f"  [would upload] {remote_rel} ({size_mb:.1f} MB)")
        return "uploaded"

    try:
        _ensure_remote_dir(sftp, remote_dir_win, made_dirs)
        print(f"  [uploading] {remote_rel} ({size_mb:.1f} MB)...", end="", flush=True)
        t0 = time.time()
        sftp.put(str(local_file), remote_win)
        sftp.utime(remote_win, (local_stat.st_atime, local_stat.st_mtime))
        print(f" done ({time.time() - t0:.1f}s)")
        return "uploaded"
    except Exception as e:
        print(f" FAILED: {type(e).__name__}: {e}")
        return "failed"


def sync(dry_run: bool = False, skip_data_store: bool = False, push_local_db: bool = False) -> tuple[int, int, int]:
    cfg = env()
    client = _connect(cfg)
    sftp = client.open_sftp()
    sftp.get_channel().in_window_size = 2147483647
    sftp.get_channel().out_window_size = 2147483647

    made_dirs: set = set()
    uploaded = skipped = failed = 0
    t0 = time.time()

    if not push_local_db:
        print("[i] kogul/data/kogul.sqlite excluded from sync (the VPS's live data is the source of "
              "truth) — pass --push-local-db to override")

    for local_dir, remote_rel_dir in SYNC_ITEMS:
        if not local_dir.exists():
            print(f"[!] {local_dir} does not exist locally — skipping", file=sys.stderr)
            continue
        files = sorted(p for p in local_dir.rglob("*") if p.is_file() and not _should_skip(p, push_local_db=push_local_db))
        print(f"[i] {len(files)} files under {local_dir.name}/")
        for lf in files:
            rel = (Path(remote_rel_dir) / lf.relative_to(local_dir)).as_posix()
            result = _upload_one(sftp, lf, rel, made_dirs, dry_run)
            if result == "uploaded":
                uploaded += 1
            elif result == "skipped":
                skipped += 1
            else:
                failed += 1

    for local_file, remote_rel in SYNC_FILES:
        if not local_file.exists():
            print(f"[!] {local_file} does not exist locally — skipping", file=sys.stderr)
            continue
        result = _upload_one(sftp, local_file, remote_rel, made_dirs, dry_run)
        if result == "uploaded":
            uploaded += 1
        elif result == "skipped":
            skipped += 1
        else:
            failed += 1

    if not skip_data_store:
        local_file, remote_rel = DATA_STORE_FILE
        if local_file.exists():
            result = _upload_one(sftp, local_file, remote_rel, made_dirs, dry_run)
            if result == "uploaded":
                uploaded += 1
            elif result == "skipped":
                skipped += 1
            else:
                failed += 1
        else:
            print(f"[!] {local_file} does not exist locally — skipping", file=sys.stderr)
    else:
        print("[i] --skip-data-store set — data_store.sqlite not synced")

    sftp.close()
    client.close()
    print(f"[i] sync finished in {time.time() - t0:.1f}s — "
          f"{uploaded} uploaded, {skipped} unchanged/skipped, {failed} failed")
    return uploaded, skipped, failed


def restart_remote_app() -> bool:
    """2026-10-06 fix: the original version built a `cmd.exe /c "..."` string
    with its own embedded double quotes (from `start ""`), nested inside a
    single-quoted -ArgumentList, nested inside the outer powershell -Command
    "..." string — three layers of quoting that collided ("The string is
    missing the terminator: '." — confirmed live, broke the restart after a
    real multi-hour data_store.sqlite upload had already succeeded).

    Fixed by writing the whole launch sequence to a .ps1 FILE on the remote
    side first (via SFTP, no shell quoting involved at all for its content),
    then invoking that file with a single simple `powershell -File` call —
    no nested quoting anywhere."""
    cfg = env()
    client = _connect(cfg)

    remote_ps1 = REMOTE_ROOT + r"\restart_kogul.ps1"
    # 2026-10-22: (1) wait while a "Find more businesses" search is running (a restart kills it and its results);
    # (2) restart through the VPS's own startup task, which runs run_kogul.bat -> run_kogul_prefixed.py (the /pcagent
    # URL rewrite and the username check). Starting app_kogul.py by hand skipped both.
    ps1_content = (
        "for ($i = 0; $i -lt 120; $i++) {\n"
        "  try { $s = Invoke-RestMethod -Uri 'http://127.0.0.1:%d/api/activity/status' -TimeoutSec 20 } catch { break }\n"
        "  if (-not $s.find_running) { break }\n"
        "  Write-Output 'a business search is running, waiting...'; Start-Sleep -Seconds 30\n"
        "}\n"
        "$conns = Get-NetTCPConnection -LocalPort %d -State Listen -ErrorAction SilentlyContinue\n"
        "if ($conns) {\n"
        "  $conns.OwningProcess | Sort-Object -Unique | ForEach-Object {\n"
        "    try { Stop-Process -Id $_ -Force; Write-Output \"stopped PID $_\" }\n"
        "    catch { Write-Output \"failed to stop PID $_ : $($_.Exception.Message)\" }\n"
        "  }\n"
        "} else { Write-Output 'nothing listening on port %d' }\n"
        "Start-Sleep -Seconds 2\n"
        "schtasks /Run /TN 'Kapruka-PC-Agent-Server'\n"
        "Write-Output 'relaunched app_kogul.py'\n"
    ) % (REMOTE_PORT, REMOTE_PORT, REMOTE_PORT)

    sftp = client.open_sftp()
    with sftp.open(remote_ps1, "w") as f:
        f.write(ps1_content)
    sftp.close()

    stdin, stdout, stderr = client.exec_command(f'powershell -File "{remote_ps1}"')
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    print("[i] remote restart output:")
    print(out)
    if err.strip():
        print("[!] remote restart stderr:", err, file=sys.stderr)
    client.close()
    return "relaunched app_kogul.py" in out


def verify_remote_up(cfg=None, retries: int = 8, delay: int = 5) -> bool:
    import requests
    cfg = cfg or env()
    url = f"http://{cfg['VPS']}:{REMOTE_PORT}/"
    for attempt in range(1, retries + 1):
        try:
            r = requests.get(url, timeout=10)
            if r.status_code == 200:
                print(f"[+] {url} is up (attempt {attempt}/{retries})")
                return True
        except Exception as e:
            print(f"  [attempt {attempt}/{retries}] not up yet: {type(e).__name__}: {e}")
        if attempt < retries:
            time.sleep(delay)
    print(f"[!] {url} did not come back up after {retries} attempts", file=sys.stderr)
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-restart", action="store_true")
    ap.add_argument("--skip-data-store", action="store_true")
    ap.add_argument("--push-local-db", action="store_true",
                     help="Override the default exclusion and overwrite the VPS's live kogul.sqlite "
                          "with this machine's local copy — DESTRUCTIVE to any data added directly on "
                          "the VPS since the last push. Only use this deliberately (e.g. first-time "
                          "VPS seeding), never as part of a routine code deploy.")
    args = ap.parse_args()

    uploaded, skipped, failed = sync(dry_run=args.dry_run, skip_data_store=args.skip_data_store,
                                       push_local_db=args.push_local_db)
    if args.dry_run:
        print(f"[i] dry run — {uploaded} file(s) would be uploaded, {skipped} unchanged")
        return
    if failed:
        print(f"[!] {failed} file(s) failed to upload — NOT restarting the remote app", file=sys.stderr)
        sys.exit(1)
    if args.no_restart:
        print("[i] --no-restart set — files synced, remote app left untouched")
        return

    print("[i] restarting the remote app_kogul.py...")
    restart_remote_app()
    time.sleep(3)
    verify_remote_up()


if __name__ == "__main__":
    main()
