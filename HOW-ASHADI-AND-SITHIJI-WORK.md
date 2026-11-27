# Ashadi and Sithiji — how each project works, end to end

Written 2026-11-22 for the move out of the SEO AGENT / Claude Ads Team folders into a new project on the same laptop.
This file sits at the root of `Ashadi-Sithiji-project.zip`. Other docs inside the zip go deeper:
`tools/ig2img/ASHADI-ONE-PIPELINE.md` (the spec), `tools/ig2img/MIGRATION-ASHADI.md` (CLI vs non-CLI), `tools/ig2img/TELEGRAM-PIPELINE.md`.

---

## 0. The two projects in one minute

| | **Sithiji** — content manager | **Ashadi** — graphic designer |
|---|---|---|
| Job | Collect content ideas (Instagram / TikTok / Facebook / LinkedIn / YouTube links, screenshots, typed ideas), have Claude read them, sort them into 4 groups, score difficulty, write step-by-step, and plan the week's 10 picks. | Turn a reference picture (plus an optional Kapruka product) into an editable Kapruka design in Canva, then export a flat `FINAL.png`. |
| Language | Python 3 (Flask, sqlite) | Node 22 (plain `http`, Playwright, pptxgenjs) |
| Where it runs | **Web app + Telegram bot + database live on the VPS** (`https://pricelens.lanka.info/sithiji/`, port 5071). A small **PC worker** runs on this laptop. | **Everything runs on this laptop**: web UI `http://127.0.0.1:5041`, Telegram bot, automation Chrome on port 9222. |
| Thinking | Claude CLI (`claude -p`, model `claude-sonnet-5-5`), Read tool only | Selectable: **non-CLI** = Gemini in the browser (default, used for testing), or **CLI** = Claude CLI |
| Pictures | Does not make pictures | Gemini in the browser (Meta AI as automatic fallback) |
| Output | Cards in a content bank, weekly plan, step lists | A Canva link (editable design) + `FINAL.png` |

How they connect: a Sithiji card judged "recreatable" gets a **Send to Ashadi** button. The PC worker carries it from the VPS to Ashadi's local web server, watches Ashadi work, and pushes the Canva link and previews back onto the card (section 4).

```
 Telegram / WhatsApp / dashboard
            |
            v
   SITHIJI on the VPS  ── queue ──>  PC worker (this laptop)  ── Claude CLI reads the media, writes the analysis
   (bank, week, rules)  <── result ──┘            |
            ^                                      | "Send to Ashadi" card
            |                                      v
            |                        ASHADI web server :5041  ── one-job-at-a-time queue
            |                                      |   Gemini (picture) + Canva (editable layers)
            └─────── Canva link + previews ────────┘
```

---

# PART A — SITHIJI

## A1. What it does, as a user sees it

1. You send Sithiji something: a link, a photo/screenshot/screen recording, or a typed idea.
2. Within a minute or two it answers with a card: title, group, difficulty 1–5, time estimate, why that group, and `/show <id>` for the step-by-step.
3. In the dashboard you **pick** cards into the current week (10 slots, with rules). Cards move through *Not started → In progress → Done*. Unfinished picks roll into the next week by themselves.
4. Cards that are still pictures (an image or a carousel) show **Send to Ashadi**. The design comes back on the card as a Canva link plus a preview. Press **Pull final** after you edit it in Canva to get the finished PNG on the card.

## A2. The four groups and the weekly rules

| Group key | Meaning |
|---|---|
| `laptop_image` | Made at a desk: AI image generation + Canva edits |
| `laptop_video` | Made at a desk: AI video/animation + Canva edits |
| `walk_image` | Walk around, take real photos, then edit |
| `walk_video` | Walk around, shoot real footage, then edit |

Rules (all in `sithiji/core.py`, so the dashboard and the bot can never disagree):

