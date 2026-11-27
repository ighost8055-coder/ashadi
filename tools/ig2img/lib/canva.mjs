// canva.mjs — Canva Connect API for Ashadi: one-time OAuth sign-in (PKCE), import a
// layered file (.pptx) as an EDITABLE Canva design, and export the finished design as PNG.
//
// Why the API and not driving canva.com in Chrome: the editor UI changes often and is
// heavy to automate; the import/export endpoints are stable and documented.
//
// Credentials: CANVA_CLIENT_ID / CANVA_CLIENT_SECRET in the project .env (never logged).
// Tokens:      <project>/.canva-tokens.json (gitignored). Canva refresh tokens are
//              SINGLE-USE — every refresh returns a new one, so the file is rewritten
//              atomically and concurrent refreshes are collapsed into one.
// Redirect:    http://127.0.0.1:5041/canva/callback must be registered on the Canva
//              integration (Developer Portal → your integration → Authentication).
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { ROOT, env } from './env.mjs';

const API = 'https://api.canva.com/rest/v1';
const AUTHORIZE = 'https://www.canva.com/api/oauth/authorize';
export const CANVA_REDIRECT = process.env.CANVA_REDIRECT_URI || 'http://127.0.0.1:5041/canva/callback';
// Every scope must ALSO be ticked on the integration in the Developer Portal, or the
// sign-in fails. Scopes are explicit: asset:write does not imply asset:read.
// Kept to the minimum Ashadi needs — asking for one the integration hasn't ticked fails the
// whole sign-in with "invalid_scope" (seen 2026-11-15 with asset:* + profile:read requested).
// Override with CANVA_SCOPES in .env (space-separated) if more are enabled later.
export const CANVA_SCOPES = (env(['CANVA_SCOPES'], { required: false }) || [
  'design:content:write',   // import a layered file as a design
  'design:content:read',    // export the finished design
  'design:meta:read',       // read a design's title / edit + view links
].join(' ')).split(/\s+/).filter(Boolean);
const TOKEN_FILE = join(ROOT, '.canva-tokens.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const canvaConfigured = () =>
  !!(env(['CANVA_CLIENT_ID'], { required: false }) && env(['CANVA_CLIENT_SECRET'], { required: false }));

// ---------------------------------------------------------------- OAuth
const pending = new Map();                      // state -> { verifier, at }

export function authorizeUrl() {
  const verifier = b64url(randomBytes(64));                       // 86 chars, within 43-128
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(24));
  for (const [k, v] of pending) if (Date.now() - v.at > 15 * 60_000) pending.delete(k);
  pending.set(state, { verifier, at: Date.now() });
  const q = new URLSearchParams({
    code_challenge: challenge, code_challenge_method: 'S256', scope: CANVA_SCOPES.join(' '),
    response_type: 'code', client_id: env(['CANVA_CLIENT_ID']), state, redirect_uri: CANVA_REDIRECT,
  });
  return `${AUTHORIZE}?${q}`;
}

async function tokenRequest(params) {
  const basic = Buffer.from(`${env(['CANVA_CLIENT_ID'])}:${env(['CANVA_CLIENT_SECRET'])}`).toString('base64');
  const res = await withRetry('token', () => fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(30_000),
  }));
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    throw new Error(`Canva sign-in failed (${res.status}): ${j.error_description || j.message || j.error || 'no access token returned'}`);
  }
  return j;
}

function saveTokens(j) {
  const t = {
    access_token: j.access_token, refresh_token: j.refresh_token,
    expires_at: Date.now() + (Number(j.expires_in) || 3600) * 1000,
    scope: j.scope || '', saved_at: new Date().toISOString(),
  };
  const tmp = `${TOKEN_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(t, null, 2));
  renameSync(tmp, TOKEN_FILE);
  return t;
}
const loadTokens = () => { try { return JSON.parse(readFileSync(TOKEN_FILE, 'utf8')); } catch { return null; } };

export async function finishAuthorize(code, state) {
  const p = pending.get(state);
  pending.delete(state);
  if (!p) throw new Error('That Canva sign-in link expired or was already used. Click "Connect Canva" again.');
  saveTokens(await tokenRequest({ grant_type: 'authorization_code', code, code_verifier: p.verifier, redirect_uri: CANVA_REDIRECT }));
}

let refreshing = null;
async function accessToken() {
  const t = loadTokens();
  if (!t) throw new Error('Canva is not connected. Click "Connect Canva" in Ashadi.');
  if (t.expires_at - Date.now() > 60_000) return t.access_token;
  refreshing ||= (async () => {
    try {
      const cur = loadTokens();
      if (cur.expires_at - Date.now() > 60_000) return cur.access_token;
      if (!cur.refresh_token) throw new Error('Canva session expired. Click "Connect Canva" again.');
      return saveTokens(await tokenRequest({ grant_type: 'refresh_token', refresh_token: cur.refresh_token })).access_token;
    } finally { refreshing = null; }
  })();
  return refreshing;
}

// ---------------------------------------------------------------- REST
// This office connection drops requests now and then (seen 2026-11-15: an 1.2 MB import
// died with a bare "fetch failed" after 85 s, the next request worked). Network-level
// failures are retried with growing pauses; HTTP errors (4xx/5xx answers) are not.
const NET_ERR = /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR|socket|network|aborted|timeout/i;
async function withRetry(what, fn, { tries = 3 } = {}) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      const msg = `${e.message} ${e.cause?.code || e.cause?.message || ''}`;
      if (i >= tries || !NET_ERR.test(msg)) throw new Error(`${e.message}${e.cause?.code ? ` (${e.cause.code})` : ''}`);
      await sleep([0, 4000, 10000][i] || 10000);
    }
  }
}

async function api(method, path, { json, body, headers = {}, timeoutMs = 60_000 } = {}) {
  const res = await withRetry(`${method} ${path}`, async () => fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: json ? JSON.stringify(json) : body,
    signal: AbortSignal.timeout(timeoutMs),
  }));
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Canva ${method} ${path} → ${res.status}: ${j.message || j.code || 'error'}`);
  return j;
}

