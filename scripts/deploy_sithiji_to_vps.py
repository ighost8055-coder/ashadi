#!/usr/bin/env python3
"""deploy_sithiji_to_vps.py - pushes Sithiji (Content Assistor) to the VPS.

Layout on the VPS (mirrors the local one so scripts/_env.py + .env resolve):
  C:\\apps\\sithiji\\run.bat, .env (token ONLY - not the full local .env),
  C:\\apps\\sithiji\\scripts\\_env.py, C:\\apps\\sithiji\\sithiji\\ (the app)
Runs on 127.0.0.1:5071, fronted by IIS at https://pricelens.lanka.info/sithiji/
via a rewrite rule in the Default Web Site web.config (same pattern as every
other app there). Registered in restart-apps.ps1 so the watchdog keeps it up.

Usage:
  python scripts/deploy_sithiji_to_vps.py              # code only (VPS data untouched)
  python scripts/deploy_sithiji_to_vps.py --seed-data  # ALSO push local data/ (first deploy only)
Both timestamped .bak-sithiji backups are taken before web.config / restart-apps.ps1 are edited.
"""
from __future__ import annotations
import argparse, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _env import env  # noqa: E402
from deploy_kogul_to_vps import _connect  # noqa: E402  (paramiko tuning)
from deploy_ashadi_hub_to_vps import load_secrets  # noqa: E402  (shared sign-in secrets)

REMOTE = r"C:\apps\sithiji"
PORT = 5071
WEBCONFIG = r"C:\apps\kapruka-campaign-portal\web.config"
RESTART = r"C:\apps\restart-apps.ps1"

RULES = f'''        <rule name="sithiji-slash" stopProcessing="true">
          <match url="^sithiji$" />
          <action type="Redirect" url="/sithiji/" />
        </rule>
        <rule name="sithiji-proxy" stopProcessing="true">
          <match url="^sithiji/(.*)" />
          <action type="Rewrite" url="http://localhost:{PORT}/{{R:1}}" />
        </rule>
'''
RUN_BAT = (f"@echo off\r\ncd /d {REMOTE}\\sithiji\r\nset PYTHONUTF8=1\r\nset PYTHONIOENCODING=utf-8\r\n"
           f"set SITHIJI_PORT={PORT}\r\npython app_sithiji.py >> {REMOTE}\\sithiji_server.log 2>&1\r\n")


def _mkdirs(sftp, path: str, made: set):
    parts = path.split("\\")
    cur = parts[0] + "\\"
    for p in parts[1:]:
        cur = cur.rstrip("\\") + "\\" + p
        if cur in made:
            continue
        try:
            sftp.stat(cur)
        except FileNotFoundError:
            sftp.mkdir(cur)
        made.add(cur)


def _put(sftp, local: Path, rel: str, made: set) -> bool:
    remote = REMOTE + "\\" + rel.replace("/", "\\")
    st = local.stat()
    try:
        r = sftp.stat(remote)
        if r.st_size == st.st_size and abs((r.st_mtime or 0) - st.st_mtime) < 2:
            return False
    except FileNotFoundError:
        pass
    _mkdirs(sftp, remote.rsplit("\\", 1)[0], made)
    sftp.put(str(local), remote)
    sftp.utime(remote, (st.st_atime, st.st_mtime))
    print(f"  uploaded {rel}")
    return True


def _read(sftp, path: str) -> bytes:
    with sftp.open(path, "rb") as f:
        return f.read()


