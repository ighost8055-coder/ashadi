// chatgpt.mjs — open a NEW chat on chatgpt.com in the attached Chrome, paste the
// prompt (optionally with real Kapruka brand assets attached), wait for the
// image(s), composite the real logo, and save them to disk.
//
// Deliberately defensive: ChatGPT's DOM changes often, so every selector has
// fallbacks and every wait has a hard ceiling.
//
// PRIMARY ENGINE (2026-09-14, human decision) — this account was previously free-tier
// (see run.mjs's 2026-08-28 note) and could not generate images at all; the automation
// profile now carries a real ChatGPT Plus login (confirmed live in the UI: "Plus" in
// the sidebar, a real generation completed end to end). Flow and Meta AI remain wired
// as fallbacks — see run.mjs.
//
// DOM facts this relies on (verified 2026-09-14):
//   composer     — #prompt-textarea (ProseMirror contenteditable)
//   file inputs  — real <input type="file"> elements exist directly in the DOM
//                  (#upload-photos, accept="image/*") — unlike Flow, no native OS
//                  file-chooser interception needed; setInputFiles() works directly.
//   results      — generated-image URLs route through
//                  /backend-api/estuary/content?id=... (NOT the older
//                  /backend-api/(files|content) shape — that regex silently matched
//                  nothing and every generation looked like it never finished).
//
// ATTACH WORKS MECHANICALLY BUT IS NOT BRAND-ACCURATE (tested 2026-09-14): the file
// genuinely uploads and ChatGPT acknowledges it, but a real Kapruka logo attached and
// asked for verbatim came back as a DIFFERENT, hallucinated logotype (a generic
// "Kapruka.com" + tree icon that doesn't exist in the real brand) — same failure mode
// meta.mjs already documented for Meta AI. `attach` support stays in this file (it may
// help for a non-exact-fidelity reference like a product photo's rough shape/colour —
// untested) but run.mjs deliberately does NOT pass a real brand asset to this engine.
// The logo is always applied afterwards via compositeLogo() (logo.mjs), pixel-exact,
// never trusted to in-generation attachment on this engine.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { compositeLogo } from './logo.mjs';
import { negativeBlock } from './negatives.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const COMPOSER = [
  '#prompt-textarea',
  'div[contenteditable="true"][id="prompt-textarea"]',
  'div.ProseMirror[contenteditable="true"]',
  'textarea[data-id]',
  'textarea',
];

// Real file inputs ChatGPT renders directly in the DOM (verified live 2026-09-14) —
// #upload-photos accepts image/* and is the one to target for a reference image.
const FILE_INPUT = ['#upload-photos', 'input[type="file"][accept*="image"]', 'input[type="file"]'];

const BRAND_PREAMBLE = [
  'Premium advertising image for Kapruka, Sri Lanka\'s online gifting and e-commerce brand.',
  'Vertical portrait.',
  'BRAND PALETTE — use these EXACT hex values, not an approximation or a generic purple/yellow/gold from your own training. Retail Purple #340A5C (the anchor — a deep near-black violet-purple, NOT a bright or saturated purple, NOT lavender, NOT magenta-leaning). Highlight yellow #FFC107 (a warm golden-amber yellow, NOT lemon, NOT neon, NOT pale). Soft Cream #F5F4EB (a warm off-white, NOT pure white, NOT grey). Luxury Gold #D9A441 (a MUTED antique gold, never bright yellow). Deep Purple #241044. If Kapruka packaging physically appears in the frame, it keeps its OWN true printed colours instead: Kapruka Purple #4B2386, Kapruka Yellow #FFD21E — these two are close to but distinct from the ad-palette purple/yellow above; do not swap them.',
  'The ground is a creative choice, not a quota: purple, cream, editorial white, near-black or a real photographic environment are all valid. Where on-image copy appears, set one word or two in #FFC107 unless it would collide with the background.',
  'All on-image text in Inter (clean geometric grotesque sans-serif), correctly spelled, no serif or script type, no em dash.',
  'THE LAYOUT BLOCK BELOW IS A SPECIFICATION, NOT A SUGGESTION. Follow every percentage, panel split, alignment and cap height exactly as written. Text alignment, line spacing and margins must be precise and even: type sits on a consistent baseline grid, optically centred where centred is specified, with equal margins left and right. No drifting, no ragged spacing, no type creeping toward an edge.',
  'Build the composition for the stated frame proportions. Do not crop, zoom or slice the subject or the type to make it fit.',
  'NO logo, NO wordmark, NO brand mark and NO tagline anywhere in the frame — leave the bottom-right corner clear and uncluttered.',
  'Photoreal elements must look like real professional photography: real texture, real light, no waxy AI sheen, no CG look.',
  'No counterfeit third-party brand logos or packaging.',
  'NO ALCOHOL of any kind: no beer, wine, spirits, cocktails, beer bottles or cans, wine or beer glasses, bar or pub settings, and no drinking. Use tea, coffee, king coconut or a soft drink instead.',
  '',
].join('\n');

async function findComposer(page) {
  for (const sel of COMPOSER) {
    const el = page.locator(sel).last();
    if (await el.count() && await el.isVisible().catch(() => false)) return el;
  }
  return null;
}

