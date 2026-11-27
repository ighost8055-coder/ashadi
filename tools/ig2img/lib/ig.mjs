// ig.mjs — read an Instagram post (single image OR carousel) in the attached
// Chrome, saving every slide to disk plus the caption.
//
// Two paths, tried in order:
//   1. the real post page — works logged in or out, and is the only path that
//      can walk a carousel;
//   2. the /embed/captioned/ page — a clean, login-free render of the FIRST
//      slide, used as a fallback when (1) finds nothing.
//
// The key filter: on a post page, the post's own media is the large image that
// is NOT wrapped in an <a> — every "more posts from this account" thumbnail is.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Normalise any Instagram URL to its canonical post permalink. */
export function normaliseIgUrl(url) {
  const m = String(url).match(/instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  if (!m) throw new Error(`not an Instagram post/reel URL: ${url}`);
  const kind = m[1].toLowerCase() === 'reels' ? 'reel' : m[1].toLowerCase();
  return `https://www.instagram.com/${kind}/${m[2]}/`;
}

/** Pick the highest-resolution candidate out of a srcset. */
function bestFromSrcset(srcset, src) {
  if (!srcset) return src;
  const best = srcset.split(',')
    .map((p) => p.trim().split(/\s+/))
    .map(([u, w]) => ({ u, w: parseInt(w || '0', 10) }))
    .sort((a, b) => b.w - a.w)[0];
  return best?.u || src;
}

/** The post's own media, currently rendered. Excludes link-wrapped thumbnails. */
async function visibleSlides(page) {
  return page.evaluate(() => {
    const inLink = (el) => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        if (n.tagName === 'A' && n.getAttribute('href')) return true;
      }
      return false;
    };
    return [...document.querySelectorAll('img')]
      .filter((img) => {
        const r = img.getBoundingClientRect();
        if (r.width < 240 || r.height < 240) return false;               // avatars, icons
        if (inLink(img)) return false;                                   // "more posts" grid
        const alt = (img.getAttribute('alt') || '').toLowerCase();
        return !alt.includes('profile picture');
      })
      .map((img) => ({ src: img.currentSrc || img.src, srcset: img.getAttribute('srcset') || '' }));
  });
}

/** Close the logged-out signup interstitial if it's covering the carousel arrows. */
async function dismissLoginNag(page) {
  await page.keyboard.press('Escape').catch(() => {});
  const close = page.locator('div[role="dialog"] button[aria-label="Close"], svg[aria-label="Close"]').first();
  if (await close.count().catch(() => 0)) await close.click({ timeout: 2000 }).catch(() => {});
}

/** Download a URL from inside the page session (IG cookies/referrer apply). */
async function download(page, url, file, log) {
  const b64 = await page.evaluate(async (src) => {
    const res = await fetch(src);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let s = ''; const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }, url).catch(() => null);
  if (!b64) { log?.(`  ! a slide failed to download, skipping`); return null; }
  writeFileSync(file, Buffer.from(b64, 'base64'));
  return file;
}

