// telegram-bot.mjs — the Telegram front door.
//
// Three jobs, told apart by a fast LLM classifier (lib/classify.mjs) reading the
// message itself — no fixed command syntax to memorise:
//   1. "recreate this <link>"                 — reverse-engineer an Instagram post
//   2. "ideas for <persona>"                   — originate ideas for a named persona
//   3. "promote <service/feature/page>"        — promote something Kapruka actually offers
// It replies: progress, then the finished images.
//
//   node tools/ig2img/telegram-bot.mjs
//
// Unlike the WhatsApp path, this needs NO public URL, no tunnel, no DNS and no
// Meta app config — Telegram bots long-poll for their own updates, so this works
// from behind any router as long as the PC is on.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setDefaultResultOrder } from 'node:dns';
import { ROOT } from './lib/env.mjs';

// This network resolves api.telegram.org to a AAAA (IPv6) address that is
// unreachable (instant connection failure), while the A (IPv4) address works
// fine. Node's fetch doesn't always fall back to IPv4 the way curl's Happy
// Eyeballs does, producing a bare "fetch failed" on every long-poll — seen
// live 2026-09-13 as continuous POLL ERR every ~5s. Forcing IPv4-first avoids
// ever attempting the broken IPv6 address.
setDefaultResultOrder('ipv4first');
import { getMe, getUpdates, sendText, sendImage, downloadFile } from './lib/telegram.mjs';
import { classifyMessage } from './lib/classify.mjs';
import { runPipeline } from './run.mjs';
import { runDesign, pullFinal, retryCanva } from './design.mjs';

const LOG_DIR = join(ROOT, 'tools', 'logs');

// "Canva for all links" (human decision, 2026-11-15): an Instagram link no longer comes
// back as a flat image with text painted in — it goes through design.mjs (exact layout
// measured → adapted to Kapruka → text-free picture → editable design in Canva). The chat
// gets a preview + the Canva edit link; replying "final" pulls the edited design back.
// Each chat's latest design folder is remembered here so "final" knows what to pull.
const LAST_DESIGN = join(LOG_DIR, 'tg-last-design.json');
const lastDesigns = () => { try { return JSON.parse(readFileSync(LAST_DESIGN, 'utf8')); } catch { return {}; } };
const rememberDesign = (chatId, dir) => {
  const all = lastDesigns();
  all[chatId] = dir;
  try { writeFileSync(LAST_DESIGN, JSON.stringify(all, null, 2)); } catch {}
};

async function designForChat(job) {
  const say = (m) => sendText(m, job.chatId).catch(() => {});
  // Forward only the pipeline's own milestone lines (📥 🧠 ✅) to the chat, not every log line.
  const plog = (...a) => {
    log(...a);
    const line = a.join(' ').trim();
    if (/^(📥|🧠|✅)/u.test(line)) say(line);
  };
  let res;
  try {
    res = await runDesign({ igUrl: job.link, instruction: job.instruction, log: plog });
  } catch (e) {
    // A design that was made but didn't reach Canva can be re-sent with "retry".
    if (e.outDir) rememberDesign(job.chatId, e.outDir);
    if (/sending it to Canva failed/.test(e.message)) throw new Error(`${e.message.replace(/Use "Retry sending to Canva"\./, '')}Reply "retry" to send it again.`);
    throw e;
  }
  rememberDesign(job.chatId, res.outDir);
  await sendDesignResult(job.chatId, res.outDir, res.result);
}

async function sendDesignResult(chatId, outDir, result) {
  const say = (m) => sendText(m, chatId).catch(() => {});
  const vs = result.variants;
  for (const [i, v] of vs.entries()) {
    const cap = `${i + 1}/${vs.length} — ${result.title} [picture: ${v.engine}]\n`
      + (v.canva?.editUrl ? `✏️ Edit in Canva (all text is editable):\n${v.canva.editUrl}` : `⚠️ Canva import failed: ${v.canvaError}`);
    if (v.preview) await sendImage(join(outDir, v.preview), cap, chatId, { asFile: true }).catch((e) => log(`  ! send failed: ${e.message}`));
    else await say(cap);
  }
  if (vs.some((v) => v.canva)) await say('When you\'ve finished editing in Canva, reply "final" and I\'ll send the finished image back.');
}

async function retryForChat(job) {
  const dir = lastDesigns()[job.chatId];
  if (!dir) return void sendText('There\'s no design from this chat to re-send.', job.chatId).catch(() => {});
  const result = await retryCanva(dir, { log });
  await sendDesignResult(job.chatId, dir, result);
}

