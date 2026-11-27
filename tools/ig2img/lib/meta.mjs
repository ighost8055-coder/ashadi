// meta.mjs — generate images in Meta AI (meta.ai) in the attached Chrome, and save them.
//
// Why Meta AI as the FIRST engine (2026-08-29): the same two prompts that Flow refused
// outright ("This generation might violate our policies") — a photoreal woman in visible
// distress, and a cute-illustration "head opens like a lid" gag — both generated on Meta
// AI without incident. Meta AI is also signed in on a real account and needs no paid
// tier, and its results come back at a higher native resolution (1920x1280 observed vs
// Flow's 896x1200). Flow stays wired in as the fallback for whatever Meta AI itself
// refuses or errors on — see run.mjs.
//
// DOM facts this relies on (verified 2026-08-29):
//   composer  — [data-testid="composer-input"]:visible (the page renders a SECOND,
//               hidden copy for a different layout breakpoint — :visible is required,
//               not optional, or the click silently times out against the hidden one)
//   submit    — button[aria-label="Send"]:visible
//   results   — the generated image is an <img> served from scontent.xx.fbcdn.net
//               (t39.105495-1 or t58.90637-1 paths seen), natural size ~1920x1280.
//               The page also renders decorative <img> elements (the "orbit" thinking
//               logo, the user's profile picture) that must be filtered out — see
//               IGNORE_SRC and the pre-submit baseline below.
import { writeFileSync, readFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { compositeLogo } from './logo.mjs';
import { negativeBlock } from './negatives.mjs';
import { alreadySeen, markSeen } from './seen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- never return an OLD image as a new result (bug found 2026-11-15) ----
// A design run "generated" a picture that was byte-for-byte that morning's render: after
// submit, meta.ai can show earlier creations on the page, and the old wait loop took the
// FIRST new <img> it saw. Two guards now: (1) wait for the result set to settle and take
// the newest image first, (2) the shared fingerprint index in lib/seen.mjs — a candidate
// whose bytes were saved before (by any engine) is rejected, whatever the page does.

export const META_URL = process.env.IG2IMG_META_URL || 'https://www.meta.ai/';

// Decorative chrome that is NOT a generation result: the "thinking" orbit animation,
// the small emoji/avatar sprite, and the user's own profile picture.
const IGNORE_SRC = /cot_logo_static|_tN6hYY4oeH|fbcdn\.net\/rsrc\.php/i;

const BRAND_PREAMBLE = [
  'Premium advertising image for Kapruka, Sri Lanka\'s online gifting and e-commerce brand.',
  'Vertical portrait, 4:5 aspect ratio (1080×1350). Keep every headline, logo space and product at least 8% in from all four edges — the image is centre-cropped to exactly 4:5 afterwards.',
  'BRAND PALETTE — use these EXACT hex values, not an approximation or a generic purple/yellow/gold from your own training. Retail Purple #340A5C (the anchor — a deep near-black violet-purple, NOT a bright or saturated purple, NOT lavender, NOT magenta-leaning). Highlight yellow #FFC107 (a warm golden-amber yellow, NOT lemon, NOT neon, NOT pale). Soft Cream #F5F4EB (a warm off-white, NOT pure white, NOT grey). Luxury Gold #D9A441 (a MUTED antique gold, never bright yellow). Deep Purple #241044. If Kapruka packaging physically appears in the frame, it keeps its OWN true printed colours instead: Kapruka Purple #4B2386, Kapruka Yellow #FFD21E — these two are close to but distinct from the ad-palette purple/yellow above; do not swap them.',
  'The ground is a creative choice, not a quota: purple, cream, editorial white, near-black or a real photographic environment are all valid. Where on-image copy appears, set one word or two in #FFC107 unless it would collide with the background. NEVER put an outline, stroke or shadow of any colour behind yellow type (a purple outline behind a yellow word is a specific, banned failure — it reads as a cheap sticker/decal effect, not premium type). If #FFC107 would not hold contrast on the chosen ground, move the word to a darker patch of the ground instead, or drop the yellow highlight and keep the line in Retail Purple #340A5C — never add a stroke to force it to work.',
  'All on-image text in Inter (clean geometric grotesque sans-serif), correctly spelled, no serif or script type, no em dash.',
  'EASY TO PROCESS — the frame must be effortless for the eye. FIGURE/GROUND: the hero must differ from its background on at least TWO of size, value (light/dark), saturation and shape — one is not enough. Never place the hero inside a background that shares its visual language (small bright shapes on a ground already full of small bright shapes reads as one busy texture). If the background is the most saturated, most detailed or most contrasty thing in frame, calm it down — darken, desaturate, blur or simplify it — so the hero wins. The products being sold must never be the quietest elements in the frame. HIERARCHY: there is ONE clear first stop for the eye, then a path — one element biggest/brightest/most central, everything else demonstrably secondary. Never place several items at equal size with equal emphasis scattered in an arc. Fewer, bigger, calmer beats more, smaller, busier.',
  'THE LAYOUT BLOCK BELOW IS A SPECIFICATION, NOT A SUGGESTION. Follow every percentage, panel split, alignment and cap height exactly as written. Text alignment, line spacing and margins must be precise and even: type sits on a consistent baseline grid, optically centred where centred is specified, with equal margins left and right. No drifting, no ragged spacing, no type creeping toward an edge.',
  'Build the composition for the stated frame proportions. Do not crop, zoom or slice the subject or the type to make it fit.',
  'NO logo, NO wordmark, NO brand mark and NO tagline anywhere in the frame — leave the bottom-right corner clear and uncluttered.',
  'NO INVENTED SUB-TEXT ON ANY OBJECT. Do not print, letter or label ANY text onto packaging, boxes, bags, labels, tags, gift cards, signage, vehicle panels, aprons or cups unless this prompt names the exact words to render. Never invent a slogan, strapline, tagline or brand line and print it on a surface — cleanly-rendered invented brand copy is a false claim, worse than garbled text because it looks legitimate. If a surface would carry text and no exact string was given, leave that surface BLANK.',
  'MATERIAL REALISM — binds EVERY element in EVERY image, even a deliberately impossible or graphic one: a scene may be impossible, but a surface may never be fake. Fur reads as fur with individual strands and direction, fabric as fabric with weave and real drape, skin as skin with visible pores and subsurface warmth, metal/glass/ceramic each behaving correctly. NO plastic-looking, waxy, over-smoothed or CG-putty surfaces on anything. One coherent light logic across the whole frame: every element lit from the same direction, shadows falling the same way with matching softness, correct light wrap where a subject meets its ground, and a real contact shadow wherever an object touches a surface (a floating object with no contact shadow is the clearest failure). Correct anatomy and construction — no melted, warped, fused or duplicated detail. Real edges — no cut-out halo, no eroded fringe, no visible masking line. Type rendered correctly — real letterforms, correct spelling, no garbled invented sub-text on labels or packaging. The idea may be impossible; nothing in the frame may look cheaply made.',
  'Photoreal elements must look like a REAL PHOTOGRAPH SOMEONE TOOK — not an advertisement, not a stock photo, not a render. Hold this floor on every photoreal element: ONE large soft directional light from the side (a window or a practical), low contrast, gentle falloff into shadow — never flash, never a studio rig, never flat frontal fill, which is the fastest "this is an ad" tell. Visible skin pores and fine lines, real fabric wrinkles, worn and handled surfaces, no airbrushing and no skin smoothing. Fine natural film grain, mild vignetting, gentle highlight roll-off, realistic lens character. Genuine shallow depth of field from the stated aperture, focal plane sharp on the eyes. Eye-level camera height. A candid in-between moment: the subject absorbed and caught mid-action, NOT posing and NOT smiling at the lens. A lived-in environment, not a spotless propped set. No waxy AI sheen, no CG look, no HDR glow, no cinematic grading, no glossy stock-photo polish.',
  'No counterfeit third-party brand logos or packaging.',
  'NO ALCOHOL of any kind: no beer, wine, spirits, cocktails, beer bottles or cans, wine or beer glasses, bar or pub settings, and no drinking. Use tea, coffee, king coconut or a soft drink instead.',
  '',
].join('\n');

/** The visible composer — the page renders a hidden duplicate for another breakpoint. */
async function findComposer(page, { tries = 6, log = console.log } = {}) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    const el = page.locator('[data-testid="composer-input"]:visible').first();
    if (await el.count().catch(() => 0)) return el;
    if (attempt < tries) {
      log(`  · composer not ready (attempt ${attempt}/${tries}), waiting…`);
      await sleep(5000);
      if (attempt % 3 === 0) {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
        await sleep(6000);
      }
    }
  }
  return null;
}

