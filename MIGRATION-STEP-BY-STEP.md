# Moving Ashadi, Sithiji and the Facebook Ads Tool to the new laptop — step by step

Written 2026-11-25. Do the steps **in order**. Tick each one. Nothing in this file contains a password or key; the keys are in the
separate `KEYS-PRIVATE-….zip`.

---

## 0. What you have

| File | What it is | Secret? |
|---|---|---|
| `Ashadi-Sithiji-KIT-….zip` | Ashadi, Sithiji, brand docs, past designs, learned prompt book, failure log, **all fixes made 2026-11-22/23** | No keys inside |
| `Facebook-Ads-Tool-KIT-….zip` | The Facebook Ads Tool (Flask app) plus the small helper files it reads from other folders | No keys inside |
| `KEYS-PRIVATE-….zip` | Every `.env` and the job history | **YES — treat like a password** |
| `MIGRATION-STEP-BY-STEP.md` | This file | No |

**Deliberately left out**
- `.canva-tokens.json` — Canva sign-ins cannot be copied (see §7). You sign in again on the new laptop.
- The Chrome automation profile — it must be rebuilt on the new laptop (see §6).
- `node_modules`, caches, `__pycache__` — reinstalled in §5.
- `SEO AGENT\data_store.sqlite` (610 MB) — only the Facebook tool's "Suggest" agent reads it, and a missing file is reported as "not available", not an error. Copy it by hand if you want that data source.
- The other `.env` files in `SEO AGENT\` (and its `.bak`) — those belong to the SEO tools, not to these three.

---

## 1. Read this before you start (the traps)

1. **Only ONE place may be signed in to Canva, and only ONE place may poll each Telegram bot.** Canva refresh tokens are single-use: if two machines share a sign-in, Canva revokes it ("Refresh token used twice", "Token lineage has been revoked"). Telegram refuses a second poller. So **stop everything on the old PC before you start Ashadi on the new laptop** (§13).
2. **Do not copy `.canva-tokens.json`.** Sign in on the new laptop instead.
3. **Do not run the Claude CLI on Opus on a Pro plan.** If you ever switch Ashadi to the CLI, set `IG2IMG_AGENT_MODEL=sonnet` first and watch your usage. The default (Gemini in Chrome) uses your Gemini account, not your Claude usage.
4. **Keep the same folder layout** (§3), or the Facebook tool will not find the files it reads from other folders.
5. **Move the zip files by USB or a private transfer, not email or chat.** The keys zip is *not* encrypted. Delete it from the USB stick and the Downloads folder when you finish.

---

## 1b. Every login in one place (tick them off as you go)

**Sign in by hand — these cannot be copied from the old laptop**

| ☐ | Login | Where / how | Account | Needed? | Details |
|---|---|---|---|---|---|
| ☐ | **Gemini** | `https://gemini.google.com/app` in the **automation Chrome** | Google account with the Gemini Pro plan | **Required** — every picture is made here | §6 |
| ☐ | **Meta AI** | `https://www.meta.ai/` in the automation Chrome | Your Meta / Facebook account | Fallback engine (recommended) | §6 |
| ☐ | **Instagram** | `https://www.instagram.com/` in the automation Chrome | Any account | Optional (without it only slide 1 of a carousel is read) | §6 |
| ☐ | **Canva** | The **Connect Canva** button at `http://127.0.0.1:5041`, with the **new team** active in Canva | Canva account in the new team | **Required** for the editable design | §7 |
| ☐ | **Claude CLI** | `claude auth login` in a terminal; check with `claude auth status` (must show `"loggedIn": true`) | Your Claude account | **Optional.** Only if you switch Ashadi to the CLI method, or use the Facebook tool's Suggest agent. On a Pro plan set `IG2IMG_AGENT_MODEL=sonnet` / `FBADS_MODEL=sonnet` first (§1.3, §10). The login is PC-wide and shares your usage limit | §1.3, §10 |

The first three are signed in **in the window opened by `start-chrome.ps1`** (the automation Chrome), not your everyday Chrome. Leave it open and signed in.

**No login — the keys come from the `.env` files in the keys zip (§4)**

