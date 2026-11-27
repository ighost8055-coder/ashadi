#!/usr/bin/env python3
"""deploy_ashadi_hub_to_vps.py — puts the Ashadi hub and the Facebook Ads Tool on the VPS (and refreshes Sithiji).

  https://pricelens.lanka.info/ashadi    Ashadi hub   C:\\apps\\ashadi-hub          127.0.0.1:5081   (web/hub.mjs, node)
  https://pricelens.lanka.info/facebook  Facebook tool C:\\apps\\facebook-ads-tool   127.0.0.1:5082   (app.py, flask)
  https://pricelens.lanka.info/sithiji   Sithiji      C:\\apps\\sithiji             127.0.0.1:5071   (deploy_sithiji_to_vps.py, unchanged)

Same pattern as deploy_sithiji_to_vps.py: IIS rewrite rules in the Default Web Site web.config, apps registered in
C:\\apps\\restart-apps.ps1 (the watchdog), started with Win32_Process.Create so they outlive the SSH session. Every edit of a shared
VPS file takes a timestamped .bak-ashadi-<stamp> copy first, and every step is idempotent (safe to run again).

Ashadi's browser automation does NOT run on the VPS. The hub only queues; the laptop worker (web/hub-worker.mjs) runs the jobs.

Usage (from the project root):
  python scripts/deploy_ashadi_hub_to_vps.py --env-file <.env that holds VPS / VPS_USERNAME / VPS_PASSWORD> \\
        --secrets-file <KEYS-private\\ashadi-hub.env> --fb-dir ../Facebook-Ads-Tool --fb-env <Facebook tool .env> [--seed-data] [--only hub|facebook]
  --secrets-file is created on the first run (random passwords/keys) and re-used afterwards; it is the ONLY place the passwords are written
  locally, plus the VPS's own .env files. Never commit or email it.
  --seed-data   first deploy only: copy the Facebook tool's local data/ to the VPS. Afterwards the VPS is the source of truth.
"""
from __future__ import annotations
import argparse, secrets, sys, time, json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from deploy_kogul_to_vps import _connect  # noqa: E402  (paramiko tuning, same VPS)
from dotenv import dotenv_values  # noqa: E402

HUB_REMOTE = r"C:\apps\ashadi-hub"
HUB_PORT = 5081
FB_REMOTE = r"C:\apps\facebook-ads-tool"
FB_PORT = 5082
SITE = "pricelens.lanka.info"
WEBCONFIG = r"C:\apps\kapruka-campaign-portal\web.config"
RESTART = r"C:\apps\restart-apps.ps1"


def rules(name: str, prefix: str, port: int) -> str:
    return f'''        <rule name="{name}-slash" stopProcessing="true">
          <match url="^{prefix}$" />
          <action type="Redirect" url="/{prefix}/" />
        </rule>
        <rule name="{name}-proxy" stopProcessing="true">
          <match url="^{prefix}/(.*)" />
          <action type="Rewrite" url="http://localhost:{port}/{{R:1}}" />
        </rule>
'''


class Remote:
    def __init__(self, client):
        self.c = client
        self.sftp = client.open_sftp()
        self.made: set[str] = set()

    def mkdirs(self, path: str):
        parts = path.split("\\")
        cur = parts[0] + "\\"
        for p in parts[1:]:
            cur = cur.rstrip("\\") + "\\" + p
            if cur in self.made:
                continue
            try:
                self.sftp.stat(cur)
            except FileNotFoundError:
                self.sftp.mkdir(cur)
            self.made.add(cur)

    def put(self, local: Path, remote: str) -> bool:
        st = local.stat()
        try:
            r = self.sftp.stat(remote)
            if r.st_size == st.st_size and abs((r.st_mtime or 0) - st.st_mtime) < 2:
                return False
        except FileNotFoundError:
            pass
        self.mkdirs(remote.rsplit("\\", 1)[0])
        self.sftp.put(str(local), remote)
        self.sftp.utime(remote, (st.st_atime, st.st_mtime))
        return True

    def read(self, remote: str) -> bytes:
        with self.sftp.open(remote, "rb") as f:
            return f.read()

    def exists(self, remote: str) -> bool:
        try:
            self.sftp.stat(remote)
            return True
        except FileNotFoundError:
            return False

    def write(self, remote: str, data: bytes):
        self.mkdirs(remote.rsplit("\\", 1)[0])
        with self.sftp.open(remote, "wb") as f:
            f.write(data)

    def ps(self, script: str) -> str:
        self.write(r"C:\Windows\Temp\_ashadi_deploy.ps1", ("\ufeff" + script).encode("utf-8"))
        _, o, e = self.c.exec_command(r"powershell -NoProfile -ExecutionPolicy Bypass -File C:\Windows\Temp\_ashadi_deploy.ps1")
        return (o.read().decode(errors="replace") + e.read().decode(errors="replace")).strip()