/** Just the caption, from the login-free embed render. */
async function captionViaEmbed(browserish, url) {
  const page = await browserish.newPage();
  try {
    await page.goto(`${url}embed/captioned/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await sleep(2500);
    return await page.evaluate(() => {
      const c = document.querySelector('.Caption');
      if (!c) return '';
      const t = c.innerText.trim();
      // The embed prefixes the caption with "<account>\n \n<age>\n" — strip it.
      return t.replace(/^[A-Za-z0-9_.]+\s*[\n•]\s*(\d+\s*[smhdwy]\s*\n)?/i, '').trim();
    });
  } finally { await page.close().catch(() => {}); }
}

/** Fallback: the login-free embed render (first slide + caption only). */
async function viaEmbed(browserish, url, outDir, log) {
  const page = await browserish.newPage();
  try {
    log('  → falling back to the embed view');
    await page.goto(`${url}embed/captioned/`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await sleep(3500);
    const shot = await page.evaluate(() => {
      const img = document.querySelector('img.EmbeddedMediaImage')
        || [...document.querySelectorAll('img')].sort((a, b) => b.naturalWidth - a.naturalWidth)[0];
      return {
        src: img ? (img.currentSrc || img.src) : null,
        caption: document.querySelector('.Caption')?.innerText?.trim() || '',
      };
    });
    if (!shot.src) return null;
    const file = await download(page, shot.src, join(outDir, 'ig-01.jpg'), log);
    return file ? { caption: shot.caption, files: [file], partial: true } : null;
  } finally { await page.close().catch(() => {}); }
}

/**
 * Scrape one post.
 * @returns {Promise<{url:string, caption:string, files:string[], loggedIn:boolean, partial:boolean}>}
 */
export async function scrapeInstagram(browserish, rawUrl, outDir, { maxSlides = 12, log = console.log } = {}) {
  const url = normaliseIgUrl(rawUrl);
  mkdirSync(outDir, { recursive: true });
  const page = await browserish.newPage();
  let loggedIn = false;

  try {
    log(`  → opening ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('main img, article img', { timeout: 25_000 }).catch(() => {});
    await sleep(2500);

    if (/\/accounts\/login/i.test(page.url())) {
      throw new Error('Instagram bounced straight to the login page — log into instagram.com in this Chrome window, then retry.');
    }

    loggedIn = await page.evaluate(() =>
      !!document.querySelector('svg[aria-label="Home"], a[href="/direct/inbox/"], svg[aria-label="New post"]')).catch(() => false);
    if (!loggedIn) {
      log('  ! Instagram is logged out in this profile — public posts work, but carousels may only give slide 1');
      await dismissLoginNag(page);
    }

    // Caption. Anything inside the signup dialog is the login nag, never the post.
    let caption = await page.evaluate(() => {
      const inDialog = (el) => !!el.closest('div[role="dialog"]');
      const h1 = [...document.querySelectorAll('article h1, main h1')].find((e) => !inDialog(e) && e.innerText?.trim());
      if (h1) return h1.innerText.trim();
      const span = [...document.querySelectorAll('main span[dir="auto"], article span[dir="auto"]')]
        .find((s) => !inDialog(s) && (s.innerText || '').trim().length > 20);
      return span?.innerText?.trim() || '';
    }).catch(() => '');

    // Walk the carousel, collecting each slide as it comes into view.
    const seen = new Set();
    for (let i = 0; i < maxSlides; i++) {
      for (const { src, srcset } of await visibleSlides(page)) {
        const u = bestFromSrcset(srcset, src);
        if (u) seen.add(u);
      }
      const next = page.locator('button[aria-label="Next"], button:has(svg[aria-label="Next"])').first();
      if (!(await next.count().catch(() => 0)) || !(await next.isVisible().catch(() => false))) break;
      await next.click({ timeout: 5000 }).catch(() => {});
      await sleep(1300);
    }

    const urls = [...seen];
    if (!urls.length) {
      const fb = await viaEmbed(browserish, url, outDir, log);
      if (!fb) throw new Error('found no images on that post (private account, video-only, or Instagram changed its DOM)');
      log(`  ✓ 1 slide saved via embed${fb.caption ? ', caption captured' : ''}`);
      return { url, ...fb, caption: fb.caption || caption, loggedIn };
    }

    const files = [];
    for (const [i, u] of urls.entries()) {
      const f = await download(page, u, join(outDir, `ig-${String(i + 1).padStart(2, '0')}.jpg`), log);
      if (f) files.push(f);
    }
    if (!files.length) throw new Error('every slide failed to download');

    // Logged out, the post page often yields only the nag text — the embed view
    // renders the real caption without a login.
    if (!caption || /never miss a post|sign up|log in/i.test(caption)) {
      caption = await captionViaEmbed(browserish, url).catch(() => '') || '';
    }

    const partial = !loggedIn && files.length === 1;
    log(`  ✓ ${files.length} slide${files.length > 1 ? 's' : ''} saved${caption ? ', caption captured' : ''}`);
    return { url, caption, files, loggedIn, partial };
  } finally {
    await page.close().catch(() => {});
  }
}
