// webhook.mjs — the WhatsApp Cloud API webhook.
//
// You send:   an Instagram link + the word "create"
// It replies: progress, then the finished images.
//
//   node tools/ig2img/webhook.mjs            (listens on :8787)
//
// Meta can only PUSH to a public HTTPS URL, so this sits behind a Cloudflare
// Tunnel — see start.ps1, which starts both.
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, WA_VERIFY_TOKEN, WA_ADMIN_NUMBER } from './lib/env.mjs';
import { sendText } from './lib/wa.mjs';
import { runPipeline } from './run.mjs';

const PORT = Number(process.env.PORT || 8787);
const TRIGGER = /\bcreate\b/i;
const IG_URL = /https?:\/\/(?:www\.)?instagram\.com\/[^\s]+/i;
const LOG_DIR = join(ROOT, 'tools', 'logs');

mkdirSync(LOG_DIR, { recursive: true });
const log = (...a) => {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}`;
  console.log(line);
  try { appendFileSync(join(LOG_DIR, 'ig2img.log'), line + '\n'); } catch {}
};

// --- one-at-a-time queue: two Chrome runs would fight over the same tabs ---
const queue = [];
let busy = false;
async function drain() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const job = queue.shift();
    log(`RUN  ${job.url} (from ${job.from}${queue.length ? `, ${queue.length} queued` : ''})`);
    try { await runPipeline(job.url, { to: job.from, log, variations: job.variations, engine: job.engine, maxPrompts: 2 }); }
    catch (e) { log(`ERR  ${e.message}`); }
  }
  busy = false;
}

const seen = new Set();                       // Meta retries deliveries — dedupe by message id

function handleMessage(msg, contactName) {
  const from = msg.from || WA_ADMIN_NUMBER();
  const body = msg.text?.body || msg.image?.caption || msg.video?.caption || '';
  if (!body) return;
  log(`MSG  ${from}: ${body.replace(/\s+/g, ' ').slice(0, 120)}`);

  const link = body.match(IG_URL)?.[0];
  const wants = TRIGGER.test(body);

  if (!link) {
    if (wants) sendText('Send me an Instagram post link with the word "create" and I\'ll recreate it for Kapruka.', from).catch(() => {});
    return;
  }
  if (!wants) {
    sendText('Got a link. Add the word "create" to that message and I\'ll build it.', from).catch(() => {});
    return;
  }

  const variations = Number(body.match(/\bx\s?(\d)\b/i)?.[1] || 1);
  const engine = 'flow';   // Flow only — ChatGPT/OpenAI removed from the pipeline
  sendText(`👍 On it${contactName ? `, ${contactName.split(' ')[0]}` : ''} — reading that post now.`, from).catch(() => {});
  queue.push({ url: link, from, engine, variations: Math.min(Math.max(variations, 1), 4) });
  drain();
}

createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Meta's one-time verification handshake
  if (req.method === 'GET' && url.pathname === '/webhook') {
    const ok = url.searchParams.get('hub.verify_token') === WA_VERIFY_TOKEN()
            && url.searchParams.get('hub.mode') === 'subscribe';
    log(`VERIFY ${ok ? 'ok' : 'REJECTED'}`);
    res.writeHead(ok ? 200 : 403, { 'Content-Type': 'text/plain' });
    return res.end(ok ? url.searchParams.get('hub.challenge') : 'forbidden');
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, busy, queued: queue.length }));
  }

  if (req.method === 'POST' && url.pathname === '/webhook') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      res.writeHead(200).end('EVENT_RECEIVED');            // ack fast, work after
      try {
        for (const entry of JSON.parse(raw).entry || []) {
          for (const change of entry.changes || []) {
            const value = change.value || {};
            const name = value.contacts?.[0]?.profile?.name || '';
            for (const msg of value.messages || []) {
              if (seen.has(msg.id)) continue;
              seen.add(msg.id);
              handleMessage(msg, name);
            }
          }
        }
      } catch (e) { log(`BAD PAYLOAD ${e.message}`); }
    });
    return;
  }

  res.writeHead(404).end('not found');
}).listen(PORT, () => {
  log(`webhook listening on http://127.0.0.1:${PORT}/webhook`);
  log('waiting for a WhatsApp message containing an Instagram link + the word "create"');
});
