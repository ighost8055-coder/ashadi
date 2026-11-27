// gemini.mjs — generate an image in Gemini (gemini.google.com) in the attached Chrome, and save it.
//
// Same contract as meta.mjs's generateInMeta(): returns the saved file paths.
// Signed in on the account in the automation Chrome profile (a Pro plan, 2026-11-15).
//
// DOM facts this relies on (read 2026-11-15):
//   composer — div.ql-editor[role="textbox"] ("Enter a prompt for Gemini"), inside <rich-textarea>
//   submit   — a button whose aria-label contains "Send" (appears once text is typed); Enter as fallback
//   results  — <img> elements inside the model's response; generated images are large
//              (googleusercontent or blob: URLs). Gemini stamps a small visible sparkle
//              watermark in a corner — the design job's picture check crops it off.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { alreadySeen, markSeen } from './seen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const GEMINI_URL = process.env.IG2IMG_GEMINI_URL || 'https://gemini.google.com/app';

async function findComposer(page, { tries = 6, log }) {
  for (let i = 1; i <= tries; i++) {
    const el = page.locator('div.ql-editor[role="textbox"]:visible, [contenteditable="true"][aria-label*="prompt" i]:visible').first();
    if (await el.count().catch(() => 0)) return el;
    log(`  · Gemini composer not ready (${i}/${tries}), waiting…`);
    await sleep(4000);
    if (i % 3 === 0) { await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {}); await sleep(5000); }
  }
  return null;
}

/** Every large image currently on the page (generated results, not avatars/icons). */
async function resultUrls(page) {
  // Never the user's own upload: an attached layout sketch shows up as a big <img> in the
  // user's message and was captured as the "result" (seen 2026-11-17).
  // The exclusion must be EXACT element names: an earlier wildcard ([class*="attachment"] etc.) also matched a
  // wrapper of Gemini's own generated image, so a real result was rejected and the job timed out ("no image
  // within the time limit", 2026-11-17 — the image was sitting in the chat). Generated images live in
  // <generated-image>/<single-image>; prefer those, fall back to any large image outside the user's message.
  return page.evaluate(() => {
    const big = (im) => (im.naturalWidth >= 400 || im.width >= 300) && !/avatar|profile|logo|icon|gstatic\.com\/(images|lamda)/i.test(im.currentSrc || im.src);
    const users = 'user-query, user-query-file-preview, user-query-file-carousel, uploader-file-preview';
    const gen = [...document.querySelectorAll('generated-image img, single-image img')].filter((im) => !im.closest(users) && big(im));
    const pick = gen.length ? gen : [...document.querySelectorAll('img')].filter((im) => !im.closest(users) && big(im));
    return pick.map((im) => im.currentSrc || im.src).filter(Boolean);
  });
}

