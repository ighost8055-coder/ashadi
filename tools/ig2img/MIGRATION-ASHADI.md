# Ashadi — migration guide (moving to another laptop)

Written 2026-11-22. Read this first on the new laptop. It covers **what Ashadi is made of, the two AI methods (CLI and non-CLI), what to copy, how to set it up, and how to prove it works.**

- Methodology and stages: `ASHADI-ONE-PIPELINE.md` (the one pipeline).
- Older notes, kept as they were: `ASHADI-PIPELINE.md`, `TELEGRAM-PIPELINE.md`, `SEO AGENT/output/canva_fbt/PIPELINE-reference-to-canva.md`.
- Everything below assumes the project folder is `Claude Ads Team` (Ashadi lives in `Claude Ads Team\tools\ig2img`). Sithiji is a separate project, `SEO AGENT\sithiji`.

---

## 1. The two AI methods — pick one, it is strict

Ashadi's **thinking steps** can be answered by either of two methods. The **image engines are the same in both** (Gemini in the browser, with Meta AI only as an automatic fallback).

| | **Non-CLI** (`gemini`) | **CLI** (`cli`) |
|---|---|---|
| Who thinks | Gemini, in the signed-in automation Chrome | The Claude CLI (`claude -p`, Opus), run locally |
| Needs | Chrome signed in to Gemini | Claude CLI installed and `claude auth login` done |
| Limits | Your Gemini account's own limits | Your Claude plan's usage (the 5-hour limit), shared with every other automation on that PC |
| Review quality | Good, looser (finds fewer issues) | Sharper and stricter |
| Speed | About 20 min per job | About 10 to 12 min per job |
| Failure mode | Browser-dependent: a closed Chrome or a changed Gemini page breaks a step | Clear error text (signed out, limit hit) |
| Today | **Used and tested on this PC** | Built, **not tested here** (the CLI here is signed out) |

**Thinking steps** (these follow the picked method): measure the reference, adapt it to Kapruka, picture check, art director, fixer, concept, creative strategist, direct/indirect check, product label reader, and the prompt-playbook distiller.

**Strict rule.** When a method is picked, every thinking step uses that method. There is **no silent fallback** to the other one. If the CLI is picked and is signed out, the job stops at once with a message that says so; it does not quietly use Gemini. A job also never changes method half-way: the method is fixed when the job starts.

### How to choose (first match wins)
1. **The header switch** in the Ashadi page (`Non-CLI` / `CLI`). It writes `tools\ig2img\web\data\settings.json` → `{"aiMethod": "cli"}`. Applies to the next job that starts. The AI pill beside it shows "CLI — signed out" if the CLI isn't usable.
2. **`settings.json`** edited by hand (same file).
3. **Environment variable `ASHADI_AI`** = `cli` or `gemini` — a per-machine default. Use this to set the laptop's default before anyone touches the switch (the settings file wins once it exists).
4. **Default:** `gemini`.

The Tracker shows which method each job used ("Method: CLI (Claude)" or "Non-CLI (Gemini)").

### Going to CLI on the new laptop
1. Install the Claude CLI and run `claude auth login` as the Windows user that runs the Ashadi tasks. The login is **per Windows user and PC-wide**: every other Claude automation on that account shares it and shares its usage limit.
2. Check: `claude auth status` must show `"loggedIn": true`.
3. Pick CLI (header switch, or `ASHADI_AI=cli`).
4. Run one test job (section 6). The first step to run on the CLI is the reverse-engineer; a clean log line `→ reverse-engineering … (Opus, measuring on a 5% grid)` followed by `✓ reference spec` means it works.
5. If the CLI hits its limit or is signed out, switch to Non-CLI; nothing else needs changing.

---

## 2. What Ashadi is made of