def sync_tree(rem: Remote, src: Path, dest: str, skip_dirs=(), skip_names=(), skip_suffix=(".pyc",), only_top_data: bool = True) -> int:
    n = 0
    for f in sorted(src.rglob("*")):
        if not f.is_file():
            continue
        rel = f.relative_to(src)
        if any(p in skip_dirs for p in rel.parts[:-1]) or f.name in skip_names or f.suffix in skip_suffix or "__pycache__" in rel.parts:
            continue
        if rem.put(f, dest + "\\" + "\\".join(rel.parts)):
            n += 1
    return n


def load_secrets(path: Path) -> dict:
    cur = {k: v for k, v in dotenv_values(path).items() if v} if path.exists() else {}
    want = {
        "ASHADI_HUB_PASSWORD": 24, "ASHADI_WORKER_KEY": 40, "ASHADI_HUB_API_KEY": 32, "FBADS_WEB_PASSWORD": 24, "SITHIJI_WEB_PASSWORD": 24,
    }
    changed = False
    for k, n in want.items():
        if not cur.get(k):
            cur[k] = secrets.token_urlsafe(n)[: n + 8]
            changed = True
    if changed or not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        lines = [
            "# Secrets for the Ashadi hub + Facebook tool on the VPS. PRIVATE. Never email, commit or paste into chat.",
            "# Sign-in for https://pricelens.lanka.info/ashadi  -> user kapruka, password ASHADI_HUB_PASSWORD",
            "# Sign-in for https://pricelens.lanka.info/facebook -> user kapruka, password FBADS_WEB_PASSWORD",
            "# Sign-in for https://pricelens.lanka.info/sithiji -> user kapruka, password SITHIJI_WEB_PASSWORD",
            "# ASHADI_WORKER_KEY goes into the laptop's project .env (the worker uses it); ASHADI_HUB_API_KEY is used only on the VPS (Facebook tool -> hub).",
            "ASHADI_HUB_USER=kapruka",
        ] + [f"{k}={v}" for k, v in cur.items() if k != "ASHADI_HUB_USER"] + [
            f"ASHADI_HUB_URL=https://{SITE}/ashadi", "FBADS_WEB_USER=kapruka",
        ]
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"[i] secrets written to {path}")
    cur.setdefault("ASHADI_HUB_USER", "kapruka")
    return cur


def edit_shared(rem: Remote, stamp: str):
    """web.config routes + watchdog registration, with backups."""
    wc = rem.read(WEBCONFIG)
    txt = wc.decode("utf-8-sig")
    new = txt
    added = []
    for name, prefix, port in (("ashadi", "ashadi", HUB_PORT), ("facebooktool", "facebook", FB_PORT)):
        if f'name="{name}-proxy"' not in new:
            new = new.replace("      </rules>", rules(name, prefix, port) + "      </rules>", 1)
            added.append(prefix)
    if new != txt:
        assert "</rules>" in txt, "could not find </rules> in web.config"
        rem.write(WEBCONFIG + f".bak-ashadi-{stamp}", wc)
        rem.write(WEBCONFIG, (b"\xef\xbb\xbf" if wc.startswith(b"\xef\xbb\xbf") else b"") + new.encode("utf-8"))
        print(f"[i] web.config: added routes {added} (backup taken)")
    else:
        print("[i] web.config: routes already present")

    rs = rem.read(RESTART)
    rtxt = rs.decode("utf-8-sig")
    out = rtxt
    marker = "    @{ Name = 'sithiji';"
    assert marker in out, "sithiji entry not found in restart-apps.ps1"
    for nm, port, bat in (("ashadi-hub", HUB_PORT, HUB_REMOTE + r"\run.bat"), ("facebook-ads-tool", FB_PORT, FB_REMOTE + r"\run.bat")):
        if f"Name = '{nm}'" in out:
            continue
        line_start = out.index(marker)
        line_end = out.index("\n", line_start)
        entry = f"    @{{ Name = '{nm}';{' ' * max(1, 28 - len(nm))}Port = {port}; RunBat = '{bat}' }},"
        out = out[: line_end + 1] + entry + "\n" + out[line_end + 1:]
    if out != rtxt:
        rem.write(RESTART + f".bak-ashadi-{stamp}", rs)
        rem.write(RESTART, (b"\xef\xbb\xbf" if rs.startswith(b"\xef\xbb\xbf") else b"") + out.encode("utf-8"))
        print("[i] restart-apps.ps1: registered ashadi-hub + facebook-ads-tool (backup taken)")
    else:
        print("[i] restart-apps.ps1: already registered")


