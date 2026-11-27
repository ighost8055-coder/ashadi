// web/hub-worker.mjs — the laptop side of the VPS hub (https://pricelens.lanka.info/ashadi).
//
// This process only makes OUTBOUND https calls to the hub, so the laptop needs no open port and no public address.
// Every few seconds it:
//   1. reads the local engine (web/server.mjs on 127.0.0.1:5041): status, tracker rows, live job logs
//   2. sends those to the hub, and receives (a) new jobs the hub queued, (b) commands (stop / retry / resume / final …)
//   3. hands new jobs to the local engine under the SAME id (body.hubId), so one job = one row everywhere
//   4. uploads finished designs' pictures + design.json to the hub so the VPS page can show them
// Chrome, Gemini, Canva and Telegram never leave the laptop; the local engine does all of that exactly as before.
//
// .env keys (project root): ASHADI_HUB_URL=https://pricelens.lanka.info/ashadi   ASHADI_WORKER_KEY=<same as hub>
//                           ASHADI_LOCAL_URL=http://127.0.0.1:5041 (optional)
// Run:  node tools/ig2img/web/hub-worker.mjs        (autostart.ps1 / run_hub_worker.bat start it)
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, appendFileSync, renameSync } from 'node:fs';
import { join, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDefaultResultOrder } from 'node:dns';

setDefaultResultOrder('ipv4first');
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const DATA_DIR = process.env.ASHADI_WORKER_DATA || join(HERE, 'data');
const LOG_DIR = join(ROOT, 'tools', 'logs');
const STATE_FILE = join(DATA_DIR, 'hub-sync-state.json');
const DESIGN_DIR = process.env.ASHADI_DESIGN_DIR || join(ROOT, '3-output', 'ashadi-designs');
mkdirSync(DATA_DIR, { recursive: true }); mkdirSync(LOG_DIR, { recursive: true });

