# ig2img — the Telegram ad-recreation pipeline

What this is: a Telegram bot that takes a message from you (a link, a persona
name, or a thing to promote), runs it through the same Reference Recreator
role the human-run Claude Code sessions use, generates real images on three
different engines, reviews them, regenerates on defects, and sends the best
result back to you on Telegram — all with no manual step in between.

## The three modes

The bot classifies every incoming message (via a small Haiku call in
`lib/classify.mjs`) into one of three jobs:

1. **`recreate`** — you send an Instagram link (optionally with an
   instruction like "swap the cake for a watch"). The pipeline scrapes the
   post, then writes two prompts: a faithful copy of the reference, and
   either your instruction applied or the Recreator's own second take.
2. **`idea`** — you ask for ideas for a named persona ("ideas for corporate
   gifting"), no reference image. The pipeline originates ideas from
   scratch using the persona docs, occasion calendar, and desire engine.
3. **`promote`** — you ask to promote a specific Kapruka service/feature/page.
   The pipeline verifies the claim against `01-business-context.md`'s
   confirmed proof stats before writing anything, so it can't launder an
   unapproved claim into an ad.

All three converge on the same output shape and the same generation/review
pipeline below.

## Pipeline stages (`run.mjs` → `runPipeline()`)

```
[1] Instagram scrape (recreate mode only) — lib/ig.mjs
      ↓
[2] Reference Recreator — lib/prompt.mjs
      headless `claude -p --model opus`, reads CLAUDE.md + the role file +
      foundation docs, writes 1-N paste-ready prompts (450-600 words each,
      raised from 250-350 on 2026-09-01 — see "Prompt depth" below)
      ↓
[3] Generate + review — run.mjs + lib/chatgpt.mjs + lib/flow.mjs + lib/meta.mjs
      + lib/review.mjs
      Every prompt runs on ALL THREE engines in parallel (ChatGPT + Flow
      "Nano Banana Pro" + Meta AI), on separate tabs of the same automation
      Chrome instance. ChatGPT is primary (2026-09-14); Flow and Meta AI stay
      wired in as fallbacks for whatever ChatGPT's filter refuses or a UI
      change breaks. Each engine's candidates go through an automated reviewer (headless
      Opus) that checks against a real checklist — flowers, hands, text,
      logo, palette, dead space, brand-lookalike risk, typography — and
      fails/regenerates once with the specific defect fed back as a steer.
      ↓
[4] Send — telegram-bot.mjs / lib/telegram.mjs
      Best-passing image per prompt per engine gets sent. Anything that
      never fully passed review still gets sent, but flagged with a
      ⚠️ note naming the reason, rather than silently withheld.
```

## Key files

| File | Role |
|---|---|
| `telegram-bot.mjs` | Long-polls Telegram, classifies each message, routes to `runPipeline()` |
| `lib/classify.mjs` | Haiku call that decides recreate/idea/promote + extracts link/persona/thing/instruction |
| `lib/prompt.mjs` | The Reference Recreator — builds the paste-ready image-gen prompts (Opus) |
| `lib/review.mjs` | The automated reviewer — checks generated images against a real checklist (Opus) |
| `lib/chatgpt.mjs` | Drives ChatGPT (primary engine) over the same Chrome CDP connection |
| `lib/flow.mjs` / `lib/meta.mjs` | Drive Flow and Meta AI (fallback engines) over the same Chrome CDP connection |
| `lib/chrome.mjs` | Chrome automation profile connection (per-call `newPage()`, safe for concurrent tabs) |
| `lib/ig.mjs` | Instagram slide/caption scraper |
| `lib/telegram.mjs` | Real Telegram send functions (text + image) |
| `run.mjs` | Orchestrates the whole pipeline; also has a CLI entrypoint (`--variations`, `--max-prompts`, `--engine`, `--reuse`, `--no-wa`) — **no `--channel`/`--to` flags**, so a manual CLI run defaults to WhatsApp, not Telegram |
| `autostart.ps1` | Brings up automation Chrome + the bot; safe to re-run (checks before starting anything) |
| `_master-ad-prompt.md` (in `1-foundation/references/brand-assets/`) | The premium-ad quality baseline (added 2026-10-12). Listed in all three modes' READ-FIRST lists plus a `SHARED_RULES` block: the Recreator must meet its §1-§9 and run its §10 QC on the draft **before** writing the final image prompt. Rulebook wins on conflict. |
| `_STANDING-SPEC.md` (in `3-output/reference-recreations/`) | The full brand rulebook pasted above every prompt, in full, per Hard Rule 13 |

## Running / keeping it alive

- **Manual start:** `powershell -File tools/ig2img/autostart.ps1` — starts
  automation Chrome (port 9222) if not already up, then the Telegram bot if
  not already running.
- **Scheduled task:** `Kapruka-ig2img-autostart` runs `autostart.ps1` on
  Windows logon **and now also every 5 minutes** (added 2026-09-02, after a
  ~19-hour outage where the bot silently died and nothing restarted it or
  left a trace). Since `autostart.ps1` is idempotent, running it repeatedly
  is safe — it just closes the detection gap.
- **Logs:** `tools/logs/ig2img.log` (the pipeline's own structured log),
  `tools/logs/bot-stdout.log` / `bot-stderr.log` (raw process output,
  captures a hard crash that the structured log would miss).
- **Chrome:** must stay signed in to Instagram + the two image-gen engines
  in the automation profile. Datacenter/VPS IPs get blocked by Meta AI's
  login — this only runs reliably on the local PC (confirmed 2026-08-31).

## Notable design decisions (with the reasoning, so they don't get re-litigated)

- **Both engines always, not fallback.** `run.mjs` fires Flow and Meta AI in
  genuine parallel for every prompt and sends both results — not
  first-success-wins — because each engine has different strengths (Flow
  is more faithful to exact multi-panel layout geometry; Meta AI reads the
  `Product (kapruka.com):` URL and returns the real branded item where Flow
  returns a generic one).
- **3:4 (1080×1440), not 4:5.** Flow's composer is hardcoded to render 3:4
  regardless of what the prompt claims — a 4:5-composed prompt was fighting
  the frame it actually got rendered into, causing ~35% dead space at the
  bottom of real generated images. Fixed 2026-09-01 across `prompt.mjs` and
  the standing spec.
- **Opus, not Sonnet, for both the Recreator and the Reviewer.** A Sonnet
  default (chosen 2026-08-28 for speed) was flagged as a real, measurable
  quality gap versus a manual Opus-run Claude Code session doing the same
  role. Reverted 2026-09-01. Costs ~3 more minutes per prompt; the
  documented role files always specified Opus.
- **Prompt depth: 450-600 words, not 250-350.** The original cap
  (2026-08-xx) was meant to stop the image model from "rendering the prompt
  text instead of following it," but proved thinner than what actually gets
  good renders — a manual, unrushed session naturally lands around 450-600.
  Raised 2026-09-01, with the extra length required to go specifically into
  material/surface texture (Product line) and lighting behavior (CAMERA
  line), not padding elsewhere.
- **Generate → review → regenerate-once-with-defect-note → send-best,
  flagged if imperfect.** Built 2026-08-31/09-01 after a live case of fake-
  looking flowers reaching Telegram unflagged. The reviewer is honest about
  its own limits (flower-uniformity judgment is acknowledged as imperfect —
  ship-as-is was a deliberate call, not an oversight).
- **No chat-ID allowlist, by design.** Anyone who has the bot's Telegram
  handle can trigger generation — confirmed as an intentional choice
  (2026-09-02), not a gap to close, presumably because this is shared with
  a small team. A request asking to depict real, identifiable people
  (celebrity likeness) was manually killed on sight rather than allowed to
  generate — that boundary is enforced by judgment at request time, not by
  a code-level filter, so it's worth staying alert to messages like that
  coming from unfamiliar senders.

## Known limitations

- The reviewer's flower-uniformity check is real but imperfect — it catches
  most synthetic-flower cases but has been seen to miss the specific
  failure mode of a densely-clustered small filler flower (chrysanthemums)
  reading as uniform even when it correctly fails the same image for an
  unrelated defect. Flag real slip-throughs with concrete examples rather
  than further blind prompt-tuning.
- Instagram scraping falls back to the embed view when the automation
  profile is logged out of Instagram — this loses multi-slide carousels
  (only slide 1 comes through).
- The CLI entrypoint (`node run.mjs <url> ...`) has no `--channel`/`--to`
  flags and defaults to WhatsApp. To retry/re-run a specific request to a
  specific Telegram chat, call `runPipeline()` directly from a small script
  rather than the CLI.
