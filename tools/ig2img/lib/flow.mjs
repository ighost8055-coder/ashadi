// flow.mjs — generate images in Google Labs "Flow" (Nano Banana Pro) in the
// attached Chrome, and save them.
//
// Why Flow as well as ChatGPT: the automation profile's ChatGPT account is on the
// free tier (no image generation), while Flow is signed in on a PRO account whose
// composer is forced to Nano Banana Pro / 3:4 / x1 by configureComposer(), and
// strong in-frame text rendering, which is exactly what ad recreations need.
//
// DOM facts this relies on (verified 2026-08-27):
//   composer  — the visible [contenteditable] (the FIRST <textarea> on the page is
//               the hidden g-recaptcha-response field, never the composer)
//   submit    — the button labelled "Create" / arrow_forward
//   results   — img[alt="Generated image"], src is
//               labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=<uuid>,
//               natural size 896x1200
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { compositeLogo } from './logo.mjs';
import { negativeBlock } from './negatives.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const FLOW_PROJECT = process.env.IG2IMG_FLOW_PROJECT
  || 'https://labs.google/fx/tools/flow/project/d4112722-b1d9-4b43-b8a1-e8318d67b6ed';

/**
 * Did Flow REFUSE this generation?
 *
 * A refused prompt is not a slow prompt: Flow prints "Failed — This generation might
 * violate our policies" into the results area and then does nothing, for ever. Without
 * this check the run waited out the full 8-minute timeout, reported "produced no image
 * within the time limit", retried the identical prompt, and failed again — 25 minutes to
 * learn nothing. Seen live 2026-08-28.
 */
async function refusal(page) {
  return page.evaluate(() => {
    const t = document.body.innerText || '';
    const m = t.match(/[^\n]*(might violate our policies|violates? our polic|content policy|can'?t generate|unable to generate)[^\n]*/i);
    return m ? m[0].trim().slice(0, 180) : null;
  }).catch(() => null);
}

/** Every generated-image URL currently on the page. */
async function resultUrls(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('img[alt="Generated image"], img[alt*="Generated"]')]
      .map((i) => i.currentSrc || i.src)
      .filter(Boolean));
}

/**
 * Wait until the project gallery has finished lazy-loading, then return its contents.
 *
 * CRITICAL: the gallery holds ZERO images at page load and fills in several seconds
 * later (measured 0 → 20 in ~6s). Snapshotting the baseline too early means every old
 * image that loads afterwards looks "new" — and the run delivers someone's earlier
 * renders instead of this one's. Bug found live 2026-08-28.
 */
