# ig2img — WhatsApp an Instagram link, get Kapruka creatives back

**You send** an Instagram post link + the word `create` to **070 117 8279**.
**You get back** the finished images in the same WhatsApp thread.

```
WhatsApp msg ──▶ Cloudflare Tunnel ──▶ webhook.mjs ──▶ run.mjs
                                                         │
                    ┌────────────────────────────────────┤
                    ▼                ▼                   ▼
              Instagram          Reference        Flow / ChatGPT
              (your Chrome)      Recreator        (your Chrome)
              slides + caption   (claude -p)      images -> 1080x1350
                                       │                 │
                                       └──────▶ WhatsApp ◀┘
```

Everything runs in **a real Chrome window on this machine**, signed in to your own
Google/Flow, ChatGPT and Instagram accounts — that's what keeps these sites from
treating it as a bot, and it means generation uses your existing plan, not an API key.

---

## One-time setup

### 1. Build the automation Chrome profile

```powershell
powershell -File tools\ig2img\setup-profile.ps1
```

> **Why a separate profile?** Chrome 136+ refuses to open the `--remote-debugging-port`
> when the profile folder is your default Chrome one — a deliberate defence against
> cookie theft. So the automation gets its own folder,
> `%LOCALAPPDATA%\Google\Chrome\Automation Profile`. The upside: your everyday Chrome
> can stay open the whole time and the two never fight over the profile lock.

### 2. Sign in, once

```powershell
powershell -File tools\ig2img\start-chrome.ps1
node tools\ig2img\doctor.mjs
```

`doctor` opens **chatgpt.com** and **instagram.com** in the automation window and reports
`OK` / `FAIL` for each. Sign in to whichever says FAIL, then re-run `doctor` until both
are OK. Those logins persist in that profile from then on.

> Chrome encrypts cookies against the profile that created them (App-Bound Encryption),
> so a login genuinely cannot be copied across from your normal profile — signing in
> once here is the only way, and it's the only manual step in the whole setup.

### 3. Point Meta's webhook at this machine

```powershell
powershell -File tools\ig2img\start.ps1
```

It installs `cloudflared` if missing, starts Chrome with the debug port, starts the
webhook, opens the tunnel, and prints a public URL like
`https://random-words.trycloudflare.com/webhook`.

Then, at **developers.facebook.com → your app → WhatsApp → Configuration**:

| Field | Value |
|---|---|
| Callback URL | the printed `https://….trycloudflare.com/webhook` |
| Verify token | `<the WA_VERIFY_TOKEN value from .env>` (must match `WA_VERIFY_TOKEN` in `.env`) |
| Webhook fields | tick **messages** |

Click **Verify and save** — it should go green immediately.

> ⚠️ **The free tunnel URL changes every restart.** For a URL that survives reboots,
> set up a *named* tunnel once (needs a domain on Cloudflare):
> `cloudflared tunnel login` → `cloudflared tunnel create kapruka` →
> `cloudflared tunnel route dns kapruka ig.yourdomain.com` →
> `cloudflared tunnel run --url http://127.0.0.1:8787 kapruka`.
> Then the Meta callback URL never needs touching again.

---

## Daily use