async function typePrompt(page, composer, text) {
  await composer.click({ timeout: 15_000 });
  await composer.fill(text);
  await sleep(400);
}

async function submit(page) {
  const btn = page.locator('button[aria-label="Send"]:visible').first();
  if (await btn.count().catch(() => 0)) {
    await btn.click({ timeout: 8000 }).catch(async () => { await page.keyboard.press('Enter'); });
  } else {
    await page.keyboard.press('Enter');
  }
}

/** Every real result image currently on the page — decorative chrome filtered out. */
async function resultUrls(page) {
  return page.evaluate((ignoreSrc) => {
    const re = new RegExp(ignoreSrc, 'i');
    return [...document.querySelectorAll('img')]
      .filter((im) => (im.naturalWidth > 300 || im.width > 300) && !re.test(im.currentSrc || im.src))
      .map((im) => im.currentSrc || im.src)
      .filter(Boolean);
  }, IGNORE_SRC.source);
}

/**
 * Did Meta AI refuse this generation?
 *
 * Seen as an assistant chat reply rather than a dedicated failure card, so the check
 * looks for refusal PHRASING in the page text, not a fixed error element.
 */
async function refusal(page) {
  return page.evaluate(() => {
    const t = document.body.innerText || '';
    const m = t.match(/[^\n]*(can'?t (create|generate|make) (that|this)|not able to (create|generate)|against (our|my) (policy|policies|guidelines)|sorry,? i (can|cannot|can't))[^\n]*/i);
    return m ? m[0].trim().slice(0, 180) : null;
  }).catch(() => null);
}

