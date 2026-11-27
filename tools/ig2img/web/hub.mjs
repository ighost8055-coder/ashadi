// web/hub.mjs — the VPS "hub" for Ashadi (https://pricelens.lanka.info/ashadi).
//
// The hub NEVER drives a browser. It serves the same page as the laptop's web UI, keeps the job queue and tracker,
// stores finished designs, and hands queued jobs to the laptop WORKER (web/hub-worker.mjs), which feeds them to the
// normal local engine (web/server.mjs on 127.0.0.1:5041: Chrome, Gemini, Canva, Telegram all stay on the laptop).
//
//   browser ──► IIS /ashadi/ ──► hub (127.0.0.1:5081) ◄── worker (laptop, outbound HTTPS only) ──► local engine
//
// Security (this is public, unlike the local server):
//  * HTTP Basic auth on everything except /healthz and /api/worker/* (those need the worker key).
//  * Facebook Ads Tool (same VPS) may POST /api/jobs and GET /api/tracker with the X-Hub-Key header.
//  * Every state-changing browser request must carry an Origin that is this site (no cross-site "click a link").
//  * Files are served only from the designs folder, images + md/txt only. No pipeline code, no keys, no Chrome here.
// Env (hub .env): ASHADI_HUB_USER, ASHADI_HUB_PASSWORD, ASHADI_WORKER_KEY, ASHADI_HUB_API_KEY,
//                 ASHADI_BASE_PATH (/ashadi), ASHADI_HUB_PORT (5081), ASHADI_ALLOWED_HOSTS (comma list).
import http from 'node:http';
import {
  readFileSync, readdirSync, existsSync, statSync, createReadStream, appendFileSync, mkdirSync,
  writeFileSync, createWriteStream, renameSync, utimesSync, rmSync,
} from 'node:fs';
import { join, resolve, extname, sep, isAbsolute, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, timingSafeEqual } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOME = resolve(process.env.ASHADI_HUB_HOME || HERE);
const PUBLIC_DIR = join(HOME, 'public');