- The week has **10 slots** (`WEEK_SLOTS`). Weeks start **Monday, Colombo time** (UTC+5:30, no DST).
- Max **5 per group** per week. Max **5 On-Laptop** (image + video together).
- Walk Around image count and video count must stay within **1** of each other.
- A card must be analysed and grouped before it can be picked; a card can't be picked twice in a week; a full week refuses more.
- **Override:** a *rule* (not a hard error) can be bypassed with the special-permission password (`SITHIJI_OVERRIDE_PASSWORD` in `.env`, checked server-side, wrong guesses wait one second).
- **Rollover:** at the Monday change, every pick not marked Done is copied into the new week (exempt from the rules, still uses a slot). A background thread does this every 10 minutes and tells the owner on Telegram which items moved.
- **Suggest:** `/suggest` or the dashboard builds a rule-valid fill for the open slots, easiest first. It is only a helper; the person decides.

## A3. How a card gets made (intake → analysis → result)

**Intake routes** (all end at `core.add_content` + `analyze.enqueue`):

| Route | Code |
|---|---|
| Telegram (separate Sithiji bot, long polling, no webhook) | `bot.py` — link, photo/video (caption `#12` attaches it to item 12), or free text. Free text is routed by a small Claude call into an intent (`add_idea`, `list`, `week`, `suggest`, `pick`, `show`, `status`, `regroup`, `delete`, `retry`, `help`). |
| WhatsApp (Meta Cloud API) | `whatsapp.py` + `/webhook/whatsapp`. Signature-checked with the app secret, **fails closed**. Only `WA_ADMIN_NUMBER` / `WA_CHAMUDHI_NUMBER` are served. Same intake functions as Telegram. See A7 for the Kogul forward. |
| Dashboard Quick add | `POST /api/idea` — link and/or text. |
| Dashboard manual log | `POST /api/log` — title, link, notes, optional file; with "AI" ticked Claude fills the rest, otherwise you fill group/difficulty/steps yourself. |

**Analysis** (`analyze.py`):

1. `gather()` collects media into `data/media/<id>/`: Instagram via the public embed JSON (every carousel slide plus caption; `ig_embed.py`), TikTok/Facebook/LinkedIn via oEmbed or embed pages (`social_fetch.py`, public routes only, no login-wall tricks), YouTube/other via yt-dlp. Videos are sampled into frames with `ffprobe`/`ffmpeg`. Max 12 images are shown to Claude.
2. `run_analysis()` builds the prompt (Kapruka context, the group definitions, difficulty scale, **banned words**, "short point-form steps, max 7") and runs the Claude CLI with **only the Read tool**, inside the card's media folder.
3. The JSON reply is validated (group must be one of the four; any video slide forces a `_video` group), then stored: title, format, origin (`original` / `inspired`), group + reason, difficulty + factors, time estimate, summary, full analysis JSON, thumbnail.
4. If nothing could be fetched and the text is too short, the state is `needs_media` and the user is asked for a screenshot or screen recording captioned `#<id>`.

**Two analysis modes** (`SITHIJI_ANALYZE_MODE`):

- `local` — the process that holds the database analyses it itself (a laptop-only setup).
- `queue` — the process only stores `pending` items; the **PC worker** claims, analyses and pushes results. This is how it runs in production, because the VPS has no logged-in Claude CLI and Instagram opens from a home IP.

## A4. The PC worker (`worker_pc.py`) — what runs on this laptop

Two loops in one process (`pythonw`, hidden, log in `sithiji/data/worker.log`):

1. **Analysis loop** — every 20 s `POST /api/worker/claim` (header `X-Worker-Key`). The VPS hands out the oldest `pending` item (or one claimed more than 25 minutes ago by a worker that vanished). The worker pulls the media, runs `run_analysis`, and pushes the result with up to 6 retries. If Claude says "usage limit" the item is re-queued silently and the worker backs off 10 minutes; transient CLI failures retry up to 3 times.
2. **Ashadi bridge loop** — see section 4.

If the PC is off, items just wait on the VPS and are processed in order when it comes back. The dashboard shows whether the worker is online (seen in the last 90 s).

## A5. Data model (sqlite, `sithiji/data/sithiji.sqlite`)

- `content` — one row per card (state, analysis fields, thumb, status, `done_at`, and the five `ashadi_*` columns).
- `picks(week_start, content_id, picked_at, override, carried_from)` — the weekly plan and its history.
- `meta(k, v)` — e.g. `worker_seen`.
- `chats(chat_id, name, is_owner)` — who the bot talks to.

