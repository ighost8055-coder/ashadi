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
import { getMe, getUpdates, sendText, sendImage } from './lib/telegram.mjs';
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

async function handle(msg) {
  const chatId = msg.chat?.id;
  const body = msg.text || msg.caption || '';
  if (!chatId || !body) return;
  const who = msg.from?.first_name || msg.chat?.title || chatId;
  log(`MSG  ${who}: ${body.replace(/\s+/g, ' ').slice(0, 120)}`);

  if (/^\/?retry\b/i.test(body.trim())) {
    sendText('👍 Re-sending the last design to Canva…', chatId).catch(() => {});
    queue.push({ mode: 'retry', chatId });
    return void drain();
  }

  if (/^\/?final\b/i.test(body.trim())) {
    sendText('👍 Getting the final from Canva…', chatId).catch(() => {});
    queue.push({ mode: 'final', chatId });
    return void drain();
  }

  if (/^\/start\b/.test(body)) {
    return void sendText(
      'Send me a message and I\'ll figure out which of three things you want:\n\n'
      + '1) Rebuild an Instagram post as a Kapruka design in Canva — send the link + "create"\n'
      + '   e.g. create <link>  ·  create <link> use the flower box\n'
      + '   You get a preview + a Canva link where every word is editable. Reply "final" when you\'re done editing.\n\n'
      + '2) Ideas for a persona — no link needed\n'
      + '   e.g. "give me 3 ideas for the romantic local gifter"\n\n'
      + '3) Promote something Kapruka does — no link needed\n'
      + '   e.g. "promote same-day delivery" or "promote corporate gifting x2"',
      chatId).catch(() => {});
  }

  let job;
  try {
    job = await classifyMessage(body, { log });
  } catch (e) {
    log(`ERR  classify: ${e.message}`);
    return void sendText('Couldn\'t work out what you meant there — try again?', chatId).catch(() => {});
  }

  if (job.mode === 'none') {
    sendText('Not sure what to build there. Send an Instagram link + "create", ask for ideas for a persona, or ask me to promote something — /start for examples.', chatId).catch(() => {});
    return;
  }
  if (job.mode === 'recreate' && !job.link) {
    sendText('Send an Instagram post link along with what you want done with it.', chatId).catch(() => {});
    return;
  }
  if (job.mode === 'idea' && !job.persona) {
    sendText('Which persona? e.g. "ideas for the romantic local gifter".', chatId).catch(() => {});
    return;
  }
  if (job.mode === 'promote' && !job.thing) {
    sendText('Promote what, exactly? e.g. "promote same-day delivery".', chatId).catch(() => {});
    return;
  }

  const label = job.mode === 'recreate' ? 'measuring that post and rebuilding it for Kapruka in Canva (takes ~10-15 min)'
    : job.mode === 'idea' ? `researching ideas for "${job.persona}"`
    : `checking "${job.thing}" and finding the angle`;
  sendText(`👍 On it${msg.from?.first_name ? `, ${msg.from.first_name}` : ''} — ${label}.`
    + (job.instruction ? `\nFollowing your note: "${job.instruction}"` : ''), chatId).catch(() => {});

  // "x3"/"3 ideas" means two different things depending on mode: for recreate it's how
  // many image VARIATIONS to render per prompt (the prompt count itself stays fixed at
  // 2 — faithful copy + take, this track's existing design); for idea/promote there's no
  // such fixed pair, so the count instead picks how many DISTINCT ideas to write.
  queue.push({
    mode: job.mode, link: job.link, persona: job.persona, thing: job.thing,
    chatId, instruction: job.instruction,
    variations: job.mode === 'recreate' ? job.variations : 1,
    maxPrompts: job.mode === 'recreate' ? 2 : job.variations,
  });
  drain();
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