// ---- config (.env next to the hub; real environment wins) ----
const fileEnv = {};
try {
  for (const raw of readFileSync(join(HOME, '.env'), 'utf8').split(/\r?\n/)) {
    const m = raw.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && !raw.trim().startsWith('#')) fileEnv[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
} catch { /* no .env: refuse to start below */ }
const cfg = (k, d = '') => process.env[k] ?? fileEnv[k] ?? d;

const PORT = Number(cfg('ASHADI_HUB_PORT', '5081'));
const HOST = '127.0.0.1';
const BASE = (cfg('ASHADI_BASE_PATH', '/ashadi') || '').replace(/\/+$/, '');
const HUB_USER = cfg('ASHADI_HUB_USER', 'kapruka');
const HUB_PASSWORD = cfg('ASHADI_HUB_PASSWORD');
const WORKER_KEY = cfg('ASHADI_WORKER_KEY');
const API_KEY = cfg('ASHADI_HUB_API_KEY');
// OPEN=1 (set by deploy --open): the page and API need no sign-in. The worker key is ALWAYS required for /api/worker/*.
const OPEN = cfg('ASHADI_HUB_OPEN') === '1';
if ((!OPEN && (!HUB_PASSWORD || HUB_PASSWORD.length < 12)) || !WORKER_KEY || WORKER_KEY.length < 24) {
  console.error('hub: ASHADI_HUB_PASSWORD (12+ chars) and ASHADI_WORKER_KEY (24+ chars) must be set in the hub .env. Refusing to start without them.');
  process.exit(1);
}
const ALLOWED_HOSTS = new Set(String(cfg('ASHADI_ALLOWED_HOSTS', 'pricelens.lanka.info')).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
// The IIS rewrite may forward Host as localhost:<port>; that is this machine, not an outsider.
ALLOWED_HOSTS.add(`localhost:${PORT}`); ALLOWED_HOSTS.add(`127.0.0.1:${PORT}`);

const DESIGN_DIR = join(HOME, 'designs');
const INBOX_DIR = join(HOME, 'inbox');
const DATA_DIR = join(HOME, 'data');
const LOG_DIR = join(HOME, 'logs');
const STATE_FILE = join(DATA_DIR, 'hub-state.json');
for (const d of [DESIGN_DIR, INBOX_DIR, DATA_DIR, LOG_DIR]) mkdirSync(d, { recursive: true });
const wlog = (...a) => { try { appendFileSync(join(LOG_DIR, 'hub.log'), `[${new Date().toISOString()}] ${a.join(' ')}\n`); } catch {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clampInt = (v, lo, hi, d) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d));

// Same pattern + canonical form as normaliseIgUrl() in lib/ig.mjs, so a pasted
// "create https://…/p/X/?utm_source=…" and the clean link are recognised as the same post.
const IG_RE = /instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i;

const REF_LINK_OK = (s) => IG_RE.test(s) || /pinterest\.[a-z.]+\/pin\/|pin\.it\//i.test(s) || /^https?:\/\/\S+\.(?:png|jpe?g|webp)(?:\?\S*)?$/i.test(s);
const KAPRUKA_URL_RE = /^https?:\/\/(?:www\.)?kapruka\.com\//i;
const short = (s, n = 60) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

/**
 * One job per reference (human rule 2026-11-22: "number of references = number of images to create"). The Design,
 * Persona promotion and Promote tabs all accept references (up to 3: links or uploaded images) and an optional
 * Kapruka product or category link; with no reference, persona/promote jobs go to the strategist.
 */
function buildJobs(b) {
  if (!b || typeof b !== 'object') return { error: 'Bad request.' };
  const tab = b.mode === 'recreate' ? 'design' : b.mode;
  if (!['design', 'idea', 'promote'].includes(tab)) return { error: 'Pick what you want to do first.' };
  const kind = tab === 'design' ? 'reference' : tab === 'idea' ? 'persona' : 'promote';
  const text = String(b.source ?? '').trim();
  const instruction = String(b.instruction ?? '').trim();
  if (instruction.length > 3000) return { error: 'The creative note is too long (3000 characters max).' };
  const productUrl = String(b.productUrl ?? '').trim();
  if (productUrl && !KAPRUKA_URL_RE.test(productUrl)) return { error: 'The product or category link must be a kapruka.com page.' };
  const relation = ['direct', 'indirect'].includes(b.relation) ? b.relation : 'auto';

  const refs = [];
  if (kind === 'reference' && text) refs.push({ type: 'link', value: text });
  for (const l of Array.isArray(b.refLinks) ? b.refLinks : []) { const v = String(l ?? '').trim(); if (v) refs.push({ type: 'link', value: v }); }
  const uploads = Array.isArray(b.uploads) ? b.uploads : [];
  if (refs.length + uploads.length > 3) return { error: 'Up to 3 references at a time (links and uploads together).' };
  for (const r of refs) {
    if (!REF_LINK_OK(r.value)) return { error: 'A reference link must be an Instagram post, a Pinterest pin or a direct image link.' };
    if (IG_RE.test(r.value)) {
      const ig = r.value.match(IG_RE); const k = ig[1].toLowerCase() === 'reels' ? 'reel' : ig[1].toLowerCase();
      r.value = `https://www.instagram.com/${k}/${ig[2]}/`;
    }
  }
  const stamp = Date.now(); let dir = null;
  for (const [i, u] of uploads.entries()) {
    const ext = extname(String(u?.name || '')).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext) || typeof u.b64 !== 'string' || !u.b64) return { error: 'An uploaded reference must be a JPG, PNG or WebP image.' };
    if (u.b64.length > 14 * 1024 * 1024) return { error: 'An uploaded image is too large (10 MB max).' };
    dir ||= join(INBOX_DIR, `web-${stamp}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `ref-${i + 1}${ext}`);
    writeFileSync(file, Buffer.from(u.b64, 'base64'));
    refs.push({ type: 'file', value: file, name: String(u.name).slice(0, 80) });
  }
  if (kind === 'reference' && !refs.length) return { error: 'Give a reference: paste an Instagram or Pinterest link, or upload an image.' };
  if (kind !== 'reference') {
    if (text.length < 2) return { error: kind === 'persona' ? 'Name the persona you want to promote to.' : 'Say what you want to promote.' };
    if (text.length > 300) return { error: 'That\'s too long (300 characters max).' };
  }
  const label = { reference: 'Design', persona: 'Persona promotion', promote: 'Promote' }[kind];
  const mk = (ref, i, n) => {
    const part = n > 1 ? ` (${i + 1} of ${n})` : '';
    const refLabel = ref ? (ref.type === 'file' ? ref.name : short(ref.value.replace(/^https?:\/\/(www\.)?/, ''), 48)) : '';
    const description = kind === 'reference'
      ? `Recreate ${refLabel}${productUrl ? ` for ${short(productUrl.replace(/^https?:\/\/(www\.)?kapruka\.com\//, ''), 40)}` : ''}${part}`
      : `${label}: ${short(text, 70)}${ref ? ` · ref ${refLabel}` : ''}${part}`;
    return {
      mode: 'design', kind, origin: 'web', ref: ref || null, source: ref ? (ref.type === 'file' ? ref.name : ref.value) : text,
      text: kind === 'reference' ? '' : text, productUrl, relation, count: 1, description,
      instruction: instruction + (!ref && n > 1 ? `${instruction ? ' ' : ''}(Idea ${i + 1} of ${n}: choose a different angle from the other ideas.)` : '').slice(0, 3000),
    };
  };
  if (refs.length) return { specs: refs.map((r, i) => mk(r, i, refs.length)) };
  const n = clampInt(b.count, 1, 4, 1);
  return { specs: Array.from({ length: n }, (_, i) => mk(null, i, n)) };
}

const NAME_RE = /^[\w.-]+$/;
function readJsonFile(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }

function dFileUrl(name, fname) {
  if (!fname) return null;
  const abs = join(DESIGN_DIR, name, fname);
  if (!existsSync(abs)) return null;
  let v = 0;
  try { v = Math.floor(statSync(abs).mtimeMs); } catch {}
  return `/dfiles/${encodeURIComponent(name)}/${fname.split('/').map(encodeURIComponent).join('/')}?v=${v}`;
}

function listDesigns() {
  let names = [];
  try { names = readdirSync(DESIGN_DIR, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_')).map((d) => d.name); } catch {}
  const out = [];
  for (const name of names) {
    const j = readJsonFile(join(DESIGN_DIR, name, 'design.json'));
    if (!j) continue;
    let at = 0;
    try { at = statSync(join(DESIGN_DIR, name, 'design.json')).mtimeMs; } catch {}
    const vs = j.variants || [];
    const thumbV = vs.find((v) => v.final) || vs.find((v) => v.preview);
    out.push({
      id: name, kind: 'design', mode: 'design', label: j.title || name, source: j.source || '', at,
      imageCount: vs.filter((v) => v.canva).length, finals: vs.filter((v) => v.final).length, error: j.error || null,
      thumb: dFileUrl(name, thumbV?.final || thumbV?.preview) || dFileUrl(name, j.reference?.[0] && `reference/${j.reference[0]}`),
    });
  }
  return out.sort((a, b) => b.at - a.at);
}

function designDetail(name) {
  if (!NAME_RE.test(name)) return null;
  const dir = join(DESIGN_DIR, name);
  const j = readJsonFile(join(dir, 'design.json'));
  if (!j) return null;
  const k = readJsonFile(join(dir, 'kapruka-spec.json')) || {};
  let at = 0;
  try { at = statSync(join(dir, 'design.json')).mtimeMs; } catch {}
  return {
    id: name, kind: 'design', mode: 'design', label: j.title || name, source: j.source || '', at,
    instruction: j.instruction || '', caption: j.caption || '', error: j.error || null,
    reference: (j.reference || []).map((f) => dFileUrl(name, `reference/${f}`)).filter(Boolean),
    changes: k.changes || [], claims: k.claims_used || [], layout: k.layout_summary || '', concept: j.concept || null,
    copy: (k.elements || []).filter((e) => e.type === 'text').map((e) => ({ role: e.role, text: e.text })),
    scenePrompt: k.scene?.prompt || '',
    variants: (j.variants || []).map((v, i) => ({
      index: i, engine: v.engine, editUrl: v.canva?.editUrl || null, canvaError: v.canvaError || null,
      pages: v.pages || 1, previews: (v.previews || []).map((f) => dFileUrl(name, f)).filter(Boolean),
      finals: (v.finals || []).map((f) => dFileUrl(name, f)).filter(Boolean),
      preview: dFileUrl(name, v.preview), scene: dFileUrl(name, v.scene && `renders/${v.scene}`), canRetry: !v.canva && !!v.pptx,
      final: dFileUrl(name, v.final), finalName: v.final || null, finalAt: v.finalAt || null,
      check: v.check || null, attempts: v.attempts || 1, review: v.review || null, polish: v.polish || null,
    })),
  };
}

// ---------------------------------------------------------------------------------
// State: the tracker (one row per job — hub-queued jobs AND every job the laptop reports) + logs + commands
// ---------------------------------------------------------------------------------
const MAX_QUEUED = 30;
const rows = new Map();          // id -> row. Private fields start with "_" and are never sent to browsers.
const logs = new Map();          // id -> [lines]
const deleted = new Set();       // ids the user removed: the laptop keeps reporting them, we keep ignoring them
const cmds = [];                 // commands for the laptop {id, method, path, body, waiter?, delivered}
const sse = new Set();
let lastStatus = null;           // the laptop's own /api/status
let lastSeen = 0;
const ACTIVE = ['queued', 'waiting', 'running'];
const laptopOnline = () => Date.now() - lastSeen < 45_000;

const pub = (r) => { const o = {}; for (const [k, v] of Object.entries(r)) if (!k.startsWith('_')) o[k] = v; return o; };
function positionOf(r) {
  if (r.status !== 'queued') return null;
  const q = [...rows.values()].filter((x) => x.status === 'queued').sort((a, b) => a.createdAt - b.createdAt);
  const i = q.findIndex((x) => x.id === r.id);
  return i < 0 ? null : i + 1;
}
const view = (r) => ({ ...pub(r), position: positionOf(r) });

function saveState() {
  try {
    const list = [...rows.values()].sort((a, b) => a.createdAt - b.createdAt).slice(-600);
    const tmp = `${STATE_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify({ savedAt: Date.now(), rows: list, deleted: [...deleted].slice(-2000), cmds: cmds.filter((c) => c.later).slice(-50) }));
    renameSync(tmp, STATE_FILE);
  } catch (e) { wlog(`state save failed: ${e.message}`); }
}
let saveTimer = null;
const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveState, 800); };

