# Ashadi web UI

A browser front door to the ig2img pipeline — the same engine as the Telegram bot
(`@Ashadiabot`), driven from a form instead of a chat. It does **not** use Telegram, so it
keeps working when the bot can't reach `api.telegram.org`.

```powershell
powershell -File tools\ig2img\web\start-web.ps1     # then open http://127.0.0.1:5041
```

Or in the foreground: `node tools/ig2img/web/server.mjs`. Add `--demo` for simulated runs
(no Chrome, no image-generation quota used) — handy for trying the UI.

## What it does

| Area | |
|---|---|
| **Create** | The bot's three jobs as tabs — *Recreate a post* (Instagram link), *Ideas* (persona), *Promote* (a Kapruka service/page) — plus an optional creative note and 1–4 count. |
| **Now & next** | Live step tracker (read → prompts → generate & review → finish), the pipeline's own log, queue, cancel for jobs that haven't started. |
| **Results** | Reference vs. generated images grouped by prompt, reviewer pick / "didn't pass review" with the reviewer's reason, full-size preview, download, and the prompt text. |
| **Past runs** | Every folder in `3-output/reference-recreations/` that has a `run.json` (Telegram runs included), filterable by type. |

## How it fits

- Calls `runPipeline()` from `run.mjs` directly with `notify: false` and its own `log`
  function — **no existing file was modified**. Counts map exactly as in `telegram-bot.mjs`
  (recreate: variations per prompt, 2 prompts; ideas/promote: number of prompts).
- **One job at a time**, like the bot. It also **waits while the Telegram bot is mid-job**
  (detected from `tools/logs/ig2img.log`), because both share one automation Chrome.
  The reverse isn't guarded: the bot can't see this page's jobs, so avoid sending the bot a
  job while one is running here.
- A job that's running can't be stopped from the UI (it's mid-way through driving Chrome).
- Output lands in the usual `3-output/reference-recreations/<run>/` folders; re-running the
  same link on the same day reuses that day's folder (same as the bot).

## Security

Binds to `127.0.0.1` only. There is no login, and a job drives your signed-in Chrome and
spends image-generation quota — don't expose it to the network. Requests with a foreign
`Host`/`Origin` are rejected, files are served only from `reference-recreations/` (images,
`.md`, `.txt`), and the page has a strict Content-Security-Policy.

## Files

`server.mjs` (API, queue, SSE, static) · `public/` (`index.html`, `app.css`, `app.js`) ·
`start-web.ps1`. Logs: `tools/logs/web.log`, `web-stdout.log`, `web-stderr.log`.
Port override: `IG2IMG_WEB_PORT`.