async function stableBaseline(page, { log = console.log, timeoutMs = 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = -1, steady = 0;
  while (Date.now() < deadline) {
    const urls = await resultUrls(page);
    if (urls.length === last) {
      if (++steady >= 3) return new Set(urls);      // unchanged over ~6s
    } else {
      steady = 0; last = urls.length;
    }
    await sleep(1500);
  }
  log('  ! gallery never settled — baseline may be incomplete');
  return new Set(await resultUrls(page));
}

/**
 * Find the composer, waiting for it and reloading once if it never appears.
 *
 * A second prompt in the same run opens Flow again moments after the first finished,
 * and the app is often still hydrating — a single synchronous check finds nothing and
 * the whole prompt gets thrown away (seen live 2026-08-28: prompt 1 rendered, prompt 2
 * died on "could not find the Flow composer").
 */
async function findComposer(page, { tries = 6, log = console.log } = {}) {
  // Deliberately NOT 'textarea' first — that matches the hidden recaptcha field.
  const SELECTORS = ['[contenteditable="true"]:visible', 'textarea:visible'];
  for (let attempt = 1; attempt <= tries; attempt++) {
    for (const sel of SELECTORS) {
      const el = page.locator(sel).first();
      if (await el.count().catch(() => 0)) return el;
    }
    if (attempt < tries) {
      log(`  · composer not ready (attempt ${attempt}/${tries}), waiting…`);
      await sleep(6000);
      // Reload on every third miss, not only once near the end. Flow's SPA sometimes
      // settles into a state where the editor never mounts, and only a reload fixes it —
      // three attempts with a single late reload gave up while it was still recoverable.
      if (attempt % 3 === 0) {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
        await sleep(9000);
      }
    }
  }
  return null;
}

/**
 * Close any open Radix popover.
 *
 * The composer settings live in a popper panel, and while it is open it swallows pointer
 * events for the whole editor — clicking the prompt box then times out after 60s against
 * "<div …> from <div data-radix-popper-content-wrapper> subtree intercepts pointer
 * events". Anything that touches those controls has to shut the panel behind it.
 */
async function dismissPopovers(page) {
  for (let i = 0; i < 3; i++) {
    const open = await page.locator('[data-radix-popper-content-wrapper]').count().catch(() => 0);
    if (!open) return;
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(500);
  }
  // Escape did not take — click a dead area of the page instead.
  await page.mouse.click(8, 8).catch(() => {});
  await sleep(500);
}

async function typePrompt(page, composer, text) {
  // Belt and braces: an overlay left over from any earlier interaction swallows this
  // click and stalls the whole run for a minute. Clear it, and force the click if the
  // normal one is still intercepted.
  await dismissPopovers(page);
  await composer.click({ timeout: 15_000 }).catch(async () => {
    await dismissPopovers(page);
    await composer.click({ timeout: 15_000, force: true });
  });
  await sleep(400);
  const lines = text.replace(/\r/g, '').split('\n');
  for (const [i, line] of lines.entries()) {
    if (line) await page.keyboard.insertText(line);
    if (i < lines.length - 1) await page.keyboard.press('Shift+Enter');
    if (i % 40 === 0) await sleep(60);
  }
  await sleep(800);
}

/**
 * Force the composer's model / aspect / variant-count instead of inheriting whatever the
 * UI last remembered.
 *
 * This mattered more than it looks. The composer had been left on **x1** while the code
 * waited for **3** new images, so every prompt sat out the full 8-minute timeout waiting
 * for two variants that were never coming — that was most of the ten-minute run.
 *
 * Returns the variant count actually in force, so the caller can wait for exactly that
 * many and stop.
 */
async function configureComposer(page, { model = 'Nano Banana Pro', aspect = '3:4', count = 1, log } = {}) {
  const summary = () => page.evaluate(() => {
    const b = [...document.querySelectorAll('button,[role="button"]')]
      .map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim())
      .find((t) => /Nano Banana/i.test(t) && /x\d/.test(t));
    return b || '';
  }).catch(() => '');

  // The summary button states the whole configuration in one string, e.g.
  //   "🍌 Nano Banana Pro crop_portrait x1"
  // so the current settings can be READ instead of clicked blind. That matters: every
  // click here opens a popover, and an open popover blocks the prompt box.
  const ASPECT_TOKEN = {
    '16:9': 'crop_16_9', '4:3': 'crop_landscape', '1:1': 'crop_square',
    '3:4': 'crop_portrait', '9:16': 'crop_9_16',
  };
  const before = await summary();
  const okModel = new RegExp(model.replace(/\s+/g, '\\s+'), 'i').test(before);
  const okAspect = before.includes(ASPECT_TOKEN[aspect] || aspect);
  const okCount = new RegExp(`\\bx${count}\\b`).test(before);

  if (before && okModel && okAspect && okCount) {
    log?.(`  · composer already correct: ${before}`);
    return count;
  }

  try {
    // Model: open the dropdown only if we are not already on the wanted model.
    if (before && !okModel) {
      const dd = page.locator('button:has-text("Nano Banana")').last();
      if (await dd.count().catch(() => 0)) {
        await dd.click({ timeout: 8000 }).catch(() => {});
        await sleep(1500);
        const opt = page.locator(`[role="menuitem"]:has-text("${model}"), [role="option"]:has-text("${model}")`).first();
        if (await opt.count().catch(() => 0)) { await opt.click({ timeout: 6000 }).catch(() => {}); await sleep(1200); }
        await dismissPopovers(page);
      }
    }

    // Aspect + variant count are plain toggle buttons in the composer settings row.
    for (const [label, already] of [[aspect, okAspect], [`x${count}`, okCount]]) {
      if (already) continue;
      const b = page.locator(`button:text-is("${label}"), [role="radio"]:text-is("${label}")`).last();
      if (await b.count().catch(() => 0)) await b.click({ timeout: 6000 }).catch(() => {});
      await sleep(500);
    }
  } finally {
    // Non-negotiable: leave nothing floating over the editor, whatever happened above.
    await dismissPopovers(page);
  }

  const after = await summary();
  log?.(`  · composer: ${after || '(unreadable)'}`);

  // Trust the UI over our intent — if the click did not take, wait for what it will
  // actually produce rather than for what we asked for.
  const m = (after.match(/x(\d)/) || [])[1];
  return m ? Number(m) : count;
}