function loadState() {
  try {
    const s = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    for (const r of s.rows || []) rows.set(r.id, r);
    for (const d of s.deleted || []) deleted.add(d);
    for (const c of s.cmds || []) cmds.push({ ...c, delivered: false });
  } catch { /* first run */ }
}
loadState();

function emit(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data).replace(/"\/(dfiles|files|canva)\//g, `"${BASE}/$1/`)}\n\n`;
  for (const res of sse) { try { res.write(payload); } catch { sse.delete(res); } }
}
function touch(r, patch = {}) { Object.assign(r, patch); rows.set(r.id, r); saveSoon(); emit('job', view(r)); }
function pushLog(id, lines) {
  const arr = logs.get(id) || [];
  for (const l of lines) { arr.push(l); emit('log', { id, line: l }); }
  if (arr.length > 2000) arr.splice(0, arr.length - 2000);
  logs.set(id, arr);
}
const queueMsg = () => (laptopOnline() ? 'Waiting in the queue…' : 'Waiting for the laptop to come online…');

// ---------------------------------------------------------------------------------
// Creating jobs (from the page, or the Facebook Ads Tool)
// ---------------------------------------------------------------------------------
function createRow(spec, via) {
  const dup = [...rows.values()].find((j) => ACTIVE.includes(j.status) && j.mode === spec.mode && j.source === spec.source
    && (j.kind || 'reference') === (spec.kind || 'reference') && (j.productUrl || '') === (spec.productUrl || '') && (j.instruction || '') === (spec.instruction || ''));
  if (dup) return { error: 'That exact job is already queued or running.', status: 409 };
  if ([...rows.values()].filter((j) => ACTIVE.includes(j.status)).length >= MAX_QUEUED) return { error: `The queue is full (${MAX_QUEUED}). Let some finish first.`, status: 429 };
  const r = {
    id: randomUUID(), mode: 'design', kind: spec.kind, source: spec.source, instruction: spec.instruction || '', count: 1,
    status: 'queued', message: queueMsg(), step: 0, createdAt: Date.now(), startedAt: null, finishedAt: null, runId: null,
    runKind: 'design', imageCount: null, error: null, origin: 'web', description: spec.description || '', productUrl: spec.productUrl || '',
    canvaUrl: null, finalUrl: null, rating: null, aiMethod: null, stopping: false, stoppable: false,
    _spec: { kind: spec.kind, ref: spec.ref || null, text: spec.text || '', relation: spec.relation || 'auto' }, _claimed: false, _via: via,
  };
  rows.set(r.id, r); saveSoon(); emit('job', view(r));
  wlog(`${r.id.slice(0, 8)} QUEUED via ${via}: ${r.description}`);
  return { row: r };
}

