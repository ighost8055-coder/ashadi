// thinker.mjs — which AI answers Ashadi's THINKING steps. Two methods, picked by a setting (human spec, 2026-11-22):
//
//   'gemini'  NON-CLI  Gemini in the signed-in automation Chrome. No Claude, no CLI sign-in, no Claude usage limit.
//   'cli'     CLI      the local Claude CLI (`claude -p`, Opus) — sharper measuring and review; needs `claude auth login`.
//
// Strict: when a method is picked, every thinking step uses THAT method. There is no silent fallback to the other one —
// a failing step fails the job with a message that names the method, so nothing quietly changes underneath you.
//
// "Thinking steps" = reverse-engineer, adapt, picture-checker, art director, fixer, concept, creative strategist,
// reference-type (direct/indirect) check, product label reader and the playbook distiller. The IMAGE engines (Gemini, with
// Meta AI as a fallback) are the same in both methods — they always run in the browser.
//
// Which method is used (first match wins):
//   1. ASHADI_AI_JOB   set per job by the web server when the job STARTS, so a job never changes method half-way
//   2. web/data/settings.json  {"aiMethod": "cli" | "gemini"}   — what the header switch writes
//   3. ASHADI_AI env   "cli" | "gemini"                          — a per-machine default (e.g. set it on the new laptop)
//   4. default         "gemini"
import { spawn, execFile } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT } from './env.mjs';
import { connectChrome } from './chrome.mjs';
import { askGemini } from './gemini.mjs';

export const AI_METHODS = ['gemini', 'cli'];
export const AI_LABEL = { gemini: 'Non-CLI (Gemini in browser)', cli: 'CLI (Claude)' };
const SETTINGS_FILE = join(ROOT, 'tools', 'ig2img', 'web', 'data', 'settings.json');
const rel = (p) => relative(ROOT, p).split('\\').join('/');
const norm = (v) => { const s = String(v || '').toLowerCase().trim(); return s === 'cli' ? 'cli' : ['gemini', 'non-cli', 'noncli'].includes(s) ? 'gemini' : null; };

