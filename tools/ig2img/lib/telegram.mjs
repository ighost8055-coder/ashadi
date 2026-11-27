// telegram.mjs — Telegram Bot API: send text/photos, and long-poll for messages.
//
// Why this exists alongside wa.mjs: Telegram bots PULL their updates, so the PC
// needs no public URL — no tunnel, no DNS, no Meta app config, and no 24-hour
// reply window. Same pipeline behind it, different front door.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { env } from './env.mjs';

const TOKEN = () => env(['TELEGRAM_BOT_TOKEN']);
const api = (method) => `https://api.telegram.org/bot${TOKEN()}/${method}`;

async function call(method, body, { timeoutMs = 60_000, keepalive = true } = {}) {
  const res = await fetch(api(method), {
    method: 'POST',
    ...(body instanceof FormData
      ? { body }
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
    // getUpdates holds a connection open for up to 50s server-side, thousands of
    // times a day. Undici's keep-alive pool reuses sockets across those long holds
    // and — over many hours — accumulates ones the OS/network has quietly killed,
    // failing with a bare "fetch failed". Forcing a fresh connection for the
    // long-poll avoids resurrecting a dead pooled socket. Seen live 2026-09-12:
    // 15,000+ POLL ERR occurrences in one day, clearing only on process restart.
    ...(keepalive ? {} : { headers: { ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), Connection: 'close' } }),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description || res.status}`);
  return json.result;
}

/** Download a file the user sent (photo or image document) -> { buffer, ext }. */
export async function downloadFile(fileId) {
  const f = await call('getFile', { file_id: fileId });
  const res = await fetch(`https://api.telegram.org/file/bot${TOKEN()}/${f.file_path}`, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Telegram file download failed (${res.status})`);
  const ext = (String(f.file_path).match(/\.(png|jpe?g|webp)$/i)?.[0] || '.jpg').toLowerCase();
  return { buffer: Buffer.from(await res.arrayBuffer()), ext };
}

/** Who am I? Used at startup to prove the token works. */
export const getMe = () => call('getMe', {});

export function sendText(text, chatId) {
  return call('sendMessage', { chat_id: chatId, text: String(text).slice(0, 4000), disable_web_page_preview: true });
}

/** Send an image. `asFile` sends it uncompressed (Telegram compresses photos). */
export async function sendImage(filePath, caption = '', chatId, { asFile = false } = {}) {
  const fd = new FormData();
  fd.set('chat_id', String(chatId));
  if (caption) fd.set('caption', caption.slice(0, 1000));
  const blob = new Blob([readFileSync(filePath)]);
  if (asFile) {
    fd.set('document', blob, basename(filePath));
    return call('sendDocument', fd, { timeoutMs: 180_000 });
  }
  fd.set('photo', blob, basename(filePath));
  return call('sendPhoto', fd, { timeoutMs: 180_000 });
}

/**
 * Long-poll for new messages. Resolves with an array of updates; blocks up to
 * `timeout` seconds server-side, which is why this costs nothing while idle.
 */
export function getUpdates(offset, { timeout = 50 } = {}) {
  return call('getUpdates', { offset, timeout, allowed_updates: ['message'] },
    { timeoutMs: (timeout + 15) * 1000, keepalive: false });
}