def start_app(rem: Remote, remote_dir: str, port: int, name: str):
    ps = (f"$c = Get-NetTCPConnection -LocalPort {port} -State Listen -ErrorAction SilentlyContinue\n"
          f"if ($c) {{ $c.OwningProcess | Sort-Object -Unique | % {{ Stop-Process -Id $_ -Force }}; Start-Sleep 2 }}\n"
          f"Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments "
          f"@{{CommandLine='cmd.exe /c {remote_dir}\\run.bat'; CurrentDirectory='{remote_dir}'}} | Out-Null\n"
          f"Start-Sleep 6\n"
          f"$ok = Get-NetTCPConnection -LocalPort {port} -State Listen -ErrorAction SilentlyContinue\n"
          f"if ($ok) {{ 'listening on {port}' }} else {{ 'NOT listening on {port} - check {remote_dir}' }}\n")
    print(f"[i] {name}:", rem.ps(ps))


def deploy_hub(rem: Remote, sec: dict, stamp: str, no_restart: bool, open_site: bool = False):
    web = ROOT / "tools" / "ig2img" / "web"
    n = 0
    n += rem.put(web / "hub.mjs", HUB_REMOTE + r"\hub.mjs")
    for f in sorted((web / "public").iterdir()):
        if f.is_file():
            n += rem.put(f, HUB_REMOTE + "\\public\\" + f.name)
    env = [
        f"ASHADI_HUB_USER={sec['ASHADI_HUB_USER']}", f"ASHADI_HUB_PASSWORD={sec['ASHADI_HUB_PASSWORD']}",
        f"ASHADI_WORKER_KEY={sec['ASHADI_WORKER_KEY']}", f"ASHADI_HUB_API_KEY={sec['ASHADI_HUB_API_KEY']}",
        f"ASHADI_HUB_PORT={HUB_PORT}", "ASHADI_BASE_PATH=/ashadi", f"ASHADI_ALLOWED_HOSTS={SITE}",
    ] + (["ASHADI_HUB_OPEN=1"] if open_site else [])
    rem.write(HUB_REMOTE + r"\.env", ("\r\n".join(env) + "\r\n").encode())
    run = f"@echo off\r\ncd /d {HUB_REMOTE}\r\nset ASHADI_HUB_HOME={HUB_REMOTE}\r\nnode hub.mjs >> {HUB_REMOTE}\\logs\\hub-stdout.log 2>&1\r\n"
    rem.mkdirs(HUB_REMOTE + r"\logs")
    rem.write(HUB_REMOTE + r"\run.bat", run.encode())
    print(f"[i] hub: {n} file(s) changed; .env + run.bat written")
    return n