/** Type long text into the ProseMirror composer without triggering a submit. */
async function typePrompt(page, composer, text) {
  await composer.click();
  await sleep(300);
  const lines = text.replace(/\r/g, '').split('\n');
  for (const [i, line] of lines.entries()) {
    if (line) await page.keyboard.insertText(line);
    if (i < lines.length - 1) await page.keyboard.press('Shift+Enter');   // newline, never send
    if (i % 40 === 0) await sleep(60);                                    // let the editor keep up
  }
  await sleep(500);
}

/**
 * Every DISTINCT generated-image URL currently in the transcript.
 *
 * ChatGPT renders the SAME generated image at multiple DOM sizes at once (a full-size
 * view plus one or more thumbnail/grid copies), each as its own <img> with a slightly
 * different query string (size/sig/ts vary, `id=file_...` does not) — verified live
 * 2026-09-14: a single real generation produced 9 <img> elements collapsing to exactly
 * 2 distinct files by content hash. Deduping on the raw URL string undercounted nothing
 * (every copy is a real new <img>) but overcounted every real image 3-4x, which made
 * `want`/`variations` counting wrong and saved redundant copies. Dedupe on the file id
 * instead of the whole URL.
 */
async function imageUrls(page) {
  return page.evaluate(() => {
    // ChatGPT's generated-image URLs route through /backend-api/estuary/content
    // (verified live 2026-09-14) — the older /backend-api/(files|content) shape is
    // kept as a fallback in case a different surface still uses it.
    const ok = (s) => s && /oaiusercontent|\/backend-api\/.*\/(files|content)|\/backend-api\/(files|content)|sdmntpr|blob:/.test(s);
    const all = [...document.querySelectorAll('main img')]
      .map((img) => img.currentSrc || img.src)
      .filter((s) => ok(s) && !/avatar|profile/i.test(s));

    const seen = new Map();          // file id (or whole URL if no id) -> first URL seen
    for (const u of all) {
      const m = u.match(/[?&]id=([^&]+)/);
      const key = m ? m[1] : u;
      if (!seen.has(key)) seen.set(key, u);
    }
    return [...seen.values()];
  });
}

/** True while ChatGPT is still working (stop button present). */
async function isGenerating(page) {
  return page.evaluate(() => !!document.querySelector(
    'button[data-testid="stop-button"], button[aria-label*="Stop"], button[aria-label*="stop"]'
  ));
}

/**
 * Did ChatGPT refuse this generation? Seen as an assistant chat reply rather than a
 * dedicated failure card, same shape as Meta AI's refusal — see meta.mjs.
 */