async function submit(page) {
  const btn = page.locator(
    'button:has-text("arrow_forward"), button[aria-label="Create"], button:has-text("Create")'
  ).last();
  if (await btn.count().catch(() => 0)) {
    await btn.click({ timeout: 8000 }).catch(async () => { await page.keyboard.press('Enter'); });
  } else {
    await page.keyboard.press('Enter');
  }
}

/** Save `url` next to `fileNoExt`, using the REAL format (Flow serves JPEG, not PNG). */
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
  // Trust the bytes over the header, and never the URL — it carries no extension.
  const ext = buf[0] === 0xff && buf[1] === 0xd8 ? 'jpg'
    : buf[0] === 0x89 && buf[1] === 0x50 ? 'png'
    : buf.slice(8, 12).toString() === 'WEBP' ? 'webp'
    : (got.type.split('/')[1] || 'bin').replace('jpeg', 'jpg');

  const file = `${fileNoExt}.${ext}`;
  writeFileSync(file, buf);
  return file;
}

// NOTE: no cropping. Flow renders 3:4 (896x1200) and that is what gets delivered —
// human decision, 2026-08-27. Cropping to the 4:5 invariant meant slicing the top off
// a composition the model had built for the full 3:4 frame, which visibly ate content.
// The logo is composited by lib/logo.mjs, which also picks the white or purple variant
// based on what is actually behind it.