export function aiMethod() {
  const job = norm(process.env.ASHADI_AI_JOB);
  if (job) return job;
  try { const s = norm(JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')).aiMethod); if (s) return s; } catch { /* no settings yet */ }
  return norm(process.env.ASHADI_AI) || 'gemini';
}

export function setAiMethod(method) {
  const m = norm(method);
  if (!m) throw new Error('AI method must be "cli" or "gemini".');
  mkdirSync(join(ROOT, 'tools', 'ig2img', 'web', 'data'), { recursive: true });
  let cur = {};
  try { cur = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')); } catch { /* new file */ }
  writeFileSync(SETTINGS_FILE, JSON.stringify({ ...cur, aiMethod: m, updatedAt: new Date().toISOString() }, null, 1));
  return m;
}

/** Is the Claude CLI installed and signed in? (`claude auth status`) */
export function cliStatus() {
  return new Promise((resolve) => {
    execFile('claude', ['auth', 'status'], { shell: true, timeout: 20_000, windowsHide: true, cwd: ROOT }, (err, stdout) => {
      const out = String(stdout || '');
      if (err && !out.trim()) return resolve({ installed: !/not recognized|not found|ENOENT/i.test(String(err.message)), loggedIn: false, detail: String(err.message).split('\n')[0].slice(0, 120) });
      try { const j = JSON.parse(out.slice(out.indexOf('{'))); resolve({ installed: true, loggedIn: !!j.loggedIn, detail: j.email || j.authMethod || '' }); }
      catch { resolve({ installed: true, loggedIn: /logged in|true/i.test(out) && !/not logged/i.test(out), detail: out.trim().slice(0, 80) }); }
    });
  });
}

let agentLog = (m) => console.log(m);
export function setAgentLogger(fn) { agentLog = fn || agentLog; }

// ---------------------------------------------------------------------------------------------------------
// The two runners
// ---------------------------------------------------------------------------------------------------------
export function runClaudeCli(instructions, { model = process.env.IG2IMG_AGENT_MODEL || 'opus', tools = 'Read', timeoutMs = 15 * 60_000, label = 'agent' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--model', model, '--permission-mode', 'acceptEdits', '--allowedTools', `"${tools}"`],
      { shell: true, windowsHide: true, cwd: ROOT });
    let out = ''; let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${label} timed out`)); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`${label} exited ${code}: ${(err || out).slice(-400)}`));
      resolve(out.trim());
    });
    child.stdin.write(instructions);
    child.stdin.end();
  });
}

export async function runGemini(instructions, { label = 'agent', timeoutMs = 12 * 60_000 } = {}) {
  // Gemini cannot Read files: attach every image the task names (in order) and paste the .md documents it names.
  const names = [...new Set(instructions.match(/[\w.\-\/]+\.(?:png|jpe?g|webp|md)\b/gi) || [])];
  const images = []; const docs = [];
  for (const n of names) {
    const f = join(ROOT, n);
    if (!existsSync(f)) continue;
    if (/\.md$/i.test(n)) docs.push({ n, text: readFileSync(f, 'utf8').slice(0, 9000) });
    else if (images.length < 10) images.push({ n, f });
  }
  const preface = `You cannot read files in this chat. Wherever the task below says to read a file, use what is given here instead: `
    + `${images.length ? `the images attached to this message, in this order — ${images.map((im, i) => `image ${i + 1} = ${im.n}`).join('; ')}` : 'no images'}`
    + `${docs.length ? `, and the documents pasted under REFERENCE DOCUMENTS at the end` : ''}. `
    + `Do the task exactly as written. When it says to reply with ONLY one JSON object, reply with only that object — no commentary, no code fence, no markdown.\n\n=== TASK ===\n`;
  const tail = docs.length ? `\n\n=== REFERENCE DOCUMENTS ===\n${docs.map((d) => `--- ${d.n} ---\n${d.text}`).join('\n\n')}` : '';
  const chrome = await connectChrome();
  try {
    return (await askGemini(chrome, preface + instructions + tail, { images: images.map((im) => im.f), timeoutMs, log: agentLog })).trim();
  } finally { await chrome.close().catch(() => {}); }
}

/**
 * Run one thinking step with the picked method. `instructions` follows the house convention: files to look at are named by
 * project-relative path ("Read …"); the CLI reads them with its Read tool, Gemini gets the images attached / the .md pasted.
 */
export async function runThinking(instructions, opts = {}) {
  const method = aiMethod();
  const label = opts.label || 'a step';
  if (method === 'cli') {
    try { return await runClaudeCli(instructions, opts); }
    catch (e) {
      const why = String(e.message).replace(/\s+/g, ' ').slice(0, 160);
      throw new Error(`The Claude CLI could not do "${label}" (${why}). The AI method is set to CLI — fix the CLI (claude auth login) or switch to Non-CLI in the header.`);
    }
  }
  return runGeminiChecked(instructions, opts);
}

/**
 * Gemini is a chat: now and then it answers in prose instead of the JSON object a step asked for (seen 2026-11-22: the art
 * director returned no JSON, so nothing got reviewed or fixed; the strategist failed the same way), or a paste/attach step
 * hiccups. Try once more with a firmer instruction before giving up. Not for "signed out": that needs you.
 */
async function runGeminiChecked(instructions, opts) {
  const wantsJson = /\bJSON\b/.test(instructions);
  const hasJson = (t) => /\{[\s\S]*\}/.test(String(t || ''));
  let first;
  try {
    first = await runGemini(instructions, opts);
    if (!wantsJson || hasJson(first)) return first;
    agentLog(`  · Gemini answered "${opts.label || 'a step'}" in prose, not JSON — asking again`);
  } catch (e) {
    if (/signed out/i.test(String(e.message))) throw e;
    agentLog(`  · Gemini hiccup on "${opts.label || 'a step'}" (${String(e.message).split('\n')[0].slice(0, 80)}) — trying once more`);
  }
  const again = await runGemini(`${instructions}\n\nIMPORTANT: reply with ONLY the single JSON object described above. No questions, no commentary, no code fence, no markdown.`, opts);
  return again;
}

/** For steps that hand over images + a question in code (reference type, label reader, strategist, playbook). */
export async function think(prompt, { images = [], label = 'a step', timeoutMs, model } = {}) {
  const files = images.map((f) => rel(f));
  const head = files.length ? `Look at these image files (read each with the Read tool if you have one):\n${files.map((f) => `  ${f}`).join('\n')}\n\n` : '';
  return runThinking(`${head}${prompt}`, { label, ...(timeoutMs ? { timeoutMs } : {}), ...(model ? { model } : {}) });
}
