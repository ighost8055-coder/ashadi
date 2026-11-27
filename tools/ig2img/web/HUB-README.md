# Ashadi hub + worker (developer notes)

Files: `hub.mjs` (VPS, node, no pipeline code), `hub-worker.mjs` (laptop), `server.mjs` (the unchanged local engine + one tiny change: `POST /api/jobs` accepts `hubId`).
Deploy: `python scripts/deploy_ashadi_hub_to_vps.py --help`. User-facing docs: the `MIGRATION-PACK-v2` folder.

## Flow
browser/Facebook tool → hub `POST /api/jobs` (queued, stored with `_spec`) → worker `POST /api/worker/sync` every 2.5–5 s →
hub returns `jobs:[{id, body}]` (only when the laptop reports `free > 0`) → worker `POST 127.0.0.1:5041/api/jobs` with `body.hubId = id` →
engine runs it under that id → worker mirrors `/api/tracker` rows (only changed ones, hash per row), new log lines and `/api/status`
→ worker uploads design files to `PUT /api/worker/file/<run>/<path>` → hub serves `/dfiles/…`.

## Commands (hub → laptop)
`rpc()` queues `{method,path,body}`; the worker runs it against the engine only if it matches the allow-list in `hub-worker.mjs` (`ALLOWED_CMDS`) and answers in its next sync. The browser request waits ≤105 s (IIS proxy limit ~120 s).

## Auth
Browser: HTTP Basic (`ASHADI_HUB_USER/PASSWORD`) + `Origin` must be an allowed host for POST/DELETE. Worker: `X-Worker-Key`. Facebook tool: `X-Hub-Key` (`ASHADI_HUB_API_KEY`), only for `POST /api/jobs` and `GET /api/tracker`. `/healthz` is open (no data).

## Hub state
`data/hub-state.json` (rows, deleted ids, pending housekeeping commands), `designs/`, `inbox/`, `logs/`.
Private row fields start with `_` and are never sent to browsers.

## Test without the real engine
Run `hub.mjs` with `ASHADI_HUB_HOME=<tmp>` (a `.env` + copy of `public/` in it) on another port, a stub engine, and `hub-worker.mjs` with
`ASHADI_HUB_URL`, `ASHADI_WORKER_KEY`, `ASHADI_LOCAL_URL`, `ASHADI_DESIGN_DIR`, `ASHADI_WORKER_DATA` set to test values.