**The live database is on the VPS** (`C:\apps\sithiji\sithiji\data`). The local copy is mostly an empty database plus 196 MB of media the worker downloaded. Moving the laptop copy does **not** move or delete the production data.

## A6. Files

| File | Role |
|---|---|
| `app_sithiji.py` | Flask dashboard + all `/api/...` routes + worker routes + WhatsApp webhook + rollover thread; starts the Telegram bot. Port `SITHIJI_PORT` (default 5070 locally, 5071 on the VPS). |
| `core.py` | Database, the four groups, weekly rules, rollover, suggest, claim logic, `ashadi_fit`. |
| `analyze.py` | Media gathering, the analysis prompt, Claude call, queue/local modes. |
| `bot.py` | Telegram front door. |
| `whatsapp.py` | WhatsApp Cloud API in/out (24-hour free-reply window limit: late results are logged, not sent). |
| `worker_pc.py` | PC worker + Ashadi bridge. |
| `claude_cli.py` | Finds `claude`, builds its environment (pins HOME/USERPROFILE so it also works under the SYSTEM account on the VPS). |
| `social_fetch.py`, `ig_embed.py`, `backfill_thumbs.py` | Platform readers; thumbnail backfill. |
| `templates/sithiji.html`, `static/` | The dashboard page (served with `no-store`). |
| `scripts/_env.py` | Shared `.env` loader (the app expects `<root>/scripts/_env.py` and `<root>/.env`). |
| `scripts/deploy_sithiji_to_vps.py` (+ `deploy_kogul_to_vps.py`, which it imports for the SFTP tuning) | Pushes code to the VPS. |
| `run_sithiji.bat`, `run_sithiji_worker.bat` | Start the app / the hidden worker. |

## A7. The VPS side and the Kogul link (do not lose these)

- **VPS layout:** `C:\apps\sithiji\run.bat`, `.env` (the bot token only, not the full local `.env`), `scripts\_env.py`, `sithiji\` (the app). Port **5071**. IIS (Default Web Site `web.config` of `kapruka-campaign-portal`) rewrites `https://pricelens.lanka.info/sithiji/*` to `http://localhost:5071/*`. Registered in `C:\apps\restart-apps.ps1` so the watchdog restarts it.
- **Deploy:** `python scripts/deploy_sithiji_to_vps.py` (code only) or `--seed-data` (first deploy only; it also pushes local data). It takes timestamped `.bak-sithiji` backups of `web.config` and `restart-apps.ps1` before editing.
- **WhatsApp has ONE webhook callback**, and it belongs to Kogul (`kogul/app_kogul.py`, "Sithiji hand-off" section). Kogul recognises messages that contain a social link, re-signs a one-message payload with the app secret and POSTs it to `http://127.0.0.1:5071/webhook/whatsapp` (override with `SITHIJI_WEBHOOK_URL`). **That forward stays in the Kogul project**; moving Sithiji on this laptop does not touch it because both run on the VPS.
- **Secrets involved:** `SITHIJI_BOT_TOKEN`, `SITHIJI_WORKER_KEY` (same value on the VPS and the PC), `SITHIJI_REMOTE_URL`, `SITHIJI_OVERRIDE_PASSWORD`, `META_APP_SECRET`, `WA_TOKEN`, `WA_PHONE_ID`, `WA_WEBHOOK_VERIFY_TOKEN`, `WA_ADMIN_NUMBER`, `WA_CHAMUDHI_NUMBER`. Optional: `SITHIJI_IG_COOKIES`, `SITHIJI_ANALYZE_MODE`, `SITHIJI_DATA`, `SITHIJI_NO_BOT`, `SITHIJI_WA_DRYRUN`, `ASHADI_URL`.

## A8. Run it