async function finalForChat(job) {
  const say = (m) => sendText(m, job.chatId).catch(() => {});
  const dir = lastDesigns()[job.chatId];
  if (!dir) return void say('There\'s no Canva design from this chat yet. Send an Instagram link + "create" first.');
  const design = JSON.parse(readFileSync(join(dir, 'design.json'), 'utf8'));
  const idx = (design.variants || []).map((v, i) => (v.canva ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return void say('That design never made it into Canva, so there\'s nothing to pull.');
  await say('📤 Pulling your edited design from Canva…');
  for (const i of idx) {
    const file = await pullFinal(dir, i, { log });
    await sendImage(file, `✅ Final from Canva — ${design.title || 'design'}${idx.length > 1 ? ` (${i + 1})` : ''}`, job.chatId, { asFile: true });
  }
}

mkdirSync(LOG_DIR, { recursive: true });
const log = (...a) => {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}`;
  console.log(line);
  try { appendFileSync(join(LOG_DIR, 'ig2img.log'), line + '\n'); } catch {}
};

// One job at a time — two concurrent runs would fight over the same Chrome tabs.
const queue = [];
let busy = false;
async function drain() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const job = queue.shift();
    const what = job.mode === 'recreate' ? job.link : job.mode === 'idea' ? job.persona : job.mode === 'final' ? 'pull final' : job.mode === 'retry' ? 're-send to Canva' : job.thing;
    log(`RUN  [${job.mode === 'recreate' ? 'design' : job.mode}] ${what} (chat ${job.chatId}${queue.length ? `, ${queue.length} queued` : ''})`);
    try {
      if (job.mode === 'recreate') { await designForChat(job); log('Done → design'); continue; }
      if (job.mode === 'final') { await finalForChat(job); log('Done → final'); continue; }
      if (job.mode === 'retry') { await retryForChat(job); log('Done → retry'); continue; }
      // engine left unset (null) so each prompt routes on its own Engine: line —
      // hardcoding 'flow' here would silently override the per-prompt intelligent
      // routing built 2026-08-31. Only IG2IMG_ENGINE (read inside runPipeline) forces it.
      await runPipeline(job.link, {
        mode: job.mode, persona: job.persona, thing: job.thing,
        to: job.chatId, channel: 'telegram', log,
        variations: job.variations, engine: null, maxPrompts: job.maxPrompts, instruction: job.instruction,
      });
    } catch (e) {
      log(`ERR  ${e.message}`);
      // runPipeline reports its own failures to the chat; the design/final paths don't.
      if (['recreate', 'final', 'retry'].includes(job.mode)) sendText(`❌ Couldn't finish that one.\n${e.message}`, job.chatId).catch(() => {});
    }
  }
  busy = false;
}