| Service | Key names | Notes |
|---|---|---|
| Telegram — Ashadi bot | `TELEGRAM_BOT_TOKEN` | Runs on the new laptop. Only one poller allowed (§8, §13) |
| Telegram — Sithiji bot | `SITHIJI_BOT_TOKEN` | Runs on the VPS, not the laptop (§8) |
| WhatsApp / Meta Cloud API | `WA_TOKEN`, `WA_PHONE_ID`, `WA_ADMIN_NUMBER`, `WA_CHAMUDHI_NUMBER`, `META_APP_SECRET`, `WA_WEBHOOK_VERIFY_TOKEN` | Webhook is on the VPS. The access token can expire |
| OpenAI | `OPENAI_API_KEY`, `OPENAI_API_KEY_IG2IMG` | Facebook tool writer, Sithiji chat |
| Sithiji VPS link | `SITHIJI_REMOTE_URL`, `SITHIJI_WORKER_KEY` | The worker key must equal the one on the VPS |
| Facebook tool — Meta | `META_ACCESS_TOKEN`, `META_PAGE_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `META_PAGE_ID` | Long-lived tokens expire; a token error means a new token, not a login |
| Facebook tool — Google | `GOOGLE_ADS_*`, `GA4_*`, `GSC_*`, `GOOGLE_CLIENT_ID/SECRET` | Refresh tokens carry over |
| Facebook tool — other | `APIFY_TOKEN`, `SUPABASE_*`, `WP_*`, `MAILERLITE_*`, `CLARITY_*`, `DOOFINDER_*`, `EAGLE_USER/EAGLE_PASS`, `VPS_*`, `DASHBOARD_PASSWORD` and more | `DASHBOARD_PASSWORD` is in the tool's `.env`; if its page asks for a password, that is the one |

If a service rejects a key after the move, check the failure log (§15) first; an expired token looks different from a missing login.

---

## 2. Install the software

| Tool | Version used here | Needed for |
|---|---|---|
| Node.js | 22.x (22.16 here) | Ashadi |
| Python | 3.12+ (3.14 here) | Sithiji, Facebook tool, product cut-outs |
| Google Chrome | current | Ashadi's picture engine (Gemini / Meta AI) |
| ffmpeg (with ffprobe) on PATH | any recent | Sithiji reads video frames |
| Claude CLI | only if you decide to use it | optional — see §1.3 |

Check in a new PowerShell window:
```powershell
node --version
python --version
ffmpeg -version
```

---

## 3. Unpack in the right places

Use your Windows user's Desktop. **The Facebook tool's default paths assume the Desktop** (they are overridable — §10 — but the easy way is to match them).

```
Desktop\
  Ashadi-Sithiji\                (unzip Ashadi-Sithiji-KIT here; it contains tools\ig2img, sithiji, 1-foundation …)
  Facebook-Ads-Tool\             (unzip Facebook-Ads-Tool-KIT here; contains app.py, start.bat …)
  Dunder Mifflin\scripts\        (ga4_diag.py, gsc_diag.py — they are inside the Facebook tool zip, under "helpers\")
  MARKETING HUB\department_eagle\snapshots\   (also under "helpers\")
  MARKETING HUB\department\kapruka_sitemap_urls.txt
```

The Facebook tool zip has a `helpers\` folder laid out exactly like that — copy its contents to the Desktop so the folders above appear.
If your Windows user is **not** `fari`, the built-in default paths (`C:\Users\fari\Desktop\…`) will not exist; use the overrides in §10.

---

## 4. Put the keys in place

Unzip `KEYS-PRIVATE-….zip` into a temporary folder, then:

| Copy this | To here |
|---|---|
| `Ashadi-Sithiji\.env` | `Desktop\Ashadi-Sithiji\.env` (project root, next to `CLAUDE.md`) |
| `Facebook-Ads-Tool\.env` | `Desktop\Facebook-Ads-Tool\.env` |
| `Dunder-Mifflin\.env` | `Desktop\Dunder Mifflin\.env` (the GA4 script and the Facebook tool's fallback read it) |
| `web-data\*` (job history, optional) | `Desktop\Ashadi-Sithiji\tools\ig2img\web\data\` |

Check the Ashadi key **names** are all filled (values are never printed):
```powershell
cd "$env:USERPROFILE\Desktop\Ashadi-Sithiji"
powershell -ExecutionPolicy Bypass -File .\setup-new-project.ps1
```
That script also runs `npm install` and `pip install` — if you prefer, do §5 by hand instead.

**Known: `GEMINI_API_KEY` is rejected by Google** (`API_KEY_INVALID`). The pipeline drives Gemini in Chrome and does not appear to use it — ignore, or replace it.

---

## 5. Install the dependencies

```powershell
# Ashadi (node)
cd "$env:USERPROFILE\Desktop\Ashadi-Sithiji\tools"
npm install                      # playwright, pptxgenjs, marked

# Ashadi (python — product cut-outs; rembg downloads its model on first use)
python -m pip install pillow numpy scipy rembg onnxruntime

# Sithiji
cd "$env:USERPROFILE\Desktop\Ashadi-Sithiji"
python -m pip install -r requirements-sithiji.txt     # flask requests python-dotenv yt-dlp

# Facebook Ads Tool (+ the GA4 helper script)
python -m pip install flask requests python-dotenv beautifulsoup4
```
No browser download is needed: Ashadi drives your installed Chrome.

---

## 6. Chrome: build the automation profile and sign in to everything

Ashadi uses its **own** Chrome profile (Chrome 136+ refuses the debug port on your everyday profile). It lives in
`%LOCALAPPDATA%\Google\Chrome\Automation Profile`. Your normal Chrome can stay open.

1. Create the folder and start the automation Chrome:
   ```powershell
   New-Item -ItemType Directory -Force "$env:LOCALAPPDATA\Google\Chrome\Automation Profile" | Out-Null
   cd "$env:USERPROFILE\Desktop\Ashadi-Sithiji"
   powershell -ExecutionPolicy Bypass -File .\tools\ig2img\start-chrome.ps1
   ```
   (The old laptop seeded this profile from "Profile 5" with `setup-profile.ps1`; on a new laptop just sign in by hand in this window — simpler.)
2. **In that window, sign in to:**
   - **Gemini** — `https://gemini.google.com/app` — **required**. Use the Google account with the Gemini Pro plan. Check you see the chat box, not "Sign in".
   - **Meta AI** — `https://www.meta.ai/` — fallback engine. Sign in with the Meta/Facebook account.
   - **Instagram** — optional. Logged out, Ashadi still reads public posts, but only slide 1 of a carousel.
3. Leave this Chrome window **open**. Do not sign out. A job needs it for ~15–20 minutes.
4. (Optional) `node tools\ig2img\doctor.mjs` — note: this older check also looks for **ChatGPT**, which Ashadi no longer needs. Ignore a ChatGPT warning.

---

## 7. Canva — sign in again, on the new team

1. In Canva (canva.com), **switch to the new team first**.
2. Start Ashadi (§12) and open `http://127.0.0.1:5041`. Click **Connect Canva**, approve. This creates a fresh `.canva-tokens.json` on the new laptop.
3. The Canva integration's **redirect address must be exactly** `http://127.0.0.1:5041/canva/callback` (Developer Portal → your integration → Authentication). Scopes ticked: `design:content:write`, `design:content:read`, `design:meta:read`.
4. If the integration (`CANVA_CLIENT_ID`) is **private**, it may only work for members of the team that owns it. If the new team does not own it, create a new integration under the new team and replace `CANVA_CLIENT_ID` / `CANVA_CLIENT_SECRET` in `.env`.
5. **Verify the team:** run one job. A design's owner team id is returned by Canva's API. Before the change, both test designs belonged to team `oBZeqEMiIDOLClvqc7ehTo`. A different id after the move means the new team is in use. (Ask Claude to read the owner of the newest design.)

---

## 8. Telegram and WhatsApp

| Bot / service | Key names | Where it runs |
|---|---|---|
| **Ashadi bot** (`@Ashadiabot`) | `TELEGRAM_BOT_TOKEN` | **New laptop** (`telegram-bot.mjs`, long polling) |
| **Sithiji bot** (`@Sithijibot`) | `SITHIJI_BOT_TOKEN` | **The VPS** (inside the Sithiji web app). Do **not** run it on the laptop: set `SITHIJI_NO_BOT=1` if you ever start the Sithiji app locally |
| **WhatsApp (Meta Cloud API)** | `WA_TOKEN`, `WA_PHONE_ID`, `WA_ADMIN_NUMBER`, `WA_CHAMUDHI_NUMBER`, `META_APP_SECRET`, `WA_WEBHOOK_VERIFY_TOKEN` | The webhook lives on the **VPS** (`/webhook/whatsapp`). Moving the laptop changes nothing there |

- **One poller per bot token.** If the old PC's bot is still running, the new one fails with a conflict. Stop the old one first (§13).
- Test: send a link to `@Ashadiabot`. Expect "On it … queued", then the picture and a Canva link.

---

## 9. Sithiji PC worker

The Sithiji web app and database stay on the VPS (`SITHIJI_REMOTE_URL`). The worker on the laptop pulls queued content, analyses it, and carries "Send to Ashadi" cards.
- Needs `SITHIJI_REMOTE_URL` and `SITHIJI_WORKER_KEY` in `.env` (the key must equal the one on the VPS).
- Start: double-click `run_sithiji_worker.bat` (hidden). Log: `sithiji\data\worker.log`.
- It talks to Ashadi at `http://127.0.0.1:5041`, so Ashadi must be running on the **same** laptop.

---

## 10. Facebook Ads Tool

Start: `Desktop\Facebook-Ads-Tool\start.bat` → opens `http://127.0.0.1:5200`.

**Key names in its `.env`** (grouped; values stay in the file):
- Meta: `META_ACCESS_TOKEN`, `META_PAGE_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `META_PAGE_ID` — long-lived tokens expire; if the Meta pull fails with a token error, generate a new one.
- Google: `GOOGLE_ADS_*`, `GA4_*`, `GSC_*`, `GOOGLE_CLIENT_ID/SECRET` (refresh tokens carry over).
- Other: `OPENAI_API_KEY`, `APIFY_TOKEN`, `SUPABASE_*`, `WP_*`, `MAILERLITE_*`, `CLARITY_*`, `DOOFINDER_*`, `EAGLE_USER/EAGLE_PASS`, `VPS_*`, `DASHBOARD_*` and a few more.

**It reads files from other folders** (hard-coded defaults on the old PC). If your layout differs, set these as **Windows environment variables** (`setx NAME "value"`, then open a new terminal) — they are *not* read from `.env`:

| Variable | Default path on the old PC |
|---|---|
| `GA4_SCRIPT` (**required** — Suggest refuses to start without it) | `C:\Users\fari\Desktop\Dunder Mifflin\scripts\ga4_diag.py` |
| `GSC_SCRIPT` | `…\Dunder Mifflin\scripts\gsc_diag.py` |
| `EAGLE_SNAPSHOTS` | `…\MARKETING HUB\department_eagle\snapshots` |
| `SEO_DB` | `…\SEO AGENT\data_store.sqlite` (optional, not in the pack) |
| `KAPRUKA_SITEMAP_FILE` | `…\MARKETING HUB\department\kapruka_sitemap_urls.txt` |
| `SHARED_ENV_FILE` | `…\Dunder Mifflin\.env` |

**Ashadi link.** The tool pushes jobs to Ashadi at `http://127.0.0.1:5041` (its **Settings → Ashadi URL**, default is that). Ashadi only accepts that local address, so **both tools must run on the same laptop**.

**Claude CLI use.** The "Suggest" agent runs `claude -p` on Opus by default (`FBADS_MODEL`). On a Pro plan set `FBADS_MODEL=sonnet`, or skip Suggest. Everything else uses OpenAI (`OPENAI_API_KEY`) first.

Check it: `python test_tool.py` (offline checks), then open the page.

---

## 11. Start everything the first time

```powershell
cd "$env:USERPROFILE\Desktop\Ashadi-Sithiji"
powershell -ExecutionPolicy Bypass -File .\tools\ig2img\autostart.ps1
```
This starts the automation Chrome (if needed), the Ashadi Telegram bot, the web server on :5041 and the Sithiji worker. Then open `http://127.0.0.1:5041`; expect the pills **Chrome ready**, **Canva** (after §7), **AI: Non-CLI (Gemini)**, and a green Telegram pill.
Keep the AI method on **Non-CLI (Gemini)** (header switch). Start the Facebook tool separately with its `start.bat`.

---

## 12. Make it survive restarts (scheduled tasks)

**Only after the old PC's tasks are disabled (§13).**
```powershell
cd "$env:USERPROFILE\Desktop\Ashadi-Sithiji"
powershell -ExecutionPolicy Bypass -File .\setup-new-project.ps1 -RegisterTasks
```
Creates `Kapruka-ig2img-autostart` (at logon, every 5 minutes, no overlapping runs) and `Sithiji Worker` (at logon), allowed on battery.
Note: a laptop that is asleep or off runs nothing; jobs wait. A running job is lost if the PC restarts, but the queue puts it back automatically (up to 5 times).

---

## 13. Switch off the old PC (do this BEFORE §7 and §11 on the new laptop)

In Task Scheduler disable **`Kapruka-ig2img-autostart`** and **`Sithiji Worker`**, then end these processes (Task Manager → Details):
- `node.exe` running `…\web\server.mjs` and `…\telegram-bot.mjs`
- `pythonw.exe` running `sithiji\worker_pc.py`
- the automation Chrome (port 9222)
- the Facebook tool (`python app.py`)

Leave them off. Do not delete the old folders until the new laptop has run a full job.

---

## 14. Prove it works (in this order)

| # | Check | Pass looks like |
|---|---|---|
| 1 | `http://127.0.0.1:5041` | Chrome ready · Canva connected · AI: Non-CLI (Gemini) · Telegram ok |
| 2 | Create → Promote, product link `https://www.kapruka.com/online/perfumes`, no reference | Log: "3 real products fetched", then `FINAL.png` |
| 3 | Create → reference job (paste an Instagram link + a Kapruka product link) | A full-size picture: the log says **"using Gemini's full-size image (… KB)"** and the raw render is about 1840×2304 |
| 4 | Tracker tab | Row goes Queued → Running → Done, with a Canva link |
| 5 | Open the Canva link; click a headline word | The text is editable |
| 6 | Telegram: send a link to `@Ashadiabot` | Reply, then the final picture |
| 7 | Sithiji dashboard: "Send to Ashadi" on an eligible card | A Tracker row with origin Sithiji |
| 8 | Facebook tool: open `:5200`, push one creative | A job appears in Ashadi's Tracker |
| 9 | `tools\ig2img\web\data\FAILURE-LOG.md` | Any warning or failure is written here automatically |

---

## 15. When something fails — the failure log

Every failed job, and every job that finished only after a warning, is appended automatically to
`tools\ig2img\web\data\FAILURE-LOG.md` (job, step reached, error, warnings, last log lines). The top of that file is a hand-written history of the failures found in November, each with its real cause and fix. Read it first.
If Gemini returns broken JSON a third time, its raw reply is saved to `tools\ig2img\web\data\bad-json-<step>.txt`.

| What you see | What it really means | Fix |
|---|---|---|
| `no product picture could be downloaded` / `fetch failed` | The internet dropped (downloads now retry 4 times) | Check the connection, re-run |
| `could not attach the images in Gemini` / `the question did not send` | Gemini tab on an error page, or leftover draft text in Gemini's prompt box (now cleared automatically) | Reload the Gemini tab in the automation Chrome, re-run |
| `page.goto: Timeout 60000ms` / `ERR_NAME_NOT_RESOLVED` | Slow or dropped internet / DNS | Router, VPN or DNS fix; re-run |
| `Gemini is signed out in this Chrome profile` | The automation Chrome lost its Google sign-in | Sign in again in that window (§6) |
| `Meta AI is logged out` | Same, for Meta AI | Sign in at meta.ai in that window |
| `Canva sign-in failed (400): Refresh token used twice` / `Token lineage has been revoked` | Two machines shared one Canva sign-in | Stop the other machine, click **Connect Canva** |
| `kapruka-adapter returned invalid JSON` | Gemini's reply was broken (it is now re-asked once and repaired) | Re-run; check `bad-json-*.txt` |
| `full-size download not available …` (job still finishes) | Only the small 818×1024 picture was kept | Tell Claude; check the failure log line |
| Telegram pill "unreachable" | Network drop; recovers on its own | Wait; if it stays, restart the bot |
| Status shows Canva "not connected" after moving | Expected — sign in again (§7) | **Connect Canva** |

Quality flags (not breakages) that remain: the art director often marks designs "not ready" for missing bottle-label small print, a gradient instead of a flat Retail Purple background, or a tight logo margin. Open items from the earlier list: wrong product for the occasion, single-attempt label check, no pixel-level margin audit, and Sithiji / Telegram / indirect-reference jobs not re-tested after the fixes.

---

## 16. Hosting on a VPS later (not part of this move)

Plan, not built for Ashadi: put the **web page, queue and webhooks** on the VPS, and run a small **worker on the laptop that pulls jobs outward** (no open ports). Sithiji already works this way (`worker_pc.py`). Things that must stay on the laptop: the signed-in Chrome, the Canva sign-in (callback is `127.0.0.1`), and anything using the Claude CLI.
Today Ashadi (`:5041`) and the Facebook tool (`:5200`) accept **only** local addresses and talk to each other over `127.0.0.1`, so they must run together on the laptop until that rework is done. Do **not** try this during the move.

---

## 17. What was changed on 2026-11-22/23 (in the kit)

| File | Change |
|---|---|
| `tools/ig2img/lib/oneflow.mjs` | Product picture download retries 4 times on network errors. **Creative strategist rewritten (2026-11-25):** for no-reference jobs it now finds a shared truth, weighs 4 concepts from different concept buckets (K1-K9), runs the escalation pass, scores them and picks one; adds a third layout, `full-bleed` (picture fills the poster, all type in one calm band at the top); validates the reply (lengths, banned words, K0) and re-asks once. **Subject test (added the same day):** with all text covered a stranger must still be able to tell what is advertised — the strategist must name a `subject_anchor`, the code checks the picture prompt actually mentions the request's subject (e.g. a WhatsApp-style chat for a WhatsApp feature), and the art director flags a `subject:` issue if the finished design fails it |
| `1-foundation/05-strategist-craft.md` | **New.** The strategist's craft guide, distilled from `CLAUDE.md`, the concept table and the execution table. Edit it to change how the strategist thinks — no code change needed |
| `tools/ig2img/lib/textfit.mjs` (new) + `design.mjs` `enforceLayout` | **Text fits its box (2026-11-25):** an Inter width table (calibrated against a real Canva render, within 1%) shrinks a one-line text layer that is too wide for its box, so supporting lines keep the 100px margin. Wrapped paragraphs are left alone |
| `tools/ig2img/lib/oneflow.mjs` `fetchProducts`, `lib/designer.mjs` | **Label words:** the label reader now asks only for large, legible brand/product words and keeps only words the shop's product title confirms (it used to invent small print such as "EAD DESPERITITE", which then became a binding "spell exactly" rule the art director flagged). The reviewer is told never to flag fine print, and not to demand a flat #340A5C when the picture is full-bleed |
| `web/server.mjs` + Facebook tool `ashadi.py`, `strategist.py`, `craft.md` (new) | **Facebook tool → Ashadi hand-off:** the creative note limit is now 3000 characters (was 500: most of the Facebook strategist's 150-400 word prompt was thrown away) on both sides. The Facebook strategist now thinks first (shared truth, 5 candidate concepts, escalation, subject test; one corrective re-ask), reads `craft.md` (a copy of Ashadi's craft guide — keep the two in step), and still uses your winners profile and tone rule. Ashadi's strategist treats a long note as a creative direction to build on |
| `tools/ig2img/web/{server.mjs,job-runner.mjs,public/app.js}` + `design.mjs` | **Tracker controls (2026-11-25):** **Stop** / **Cancel** on active jobs; **Retry** (fresh run from the saved request), **Run again** (for finished jobs) and **Resume** (continue an earlier run in its own folder, reusing the products, strategist brief, reference measurement, relation and adapted layout it had already finished) on failed / stopped / interrupted jobs. A job also reports its run folder early, so even a stopped job can be resumed, and jobs put back in the queue after a restart now continue in their folder instead of starting over. API: `POST /api/jobs/<id>/retry`, `POST /api/jobs/<id>/resume`, `DELETE /api/jobs/<id>` (stop) |
| `tools/ig2img/design.mjs` | **No product search without a link (2026-11-25):** a no-reference job only uses products when a Kapruka product or category link is given; otherwise the strategist decides what, if anything, to show |
| `tools/ig2img/lib/gemini.mjs` | Gemini prompt box is emptied before each question; full-size download goes straight into the run folder (Playwright's way is the fallback), and re-hovers/retries the button click (3 tries, 12 s each) |
| `tools/ig2img/lib/designer.mjs` | The six thinking steps re-ask once on broken JSON; the parser repairs trailing commas and unescaped quotes; raw bad replies are saved |
| `tools/ig2img/web/server.mjs` | Automatic failure log (`web/data/FAILURE-LOG.md`) |
| `tools/ig2img/data/promptbook.json` | Newer learned prompt book from the live folder |
| `tools/ig2img/web/data/{tracker.json,settings.json,FAILURE-LOG.md}` | Job history, AI method, failure history |