/** Read pixel dimensions straight from the file header (no image library). */
export function imageSize(buf) {
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
 * Run one prompt through Flow.
 * @returns {Promise<string[]>} saved image paths
 */
// The essential brand rules, compressed. The full STANDING SPEC (~30k chars) is written
// for a human pasting into a CHAT model; an image model given that much text starts
// rendering it as body copy — which is exactly what happened on 2026-08-28 (one render
// came back as a wall of tiny paragraphs). Image models want a focused prompt, so Flow
// gets the self-contained prompt body plus this preamble, not the whole spec.
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

/**
 * @param {object} opts
 * @param {string}   [opts.body]        the self-contained prompt body (preferred over
 *                                      the full spec+prompt paste text — see BRAND_PREAMBLE)
 * @param {string[]} [opts.attach]      reference images to attach, so the model can SEE
 *                                      what it is recreating instead of only reading a
 *                                      description of it
 * @param {boolean}  [opts.attachIsPackaging]  true when `attach` is a real Kapruka
 *                                      packaging photo that will appear IN FRAME (skips
 *                                      the composited logo — the asset already carries
 *                                      real branding). Must be a SEPARATE flag from
 *                                      "attach.length > 0", not inferred from it: a
 *                                      brand-identity reference (e.g. a logo-only crop
 *                                      used just to steer colour, nothing packaging-
 *                                      shaped in frame) is also an attachment but must
 *                                      NOT skip the logo, or the image ships unbranded.
 *                                      Bug caught 2026-08-31 testing multi-asset attach.
 */
export async function generateInFlow(browserish, promptText, outDir, {
  slug = 'render', want = 1, variations = 1, timeoutMs = Number(process.env.IG2IMG_FLOW_TIMEOUT_MS) || 3.5 * 60_000, log = console.log,
  logo = true, body = '', attach = [], attachIsPackaging = attach.length > 0, upscaleTo = 3456,
} = {}) {
  mkdirSync(outDir, { recursive: true });
  const page = await browserish.newPage();
  const saved = [];
  try {
    log('  → opening Flow');
    await page.goto(FLOW_PROJECT, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await sleep(5000);

    if (/accounts\.google\.com|ServiceLogin/i.test(page.url())) {
      throw new Error('Google Labs is logged out in this Chrome profile — sign in at labs.google, then retry.');
    }

    const composer = await findComposer(page, { log });
    if (!composer) throw new Error('could not find the Flow composer (UI changed, or the project failed to load)');

    const perSubmit = await configureComposer(page, {
      model: process.env.IG2IMG_FLOW_MODEL || 'Nano Banana Pro',
      aspect: process.env.IG2IMG_FLOW_ASPECT || '3:4',
      count: Math.max(1, Math.min(Number(process.env.IG2IMG_FLOW_COUNT || variations || 1), 4)),
      log,
    });

    // Baseline AFTER the gallery settles — see stableBaseline().
    const before = await stableBaseline(page, { log });
    log(`  · gallery baseline: ${before.size} existing image(s)`);

    // Attach the reference image(s). Flow used to keep a hidden multi-file image input
    // that setInputFiles could target directly — that's gone as of 2026-09-11 (verified
    // live). Reverse-engineered the real flow by driving the page directly:
    //   1. The composer's own "Add ingredients to the prompt box" button (bottom-left,
    //      next to the model/aspect controls) opens an asset picker panel.
    //   2. Inside it, "Upload media" opens a NATIVE OS file picker — Playwright must
    //      catch this as a `filechooser` event, no DOM <input> ever appears for it.
    //   3. The uploaded file lands selected in the picker's own preview pane.
    //   4. Its "Add to prompt" button is the step that actually attaches it as a
    //      reference for the NEXT generation — skipping this step (as an earlier fix
    //      attempt did) only adds the file to the project's media LIBRARY, it does not
    //      attach it to anything.
    // Confirmed live 2026-09-11 via screenshots at every step; every earlier attach
    // attempt (brand assets AND the newer product-photo attach) was silently degrading
    // to text-only because of steps 1-2 changing since this code was last verified.
    if (attach.length) {
      // Root cause found live 2026-09-12: `page.getByText('Upload media', {exact:true})`
      // was matching a HIDDEN Angular CDK accessibility tooltip (`<div role="tooltip"
      // id="cdk-describedby-message-...">Upload media</div>`), never the real clickable
      // menu item — getByText matches any element containing the text, tooltip included,
      // and Playwright picked the tooltip first. `.waitFor({state:'visible'})` then
      // legitimately timed out every retry because THAT specific element never becomes
      // visible (it's a screen-reader-only description, not UI). Scoping to a real
      // interactive role (menuitem/button) excludes the tooltip, which carries no role.
      let attached = false;
      for (let attempt = 1; attempt <= 3 && !attached; attempt++) {
        try {
          const ingredientsBtn = page.getByRole('button', { name: 'Add ingredients to the prompt box' }).first();
          await ingredientsBtn.click({ timeout: 8_000 });
          await sleep(800);                                 // let the panel finish opening
          const uploadMedia = page.getByRole('menuitem', { name: 'Upload media' })
            .or(page.getByRole('button', { name: 'Upload media' })).first();
          await uploadMedia.waitFor({ state: 'visible', timeout: 5_000 });
          const [chooser] = await Promise.all([
            page.waitForEvent('filechooser', { timeout: 10_000 }),
            uploadMedia.click({ timeout: 8_000 }),
          ]);
          await chooser.setFiles(attach.slice(0, 3));
          await sleep(4000);                                // let the upload land + auto-select
          const addToPrompt = page.getByRole('button', { name: 'Add to prompt' }).first();
          await addToPrompt.click({ timeout: 10_000 });
          await sleep(2000);
          log(`  → attached ${Math.min(attach.length, 3)} reference image(s)`);
          attached = true;
        } catch (e) {
          log(`  ! attach attempt ${attempt}/3 failed (${e.message})`);
          await page.keyboard.press('Escape').catch(() => {});
          await sleep(1500);
        }
      }
      if (!attached) log('  ! attach failed after 3 attempts — sending text only');
    }

    // Two different reasons an image gets attached here, and they need OPPOSITE
    // instructions about the product: a packaging asset (cake box, gift bag) is the
    // CONTAINER the scene is built around — reproduce the packaging faithfully but the
    // scene/product-inside is still described in the prompt text. A bare product photo
    // (attachIsPackaging false, e.g. a specific cake or bouquet with no packaging in
    // frame) IS the product — the whole point of attaching it is so the render matches
    // that real photo instead of a generic interpretation, so it must NOT be told to
    // avoid copying the product (added 2026-09-10 — that line was silently telling the
    // model to render a different cake/bouquet than the one just attached).
    const attachNote = attach.length
      ? (attachIsPackaging
          ? 'The attached image is the REFERENCE being recreated. Match its layout, composition, '
            + 'crop, camera angle and the position and relative size of its text block. Reproduce '
            + 'that construction, with the Kapruka product, colours, setting and copy described below. '
            + 'Do NOT copy any text, logo or product from the attached image itself.\n\n'
          : 'The attached image is the REAL, exact hero product (or its packaging) described in the '
            + 'prompt below — match its true colour, texture, shape and detail faithfully; do NOT '
            + 'substitute a different or generic version of it. Compose it into the scene, staging, '
            + 'copy and layout described below exactly as specified — the attached image supplies '
            + 'the product\'s true appearance only, not the composition.\n\n')
      : '';
    const text = BRAND_PREAMBLE + attachNote + (body || promptText);
    log(`  → pasting the prompt (${text.length.toLocaleString()} chars)`);
    await typePrompt(page, composer, text);
    await submit(page);
    log('  → submitted. Generating…');

    // Flow puts the newest generation at the TOP of the gallery and returns 3 variants
    // per submit. Two things matter here:
    //   * take the first `expect` NEW urls in DOM order, not "everything not in the
    //     baseline" — the gallery keeps lazy-loading OLD items as the list re-renders,
    //     and those were being collected too (nine images saved for one prompt).
    //   * stop as soon as we have them. Waiting for the count to go quiet cost ~8 min
    //     per prompt, because it never went quiet.
    //   * `expect` now comes from what the composer is ACTUALLY set to produce, read
    //     back off the UI. Guessing 3 while the composer said x1 meant every prompt
    //     waited out the whole 8-minute timeout for variants that never existed.
    const expect = perSubmit;
    const deadline = Date.now() + timeoutMs;
    let fresh = [];
    while (Date.now() < deadline) {
      await sleep(3000);
      fresh = (await resultUrls(page)).filter((u) => !before.has(u)).slice(0, expect);
      if (fresh.length >= expect) break;
      const no = await refusal(page);
      if (no) { const e = new Error(`Flow refused this prompt: "${no}"`); e.refused = true; throw e; }
    }
    if (!fresh.length) throw new Error('Flow produced no image within the time limit');
    if (fresh.length < expect) log(`  · got ${fresh.length}/${expect} variants before the time limit`);

    // A real brand asset already carries genuine Kapruka branding in the frame — the
    // prompt itself says so ("no second logo, the asset's own printed branding is
    // enough"). Compositing a SECOND logo on top breaks the CREATIVE BAR's "ONE Kapruka
    // logo per picture" rule and the prompt's own negative. Caught live 2026-08-31: an
    // attached gift-packaging photo, already showing the wordmark twice, still got a
    // third logo pasted top-left. skipLogo keeps the upscale + sharpen pass, just
    // without pasting the mark.
    const skipLogo = attachIsPackaging;
    if (logo && skipLogo) log('  · skipping the composited logo — the attached brand asset already carries real Kapruka branding');

    for (const [i, u] of fresh.entries()) {
      const n = String(i + 1).padStart(2, '0');
      const raw = await save(page, u, join(outDir, `${slug}-flow-${n}-raw`));
      if (!raw) continue;
      const src = imageSize(readFileSync(raw));

      const finished = logo
        ? await compositeLogo(browserish, raw, join(outDir, `${slug}-flow-${n}.png`), { log, upscaleTo, skipLogo })
        : null;
      if (finished) {
        saved.push(finished);                         // the finished one is the deliverable
        const out = imageSize(readFileSync(finished));
        log(`  ✓ saved ${basename(finished)} (${out ? `${out.w}x${out.h}` : 'native'}${skipLogo ? '' : ', real logo composited'})`);
      } else {
        saved.push(raw);
        log(`  ✓ saved ${basename(raw)}${src ? ` (${src.w}x${src.h}${logo && !skipLogo ? ' ⚠ logo step failed' : ''})` : ''}`);
      }
    }
    if (!saved.length) throw new Error('Flow images appeared but none could be downloaded');
    return saved;
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Smoke test hook — configure the composer and prove the prompt box takes a click and
 * text, without submitting. Used to verify UI changes without burning a generation.
 */
export async function __smoke(page, log = console.log) {
  const composer = await findComposer(page, { log });
  if (!composer) return { ok: false, why: 'composer not found' };
  const count = await configureComposer(page, { log });
  await typePrompt(page, composer, 'smoke test');
  const typed = await composer.innerText().catch(() => '');
  await page.keyboard.press('Control+A').catch(() => {});
  await page.keyboard.press('Backspace').catch(() => {});
  return { ok: typed.includes('smoke test'), count, typed: typed.slice(0, 40) };
}

/**
 * Experiment hook — submit one prompt variant and report whether Flow refused it,
 * without saving or branding anything. Used to isolate what a content filter objects to.
 */
export async function __probeSubmit(page, body, withNegatives, log = console.log) {
  const composer = await findComposer(page, { log });
  if (!composer) return { ok: false, why: 'composer not found' };
  await configureComposer(page, { log });
  const before = await stableBaseline(page, { log });
  const text = BRAND_PREAMBLE + (withNegatives ? negativeBlock() + '\n\n' : '') + body;
  await typePrompt(page, composer, text);
  await submit(page);
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    await sleep(3000);
    const fresh = (await resultUrls(page)).filter((u) => !before.has(u));
    if (fresh.length) return { chars: text.length, verdict: 'GENERATED', n: fresh.length };
    const no = await refusal(page);
    if (no) return { chars: text.length, verdict: 'REFUSED', msg: no.slice(0, 90) };
  }
  return { chars: text.length, verdict: 'TIMEOUT' };
}