// ---------------------------------------------------------------------------------------------------------
// The one pipeline (human spec 2026-11-22): every message becomes a job in the web server's queue — same queue,
// same tracker, same stages as the web page and Sithiji. No classifier and no Claude CLI here: the message is read
// by simple rules (links, "promote …", "persona …"). The web server answers back here when the job is done.
// ---------------------------------------------------------------------------------------------------------
const WEB = `http://127.0.0.1:${process.env.IG2IMG_WEB_PORT || 5041}`;
async function webCall(path, body) {
  let r;
  try {
    r = await fetch(WEB + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  } catch { throw new Error('Ashadi\'s web service isn\'t running right now. It restarts itself within 5 minutes — try again then.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Ashadi returned ${r.status}`);
  return j;
}
const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;
const IG_RE = /instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(?:p|reel|reels|tv)\/[A-Za-z0-9_-]+/i;
const PIN_RE = /(?:pinterest\.[a-z.]+\/pin\/|pin\.it\/)/i;
const IMG_RE = /^https?:\/\/\S+\.(?:png|jpe?g|webp)(?:\?\S*)?$/i;
const KAP_RE = /^https?:\/\/(?:www\.)?kapruka\.com\//i;

const HELP = 'Send me what to make:\n\n'
  + '1) A reference — an Instagram or Pinterest link, or a photo — with a Kapruka product or category link if you want a specific product.\n'
  + '   e.g. <link> https://www.kapruka.com/online/cakes\n'
  + '   I work out whether it is a direct or indirect reference from what you promote. Up to 3 references, one design each.\n\n'
  + '2) A persona, no reference — "persona: romantic local gifter" (add x3 for three designs)\n\n'
  + '3) Something to promote — "promote perfumes for Father\'s Day"\n\n'
  + 'Everything joins one queue (one job at a time). When a design is ready you get the final picture and its Canva link here. '
  + 'Reply "final" after editing in Canva to get your edited version, or "retry" to re-send to Canva.';

async function handle(msg) {
  const chatId = msg.chat?.id;
  const body = (msg.text || msg.caption || '').trim();
  const photo = msg.photo?.length ? msg.photo[msg.photo.length - 1]
    : (msg.document && /^image\/(png|jpe?g|webp)$/i.test(msg.document.mime_type || '') ? msg.document : null);
  if (!chatId || (!body && !photo)) return;
  const who = msg.from?.first_name || msg.chat?.title || chatId;
  log(`MSG  ${who}: ${body.replace(/\s+/g, ' ').slice(0, 120)}${photo ? ' [photo]' : ''}`);
  const say = (m) => sendText(m, chatId).catch(() => {});

  if (/^\/?(retry|final)\b/i.test(body)) {
    const isRetry = /^\/?retry/i.test(body);
    say(isRetry ? '👍 Re-sending the last design to Canva…' : '👍 Getting the final from Canva…');
    try { await webCall(isRetry ? '/api/telegram/retry' : '/api/telegram/final', { chatId: String(chatId) }); }
    catch (e) { say(`❌ ${e.message}`); }
    return;
  }
  if (/^\/(start|help)\b/i.test(body)) return void say(HELP);

  // ---- read the message
  const urls = (body.match(URL_RE) || []).map((u) => u.replace(/[.,;!?]+$/, ''));
  const refLinks = urls.filter((u) => IG_RE.test(u) || PIN_RE.test(u) || IMG_RE.test(u));
  const productUrl = urls.find((u) => KAP_RE.test(u)) || '';
  let rest = body.replace(URL_RE, ' ').replace(/\s+/g, ' ').trim();
  const cm = rest.match(/\bx\s?(\d)\b|\b(\d)\s+(?:ideas?|designs?|options?)\b/i);
  const count = cm ? Math.min(4, Math.max(1, Number(cm[1] || cm[2]))) : 1;
  if (cm) rest = rest.replace(cm[0], ' ').replace(/\s+/g, ' ').trim();
  rest = rest.replace(/^\/?(?:create|design|recreate|make|build)\b[:,]?\s*/i, '').trim();

  let mode = 'design'; let source = ''; let instruction = '';
  const pm = rest.match(/\bpromote\s*[:\-–]?\s*(.+)$/i);
  const im = rest.match(/\b(?:persona|ideas?\s+for)\s*[:\-–]?\s*(.+)$/i);
  if (pm) { mode = 'promote'; source = pm[1].trim(); instruction = rest.slice(0, pm.index).trim(); }
  else if (im) { mode = 'idea'; source = im[1].trim(); instruction = rest.slice(0, im.index).trim(); }
  else if (refLinks.length || photo) instruction = rest;
  else if (rest.length >= 3) { mode = 'promote'; source = rest; }
  else return void say(HELP);

  const uploads = [];
  if (photo) {
    try {
      const f = await downloadFile(photo.file_id);
      uploads.push({ name: `telegram-${Date.now()}${f.ext}`, b64: f.buffer.toString('base64') });
    } catch (e) { return void say(`❌ I couldn't download that photo: ${e.message}`); }
  }
  const links = refLinks.slice(0, Math.max(0, 3 - uploads.length));

  try {
    const r = await webCall('/api/jobs', {
      mode, source: mode === 'design' ? '' : source, instruction, count, refLinks: links, uploads, productUrl,
      origin: 'telegram', chatId: String(chatId),
    });
    const jobs = r.jobs || [];
    const first = jobs[0];
    say(`👍 On it${msg.from?.first_name ? `, ${msg.from.first_name}` : ''} — ${jobs.length} design${jobs.length === 1 ? '' : 's'} queued`
      + `${first?.position > 1 ? ` (you're #${first.position} in the queue)` : ''}.\n`
      + 'I\'ll send each final picture here with its Canva link. Progress: the Tracker tab at http://127.0.0.1:5041');
  } catch (e) { say(`❌ ${e.message}`); }
}

const me = await getMe();
log(`telegram bot @${me.username} listening`);
log('waiting for a message — recreate a link, ideas for a persona, or promote something');

// Long-poll loop. `offset` acknowledges everything already seen, so a restart
// never reprocesses old messages.
//
// SELF-HEAL (2026-11-15): a long-lived process can lose its network state and never get it
// back — seen live: "POLL ERR fetch failed" every 5 s for hours, then an hour of SILENT
// hung polls (timeouts are not logged), while a brand-new process on the same PC reached
// Telegram first time. So if no poll has succeeded for STALE_MS, and no job is running,
// exit; the Kapruka-ig2img-autostart task (every 5 min) starts a fresh process.
const STALE_MS = 5 * 60_000;
let offset;
let lastOk = Date.now();
let staleNoted = false;
for (;;) {
  try {
    const updates = await getUpdates(offset);
    lastOk = Date.now();
    staleNoted = false;
    for (const u of updates) {
      offset = u.update_id + 1;
      if (u.message) handle(u.message);
    }
  } catch (e) {
    if (!/timeout|aborted/i.test(e.message)) {
      const cause = e.cause?.code || e.cause?.message || '';
      log(`POLL ERR ${e.message}${cause ? ` (${cause})` : ''}`);
      await new Promise((r) => setTimeout(r, 5000));   // back off on real errors
    }
    if (Date.now() - lastOk > STALE_MS) {
      if (!busy && !queue.length) {
        log(`POLL STALE — no successful poll for ${Math.round((Date.now() - lastOk) / 60_000)} min; exiting so autostart starts a fresh process`);
        process.exit(1);
      } else if (!staleNoted) {
        log('POLL STALE — waiting for the running job to finish before restarting');
        staleNoted = true;
      }
    }
  }
}