def deploy_facebook(rem: Remote, sec: dict, fb_dir: Path, fb_env: Path, seed: bool, no_restart: bool, open_site: bool = False):
    skip_dirs = {"data"} if not seed else set()
    n = sync_tree(rem, fb_dir, FB_REMOTE, skip_dirs=skip_dirs,
                  skip_names={".env", "MIGRATION-STEP-BY-STEP.md", "start.bat"})
    print(f"[i] facebook tool: {n} file(s) changed" + ("" if seed else " (data/ untouched - VPS data is the source of truth)"))
    # the Ashadi hand-off: this tool talks to the hub on the same machine
    settings_path = FB_REMOTE + r"\data\settings.json"
    cur = {}
    if rem.exists(settings_path):
        try:
            cur = json.loads(rem.read(settings_path).decode("utf-8-sig"))
        except ValueError:
            cur = {}
    if cur.get("ashadi_url") != f"http://127.0.0.1:{HUB_PORT}":
        cur["ashadi_url"] = f"http://127.0.0.1:{HUB_PORT}"
        rem.write(settings_path, json.dumps(cur, indent=1).encode())
        print(f"[i] facebook tool: ashadi_url -> http://127.0.0.1:{HUB_PORT}")
    # .env = the tool's own keys (minus the unrelated VPS_* / PC_AUDIT_* ones) + the public-mode settings
    base = []
    for line in fb_env.read_text(encoding="utf-8", errors="replace").splitlines():
        k = line.split("=", 1)[0].strip()
        if k.startswith(("VPS_", "PC_AUDIT_")) or k in ("SHARED_ENV_FILE", "FBADS_PORT"):
            continue
        base.append(line)
    base += [
        "", "# --- added by deploy_ashadi_hub_to_vps.py: public hosting on the VPS ---",
        "FBADS_PUBLIC=1", "FBADS_BASE_PATH=/facebook", f"FBADS_PORT={FB_PORT}",
        f"FBADS_ALLOWED_HOSTS={SITE},localhost:{FB_PORT},127.0.0.1:{FB_PORT}", f"FBADS_ALLOWED_ORIGINS=https://{SITE}",
        "FBADS_WEB_USER=kapruka", f"FBADS_WEB_PASSWORD={sec['FBADS_WEB_PASSWORD']}",
        f"ASHADI_HUB_API_KEY={sec['ASHADI_HUB_API_KEY']}",
    ] + (["FBADS_OPEN=1"] if open_site else [])
    rem.write(FB_REMOTE + r"\.env", ("\r\n".join(base) + "\r\n").encode("utf-8"))
    h = FB_REMOTE + r"\helpers"
    run = ("@echo off\r\ncd /d " + FB_REMOTE + f"\r\nset FBADS_PORT={FB_PORT}\r\nset PYTHONUTF8=1\r\nset PYTHONIOENCODING=utf-8\r\n"
           f"set SHARED_ENV_FILE={FB_REMOTE}\\.env\r\n"
           f"set GA4_SCRIPT={h}\\Dunder Mifflin\\scripts\\ga4_diag.py\r\nset GSC_SCRIPT={h}\\Dunder Mifflin\\scripts\\gsc_diag.py\r\n"
           f"set EAGLE_SNAPSHOTS={h}\\MARKETING HUB\\department_eagle\\snapshots\r\n"
           f"set KAPRUKA_SITEMAP_FILE={h}\\MARKETING HUB\\department\\kapruka_sitemap_urls.txt\r\n"
           f"python app.py >> {FB_REMOTE}\\fbads_server.log 2>&1\r\n")
    rem.write(FB_REMOTE + r"\run.bat", run.encode())
    print("[i] facebook tool: .env (public mode, filtered keys) + run.bat written")
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--env-file", required=True, help=".env holding VPS, VPS_USERNAME, VPS_PASSWORD")
    ap.add_argument("--secrets-file", required=True)
    ap.add_argument("--fb-dir")
    ap.add_argument("--fb-env")
    ap.add_argument("--seed-data", action="store_true")
    ap.add_argument("--only", choices=["hub", "facebook"])
    ap.add_argument("--no-restart", action="store_true")
    ap.add_argument("--open", action="store_true", help="NO sign-in on /ashadi and /facebook (anyone with the link). The laptop worker key is still required.")
    a = ap.parse_args()

    cfg = {k: v for k, v in dotenv_values(a.env_file).items() if v is not None}
    sec = load_secrets(Path(a.secrets_file))
    client = _connect(cfg)
    rem = Remote(client)
    stamp = time.strftime("%Y%m%d-%H%M%S")

    do_hub = a.only in (None, "hub")
    do_fb = a.only in (None, "facebook")
    if do_hub:
        deploy_hub(rem, sec, stamp, a.no_restart, a.open)
    if do_fb:
        if not (a.fb_dir and a.fb_env):
            sys.exit("--fb-dir and --fb-env are required to deploy the Facebook tool")
        deploy_facebook(rem, sec, Path(a.fb_dir), Path(a.fb_env), a.seed_data, a.no_restart, a.open)
    edit_shared(rem, stamp)
    if not a.no_restart:
        if do_hub:
            start_app(rem, HUB_REMOTE, HUB_PORT, "ashadi-hub")
        if do_fb:
            start_app(rem, FB_REMOTE, FB_PORT, "facebook-ads-tool")
    client.close()


if __name__ == "__main__":
    main()