def _write(sftp, path: str, data: bytes):
    with sftp.open(path, "wb") as f:
        f.write(data)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed-data", action="store_true",
                    help="also upload local sithiji/data (sqlite + media). First deploy only: afterwards "
                         "the VPS is the source of truth and this would overwrite it.")
    ap.add_argument("--no-restart", action="store_true")
    ap.add_argument("--secrets-file", required=True,
                    help="the ashadi-hub.env from the keys zip: holds SITHIJI_WEB_PASSWORD (the /sithiji sign-in). Without it the page would be public.")
    ap.add_argument("--open", action="store_true", help="NO sign-in on /sithiji (anyone with the link). Webhook and worker routes keep their own checks.")
    a = ap.parse_args()

    cfg = env()
    sec = load_secrets(Path(a.secrets_file))
    token = cfg.get("SITHIJI_BOT_TOKEN")
    if not token:
        sys.exit("SITHIJI_BOT_TOKEN missing in .env")
    client = _connect(cfg)
    sftp = client.open_sftp()
    made: set = set()
    n = 0

    # 1. code (+ optional data)
    src = ROOT / "sithiji"
    for f in sorted(src.rglob("*")):
        if not f.is_file() or "__pycache__" in f.parts or f.suffix == ".pyc" or f.name == "server.log":
            continue
        rel = f.relative_to(ROOT).as_posix()
        in_data = f.relative_to(src).parts[0] == "data"
        if in_data and not a.seed_data:
            continue
        n += _put(sftp, f, rel, made)
    n += _put(sftp, ROOT / "scripts" / "_env.py", "scripts/_env.py", made)
    # token-only .env (the full local .env holds unrelated secrets Sithiji never needs)
    _mkdirs(sftp, REMOTE, made)
    wkey = cfg.get("SITHIJI_WORKER_KEY")
    if not wkey:
        sys.exit("SITHIJI_WORKER_KEY missing in .env")
    lines = [f"SITHIJI_BOT_TOKEN={token}", f"SITHIJI_WORKER_KEY={wkey}", "SITHIJI_ANALYZE_MODE=queue",
             # public hosting guard (sithiji/app_sithiji.py): sign-in + cross-site block; webhook and /api/worker/* stay exempt
             "SITHIJI_PUBLIC=1", "SITHIJI_WEB_USER=kapruka", f"SITHIJI_WEB_PASSWORD={sec['SITHIJI_WEB_PASSWORD']}",
             "SITHIJI_ALLOWED_HOSTS=pricelens.lanka.info,localhost:5071,127.0.0.1:5071", "SITHIJI_ALLOWED_ORIGINS=https://pricelens.lanka.info"] + (["SITHIJI_OPEN=1"] if a.open else [])
    # WhatsApp channel (only the keys it needs; never the full local .env)
    for k in ("WA_TOKEN", "WA_PHONE_ID", "WA_ADMIN_NUMBER", "WA_CHAMUDHI_NUMBER",
              "WA_WEBHOOK_VERIFY_TOKEN", "META_APP_SECRET", "SITHIJI_OVERRIDE_PASSWORD"):
        if cfg.get(k):
            lines.append(f"{k}={cfg[k]}")
        else:
            print(f"[!] {k} is empty in .env - WhatsApp will not work until it is set")
    _write(sftp, REMOTE + r"\.env", ("\r\n".join(lines) + "\r\n").encode())
    _write(sftp, REMOTE + r"\run.bat", RUN_BAT.encode())
    print(f"[i] code synced ({n} files changed); .env (token + worker key + queue mode) + run.bat written")

    stamp = time.strftime("%Y%m%d-%H%M%S")
    # 2. IIS route (idempotent)
    wc = _read(sftp, WEBCONFIG)
    txt = wc.decode("utf-8-sig")
    if 'name="sithiji-proxy"' not in txt:
        _write(sftp, WEBCONFIG + f".bak-sithiji-{stamp}", wc)
        txt2 = txt.replace("      </rules>", RULES + "      </rules>", 1)
        assert txt2 != txt, "could not find </rules> in web.config"
        _write(sftp, WEBCONFIG, (b"\xef\xbb\xbf" if wc.startswith(b"\xef\xbb\xbf") else b"") + txt2.encode("utf-8"))
        print("[i] web.config: added /sithiji/ route (backup taken)")
    else:
        print("[i] web.config: route already present")

    # 3. watchdog / twice-daily restart registration (idempotent)
    rs = _read(sftp, RESTART)
    rtxt = rs.decode("utf-8-sig")
    if "sithiji" not in rtxt:
        _write(sftp, RESTART + f".bak-sithiji-{stamp}", rs)
        marker = "    @{ Name = 'pc-agent (kogul)';"
        line_end = rtxt.index("\n", rtxt.index(marker))
        entry_line = rtxt[rtxt.index(marker):line_end].rstrip("\r")
        new_entry = f"    @{{ Name = 'sithiji';                   Port = {PORT}; RunBat = '{REMOTE}\\run.bat' }}"
        if not entry_line.endswith(","):
            rtxt = rtxt.replace(entry_line, entry_line + ",\n" + new_entry, 1)
        else:
            rtxt = rtxt.replace(entry_line, entry_line + "\n" + new_entry + ",", 1)
        _write(sftp, RESTART, (b"\xef\xbb\xbf" if rs.startswith(b"\xef\xbb\xbf") else b"") + rtxt.encode("utf-8"))
        print("[i] restart-apps.ps1: registered sithiji (backup taken)")
    else:
        print("[i] restart-apps.ps1: already registered")
    sftp.close()

    # 4. (re)start
    if not a.no_restart:
        ps = (f"$c = Get-NetTCPConnection -LocalPort {PORT} -State Listen -ErrorAction SilentlyContinue\n"
              f"if ($c) {{ $c.OwningProcess | Sort-Object -Unique | % {{ Stop-Process -Id $_ -Force }}; Start-Sleep 2 }}\n"
              # Win32_Process.Create, NOT Start-Process: a child of the SSH session dies when it closes
              # (found 2026-10-19: the app vanished minutes after a deploy and the site returned 502).
              f"Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments "
              f"@{{CommandLine='cmd.exe /c {REMOTE}\\run.bat'; CurrentDirectory='{REMOTE}'}} | Out-Null\n"
              f"Write-Output 'started'\n")
        s2 = client.open_sftp()
        with s2.open(REMOTE + r"\_start.ps1", "w") as f:
            f.write(ps)
        s2.close()
        _, o, e = client.exec_command(f'powershell -NoProfile -File "{REMOTE}\\_start.ps1"')
        print("[i] start:", o.read().decode(errors="replace").strip(), e.read().decode(errors="replace").strip())
    client.close()


if __name__ == "__main__":
    main()