async function save(page, url, fileNoExt) {
  const got = await page.evaluate(async (src) => {
    const res = await fetch(src);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let s = ''; const CH = 0x8000;
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
  if (buf[0] === 0x89 && buf[1] === 0x50) {                       // PNG
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {                       // JPEG — scan markers
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      const len = buf.readUInt16BE(i + 2);
      i += 2 + len;
    }
  }
  return null;
}

/**
 * @param {object} opts
 * @param {string}   [opts.body]   the self-contained prompt body (preferred over the
 *                                 full spec+prompt paste text — see BRAND_PREAMBLE)
 * @param {string[]} [opts.attach] reference images to attach. Unlike the Instagram
 *                                 reference (never attached — see run.mjs's "NO
 *                                 ATTACHMENT" note, it flips Nano Banana into
 *                                 image-EDIT mode and hands the source back verbatim),
 *                                 a Kapruka BRAND ASSET (cake box, packaging) attaches
 *                                 fine here: tested 2026-08-31, the model renders a
 *                                 fresh scene using the asset's real colours/logo/
 *                                 mascot instead of copying it back untouched.
 */
export async function generateInMeta(browserish, promptText, outDir, {
  slug = 'render', want = 1, timeoutMs = 5 * 60_000, log = console.log,
  // 3456 wide = 3456x4320 at 4:5 (human decision, 2026-09-29; was 2160). Meta AI renders
  // ~1300-1900px natively, so this is a ~2x resample, not detail synthesis — it cannot
  // invent detail the model never drew. True 8K (6912x8640) was considered and rejected:
  // a ~5x upscale from this source is a big, soft file, not a detailed one. The `8K` cue
  // in prompt text is a DETAIL instruction to the model, unrelated to this output size.
  logo = true, body = '', upscaleTo = 3456, attach = [], rawPrompt = false,
} = {}) {
  mkdirSync(outDir, { recursive: true });
  const page = await browserish.newPage();
  const saved = [];
  try {
    log('  → opening Meta AI');
    await page.goto(META_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await sleep(4000);

    if (/log ?in|sign ?up/i.test(await page.evaluate(() => document.body.innerText.slice(0, 200)).catch(() => ''))) {
      throw new Error('Meta AI is logged out in this Chrome profile — sign in at meta.ai, then retry.');
    }

    const composer = await findComposer(page, { log });
    if (!composer) throw new Error('could not find the Meta AI composer (UI changed, or the page failed to load)');

    // Baseline BEFORE submit: unlike Flow's project gallery, meta.ai's chat has no
    // late-loading history dump, so there is no need to wait for it to "settle" — but
    // a stale image already on the page (a prior chat's result) must not count as new.
    const before = new Set(await resultUrls(page));

    if (attach.length) {
      const input = page.locator('input[type="file"]').first();
      if (await input.count().catch(() => 0)) {
        await input.setInputFiles(attach.slice(0, 3)).catch((e) => log(`  ! attach failed: ${e.message}`));
        await sleep(4000);                                // let the upload thumbnail settle
        log(`  → attached ${Math.min(attach.length, 3)} reference image(s)`);
      } else {
        log('  ! no file input found — sending text only');
      }
    }

    const attachNote = attach.length
      ? 'The attached image is a REAL Kapruka brand asset (packaging/product photo) — use its '
        + 'true colours, logo, mascot and construction exactly as shown, composed into the NEW '
        + 'scene described below. Do not copy its background or crop; render it fresh.\n\n'
      : '';
    // rawPrompt: the caller (design.mjs) sends its own complete prompt — the house preamble
    // talks about on-image copy and attached logos, which a text-free picture layer must not get.
    const text = rawPrompt ? (body || promptText) : BRAND_PREAMBLE + attachNote + negativeBlock() + '\n\n' + (body || promptText);
    log(`  → pasting the prompt (${text.length.toLocaleString()} chars)`);
    await typePrompt(page, composer, text);
    await submit(page);
    log('  → submitted. Generating…');

    // Wait until the set of new images has stopped changing for SETTLE_MS — not just until
    // the first one shows up, because an earlier creation can render before the real result.
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
      if (no) { const e = new Error(`Meta AI refused this prompt: "${no}"`); e.refused = true; throw e; }
    }
    if (!fresh.length) throw new Error('Meta AI produced no image within the time limit');

    // Newest first (the real result renders after anything Meta re-shows); skip any image
    // whose exact bytes were saved before.
    let got = 0;
    for (const u of [...fresh].reverse()) {
      if (got >= want) break;
      const n = String(got + 1).padStart(2, '0');
      const raw = await save(page, u, join(outDir, `${slug}-meta-${n}-raw`));
      if (!raw) continue;
      const bytes = readFileSync(raw);
      if (alreadySeen(bytes)) {
        log('  · skipped an image Meta re-showed from an earlier run (already saved before)');
        try { unlinkSync(raw); } catch {}
        continue;
      }
      markSeen(bytes);
      got++;
      const src = imageSize(bytes);

      const finished = logo
        ? await compositeLogo(browserish, raw, join(outDir, `${slug}-meta-${n}.png`), { log, upscaleTo })
        : null;
      if (finished) {
        saved.push(finished);
        const out = imageSize(readFileSync(finished));
        log(`  ✓ saved ${basename(finished)} (${out ? `${out.w}x${out.h}` : 'native'}, real logo composited)`);
      } else {
        saved.push(raw);
        log(`  ✓ saved ${basename(raw)}${src ? ` (${src.w}x${src.h}${logo ? ' ⚠ logo step failed' : ''})` : ''}`);
      }
    }
    if (!saved.length) throw new Error('Meta AI returned no NEW image (only earlier ones, or none could be downloaded)');
    if (saved.length < want) log(`  · got ${saved.length}/${want} new image(s)`);
    return saved;
  } finally {
    await page.close().catch(() => {});
  }
}