const env = {};
try {
  for (const raw of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = raw.trim().match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && !raw.trim().startsWith('#')) env[m[1]] = m[2].trim().replace(/;$/, '').replace(/^["']|["']$/g, '');
  }
} catch { /* handled below */ }
const cfg = (k, d = '') => process.env[k] ?? env[k] ?? d;
const HUB = cfg('ASHADI_HUB_URL').replace(/\/+$/, '');
const KEY = cfg('ASHADI_WORKER_KEY');
const LOCAL = cfg('ASHADI_LOCAL_URL', 'http://127.0.0.1:5041').replace(/\/+$/, '');
if (!HUB || !KEY) { console.error('hub-worker: set ASHADI_HUB_URL and ASHADI_WORKER_KEY in the project .env'); process.exit(1); }
if (!/^https:\/\//.test(HUB) && !/^http:\/\/(127\.0\.0\.1|localhost)/.test(HUB)) { console.error('hub-worker: ASHADI_HUB_URL must be https:// (or a localhost test address)'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wlog = (...a) => { const line = `[${new Date().toISOString()}] ${a.join(' ')}`; console.log(line); try { appendFileSync(join(LOG_DIR, 'hub-worker.log'), `${line}\n`); } catch {} };

// ---- tiny HTTP helpers ----
async function hub(path, { method = 'GET', body, raw, headers = {}, timeout = 60_000 } = {}) {
  const res = await fetch(HUB + path, {
    method, signal: AbortSignal.timeout(timeout),
    headers: { 'X-Worker-Key': KEY, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {}; try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text.slice(0, 200) }; }
  if (!res.ok) throw Object.assign(new Error(data.error || `hub HTTP ${res.status}`), { status: res.status });
  return data;
}
async function local(method, path, body, timeout = 170_000) {
  const res = await fetch(LOCAL + path, {
    method, signal: AbortSignal.timeout(timeout),
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {}; try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text.slice(0, 200) }; }
  return { status: res.status, body: data };
}

// ---- what the hub may ask this laptop to do (nothing else is ever forwarded) ----
const ALLOWED_CMDS = [
  ['POST', /^\/api\/settings$/],
  ['DELETE', /^\/api\/jobs\/[0-9a-f-]{36}$/],
  ['POST', /^\/api\/jobs\/[0-9a-f-]{36}\/(retry|resume|feedback)$/],
  ['DELETE', /^\/api\/tracker\/[0-9a-f-]{36}$/],
  ['POST', /^\/api\/designs\/[\w.%-]+\/(final|retry-canva)$/],
];
const cmdAllowed = (c) => ALLOWED_CMDS.some(([m, re]) => c.method === m && re.test(c.path));

// ---- sync state ----
let syncState = { files: {} };
try { syncState = JSON.parse(readFileSync(STATE_FILE, 'utf8')); syncState.files ||= {}; } catch { /* first run */ }
const saveState = () => { try { const t = `${STATE_FILE}.tmp`; writeFileSync(t, JSON.stringify(syncState)); renameSync(t, STATE_FILE); } catch (e) { wlog(`state save failed: ${e.message}`); } };

const sentHash = new Map();       // row id -> JSON last accepted by the hub
const logPos = new Map();         // job id -> { n, last } already sent
let pendingAcks = [];
let pendingResults = [];
const handled = new Set();        // hub job ids already handed to the local engine

// ---- uploading finished designs ----
const OK_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.md', '.txt', '.json']);
let uploading = false;
function* walk(dir, rel = '', depth = 0) {
  let ents = [];
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (depth < 4) yield* walk(join(dir, e.name), r, depth + 1); }
    else if (e.isFile() && OK_EXT.has(extname(e.name).toLowerCase())) yield r;
  }
}
async function uploadDesigns() {
  if (uploading || !existsSync(DESIGN_DIR)) return 0;
  uploading = true; let n = 0; let skipped = 0;
  try {
    const dirs = readdirSync(DESIGN_DIR, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_') && /^[\w.-]+$/.test(d.name))
      .map((d) => ({ name: d.name, t: (() => { try { return statSync(join(DESIGN_DIR, d.name)).mtimeMs; } catch { return 0; } })() })).sort((a, b) => b.t - a.t);
    const todo = [];
    for (const d of dirs) {
      for (const rel of walk(join(DESIGN_DIR, d.name))) {
        const abs = join(DESIGN_DIR, d.name, ...rel.split('/'));
        let st; try { st = statSync(abs); } catch { continue; }
        if (Date.now() - st.mtimeMs < 3000) continue;                       // still being written
        const key = `${d.name}/${rel}`; const sig = `${Math.floor(st.mtimeMs)}:${st.size}`;
        if (syncState.files[key] === sig) continue;
        if (st.size > 24 * 1024 * 1024 || !rel.split('/').every((s) => /^[\w. -]+$/.test(s))) { syncState.files[key] = sig; skipped++; continue; }
        todo.push({ d: d.name, rel, abs, key, sig, mt: Math.floor(st.mtimeMs) });
      }
    }
    let i = 0;
    const lane = async () => {
      while (i < todo.length) {
        const f = todo[i++];
        try {
          await hub(`/api/worker/file/${encodeURIComponent(f.d)}/${f.rel.split('/').map(encodeURIComponent).join('/')}`, { method: 'PUT', raw: readFileSync(f.abs), headers: { 'Content-Type': 'application/octet-stream', 'X-Mtime': String(f.mt) }, timeout: 180_000 });
          syncState.files[f.key] = f.sig; n++;
          if (n % 25 === 0) saveState();
        } catch (e) {
          if (e.status === 400 || e.status === 415) { syncState.files[f.key] = f.sig; skipped++; wlog(`upload skipped ${f.key}: ${e.message}`); }
          else wlog(`upload failed ${f.key}: ${e.message}`);
        }
      }
    };
    await Promise.all([lane(), lane(), lane()]);
    if (n || skipped) { saveState(); wlog(`designs: uploaded ${n} file(s), skipped ${skipped}`); }
  } catch (e) { wlog(`upload pass failed: ${e.message}`); }
  finally { uploading = false; }
  return n;
}

// ---- local engine reading ----
function newLines(id, L) {
  const st = logPos.get(id) || { n: 0, last: null };
  let from;
  if (L.length >= 400 && st.last !== null) { const i = L.lastIndexOf(st.last); from = i >= 0 ? i + 1 : 0; }
  else from = Math.min(st.n, L.length);
  return { lines: L.slice(from), commit: { n: L.length, last: L.length ? L[L.length - 1] : null } };
}

async function submit(job) {
  if (handled.has(job.id)) { pendingAcks.push({ id: job.id, ok: true }); return; }
  try {
    const tr = await local('GET', '/api/tracker');
    if ((tr.body.rows || []).some((r) => r.id === job.id)) { handled.add(job.id); pendingAcks.push({ id: job.id, ok: true }); return; }
    const r = await local('POST', '/api/jobs', job.body, 120_000);
    if (r.status < 300) { handled.add(job.id); pendingAcks.push({ id: job.id, ok: true }); wlog(`${job.id.slice(0, 8)} started on this laptop`); }
    else { pendingAcks.push({ id: job.id, ok: false, error: r.body.error || `local engine said HTTP ${r.status}` }); wlog(`${job.id.slice(0, 8)} refused: ${r.body.error}`); }
  } catch (e) { wlog(`${job.id.slice(0, 8)} could not reach the local engine: ${e.message}`); /* no ack: the hub gives it back after 5 min */ }
}

async function runCommand(c) {
  if (!cmdAllowed(c)) { pendingResults.push({ id: c.id, status: 403, body: { error: 'That command is not allowed.' } }); wlog(`refused command ${c.method} ${c.path}`); return; }
  try {
    const r = await local(c.method, c.path, c.body ?? (c.method === 'POST' ? {} : undefined));
    if (/\/(final|retry-canva)$/.test(c.path) && r.status < 400) { await uploadDesigns(); }
    pendingResults.push({ id: c.id, status: r.status, body: r.body });
    wlog(`command ${c.method} ${c.path} -> ${r.status}`);
  } catch (e) { pendingResults.push({ id: c.id, status: 502, body: { error: `The laptop's engine did not answer: ${e.message}` } }); }
}

let lastOk = 0; let failures = 0;
async function tick() {
  let status = { localDown: true }; let rows = []; let live = [];
  try {
    const [s, t, j] = await Promise.all([local('GET', '/api/status', undefined, 15_000), local('GET', '/api/tracker', undefined, 15_000), local('GET', '/api/jobs', undefined, 15_000)]);
    if (s.status === 200) status = s.body;
    rows = t.body.rows || []; live = j.body.jobs || [];
  } catch { /* local engine down: tell the hub, send no rows */ }

  const rowsOut = rows.filter((r) => sentHash.get(r.id) !== JSON.stringify(r));
  const logsOut = []; const commits = [];
  for (const j of live) {
    const { lines, commit } = newLines(j.id, j.log || []);
    if (lines.length) logsOut.push({ id: j.id, lines });
    commits.push([j.id, commit]);
  }
  const active = rows.filter((r) => ['queued', 'waiting', 'running'].includes(r.status)).length;
  const free = status.localDown ? 0 : Math.max(0, 2 - active);
  const acks = pendingAcks; const results = pendingResults;
  pendingAcks = []; pendingResults = [];
  let resp;
  try {
    resp = await hub('/api/worker/sync', { method: 'POST', body: { status, rows: rowsOut, logs: logsOut, acks, results, free } });
  } catch (e) {
    pendingAcks = acks.concat(pendingAcks); pendingResults = results.concat(pendingResults);
    failures++; if (failures === 1 || failures % 20 === 0) wlog(`hub unreachable: ${e.message}`);
    return false;
  }
  if (failures) wlog(`hub reachable again after ${failures} failed attempt(s)`);
  failures = 0; lastOk = Date.now();
  for (const r of rowsOut) sentHash.set(r.id, JSON.stringify(r));
  for (const [id, c] of commits) logPos.set(id, c);
  for (const job of resp.jobs || []) await submit(job);
  for (const c of resp.commands || []) runCommand(c);              // not awaited: a slow Canva pull must not stall syncing
  return (resp.jobs?.length || resp.commands?.length || active || rowsOut.length) > 0;
}

let stopping = false;
process.on('SIGINT', () => { stopping = true; saveState(); process.exit(0); });
process.on('SIGTERM', () => { stopping = true; saveState(); process.exit(0); });
wlog(`hub worker started: hub=${HUB} local=${LOCAL}`);
setTimeout(() => uploadDesigns(), 5_000);
setInterval(() => { if (Date.now() - lastOk < 60_000) uploadDesigns(); }, 12_000);
for (;;) {
  let busy = false;
  try { busy = await tick(); } catch (e) { wlog(`tick error: ${e.message}`); }
  if (stopping) break;
  await sleep(failures ? Math.min(30_000, 3_000 * failures) : busy ? 2_500 : 5_000);
}