/** The JSON body the laptop's local server expects for one hub-queued job (same shape the web form posts). */
function specToBody(r) {
  const s = r._spec;
  const b = { mode: s.kind === 'reference' ? 'design' : s.kind === 'persona' ? 'idea' : 'promote', instruction: r.instruction || '', productUrl: r.productUrl || '', relation: s.relation, count: 1, hubId: r.id };
  if (s.kind === 'reference') b.source = s.ref?.type === 'link' ? s.ref.value : '';
  else { b.source = s.text; if (s.ref?.type === 'link') b.refLinks = [s.ref.value]; }
  if (s.ref?.type === 'file') {
    b.uploads = [{ name: s.ref.name || basename(s.ref.value), b64: readFileSync(s.ref.value).toString('base64') }];
  }
  return b;
}

// ---------------------------------------------------------------------------------
// Commands to the laptop (stop, retry, resume, final from Canva, …): the browser waits for the answer
// ---------------------------------------------------------------------------------
function rpc(method, path, body, { wait = 105_000 } = {}) {     // IIS's proxy gives up at ~120 s
  if (!laptopOnline()) return Promise.reject(Object.assign(new Error('The laptop is offline, so this can\'t be done right now. It will work when the laptop worker is back.'), { status: 503 }));
  const c = { id: randomUUID(), method, path, body: body ?? null, delivered: false, createdAt: Date.now() };
  cmds.push(c);
  return new Promise((resolveRpc, rejectRpc) => {
    const timer = setTimeout(() => {
      const i = cmds.indexOf(c); if (i >= 0) cmds.splice(i, 1);
      rejectRpc(Object.assign(new Error('The laptop did not answer in time. Check the page again in a minute.'), { status: 504 }));
    }, wait);
    c.waiter = { resolve: (v) => { clearTimeout(timer); resolveRpc(v); }, reject: (e) => { clearTimeout(timer); rejectRpc(e); } };
  });
}
/** Fire-and-forget version for housekeeping that must still happen when the laptop is back. */
function rpcLater(method, path, body) { cmds.push({ id: randomUUID(), method, path, body: body ?? null, delivered: false, later: true, createdAt: Date.now() }); saveSoon(); }