| Part | Where | Notes |
|---|---|---|
| Web UI and queue | `tools\ig2img\web\server.mjs` → http://127.0.0.1:5041 | Create tab, Tracker tab, AI method switch. Localhost only. |
| One job at a time | `web\job-runner.mjs` (forked per job) | Stop kills the job and its helpers, never Chrome. |
| The pipeline | `design.mjs` + `lib\*.mjs` | `lib\thinker.mjs` (CLI / non-CLI), `lib\oneflow.mjs` (references, products, direct/indirect, strategist), `lib\promptbook.mjs` (learning loop), `lib\designer.mjs` (measure, adapt, review, fix), `lib\gemini.mjs`, `lib\meta.mjs`, `lib\canva.mjs`, `lib\layered.mjs` |
| Telegram | `telegram-bot.mjs` | Messages and photos become queue jobs. No classifier, no CLI. |
| Sithiji button | `SEO AGENT\sithiji\worker_pc.py` | Pulls queued cards from the VPS, posts them to `/api/sithiji/jobs`. |
| Browser | Automation Chrome, port **9222**, profile `%LOCALAPPDATA%\Google\Chrome\Automation Profile` | Signed in to Gemini (required), Meta AI (fallback), Instagram (optional) |
| Canva | Canva Connect API | Tokens in `Claude Ads Team\.canva-tokens.json` |
| Start-up | Scheduled tasks `Kapruka-ig2img-autostart` (logon + every 5 min) and `Sithiji Worker` (logon) | `autostart.ps1` starts Chrome, the bot, the web server and the worker |