1. `powershell -File tools\ig2img\start.ps1` (after a reboot — otherwise it's already up).
2. WhatsApp the link:

   > `create https://www.instagram.com/p/DcdTkTDtqjH/`

3. Watch the replies: *reading the post* → *prompts ready* → the images.

**Message options**

| You type | What happens |
|---|---|
| `create <link>` | generates in **Flow** (the default engine) |
| `create chatgpt <link>` | forces ChatGPT instead |
| `create x3 <link>` | 3 variations of each prompt |
| a link with no `create` | it asks you to add the word — nothing runs |

### The two image engines

Runs try **Flow first, then ChatGPT** — and either can be forced (`--engine`, or the
word `chatgpt` in the WhatsApp message).

| | Flow (Google Labs) | ChatGPT |
|---|---|---|
| Account in the automation profile | **PRO** ✅ | **Free** — cannot generate images ❌ |
| Model | Nano Banana 2, **3 variants per submit** | GPT image |
| Native output | 896×1200 (3:4) | 1024×1536 (2:3) |

**Flow is the default because it's the account that actually works.** To use ChatGPT,
sign the automation profile into your **Pro** ChatGPT account (it's currently signed
in as a free one) — see `doctor.mjs`.

> **On the 4:5 invariant:** neither tool can output 1080×1350 natively — Flow offers
> 16:9 / 4:3 / 1:1 / 3:4 / 9:16, ChatGPT does 2:3. So each render is **cropped to exactly
> 1080×1350**, taking the crop **from the top**, where these compositions carry headroom —
> the bottom of the frame holds the text card and logo and must survive intact. The
> uncropped original is kept beside it as `*-raw.jpg`, so nothing is lost.

Carousels: every slide is read. If the slides are genuinely different designs you get
a prompt each (max 2 by default); if they're one design, you get one prompt.

---

## Running it by hand (no WhatsApp)

```bash
node tools/ig2img/run.mjs "https://www.instagram.com/p/DcdTkTDtqjH/"            # full run
node tools/ig2img/run.mjs "<url>" --variations 2 --max-prompts 1 --no-wa        # local only
```

---

## Where things land

```
3-output/reference-recreations/ig-<date>-<postid>/
  reference/ig-01.jpg …        the Instagram slides
  prompt-body.md               what the Reference Recreator wrote
  paste-01.txt …               standing spec + prompt — exactly what was pasted in
  recreation-prompts.md        the filed record
  renders/p01-flow-01.png      the deliverable, cropped to 1080×1350
  renders/p01-flow-01-raw.jpg  the uncropped original from the generator
  run.json                     what happened
```

Logs: `tools/logs/ig2img.log` (pipeline) and `tools/logs/cloudflared.log` (tunnel).

---

## When it breaks

**First stop for anything browser-related: `node tools\ig2img\doctor.mjs`.**

| Symptom | Fix |
|---|---|
| `Chrome is not exposing the debug port` | `powershell -File tools\ig2img\start-chrome.ps1`. If it still won't open, the profile folder is wrong — Chrome 136+ blocks the port on the *default* profile folder, so `--user-data-dir` must be the Automation Profile. |
| `Instagram redirected to the login page` / `logged out` | Sign in at instagram.com in the automation window, then re-run `doctor`. Logged out still reads public single-image posts, but **carousels only give slide 1**. Private accounts can't be read at all. |
| `ChatGPT is logged out` | Sign in at chatgpt.com in the automation window, then re-run `doctor`. |
| `ChatGPT produced no image` | Most likely the **free tier** — it replies with text instead of an image. Sign in with the Pro account, or just let it fall through to Flow. |
| `Flow produced no image` | Open the Flow project in that window and check the composer still says **Nano Banana 2** — if it's on a video model, the run returns video, not images. |
| Prompt says `HTTP 429` from kapruka.com | The site rate-limited the product lookup, so the product was described from listing text, not its photo. Re-run, or check the named listing by hand before generating. |
| `could not find the composer` | The site changed its DOM. Selector lists sit at the top of `lib/chatgpt.mjs` / `lib/flow.mjs` — add the new one there. (Note for Flow: the first `<textarea>` on its page is a hidden reCAPTCHA field, never the composer.) |
| `24h window closed` | WhatsApp only allows free-form replies within 24h of *your* last message. Send anything to the number and retry. |
| Nothing happens at all | `curl http://127.0.0.1:8787/health`. If that's fine, the tunnel URL changed — re-run `start.ps1` and update the Meta callback URL. |

---

## The rules this obeys

The prompt is written by the real **Reference Recreator** (`2-roles/12-reference-recreator.md`)
running headless, with the repo as its working directory — so `CLAUDE.md`, the image-gen
rulebook and the copy register all load exactly as they do in a normal session. In particular:

- **Hard Rule 13** — the UNIFIED STANDING SPEC is prepended **in code**, not by the model,
  so it can never come out abridged.
- **Hard Rule 14** — the reference's *construction* is borrowed, never its voice; all copy is
  rewritten in basic English for Sri Lankan / desi families.
- This track **never** feeds the Build Sheet and is never picked at the human pick gate.
