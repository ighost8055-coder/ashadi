// notify.mjs — one small interface over the two front doors, so run.mjs doesn't
// care whether a job arrived from WhatsApp or Telegram; it just replies on the
// channel the request came in on.
import * as wa from './wa.mjs';
import * as tg from './telegram.mjs';

/**
 * @param {'whatsapp'|'telegram'|'none'} channel
 * @param {string|number} to  chat id (Telegram) or phone number (WhatsApp)
 */
export function notifier(channel, to) {
  if (channel === 'telegram') {
    return {
      channel,
      text: (msg) => tg.sendText(msg, to),
      // asFile: Telegram's photo mode re-encodes to JPEG and softens the type,
      // which is exactly what these ads are judged on. Sent as a document, the
      // 1080x1350 PNG arrives byte-for-byte.
      image: (file, caption) => tg.sendImage(file, caption, to, { asFile: true }),
    };
  }
  if (channel === 'whatsapp') {
    return {
      channel,
      text: (msg) => wa.sendText(msg, to),
      image: (file, caption) => wa.sendImage(file, caption, to),
    };
  }
  const noop = async () => {};
  return { channel: 'none', text: noop, image: noop };
}