Output: `Claude Ads Team\3-output\ashadi-designs\<run>\` (each run has `FINAL.png`, `design.json`, the Canva links). Uploaded references: `3-output\ashadi-inbox\`.

---

## 3. What to copy to the new laptop

| Copy | Why | Notes |
|---|---|---|
| The whole `Claude Ads Team` folder (`1-foundation`, `2-roles`, `tools\ig2img`, `tools\package.json`, logo and brand files under `1-foundation\references\brand-assets`) | Code, brand rules, logos | The pipeline reads `1-foundation\*.md` for brand and business rules. |
| `Claude Ads Team\.env` | Keys and tokens | **Never print or commit it.** Names needed are listed in section 5. |
| `Claude Ads Team\.canva-tokens.json` | The Canva sign-in | If it is missing or expired, open the Ashadi page and use "Connect Canva" once. |
| **`tools\ig2img\data\promptbook.json`** | **What Ashadi has learned** about picture prompts (the learning loop). Without it the strategist starts from nothing. | Worth carrying. |
| `tools\ig2img\web\data\tracker.json` | The project tracker history | Optional. |
| `tools\ig2img\web\data\settings.json` | The AI method | Or just set the method again. |
| `tools\ig2img\cache\kapruka-products.json` | Catalogue snapshot used to match products | Rebuild with `node tools\ig2img\build-product-cache.mjs` if you prefer. |
| `3-output\ashadi-designs\` | Past runs | Optional (large). `promptbook.json` already holds what was learned from them. |
| The Sithiji project (`SEO AGENT\sithiji`) and `run_sithiji_worker.bat` | The Sithiji button's PC worker | Only if this laptop also runs the Sithiji worker. |

Do **not** copy the Chrome profile folder between machines; rebuild it (section 4, step 5), then sign in again.

---

## 4. Set-up on the new laptop (in order)

1. **Install:** Node 22, Python 3 (3.14 is used here), Google Chrome. For CLI method also the Claude CLI.
2. **npm packages** (in `Claude Ads Team\tools`): `npm install` (installs `playwright`, `pptxgenjs`, `marked`). Ashadi attaches to your installed Chrome, so no browser download is needed.
3. **Python packages:** `pip install pillow numpy scipy rembg onnxruntime` (rembg downloads its cut-out model the first time it runs; the product step needs it). `pip install python-pptx` is only for inspecting design files. The Sithiji worker also needs `requests`.
4. **Put the folder and `.env` in place** (section 3). Check the project path: `lib\env.mjs` finds the project root as three folders above `lib`, so keep `tools\ig2img` inside `Claude Ads Team`.
5. **Build the automation Chrome profile:** `powershell -File tools\ig2img\setup-profile.ps1`, then start it with `tools\ig2img\start-chrome.ps1` (port 9222). **Sign in, in that Chrome:** Gemini (required), Meta AI (fallback), Instagram (optional; logged-out Instagram still reads public posts, slide 1 only for carousels). Chrome 136+ refuses a debug port on the default profile, which is why this separate profile exists.
6. **Check the setup:** `node tools\ig2img\doctor.mjs`.
7. **Start Ashadi:** `powershell -File tools\ig2img\autostart.ps1` (starts Chrome if needed, the Telegram bot, the web server, the Sithiji worker). Open http://127.0.0.1:5041.
8. **Connect Canva** (once): the page shows "Connect Canva" if the tokens aren't valid. Needs `CANVA_CLIENT_ID` / `CANVA_CLIENT_SECRET` in `.env`, and the Canva app's redirect address must match this machine's `http://127.0.0.1:5041/canva/callback` (or `CANVA_REDIRECT_URI`).
9. **Scheduled tasks** so it survives restarts: create `Kapruka-ig2img-autostart` (at logon, repeat every 5 minutes, run `autostart.ps1`, "do not start a new instance") and `Sithiji Worker` (at logon, run `run_sithiji_worker.bat`). Allow them on battery (the laptop's default kills tasks on battery).
10. **Pick the AI method** (section 1) and **run the checks in section 6.**

---

## 5. Settings and keys (names only)

`.env` in `Claude Ads Team` (values stay in the file):

| Name | Used for |
|---|---|
| `CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET`, `CANVA_SCOPES` (optional), `CANVA_REDIRECT_URI` (optional) | Canva Connect |
| `TELEGRAM_BOT_TOKEN` | The @Ashadiabot bot |
| `SITHIJI_REMOTE_URL`, `SITHIJI_WORKER_KEY` | The Sithiji PC worker talking to the VPS (same key as on the VPS) |
| `OPENAI_API_KEY_IG2IMG` / `OPENAI_API_KEY`, `WA_*` | Older routes, not used by the one pipeline |

Environment variables you may set on the machine:

| Name | Meaning |
|---|---|
| `ASHADI_AI` | `cli` or `gemini` — the machine's default AI method |
| `ASHADI_ENGINES` | Picture engines, default `gemini` (Meta AI is the automatic fallback) |
| `ASHADI_STYLE` | `adapt` (default), `replica` or `creative` |
| `IG2IMG_WEB_PORT`, `IG2IMG_CDP_PORT`, `IG2IMG_PROFILE` | Web port (5041), Chrome debug port (9222), Chrome profile folder |
| `IG2IMG_AGENT_MODEL` | CLI model (default `opus`) |

---

## 6. Prove it works (checklist)

Run these in order; do the CLI rows only if you picked CLI.

| # | Check | Pass looks like |
|---|---|---|
| 1 | Open http://127.0.0.1:5041 | Pills: Chrome ready, Canva connected, an "AI: …" pill |
| 2 | `claude auth status` (CLI only) | `"loggedIn": true` |
| 3 | Product fetch: Create → Promote, product link `https://www.kapruka.com/online/perfumes`, no reference | Log shows "3 real products fetched" |
| 4 | Reference job: paste an Instagram link and a product or category link | Log shows "reference mode: DIRECT/INDIRECT", the picture, then `final output: FINAL.png` |
| 5 | Tracker | The row goes Queued → Running → Done and shows a Canva link; "Method:" matches your pick |
| 6 | Open the Canva link, click a headline word | The text is editable in Canva (this was **not verified** on the old laptop) |
| 7 | Telegram: send a link to @Ashadiabot | "On it … queued", then the final picture and Canva link come back |
| 8 | Sithiji: press "Send to Ashadi" on an eligible card | A Tracker row with origin Sithiji |
| 9 | Restart the laptop during a job | After login the job is put back in the queue by itself and starts again from the beginning |

---

## 7. Known traps (seen on the old laptop)

- **A PC restart kills a running job.** The queue puts it back automatically (up to 5 times), but it starts from stage 1.
- **Gemini sometimes needs a second try** right after boot; the picture step now retries once and focuses the prompt box directly if a click is blocked.
- **kapruka.com shows a "Just a moment" page now and then;** the product reader waits it out.
- **Canva only honours Regular and Bold** for imported text, so everything is Inter Regular or Bold.
- **Instagram carousels** need an Instagram login in the automation Chrome; logged out gives slide 1 only.
- **The Claude CLI login is PC-wide** and shared with every other automation; its usage limit is shared too.
- **Do not close the automation Chrome or sign out** while a job runs.
- **Product cut-outs** can show white-on-white glass edges or a carton in the sheet; compare the finished picture with the shop page before posting.

---

## 8. Standing rules baked into the pipeline (do not lose in a move)

100px margin on all sides (text, logo, objects); logo top edge within 110px of the top; Inter only; the real product drawn from its real picture; brand colours and the banned-word list from `1-foundation\00-brand-guidelines.md` and `Claude Ads Team\CLAUDE.md`; do not over-localise copy; one design per reference; the number of designs equals the number of references; direct vs indirect is decided by how the reference relates to what is promoted.

## 9. What changed on 2026-11-22 (for reference)

The one pipeline (four intake routes, one queue, tracker tab), real-product sheets, Gemini-first picture engine with Meta fallback, the prompt playbook (learning loop), the CLI / non-CLI switch, Telegram intake into the same queue. Backups of the files edited that day are in `tools\ig2img\_backup-2026-11-22\`.