| What | Command / task |
|---|---|
| PC worker (what this laptop normally runs) | `run_sithiji_worker.bat`, or the scheduled task **Sithiji Worker** (at logon) |
| Whole app locally (dashboard + bot, local mode) | `run_sithiji.bat` → `http://127.0.0.1:5070` |
| Deploy code to the VPS | `python scripts/deploy_sithiji_to_vps.py` |
| Worker log | `sithiji/data/worker.log` |

Python deps: `flask`, `requests`, `python-dotenv`, `yt-dlp` (see `requirements-sithiji.txt`); `ffmpeg`/`ffprobe` on PATH for video frames; the Claude CLI signed in (`claude auth login`) for analysis.

---

# PART B — ASHADI

## B1. What it does, as a user sees it

Give Ashadi a reference (an Instagram or Pinterest link, or an image) and, optionally, a Kapruka product or category link. It builds a Kapruka version of that design, puts it in Canva as an **editable** design (real text boxes, logo, brand colours, Inter font), and shows the Canva link in the **Tracker** tab. `FINAL.png` is a flat export of the same design.

## B2. Four ways in, one queue

| # | Route | Notes |
|---|---|---|
| 1 | **Telegram** (`@Ashadiabot`) — a link, a photo, or `promote …` / `persona …` | `telegram-bot.mjs` parses it and POSTs to the web server's `/api/jobs`. No classifier, no CLI. |
| 2 | **Ashadi web UI** — paste a link / use the Create form | `http://127.0.0.1:5041`. Tabs: Design, **Persona promotion** (was "Ideas"), Promote, Tracker. Up to **3 references** (links or uploads) and an optional product/category link. |
| 3 | **Sithiji "Send to Ashadi"** | The PC worker calls `POST /api/sithiji/jobs` (section 4). Only still images and carousels qualify — no reels, no text ideas. |
| 4 | **No reference** (Persona promotion / Promote with nothing attached) | The **creative strategist** invents the angle and brief. |

**One job per reference** (3 references = 3 jobs = 3 designs). Jobs run **one at a time** in order; the rest wait. At most 30 can be queued.

## B3. Direct, indirect, or none

Decided by how the reference relates to *what is being promoted*:

- **Direct** — same product/category (a perfume reference for a perfume promotion): keep composition, camera, lighting, layout and type hierarchy; rebuild with the real product, Kapruka copy, logo, palette.
- **Indirect** — different product (a watch reference for a perfume promotion): keep only the look (composition feel, lighting, colour mood, type hierarchy); the promoted product becomes the hero.
- **None** — no reference: the strategist writes the angle and brief; a built-in layout (`purple-hero` or `light-split`) carries it.

Auto by default: Gemini looks at the reference and decides (`classifyRelation`, `lib/oneflow.mjs`). The Create form can force Direct or Indirect.

## B4. The stages of one job