// ---------------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------------
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
};
const FILE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.md', '.txt']);
const UPLOAD_EXTS = new Set([...FILE_EXTS, '.json']);
const STATIC = new Set(['index.html', 'app.css', 'app.js', 'favicon.svg']);
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; "
  + "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Cache-Control': 'no-store' };

const prefixUrls = (s) => s.replace(/"\/(dfiles|files|canva)\//g, `"${BASE}/$1/`);
function json(res, code, obj, extra = {}) {
  const body = prefixUrls(JSON.stringify(obj));
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...SEC, ...extra });
  res.end(body);
}
function readBody(req, limit) {
  return new Promise((resolveBody, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Request too large.'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req, limit = 64 * 1024) {
  const buf = await readBody(req, limit);
  try { return JSON.parse(buf.toString('utf8') || '{}'); } catch { throw Object.assign(new Error('Bad JSON.'), { status: 400 }); }
}
const safeEq = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

let failCount = 0; let failWindowStart = 0;
function basicOk(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const [u, ...rest] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':');
  return safeEq(u, HUB_USER) && safeEq(rest.join(':'), HUB_PASSWORD);
}
const workerOk = (req) => safeEq(req.headers['x-worker-key'] || '', WORKER_KEY);
const apiKeyOk = (req) => !!API_KEY && safeEq(req.headers['x-hub-key'] || '', API_KEY);

const originOk = (req) => {
  const o = req.headers.origin;
  if (!o) return false;                       // a browser always sends Origin on POST/DELETE; a missing one is not our page
  try { return ALLOWED_HOSTS.has(new URL(o).host.toLowerCase()); } catch { return false; }
};

function serveFile(req, res, abs, { download = false, cacheable = false } = {}) {
  let st;
  try { st = statSync(abs); } catch { return json(res, 404, { error: 'Not found.' }); }
  if (!st.isFile()) return json(res, 404, { error: 'Not found.' });
  const ext = extname(abs).toLowerCase();
  const headers = {
    'Content-Type': TYPES[ext] || 'application/octet-stream', 'Content-Length': st.size, 'X-Content-Type-Options': 'nosniff',
    'Cache-Control': cacheable ? 'private, max-age=31536000, immutable' : 'no-cache',
  };
  if (download) headers['Content-Disposition'] = `attachment; filename="${basename(abs).replace(/[^\w.\- ]/g, '_')}"`;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  createReadStream(abs).pipe(res);
}

function servePage(req, res, name) {
  const abs = join(PUBLIC_DIR, name);
  if (name !== 'index.html') return serveFile(req, res, abs);
  let html;
  try { html = readFileSync(abs, 'utf8'); } catch { return json(res, 404, { error: 'Not found.' }); }
  html = html.replace('<meta name="base-path" content="">', `<meta name="base-path" content="${BASE}">`)
    .replace(/(href|src)="\/(?!\/)/g, `$1="${BASE}/`);
  res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Content-Security-Policy': CSP, ...SEC });
  res.end(req.method === 'HEAD' ? undefined : html);
}

// the laptop's AI-method block, with a safe default so the page renders before the first sync
const defaultAi = { aiMethod: 'gemini', label: 'Non-CLI (Gemini)', methods: { gemini: 'Non-CLI (Gemini)', cli: 'CLI (Claude)' }, cli: { installed: false, loggedIn: false, detail: 'laptop not connected' } };

function statusBody() {
  const st = lastStatus || {};
  const online = laptopOnline();
  const running = [...rows.values()].find((r) => r.status === 'running');
  return {
    ai: st.ai || defaultAi, demo: false, chrome: online && !!st.chrome, canva: st.canva || { configured: true, connected: false, error: 'laptop not connected yet' },
    bot: st.bot || { state: 'unknown', pollErrors: 0, username: null },
    running: running ? view(running) : null, queued: [...rows.values()].filter((r) => r.status === 'queued').length,
    hub: { laptopOnline: online, lastSeen },
  };
}