async function refusal(page) {
  return page.evaluate(() => {
    const t = document.body.innerText || '';
    const m = t.match(/[^\n]*(can'?t (create|generate|make) (that|this)|unable to (create|generate)|against (our|the) (content policy|policies|usage policies)|i'?m not able to|sorry,? (i|but i) (can|cannot|can't))[^\n]*/i);
    return m ? m[0].trim().slice(0, 180) : null;
  }).catch(() => null);
}

/** Wait until at least `want` new images exist and the stream has settled. */
async function waitForImages(page, before, want, { timeoutMs = 6 * 60_000, log } = {}) {
  const deadline = Date.now() + timeoutMs;
  let stable = 0, last = -1;
  while (Date.now() < deadline) {
    await sleep(3000);
    const now = (await imageUrls(page)).filter((u) => !before.has(u));
    if (now.length >= want && !(await isGenerating(page))) {
      stable = now.length === last ? stable + 1 : 0;
      last = now.length;
      if (stable >= 2) return now;                    // count held steady ~6s after the stream ended
    } else {
      stable = 0; last = now.length;
    }
    const no = await refusal(page);
    if (no && now.length < want) { const e = new Error(`ChatGPT refused this prompt: "${no}"`); e.refused = true; throw e; }
    if ((Date.now() % 30_000) < 3100) log?.(`    …waiting (${now.length}/${want} image${want > 1 ? 's' : ''} so far)`);
  }
  const found = (await imageUrls(page)).filter((u) => !before.has(u));
  if (found.length) return found;                     // partial is better than nothing
  throw new Error('ChatGPT produced no image within the time limit (refusal, rate limit, or a stalled generation)');
}

/** Download an image from inside the page session (its URLs are auth-scoped). */
async function saveImage(page, url, fileNoExt) {
  const got = await page.evaluate(async (src) => {
    const res = await fetch(src);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    let s = ''; const bytes = new Uint8Array(buf);
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return { b64: btoa(s), type: res.headers.get('content-type') || '' };
  }, url).catch(() => null);
  if (!got) return null;

  const buf = Buffer.from(got.b64, 'base64');
  const ext = buf[0] === 0xff && buf[1] === 0xd8 ? 'jpg'
    : buf[0] === 0x89 && buf[1] === 0x50 ? 'png'
    : buf.slice(8, 12).toString() === 'WEBP' ? 'webp'
    : (got.type.split('/')[1] || 'bin').replace('jpeg', 'jpg');

  const file = `${fileNoExt}.${ext}`;
  writeFileSync(file, buf);
  return file;
}

function imageSize(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

/**
 * Attach reference image(s) via ChatGPT's real file input — no native OS file-chooser
 * interception needed (unlike Flow), ChatGPT renders a real <input type="file"> in the
 * DOM. Same direct setInputFiles() pattern as meta.mjs.
 */
async function attachFiles(page, files, log) {
  for (const sel of FILE_INPUT) {
    const input = page.locator(sel).first();
    if (await input.count().catch(() => 0)) {
      await input.setInputFiles(files.slice(0, 3)).catch((e) => { log?.(`  ! attach failed: ${e.message}`); return null; });
      await sleep(4000);                                  // let the upload thumbnail(s) settle in the composer
      log?.(`  → attached ${Math.min(files.length, 3)} reference image(s)`);
      return true;
    }
  }
  log?.('  ! no file input found — sending text only');
  return false;
}

/**
 * Run one prompt in a fresh ChatGPT chat.
 *
 * @param {object} opts
 * @param {string}   [opts.body]   the self-contained prompt body (preferred over the
 *                                 raw promptText — see BRAND_PREAMBLE, same convention
 *                                 as flow.mjs / meta.mjs)
 * @param {string[]} [opts.attach] real Kapruka brand assets (logo, packaging, product
 *                                 photo) to attach so the model renders the true
 *                                 asset instead of a generic interpretation — same
 *                                 role as flow.mjs's / meta.mjs's `attach`.
 * @returns {Promise<string[]>} saved image paths
 */
export async function generateInChatGPT(browserish, promptText, outDir, {
  variations = 1, slug = 'render', log = console.log,
  logo = true, body = '', attach = [], attachIsPackaging = attach.length > 0, upscaleTo = 3456,
} = {}) {
  mkdirSync(outDir, { recursive: true });
  const page = await browserish.newPage();
  const saved = [];
  try {
    log('  → opening a new ChatGPT chat');
    await page.goto('https://chatgpt.com/?temporary-chat=false', { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await sleep(4000);

    if (/auth0|login|\/auth\//i.test(page.url())) {
      throw new Error('ChatGPT is logged out in this Chrome profile — log into chatgpt.com in that window, then retry.');
    }

    const composer = await findComposer(page);
    if (!composer) throw new Error('could not find the ChatGPT composer (logged out, or the UI changed)');

    const before = new Set(await imageUrls(page));

    let attached = false;
    if (attach.length) attached = await attachFiles(page, attach, log);

    const attachNote = attached
      ? 'The attached image is a REAL Kapruka brand asset (logo/packaging/product photo) — use its '
        + 'true colours, logo, mascot and construction exactly as shown, composed into the NEW scene '
        + 'described below. Do not copy its background or crop; render it fresh.\n\n'
      : '';
    const text = attach.length ? BRAND_PREAMBLE + attachNote + negativeBlock() + '\n\n' + (body || promptText) : (body || promptText);
    log(`  → pasting the prompt (${text.length.toLocaleString()} chars)`);
    await typePrompt(page, composer, text);
    await page.keyboard.press('Enter');
    log('  → sent. Generating…');

    // A real brand asset already carries genuine Kapruka branding in the frame — pasting
    // a composited mark on top makes it a second logo (same reasoning as flow.mjs).
    const skipLogo = attached && attachIsPackaging;
    if (logo && skipLogo) log('  · skipping the composited logo — the attached brand asset already carries real Kapruka branding');

    let urls = await waitForImages(page, before, 1, { log });

    for (let v = 2; v <= variations; v++) {
      log(`  → asking for variation ${v}/${variations}`);
      const c2 = await findComposer(page);
      const seen = new Set([...before, ...urls]);
      await typePrompt(page, c2,
        'Generate another variation of exactly the same prompt above. Keep every brand rule, the copy, ' +
        'the palette and the crop identical. Change only the composition and camera angle.');
      await page.keyboard.press('Enter');
      const more = await waitForImages(page, seen, 1, { log });
      urls = [...urls, ...more];
    }

    for (const [i, u] of urls.entries()) {
      const n = String(i + 1).padStart(2, '0');
      const raw = await saveImage(page, u, join(outDir, `${slug}-gpt-${n}-raw`));
      if (!raw) continue;
      const src = imageSize(readFileSync(raw));

      const finished = logo
        ? await compositeLogo(browserish, raw, join(outDir, `${slug}-gpt-${n}.png`), { log, upscaleTo, skipLogo })
        : null;
      if (finished) {
        saved.push(finished);
        const out = imageSize(readFileSync(finished));
        log(`  ✓ saved ${basename(finished)} (${out ? `${out.w}x${out.h}` : 'native'}${skipLogo ? '' : ', real logo composited'})`);
      } else {
        saved.push(raw);
        log(`  ✓ saved ${basename(raw)}${src ? ` (${src.w}x${src.h}${logo && !skipLogo ? ' ⚠ logo step failed' : ''})` : ''}`);
      }
    }
    if (!saved.length) throw new Error('images appeared but none could be downloaded');
    return saved;
  } finally {
    await page.close().catch(() => {});
  }
}