1. **Job record** — origin (web/telegram/sithiji), kind (reference/persona/promote), reference(s), text, product link.
2. **Reference ready** — Instagram slides saved, Pinterest `og:image` or image URL downloaded, or the upload copied (`resolveReference`).
3. **Real product** — the product or category page is opened in the signed-in automation Chrome (it waits out Cloudflare's "Just a moment"), original pictures are downloaded, cut out with rembg, laid out on `product-sheet.png`, and Gemini reads the exact words printed on the packs. A catalogue snapshot (`cache/kapruka-products.json`) is the fallback. Result: `products.json`.
4. **Reference type** — direct / indirect / none.
5. **Strategist (none only)** — angle, audience, headline, supporting line, layout and the picture prompt, informed by the **prompt playbook** (below). Saved as `strategist-brief.json`.
6. **Measure and adapt (direct/indirect)** — the reference layout is measured on a grid, then adapted to Kapruka with the target product.
7. **Picture** — Gemini gets up to 3 attachments: layout sketch, reference (direct = composition, indirect = mood only), product sheet. Then picture checker, watermark crop, placement inside the margins, colour correction, **seam fix** (page colour forced to the layout's ground colour so no lighter rectangle shows).
8. **Layers** — pptxgenjs builds a layered 1080×1350 PPTX: Inter text, logo, 100 px margins, stacked-text separation (no overlapping headlines).
9. **Canva** — the PPTX is imported through the Canva Connect API (text boxes stay editable); a preview PNG is exported.
10. **Review and repair** — art-director check (product label spelling, margins, overlap), up to 3 fix rounds.
11. **Final** — exported from Canva as `FINAL.png`; the Canva link goes into the tracker; the result is sent back to the origin (Telegram message, Sithiji card, or the web page).

## B5. The two AI methods (strict, never mixed)

| | Non-CLI (`gemini`, default) | CLI (`cli`) |
|---|---|---|
| Thinking steps (measure, adapt, picture checker, art director, fixer, concept, strategist, relation check, label reader, playbook distiller) | Gemini in the signed-in automation Chrome | Local Claude CLI, `claude -p --model opus` |
| Needs | Chrome signed in to Gemini | `claude auth login` |
| Failure | Fails the job with a message naming the method | Same — **no silent fallback** |

The picture engines are identical in both methods (Gemini, Meta AI fallback). Choice order: `ASHADI_AI_JOB` (set per job at start, so a job never switches mid-way) > `web/data/settings.json` (`{"aiMethod": ...}`, written by the header switch) > `ASHADI_AI` env > default `gemini`. **Testing happens in non-CLI; the plan for the other laptop was CLI.** `tools/ig2img/MIGRATION-ASHADI.md` has the details.

## B6. The prompt playbook (learning loop for no-reference jobs)

`lib/promptbook.mjs` records every run (prompt, conditions, outcome, review score 0–100, your Good / Needs-work rating from the Tracker). A distiller turns those entries into lessons (`data/promptbook.json`), and the strategist is given the lessons before it writes a prompt. So no-reference designs improve as reference jobs and feedback accumulate. Version 1 lessons came from 13 entries, mostly one layout — rate more jobs to broaden it.

## B7. The Tracker

One row per job: **From** (Ashadi front end / Telegram / Sithiji + kind), **Job** (description, note, product link), **Status** (updates itself from the pipeline's progress lines: Queued #n, Running with the stage, Done, Failed, Stopped, Interrupted), **Final Canva project** (link + final picture). Stored in `web/data/tracker.json`; after a PC restart, jobs that were queued or running are put back once, up to 5 attempts. Telegram jobs are answered in Telegram; reply **final** after editing in Canva to get your edited version, **retry** to re-send to Canva.

## B8. What runs where (ports and processes)

| Piece | Where | Started by |
|---|---|---|
| Web UI + queue | `127.0.0.1:5041`, `web/server.mjs`, one `child_process.fork` per job (`web/job-runner.mjs`) | `web/start-web.ps1` |
| Telegram bot | `telegram-bot.mjs` (long polling) | `autostart.ps1` |
| Automation Chrome | debug port **9222**, profile `%LOCALAPPDATA%\Google\Chrome\Automation Profile` (signed in to Gemini; Kapruka pages are read through it) | `start-chrome.ps1` |
| Everything above + the Sithiji worker | scheduled task **Kapruka-ig2img-autostart** (at logon and every 5 minutes, ignores a second instance) runs `autostart.ps1` | Task Scheduler |

`autostart.ps1` also restarts the Sithiji worker if it died (step 4). A PC restart kills a running job; the tracker re-queues it.

## B9. Files

| Path | Role |
|---|---|
| `design.mjs` | The pipeline (`runDesign`) |
| `lib/oneflow.mjs` | References, real products, direct/indirect, strategist, layout templates |
| `lib/thinker.mjs` | CLI vs non-CLI switch and runners |
| `lib/designer.mjs` | Adapter and art director |
| `lib/gemini.mjs`, `lib/chrome.mjs` | Driving Gemini and the automation Chrome |
| `lib/layered.mjs` | PPTX builder, text calibration, stacked-text resolver |
| `lib/canva.mjs` | Canva Connect API (import, export, tokens) |
| `lib/promptbook.mjs` | Learning loop |
| `lib/cutout_sheet.py` | rembg cut-outs + product sheet |
| `lib/telegram.mjs`, `telegram-bot.mjs` | Telegram intake and hand-back |
| `web/server.mjs`, `web/job-runner.mjs`, `web/public/*` | Job model, queue, tracker, UI |
| `cache/` | Catalogue snapshot + thumbnails (51 MB) |
| `data/promptbook.json` | Learned lessons |
| `_backup-2026-11-22/` | Copies of files before the 2026-11-22 rebuild |

**Folders Ashadi expects around it** (`lib/env.mjs`: root = three levels above `lib/`): `<root>/.env`, `<root>/.canva-tokens.json`, `<root>/1-foundation/` (brand rules, logos — the pipeline reads these), `<root>/2-roles/`, `<root>/CLAUDE.md` (standing rules), `<root>/tools/package.json` (playwright, pptxgenjs, marked), outputs in `<root>/3-output/ashadi-designs/` and uploads in `3-output/ashadi-inbox/`.

## B10. Standing rules baked in (do not lose in a move)

- Logo within 110 px of the top. Strictly follow Kapruka brand guidelines. The product must look exactly like the original. **100 px margin on all four sides.**
- Font Inter (Canva only honours Regular and Bold). Don't over-localise (no "amma/akka"). Clean feel, never the banned words (premium, luxury, exclusive, high-end, best, leading, biggest, amazing, incredible, premier).
- Real product drawn from its real packshot with the exact label words.
- Gemini is the engine; no Claude CLI by default.

## B11. Secrets (names only)

`CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET` (+ `.canva-tokens.json`, refreshed automatically), `GEMINI_API_KEY`, `OPENAI_API_KEY`, `OPENAI_API_KEY_IG2IMG`, `TELEGRAM_BOT_TOKEN`, `WA_ADMIN_NUMBER`, `WA_PHONE_ID`, `WA_TOKEN`, `WA_VERIFY_TOKEN`. Never commit these; never paste them into chat.

## B12. Known limits (as of 2026-11-22)

- Small label text on product cartons can come out garbled (Gemini drawing flaw).
- Gemini's art-director review is looser than Claude's.
- Canva text editability was checked by structure, not inside the Canva editor (the in-app browser isn't signed in).
- Not yet tested end to end: a CLI-method job (the Claude CLI on this laptop is signed out), the Telegram route after the rebuild, the Sithiji route after the rebuild.
- `rebuildDesign` assumes the raw picture is in `renders/`; it breaks when the scene is a placed file.
- A reference whose hero runs off the edge is placed whole inside the 100 px margin, so it comes out smaller.
- Pinterest can block picture fetches; upload the image instead.

---

# PART C — HOW THEY TALK TO EACH OTHER

1. **Card eligible?** `core.ashadi_fit`: analysed, a still image or carousel, has a picture. Videos and text ideas are refused.
2. **Press Send to Ashadi** → card `ashadi_state = queued` (optional note, 400 chars).
3. **PC worker** (`ashadi_loop`, every 15 s) claims it, downloads up to 6 of the card's own pictures (never Ashadi's own output), and calls `POST http://127.0.0.1:5041/api/sithiji/jobs` with the pictures (base64), source link, caption (title + summary) and the note.
4. Ashadi puts it in its queue and runs the normal pipeline. The worker polls `GET /api/jobs` every 15 s and copies Ashadi's progress message onto the card.
5. When the job is done the worker reads `/api/designs/<run>`, pushes `ashadi_preview_N.png` files and the Canva edit URLs (with verdict and concept notes) to the VPS → card state `done`.
6. **Pull final** → `final_requested` → the worker calls `POST /api/designs/<run>/final`, which exports the edited design from Canva, and pushes `ashadi_final_*.png` onto the card.
7. Failure modes are written on the card in words: "Ashadi isn't running on the PC", "Ashadi lost this job (server restarted)", "nothing reached Canva".

If Ashadi moves, the worker must still reach it: set `ASHADI_URL` (default `http://127.0.0.1:5041`) or keep the port.

---

# PART D — MOVING TO THE NEW PROJECT (same laptop)

The zip is laid out so **both projects share one root** and one `.env`:

```
<NEW ROOT>\
  .env                       <- from KEYS-private\.env (both projects' keys merged)
  .canva-tokens.json         <- from KEYS-private\
  CLAUDE.md, .env.example
  1-foundation\  2-roles\    <- brand material Ashadi reads
  tools\package.json         <- run npm install here
  tools\ig2img\              <- Ashadi
  sithiji\                   <- Sithiji
  scripts\_env.py            <- Sithiji's .env loader (+ deploy scripts)
  run_sithiji.bat, run_sithiji_worker.bat
  3-output\ashadi-designs\   <- past designs
  setup-new-project.ps1      <- does the steps below
  HOW-ASHADI-AND-SITHIJI-WORK.md
```

**Steps**

1. **Stop the old ones** (they use ports 5041 and 9222 and the same Telegram token; two bots on one token fight each other): the Telegram bot, the web server, the Sithiji worker, and the two scheduled tasks (`Kapruka-ig2img-autostart`, `Sithiji Worker`). Don't close the automation Chrome unless you want to — the profile is outside the project and is reused.
2. **Unzip** to the new root. Copy `KEYS-private\.env` to `<root>\.env` and `KEYS-private\.canva-tokens.json` to `<root>\.canva-tokens.json`. Optional: copy `KEYS-private\web-data\tracker.json` and `settings.json` into `tools\ig2img\web\data\` to keep job history and the AI-method choice.
3. Run `setup-new-project.ps1` (installs `npm` and `pip` dependencies; add `-RegisterTasks` to create the two scheduled tasks pointing at the new root). Python: `pip install -r requirements-sithiji.txt`. Extra tools Ashadi needs: Node 22, Python with `rembg` (for cut-outs), Chrome.
4. Start order: automation Chrome (`tools\ig2img\start-chrome.ps1`; first time on a fresh profile also run `setup-profile.ps1` and sign in to Gemini) → `tools\ig2img\web\start-web.ps1` → `node tools\ig2img\telegram-bot.mjs` → `run_sithiji_worker.bat`. (`autostart.ps1` does all of it.)
5. **Prove it** (checklist below), then delete the old copies.

**What does NOT move, because it is not on this laptop**

- The Sithiji web app, bot and database on the VPS stay where they are. Nothing to redeploy unless you change Sithiji's code (then `python scripts\deploy_sithiji_to_vps.py`).
- The WhatsApp forward in `kogul/app_kogul.py` stays in Kogul.
- The Claude Ads Team project itself (other roles, `3-output\reference-recreations`, monthly-run scripts) and the SEO AGENT project are not touched by the zip.

**Things that reference the old folders and must be re-pointed (already done in the zip copies)**

- `autostart.ps1` step 4 used a hard-coded `C:\Users\fari\Desktop\SEO AGENT\run_sithiji_worker.bat` → now relative to the root.
- `run_sithiji_worker.bat` used a hard-coded `pythonw.exe` path → now tries that path, then `pythonw` on PATH.
- The two scheduled tasks point at the old locations until you run `setup-new-project.ps1 -RegisterTasks` and remove the old tasks.

**Checklist**

- [ ] `http://127.0.0.1:5041/api/status` answers and shows the AI method.
- [ ] Header switch shows Non-CLI; a pasted Pinterest link makes a job that reaches Canva.
- [ ] Telegram: send `@Ashadiabot` a link → a queued job appears in the Tracker.
- [ ] `sithiji\data\worker.log` shows `worker started -> https://pricelens.lanka.info/sithiji`.
- [ ] On the Sithiji dashboard the worker shows online; **Send to Ashadi** on a still card → "In Ashadi's queue" → Canva link on the card.
- [ ] Both Telegram bots answer (they are two different bots with two different tokens).

**Traps seen before**

- Windows Update restarts kill a running job (the tracker re-queues it, up to 5 times).
- Gemini can be flaky right after boot; Cloudflare "Just a moment" delays Kapruka pages.
- Two processes polling one Telegram token break both.
- A path with spaces ("Claude Ads Team") must be quoted in `Start-Process`.
- Scheduled tasks must not stop on battery (`StopIfGoingOnBatteries` false) — the existing two are set that way.
- The Chrome Automation profile holds the sign-ins; losing it means signing in to Gemini again.