const NOT_ON_HUB = `<!doctype html><meta charset="utf-8"><title>Connect Canva</title><body style="font:16px system-ui;max-width:34em;margin:4em auto;padding:0 1em">
<h2>Connect Canva on the laptop</h2><p>Canva sign-in must happen on the laptop that runs Ashadi (Canva only trusts one place at a time).</p>
<p>On the laptop open <b>http://127.0.0.1:5041</b> and click <b>Connect Canva</b>. This page will show it as connected a few seconds later.</p>
<p><a href="./">Back to Ashadi</a></p></body>`;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://local');
    const p = url.pathname;
    const method = req.method;

    if (p === '/healthz') return json(res, 200, { ok: true, laptopOnline: laptopOnline(), lastSeen, queued: [...rows.values()].filter((r) => r.status === 'queued').length });

    if (!ALLOWED_HOSTS.has(String(req.headers.host || '').toLowerCase())) return json(res, 403, { error: 'Forbidden.' });

    // ---- the laptop worker (own key; never a browser) ----
    if (p.startsWith('/api/worker/')) {
      if (!workerOk(req)) { wlog(`worker auth refused ${p}`); return json(res, 401, { error: 'Bad worker key.' }); }
      return await workerRoutes(req, res, p, method);
    }

    // ---- everyone else: Basic auth, or the Facebook tool's key on two routes ----
    const viaKey = apiKeyOk(req) && ((p === '/api/jobs' && method === 'POST') || (p === '/api/tracker' && method === 'GET'));
    if (!viaKey && !OPEN) {
      if (failCount >= 10 && Date.now() - failWindowStart < 5 * 60_000) { await sleep(2000); return json(res, 429, { error: 'Too many failed sign-ins. Wait a few minutes.' }); }
      if (!basicOk(req)) {
        if (!failWindowStart || Date.now() - failWindowStart > 5 * 60_000) { failWindowStart = Date.now(); failCount = 0; }
        if (req.headers.authorization) failCount++;
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Ashadi", charset="UTF-8"', 'Content-Type': 'text/plain; charset=utf-8', ...SEC });
        return res.end('Sign in required.');
      }
      if (method !== 'GET' && method !== 'HEAD') {
        if (!originOk(req)) return json(res, 403, { error: 'Forbidden (cross-site request).' });
        if (method === 'POST' && !/^application\/json/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'Expected JSON.' });
      }
    }

    // ---- API (same shapes as the laptop's server, so the page is unchanged) ----
    if (p === '/api/settings' && method === 'GET') return json(res, 200, (lastStatus && lastStatus.ai) || defaultAi);
    if (p === '/api/settings' && method === 'POST') {
      const b = await readJson(req);
      const r = await rpc('POST', '/api/settings', { aiMethod: b.aiMethod });
      if (r.status < 400 && lastStatus) lastStatus.ai = r.body;
      return json(res, r.status, r.body);
    }
    if (p === '/api/status' && method === 'GET') return json(res, 200, statusBody());
    if (p === '/api/events' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`retry: 3000\n\n: ${' '.repeat(2048)}\n\n`);      // padding defeats proxy buffering
      sse.add(res);
      const ka = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 15_000);
      req.on('close', () => { clearInterval(ka); sse.delete(res); });
      return;
    }
    if (p === '/api/jobs' && method === 'GET') {
      const all = [...rows.values()].sort((a, b) => a.createdAt - b.createdAt);
      const live = all.filter((r) => ACTIVE.includes(r.status)); const fin = all.filter((r) => !ACTIVE.includes(r.status)).slice(-20);
      return json(res, 200, { jobs: [...fin, ...live].map((r) => ({ ...view(r), log: (logs.get(r.id) || []).slice(-400) })) });
    }
    if (p === '/api/jobs' && method === 'POST') {
      const body = await readJson(req, 48 * 1024 * 1024);
      const bj = buildJobs(body);
      if (bj.error) return json(res, 400, { error: bj.error });
      const active = [...rows.values()].filter((r) => ACTIVE.includes(r.status)).length;
      if (active + bj.specs.length > MAX_QUEUED) return json(res, 429, { error: `The queue is full (${MAX_QUEUED}). Let some finish first.` });
      const made = [];
      for (const spec of bj.specs) {
        const r = createRow(spec, viaKey ? 'facebook-tool' : 'web');
        if (r.error) { if (!made.length) return json(res, r.status, { error: r.error }); break; }
        made.push(view(r.row));
      }
      return json(res, 202, { job: made[0], jobs: made });
    }
    let m = p.match(/^\/api\/jobs\/([0-9a-f-]{36})$/);
    if (m && method === 'DELETE') {                                   // stop / cancel
      const r = rows.get(m[1]);
      if (!r) return json(res, 404, { error: 'No such job.' });
      if (r._spec && !r._claimed && r.status === 'queued') { touch(r, { status: 'cancelled', message: 'Cancelled', finishedAt: Date.now() }); return json(res, 200, { job: view(r) }); }
      const a = await rpc('DELETE', `/api/jobs/${m[1]}`, null);
      return json(res, a.status, a.body);
    }
    m = p.match(/^\/api\/jobs\/([0-9a-f-]{36})\/(retry|resume|feedback)$/);
    if (m && method === 'POST') {
      const b = await readJson(req);
      const a = await rpc('POST', `/api/jobs/${m[1]}/${m[2]}`, m[2] === 'feedback' ? { rating: b.rating, note: b.note } : {});
      if (m[2] === 'feedback' && a.status < 400 && rows.get(m[1])) touch(rows.get(m[1]), { rating: b.rating });
      return json(res, a.status, a.body);
    }
    if (p === '/api/tracker' && method === 'GET') {
      const list = [...rows.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 300).map(view);
      return json(res, 200, { rows: list });
    }
    m = p.match(/^\/api\/tracker\/([0-9a-f-]{36})$/);
    if (m && method === 'DELETE') {
      const r = rows.get(m[1]);
      if (!r) return json(res, 404, { error: 'That row is not in the tracker.' });
      if (ACTIVE.includes(r.status)) return json(res, 409, { error: 'That job is still active. Stop it first, then remove it.' });
      rows.delete(m[1]); logs.delete(m[1]); deleted.add(m[1]); saveSoon();
      if (!r._spec || r._claimed) rpcLater('DELETE', `/api/tracker/${m[1]}`, null);   // also drop it from the laptop's own tracker
      emit('tracker-removed', { id: m[1] });
      return json(res, 200, { ok: true });
    }
    if (p === '/api/runs' && method === 'GET') return json(res, 200, { runs: [] });
    if (p.startsWith('/api/runs/') && method === 'GET') return json(res, 404, { error: 'No such run.' });
    if (p === '/api/canva' && method === 'GET') return json(res, 200, (lastStatus && lastStatus.canva) || { configured: true, connected: false });
    if (p === '/canva/connect' && method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...SEC }); return res.end(NOT_ON_HUB); }

    if (p === '/api/designs' && method === 'GET') return json(res, 200, { designs: listDesigns() });
    m = p.match(/^\/api\/designs\/([^/]+)$/);
    if (m && method === 'GET') { const d = designDetail(decodeURIComponent(m[1])); return d ? json(res, 200, d) : json(res, 404, { error: 'No such design.' }); }
    m = p.match(/^\/api\/designs\/([^/]+)\/(final|retry-canva)$/);
    if (m && method === 'POST') {
      const name = decodeURIComponent(m[1]);
      if (!NAME_RE.test(name)) return json(res, 404, { error: 'No such design.' });
      const b = await readJson(req);
      const a = await rpc('POST', `/api/designs/${encodeURIComponent(name)}/${m[2]}`, m[2] === 'final' ? { variant: clampInt(b.variant, 0, 20, 0) } : {});
      if (a.status >= 400) return json(res, a.status, a.body);
      return json(res, 200, designDetail(name) || a.body);             // the laptop uploaded the new files before it answered
    }
    if (p.startsWith('/dfiles/') && (method === 'GET' || method === 'HEAD')) {
      let rel;
      try { rel = decodeURIComponent(p.slice('/dfiles/'.length)); } catch { return json(res, 400, { error: 'Bad path.' }); }
      const abs = resolve(DESIGN_DIR, rel);
      if (!abs.startsWith(DESIGN_DIR + sep) || !FILE_EXTS.has(extname(abs).toLowerCase())) return json(res, 404, { error: 'Not found.' });
      return serveFile(req, res, abs, { download: url.searchParams.has('download'), cacheable: url.searchParams.has('v') });
    }
    if (p.startsWith('/files/')) return json(res, 404, { error: 'Not found.' });

    if (method === 'GET' || method === 'HEAD') {
      const name = p === '/' ? 'index.html' : p.slice(1);
      if (STATIC.has(name)) return servePage(req, res, name);
    }
    return json(res, 404, { error: 'Not found.' });
  } catch (e) {
    if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : 'Server error.' });
    if (!e.status) wlog(`ERR ${req.method} ${req.url}: ${e.stack || e.message}`);
  }
});