async function pollJob(get, what, { timeoutMs = 4 * 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (let wait = 1500; Date.now() < deadline; wait = Math.min(wait * 1.4, 6000)) {
    const { job } = await get();
    if (job.status === 'success') return job;
    if (job.status === 'failed') throw new Error(`Canva ${what} failed: ${job.error?.message || job.error?.code || 'unknown error'}`);
    await sleep(wait);
  }
  throw new Error(`Canva ${what} did not finish within ${Math.round(timeoutMs / 60_000)} min`);
}

export async function canvaStatus() {
  if (!canvaConfigured()) return { configured: false, connected: false };
  if (!loadTokens()) return { configured: true, connected: false };
  try {
    // /users/me needs no scope; the display name (profile:read) is only shown if granted.
    await api('GET', '/users/me', { timeoutMs: 10_000 });
    const me = CANVA_SCOPES.includes('profile:read')
      ? await api('GET', '/users/me/profile', { timeoutMs: 10_000 }).catch(() => null) : null;
    return { configured: true, connected: true, name: me?.profile?.display_name || null };
  } catch (e) {
    return { configured: true, connected: false, error: e.message };
  }
}

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** Import a layered file as an editable Canva design. Returns [{ id, title, editUrl, viewUrl }]. */
export async function importDesign(file, title, { mime = PPTX, log = () => {} } = {}) {
  const meta = { title_base64: Buffer.from(String(title).slice(0, 50) || 'Ashadi design').toString('base64'), mime_type: mime };
  const { job } = await api('POST', '/imports', {
    body: readFileSync(file),
    headers: { 'Content-Type': 'application/octet-stream', 'Import-Metadata': JSON.stringify(meta) },
    timeoutMs: 180_000,
  });
  log(`  → Canva import started (job ${job.id})`);
  const done = await pollJob(() => api('GET', `/imports/${job.id}`), 'import');
  const designs = (done.result?.designs || []).map((d) => ({
    id: d.id, title: d.title, editUrl: d.urls?.edit_url || null, viewUrl: d.urls?.view_url || null,
  }));
  if (!designs.length) throw new Error('Canva import finished but returned no design');
  return designs;
}

/** Export page 1 of a design as PNG and save it. Returns the saved path. */
export async function exportPng(designId, outFile, { width = 1080, log = () => {} } = {}) {
  const { job } = await api('POST', '/exports', { json: { design_id: designId, format: { type: 'png', width, pages: [1] } } });
  log(`  → Canva export started (job ${job.id})`);
  const done = await pollJob(() => api('GET', `/exports/${job.id}`), 'export');
  const url = done.urls?.[0];
  if (!url) throw new Error('Canva export finished but returned no download link');
  const res = await withRetry('export download', () => fetch(url, { signal: AbortSignal.timeout(120_000) }));
  if (!res.ok) throw new Error(`downloading the Canva export failed (${res.status})`);
  writeFileSync(outFile, Buffer.from(await res.arrayBuffer()));
  return outFile;
}

/** Export several pages of a multi-page design as PNGs. Returns saved paths, page order. (Additive; exportPng is unchanged.) */
export async function exportPages(designId, outPrefix, { width = 1080, pages = [1], log = () => {} } = {}) {
  const { job } = await api('POST', '/exports', { json: { design_id: designId, format: { type: 'png', width, pages } } });
  log(`  → Canva export started (job ${job.id}, pages ${pages.join(',')})`);
  const done = await pollJob(() => api('GET', `/exports/${job.id}`), 'export');
  const urls = done.urls || [];
  if (!urls.length) throw new Error('Canva export finished but returned no download links');
  const saved = [];
  for (let i = 0; i < urls.length; i++) {
    const res = await withRetry('export download', () => fetch(urls[i], { signal: AbortSignal.timeout(120_000) }));
    if (!res.ok) throw new Error(`downloading Canva export page ${pages[i] ?? i + 1} failed (${res.status})`);
    const f = `${outPrefix}-p${pages[i] ?? i + 1}.png`;
    writeFileSync(f, Buffer.from(await res.arrayBuffer()));
    saved.push(f);
  }
  return saved;
}