async function refusal(page) {
  return page.evaluate(() => {
    const t = document.querySelector('model-response:last-of-type')?.innerText || '';
    const m = t.match(/[^\n]*(I can'?t (create|generate|make)|I'?m (not able|unable) to (create|generate)|can'?t help with (that|images? of)|against (my|our) (policy|policies|guidelines))[^\n]*/i);
    return m ? m[0].trim().slice(0, 180) : null;
  }).catch(() => null);
}

/** Bigger original for googleusercontent images (the page shows a resized copy). */
const fullSize = (u) => (/googleusercontent\.com/.test(u) && /=[sw]\d+/.test(u) ? u.replace(/=[^/=]*$/, '=s0') : u);

async function download(page, url, log = () => {}) {
  // blob: images (how Gemini shows fresh results) are revoked right after they render, so
  // fetching them fails (seen 2026-11-15). Read the decoded <img> through a canvas at its
  // natural size instead — same-origin, so the canvas isn't tainted.
  if (/^blob:/i.test(url)) {
    const b64 = await page.evaluate(async (src) => {
      const im = [...document.querySelectorAll('img')].find((i) => (i.currentSrc || i.src) === src);
      if (!im) return null;
      if (!im.complete) await new Promise((r) => { im.onload = r; setTimeout(r, 5000); });
      if (!im.naturalWidth) return null;
      const c = document.createElement('canvas');
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      c.getContext('2d').drawImage(im, 0, 0);
      try { return c.toDataURL('image/png').split(',')[1]; } catch { return null; }
    }, url).catch(() => null);
    if (b64) return Buffer.from(b64, 'base64');
    log('  · could not read the blob image through a canvas');
    return null;
  }
  for (const u of [...new Set([fullSize(url), url])]) {
    // Images on googleusercontent are cross-origin: an in-page fetch() is blocked by CORS
    // (seen 2026-11-15 — every download came back empty). Fetch through the browser
    // context instead: same cookies/sign-in, no CORS. blob:/data: URLs only exist in-page.
    if (/^https?:/i.test(u)) {
      try {
        const res = await page.context().request.get(u, { headers: { Referer: 'https://gemini.google.com/' }, timeout: 60_000 });
        if (res.ok()) {
          const buf = await res.body();
          if (buf.length > 20_000) return buf;
        }
        log(`  · download attempt ${res.status()} for ${u.slice(0, 60)}…`);
      } catch (e) { log(`  · download error: ${e.message.slice(0, 80)}`); }
      continue;
    }
    const got = await page.evaluate(async (src) => {
      try {
        const res = await fetch(src, { credentials: 'include' });
        if (!res.ok) return null;
        const bytes = new Uint8Array(await res.arrayBuffer());
        let s = ''; const CH = 0x8000;
        for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
        return { b64: btoa(s), type: res.headers.get('content-type') || '' };
      } catch { return null; }
    }, u).catch(() => null);
    if (got) return Buffer.from(got.b64, 'base64');
  }
  return null;
}

const extOf = (buf) => (buf[0] === 0xff && buf[1] === 0xd8 ? 'jpg' : buf[0] === 0x89 && buf[1] === 0x50 ? 'png'
  : buf.slice(8, 12).toString() === 'WEBP' ? 'webp' : 'png');

export async function generateInGemini(browserish, promptText, outDir, {
  slug = 'render', want = 1, timeoutMs = 6 * 60_000, log = console.log, body = '', attach = [],
} = {}) {
  mkdirSync(outDir, { recursive: true });
  const page = await browserish.newPage();
  const saved = [];
  try {
    log('  → opening Gemini');
    await page.goto(GEMINI_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await sleep(5000);
    if (/accounts\.google\.com/.test(page.url())) throw new Error('Gemini is signed out in this Chrome profile — sign in at gemini.google.com, then retry.');

    const composer = await findComposer(page, { log });
    if (!composer) throw new Error('could not find the Gemini prompt box (UI changed, or the page failed to load)');
    const before = new Set(await resultUrls(page));

    // Attach the caller's layout sketch (the "+" menu → upload). A hidden file input may not
    // exist until the menu opens, so catch the file chooser the upload item raises.
    if (attach.length) {
      let ok = false;
      // 1) Paste the image(s) into the prompt box. Gemini's "Upload files" item opens the OS file
      //    dialog, which automation cannot catch (seen 2026-11-17: the file-chooser wait timed
      //    out); a paste event is accepted exactly like Ctrl+V of an image and attaches it.
      const previews = () => page.locator('uploader-file-preview, [class*="file-preview"], [data-test-id*="file-preview"]').count().catch(() => 0);
      const had = await previews();
      try {
        const files = attach.slice(0, 3).map((f) => ({ name: basename(f), type: /\.jpe?g$/i.test(f) ? 'image/jpeg' : /\.webp$/i.test(f) ? 'image/webp' : 'image/png', b64: readFileSync(f).toString('base64') }));
        await composer.click({ timeout: 8000 });
        await page.evaluate(({ files }) => {
          const dt = new DataTransfer();
          for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: f.type }));
          const el = document.querySelector('div.ql-editor[role="textbox"]');
          el.focus();
          el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        }, { files });
        for (let i = 0; i < 10 && !ok; i++) { await sleep(1000); ok = (await previews()) > had; }
      } catch (e) { log(`  · paste-attach didn't work (${e.message.slice(0, 80)}) — trying the upload menu`); }
      const direct = page.locator('input[type="file"]').first();
      if (!ok && await direct.count().catch(() => 0)) {
        ok = await direct.setInputFiles(attach.slice(0, 3)).then(() => true).catch(() => false);
      }
      if (!ok) {
        const plus = page.locator('button[aria-label*="upload" i], button[aria-label*="Open upload" i], button[aria-label*="add" i]:visible').first();
        try {
          await plus.click({ timeout: 8000 });
          await sleep(800);
          const item = page.locator('[role="menuitem"]:has-text("Upload"), button:has-text("Upload files")').first();
          const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 8000 }), item.click({ timeout: 8000 })]);
          await chooser.setFiles(attach.slice(0, 3));
          ok = true;
        } catch (e) { log(`  ! Gemini attach failed: ${e.message.slice(0, 100)}`); }
      }
      if (ok) { await sleep(4000); log(`  → attached ${Math.min(attach.length, 3)} image(s)`); }
      else {
        await page.screenshot({ path: join(outDir, `${slug}-gemini-attach-failed.png`) }).catch(() => {});
        throw new Error('could not attach the layout sketch in Gemini — screenshot saved in the run folder');
      }
    }

    // "Generate an image" up front so Gemini routes to its image model, not a text answer.
    const text = `Generate an image (do not describe it, create it).\n\n${body || promptText}`;
    log(`  → pasting the prompt (${text.length.toLocaleString()} chars)`);
    // The prompt box is a Quill rich-text editor: Playwright's fill() sets the DOM but Quill
    // never registers it, so Send stays disabled and nothing is sent (seen 2026-11-15 — a
    // test timed out after 6 min with no chat created). insertText fires real input events.
    await composer.click({ timeout: 15_000 });
    await page.keyboard.insertText(text);
    await sleep(800);
    const queriesBefore = await page.locator('user-query').count().catch(() => 0);
    const send = page.locator('button[aria-label*="Send" i]:visible').first();
    if (await send.count().catch(() => 0)) await send.click({ timeout: 8000 }).catch(() => page.keyboard.press('Enter'));
    else await page.keyboard.press('Enter');
    // Prove it was actually sent: the message must appear in the chat.
    let sent = false;
    for (let i = 0; i < 10 && !sent; i++) {
      await sleep(1000);
      sent = (await page.locator('user-query').count().catch(() => 0)) > queriesBefore;
    }
    if (!sent) {
      // Second try: Gemini can ignore the click while its tab is in the background (two
      // engines run at once). Bring it forward, re-focus the box and press Enter.
      await page.bringToFront().catch(() => {});
      await composer.click({ timeout: 8000 }).catch(() => {});
      await page.keyboard.press('Enter').catch(() => {});
      for (let i = 0; i < 10 && !sent; i++) {
        await sleep(1000);
        sent = (await page.locator('user-query').count().catch(() => 0)) > queriesBefore;
      }
    }
    if (!sent) {
      await page.screenshot({ path: join(outDir, `${slug}-gemini-send-failed.png`) }).catch(() => {});
      throw new Error('the prompt did not send in Gemini (Send button never accepted it) — screenshot saved in the run folder');
    }
    log('  → submitted. Generating…');

    const SETTLE_MS = 8000;
    const deadline = Date.now() + timeoutMs;
    let fresh = []; let lastKey = ''; let changedAt = Date.now();
    while (Date.now() < deadline) {
      await sleep(3000);
      fresh = (await resultUrls(page)).filter((u) => !before.has(u));
      const key = fresh.join('|');
      if (key !== lastKey) { lastKey = key; changedAt = Date.now(); }
      if (fresh.length >= want && Date.now() - changedAt >= SETTLE_MS) break;
      const no = await refusal(page);
      if (no) { const e = new Error(`Gemini refused this prompt: "${no}"`); e.refused = true; throw e; }
    }
    if (!fresh.length) {
      await page.screenshot({ path: join(outDir, `${slug}-gemini-no-image.png`) }).catch(() => {});
      const said = await page.evaluate(() => (document.querySelector('model-response:last-of-type')?.innerText || '').slice(0, 200)).catch(() => '');
      throw new Error(`Gemini produced no image within the time limit${said ? ` (it said: "${said.replace(/\s+/g, ' ')}")` : ''}`);
    }

    let got = 0;
    for (const u of [...fresh].reverse()) {                 // newest first
      if (got >= want) break;
      const buf = await download(page, u, log);
      if (!buf || buf.length < 20_000) { log(`  · couldn't download ${u.slice(0, 60)}…`); continue; }
      if (alreadySeen(buf)) { log('  · skipped an image Gemini re-showed from an earlier run'); continue; }
      markSeen(buf);
      got++;
      const file = join(outDir, `${slug}-gemini-${String(got).padStart(2, '0')}-raw.${extOf(buf)}`);
      writeFileSync(file, buf);
      saved.push(file);
      log(`  ✓ saved ${basename(file)} (${Math.round(buf.length / 1024)} KB)`);
    }
    if (!saved.length) throw new Error('Gemini returned no NEW image (only earlier ones, or none could be downloaded)');
    return saved;
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Ask Gemini (the signed-in browser chat) a question — text in, text out, optional images attached — and return
 * its answer. This is how Ashadi's thinking steps (measure, adapt, picture check, art director, fixer) run when the
 * Claude CLI is unavailable (usage limit, logged out): no API key, no Claude quota, just the Gemini Pro account the
 * automation Chrome is already signed in to. Images are attached by paste (the upload dialog can't be automated).
 */
export async function askGemini(browserish, promptText, { images = [], timeoutMs = 12 * 60_000, log = console.log } = {}) {
  const page = await browserish.newPage();
  try {
    await page.goto(GEMINI_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await sleep(5000);
    if (/accounts\.google\.com/.test(page.url())) throw new Error('Gemini is signed out in this Chrome profile — sign in at gemini.google.com, then retry.');
    const composer = await findComposer(page, { log });
    if (!composer) throw new Error('could not find the Gemini prompt box');

    if (images.length) {
      const previews = () => page.locator('uploader-file-preview, [class*="file-preview"], [data-test-id*="file-preview"]').count().catch(() => 0);
      const had = await previews();
      const files = images.slice(0, 10).map((f) => ({ name: basename(f), type: /\.jpe?g$/i.test(f) ? 'image/jpeg' : /\.webp$/i.test(f) ? 'image/webp' : 'image/png', b64: readFileSync(f).toString('base64') }));
      await composer.click({ timeout: 8000 });
      await page.evaluate(({ files }) => {
        const dt = new DataTransfer();
        for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: f.type }));
        const el = document.querySelector('div.ql-editor[role="textbox"]');
        el.focus();
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      }, { files });
      let ok = false;
      for (let i = 0; i < 20 && !ok; i++) { await sleep(1000); ok = (await previews()) > had; }
      if (!ok) throw new Error('could not attach the images in Gemini');
      await sleep(3000);
    }

    await composer.click({ timeout: 15_000 });
    await page.keyboard.insertText(promptText);
    await sleep(1200);
    const queriesBefore = await page.locator('user-query').count().catch(() => 0);
    const send = page.locator('button[aria-label*="Send" i]:visible').first();
    if (await send.count().catch(() => 0)) await send.click({ timeout: 8000 }).catch(() => page.keyboard.press('Enter'));
    else await page.keyboard.press('Enter');
    let sent = false;
    for (let i = 0; i < 15 && !sent; i++) { await sleep(1000); sent = (await page.locator('user-query').count().catch(() => 0)) > queriesBefore; }
    if (!sent) {
      await page.bringToFront().catch(() => {});
      await composer.click({ timeout: 8000 }).catch(() => {});
      await page.keyboard.press('Enter').catch(() => {});
      for (let i = 0; i < 15 && !sent; i++) { await sleep(1000); sent = (await page.locator('user-query').count().catch(() => 0)) > queriesBefore; }
    }
    if (!sent) throw new Error('the question did not send in Gemini');

    // Wait for the answer to finish: text stops changing and the Stop button is gone.
    const deadline = Date.now() + timeoutMs;
    let last = ''; let stableSince = Date.now(); let lastNote = Date.now();
    while (Date.now() < deadline) {
      await sleep(3000);
      const text = await page.evaluate(() => { const all = document.querySelectorAll('model-response'); return all.length ? all[all.length - 1].innerText : ''; }).catch(() => '');
      const busy = await page.locator('button[aria-label*="Stop" i]:visible').count().catch(() => 0);
      if (text !== last) { last = text; stableSince = Date.now(); }
      if (Date.now() - lastNote > 30_000) { lastNote = Date.now(); log(`  · waiting for Gemini… (${last.length} chars so far${busy ? ', still generating' : ''})`); }
      if (last.length > 20 && !busy && Date.now() - stableSince >= 7000) return last;
    }
    throw new Error('Gemini did not finish answering in time');
  } finally {
    await page.close().catch(() => {});
  }
}