// ---------------------------------------------------------------------------------
// Worker routes
// ---------------------------------------------------------------------------------
async function workerRoutes(req, res, p, method) {
  if (p === '/api/worker/sync' && method === 'POST') {
    const b = await readJson(req, 16 * 1024 * 1024);
    lastSeen = Date.now();
    if (b.status && typeof b.status === 'object') lastStatus = b.status;

    // 1. jobs the laptop accepted (or refused) since last time
    for (const a of Array.isArray(b.acks) ? b.acks : []) {
      const r = rows.get(String(a.id));
      if (!r) continue;
      if (a.ok) { r._acked = true; saveSoon(); }
      else touch(r, { status: 'failed', message: String(a.error || 'The laptop refused this job.').slice(0, 300), error: String(a.error || 'refused'), finishedAt: Date.now(), _claimed: true, _acked: true });
    }
    // 2. command answers
    for (const c of Array.isArray(b.results) ? b.results : []) {
      const i = cmds.findIndex((x) => x.id === c.id);
      if (i < 0) continue;
      const cmd = cmds[i]; cmds.splice(i, 1);
      if (cmd.waiter) cmd.waiter.resolve({ status: Number(c.status) || 500, body: c.body ?? {} });
    }
    // 3. tracker rows the laptop reports (only the ones that changed)
    for (const row of Array.isArray(b.rows) ? b.rows : []) {
      if (!row || typeof row.id !== 'string' || deleted.has(row.id)) continue;
      const prev = rows.get(row.id);
      const next = { ...(prev || {}), ...row, position: null };
      if (prev?._spec) { next._spec = prev._spec; next._claimed = true; next._acked = true; }
      rows.set(row.id, next);
      if (!prev || prev.status !== next.status || prev.message !== next.message || prev.step !== next.step) emit('job', view(next));
    }
    // 4. new log lines
    for (const l of Array.isArray(b.logs) ? b.logs : []) {
      if (l && typeof l.id === 'string' && Array.isArray(l.lines) && l.lines.length) pushLog(l.id, l.lines.slice(-200).map((x) => String(x).slice(0, 2000)));
    }
    // 5. stale claims: handed out but never acknowledged → give the job back to the queue
    for (const r of rows.values()) if (r._spec && r._claimed && !r._acked && r.status === 'queued' && Date.now() - (r._claimedAt || 0) > 5 * 60_000) { r._claimed = false; }
    // 6. what the laptop should do now
    const jobs = [];
    let free = clampInt(b.free, 0, 5, 0);
    for (const r of [...rows.values()].sort((a, c) => a.createdAt - c.createdAt)) {
      if (!free) break;
      if (r._spec && !r._claimed && r.status === 'queued') {
        try { jobs.push({ id: r.id, body: specToBody(r) }); } catch (e) { touch(r, { status: 'failed', message: `The reference image is missing on the hub: ${e.message}`, error: e.message, finishedAt: Date.now() }); continue; }
        r._claimed = true; r._claimedAt = Date.now(); r.message = 'Sent to the laptop…'; emit('job', view(r)); free--;
      }
    }
    const commands = cmds.filter((c) => !c.delivered || Date.now() - (c.deliveredAt || 0) > 240_000).slice(0, 5);
    for (const c of commands) { c.delivered = true; c.deliveredAt = Date.now(); }
    saveSoon();
    return json(res, 200, { ok: true, jobs, commands: commands.map(({ id, method: mth, path, body }) => ({ id, method: mth, path, body })), deleted: [...deleted].slice(-200) });
  }

  // a finished design's files (one per request, raw body)
  const fm = p.match(/^\/api\/worker\/file\/([\w.-]+)\/(.+)$/);
  if (fm && method === 'PUT') {
    const design = fm[1];
    let rel;
    try { rel = decodeURIComponent(fm[2]); } catch { return json(res, 400, { error: 'Bad path.' }); }
    const parts = rel.split('/');
    if (!NAME_RE.test(design) || design.startsWith('_') || !parts.every((s) => /^[\w. -]+$/.test(s) && s !== '..' && s !== '.')) return json(res, 400, { error: 'Bad path.' });
    if (!UPLOAD_EXTS.has(extname(rel).toLowerCase())) return json(res, 415, { error: 'File type not accepted.' });
    const abs = resolve(DESIGN_DIR, design, ...parts);
    if (!abs.startsWith(join(DESIGN_DIR, design) + sep)) return json(res, 400, { error: 'Bad path.' });
    mkdirSync(dirname(abs), { recursive: true });
    const tmp = `${abs}.part`;
    await new Promise((ok, bad) => {
      let size = 0; const ws = createWriteStream(tmp);
      req.on('data', (c) => { size += c.length; if (size > 28 * 1024 * 1024) { bad(Object.assign(new Error('File too large.'), { status: 413 })); req.destroy(); ws.destroy(); } });
      req.pipe(ws); ws.on('finish', ok); ws.on('error', bad); req.on('error', bad);
    }).catch((e) => { try { rmSync(tmp, { force: true }); } catch {} throw e; });
    renameSync(tmp, abs);
    const mt = Number(req.headers['x-mtime']);
    if (Number.isFinite(mt) && mt > 0) { try { utimesSync(abs, new Date(), new Date(mt)); } catch {} }
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: 'Unknown worker route.' });
}

server.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use.` : e.message); process.exit(1); });
server.requestTimeout = 0;            // uploads of big design files
server.listen(PORT, HOST, () => { const msg = `Ashadi hub on http://${HOST}:${PORT} (base path "${BASE}")`; console.log(msg); wlog(msg); });
setInterval(saveState, 60_000).unref();
process.on('SIGTERM', () => { saveState(); process.exit(0); });
