// wa.mjs — outbound WhatsApp Cloud API: text + image replies.
// Mirrors tools/wa-send.sh's behaviour (incl. the closed-24h-window hint).
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { WA_TOKEN, WA_PHONE_ID, WA_ADMIN_NUMBER } from './env.mjs';

const GRAPH = 'https://graph.facebook.com/v21.0';

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.pdf': 'application/pdf' };

async function post(path, body, headers = {}) {
  const res = await fetch(`${GRAPH}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA_TOKEN()}`, ...headers },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || `HTTP ${res.status}`;
    const code = json?.error?.code;
    if ([131047, 131051].includes(code) || /re-?engag|24 ?hour|outside.*window/i.test(msg)) {
      throw Object.assign(new Error(`WhatsApp 24h window closed — reply to the thread, then retry. (${msg})`), { windowClosed: true });
    }
    throw new Error(`WhatsApp API: ${msg}`);
  }
  return json;
}

/** Send a plain text message. `to` defaults to the admin number. */
export async function sendText(text, to = WA_ADMIN_NUMBER()) {
  return post(`${WA_PHONE_ID()}/messages`, JSON.stringify({
    messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text',
    text: { preview_url: false, body: String(text).slice(0, 4090) },
  }), { 'Content-Type': 'application/json' });
}

/** Upload a local file to the WhatsApp media store; returns its media id. */
export async function uploadMedia(filePath) {
  const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
  const fd = new FormData();
  fd.set('messaging_product', 'whatsapp');
  fd.set('type', type);
  fd.set('file', new Blob([readFileSync(filePath)], { type }), basename(filePath));
  const { id } = await post(`${WA_PHONE_ID()}/media`, fd);
  if (!id) throw new Error(`media upload returned no id for ${filePath}`);
  return id;
}

/** Send a local image file with an optional caption. */
export async function sendImage(filePath, caption = '', to = WA_ADMIN_NUMBER()) {
  const id = await uploadMedia(filePath);
  return post(`${WA_PHONE_ID()}/messages`, JSON.stringify({
    messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'image',
    image: { id, ...(caption ? { caption: caption.slice(0, 1020) } : {}) },
  }), { 'Content-Type': 'application/json' });
}

/** Send a local document (e.g. the prompt .md) with an optional caption. */
export async function sendDocument(filePath, caption = '', to = WA_ADMIN_NUMBER()) {
  const id = await uploadMedia(filePath);
  return post(`${WA_PHONE_ID()}/messages`, JSON.stringify({
    messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'document',
    document: { id, filename: basename(filePath), ...(caption ? { caption: caption.slice(0, 1020) } : {}) },
  }), { 'Content-Type': 'application/json' });
}
