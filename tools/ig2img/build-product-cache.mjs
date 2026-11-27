// build-product-cache.mjs — snapshot real kapruka.com listings to a local cache.
//
//   node tools/ig2img/build-product-cache.mjs
//
// Why: every run had the Reference Recreator browsing kapruka.com to find a product,
// costing 1-2 minutes and sometimes hitting a 429. The agent reads this cache instead.
//
// Category URLs follow /online/<category>[/price/<sub>]. The older /shops/<cat> guesses
// return Kapruka's own 404 page — the site was never blocking us, the paths were wrong.
//
// The spread is deliberate: Core Rule 12 says a set must span more than cakes and
// flowers, so the cache has to OFFER more than cakes and flowers.
//
// Re-run when the catalogue changes — monthly is plenty.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/env.mjs';
import { connectChrome } from './lib/chrome.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT_DIR = join(ROOT, 'tools', 'ig2img', 'cache');
const THUMB_DIR = join(OUT_DIR, 'thumbs');
const B = 'https://www.kapruka.com/online/';

const CATEGORIES = [
  { key: 'Cakes',                 url: B + 'cakes' },
  { key: 'Flowers',               url: B + 'flowers' },
  { key: 'Chocolates',            url: B + 'chocolates' },
  { key: 'Hampers',               url: B + 'hampers' },
  { key: 'Combo & gift sets',     url: B + 'giftset' },
  { key: 'Jewellery',             url: B + 'Jewellery' },
  { key: 'Watches',               url: B + 'jewellery/price/watches' },
  { key: 'Handbags',              url: B + 'fashion/price/handbags_and_travel_accessories/lanka/handbags' },
  { key: 'Ladies shoes',          url: B + 'fashion/price/ladies_shoes' },
  { key: 'Gents shoes',           url: B + 'fashion/price/gents_shoes' },
  { key: 'Wallets',               url: B + 'fashion/price/handbags_and_travel_accessories/lanka/wallets' },
  { key: 'Eyewear',               url: B + 'fashion/price/eyewear_accessories' },
  { key: 'Perfumes',              url: B + 'perfumes' },
  { key: 'Cosmetics',             url: B + 'cosmetics' },
  { key: 'Mobile phones',         url: B + 'electronics/price/mobile_phones' },
  { key: 'Audio & home cinema',   url: B + 'electronics/price/audio_and_home_entertainment' },
  { key: 'Smart watches',         url: B + 'electronics/price/wearable_technology/lanka/smart_watches' },
  { key: 'Laptops',               url: B + 'electronics/price/computers_and_accessories/lanka/laptops_and_notebooks' },
  { key: 'Home appliances',       url: B + 'electronics/price/home_appliances' },
  { key: 'Home & lifestyle',      url: B + 'home_lifestyle' },
  { key: 'Kids toys',             url: B + 'toys' },
  { key: 'Soft toys',             url: B + 'softtoy' },
  { key: 'Baby',                  url: B + 'baby' },
  { key: 'Sports & bicycles',     url: B + 'sports' },
  { key: 'Automobile',            url: B + 'Automobile' },
  { key: 'Clothing',              url: B + 'clothing' },
  { key: 'Personalised gifts',    url: B + 'customizedGifts' },
  { key: 'Grocery & pantry',      url: B + 'grocery' },
  { key: 'Books',                 url: B + 'books' },
  { key: 'Pet care',              url: B + 'pet' },
];

const PER_CATEGORY = Number(process.env.IG2IMG_CACHE_PER_CAT || 7);

// IG2IMG_CACHE_ONLY="Pet care,Cakes" re-scrapes just those departments; everything else
// is carried over from the last snapshot. Handy for patching one failed category without
// re-walking all thirty.
const ONLY = (process.env.IG2IMG_CACHE_ONLY || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const TARGETS = ONLY.length ? CATEGORIES.filter((c) => ONLY.includes(c.key.toLowerCase())) : CATEGORIES;

mkdirSync(THUMB_DIR, { recursive: true });
const chrome = await connectChrome();
const page = await chrome.newPage();
const all = [];

/**
 * Cloudflare throws a managed challenge ("Just a moment...") when we walk pages too
 * fast. It clears itself in a few seconds — the page is not actually blocked, it just
 * needs to be waited out. Poll until the product grid exists, reloading if we're still
 * sitting on the interstitial.
 */
async function loadCategory(cat) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    await page.goto(cat.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    for (let i = 0; i < 8; i++) {
      await sleep(2500);
      const state = await page.evaluate(() => ({
        buy: document.querySelectorAll('a[href*="/buyonline/"]').length,
        challenge: /just a moment|security verification/i.test(document.title + ' ' + (document.body?.innerText || '').slice(0, 200)),
      })).catch(() => ({ buy: 0, challenge: false }));
      if (state.buy > 0) return true;
      if (!state.challenge && i >= 3) break;      // real page, just no products
    }
    await sleep(4000 * attempt);                  // back off, then try again
  }
  return false;
}

try {
  for (const cat of TARGETS) {
    try {
      const ok = await loadCategory(cat);
      if (!ok) { console.log(`${cat.key.padEnd(20)} 0 (challenge / no grid) — keeping previous`); await sleep(3000); continue; }
      const items = await page.evaluate((limit) => {
        const seen = new Set();
        const out = [];
        for (const a of document.querySelectorAll('a[href*="/buyonline/"]')) {
          const href = a.href.split('?')[0];
          if (seen.has(href)) continue;
          const img = a.querySelector('img') || a.parentElement?.querySelector('img');
          const cardText = (a.innerText || '').replace(/\s+/g, ' ').trim();

          // The anchor text is prefixed with the shelf label ("Top Choices") and suffixed
          // with the price, so it yields "Top Choices" for every product. The img alt
          // carries the real name plus an SEO tail — cut the tail and use that.
          let name = (img?.getAttribute('alt') || '').replace(/\s+/g, ' ').trim();
          name = name.split(/\s+Buy\s+/i)[0].trim();
          if (name.length < 4) {
            name = cardText
              .replace(/^(Top Choices|Best Sellers|New Arrivals|On Sale)\s*/i, '')
              .replace(/^[\d.]+\s*(lbs?|kg|g)\s+/i, '')
              .replace(/\s*RS\.?\s?[\d,]+.*$/i, '')
              .trim();
          }
          if (!name || name.length < 4) continue;

          const price = (cardText.match(/RS\.?\s?[\d,]+/i) || [])[0] || null;
          const weight = (cardText.match(/[\d.]+\s*Lbs?\b/i) || [])[0] || null;
          seen.add(href);
          out.push({ name: name.slice(0, 90), url: href, price, weight,
                     img: img ? (img.currentSrc || img.src) : null });
          if (out.length >= limit) break;
        }
        return out;
      }, PER_CATEGORY);

      for (const it of items) all.push({ ...it, category: cat.key });
      console.log(`${cat.key.padEnd(20)} ${items.length}`);
    } catch (e) {
      console.log(`${cat.key.padEnd(20)} FAILED: ${e.message.split('\n')[0]} — keeping previous`);
    }
    await sleep(2500);  // be polite; a fast loop trips the Cloudflare challenge
  }

  // A rerun must never be a downgrade. One flaky page (a 45s nav timeout, a challenge
  // that outlasts the backoff) used to wipe a whole department out of the cache; now the
  // previous snapshot fills any gap this run left.
  if (existsSync(join(OUT_DIR, 'kapruka-products.json'))) {
    let prev = [];
    try { prev = JSON.parse(readFileSync(join(OUT_DIR, 'kapruka-products.json'), 'utf8')); } catch { /* ignore */ }
    const have = new Set(all.map((p) => p.category));
    const carried = prev.filter((p) => !have.has(p.category));
    for (const p of carried) all.push(p);
    const cats = [...new Set(carried.map((p) => p.category))];
    if (cats.length) console.log(`carried over from the last snapshot: ${cats.join(', ')}`);
  }

  // Save thumbnails so the agent can LOOK at the real listing photo locally instead of
  // guessing from the name — Kapruka's product names are poetic, not descriptive.
  // Fetched from Node, not from the page: an in-page fetch runs on whatever document is
  // currently loaded, so a single Cloudflare interstitial at the end of the walk silently
  // zeroes every thumbnail. A plain GET with a browser UA and a Referer works.
  //
  // Fetched at THUMB_WIDTH, not the 330px the grid page serves — this file doubles as an
  // attach-to-the-generator reference (2026-09-10, see lib/prompt.mjs resolveProductAsset),
  // and 330px is too soft to lock a generator onto the real product. Kapruka's own image
  // proxy takes an arbitrary width=, so this just rewrites that one query param.
  const THUMB_WIDTH = Number(process.env.IG2IMG_CACHE_THUMB_WIDTH || 1200);
  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    Referer: 'https://www.kapruka.com/',
    Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*',
  };
  let saved = 0;
  for (const [i, p] of all.entries()) {
    if (!p.img) continue;
    if (i > 0) await sleep(250);   // pace the CDN fetch loop — a fast burst over 200+ product
                                    // images is the same trip-the-challenge risk as the page
                                    // walk above, just against the image proxy instead of the
                                    // site itself (human rule, 2026-09-10).
    const hiResUrl = p.img.replace(/width=\d+/, `width=${THUMB_WIDTH}`);
    let buf = null;
    try {
      const r = await fetch(hiResUrl, { headers: HEADERS });
      if (r.ok) buf = Buffer.from(await r.arrayBuffer());
    } catch { /* fall through */ }
    if (!buf) {
      // The rewritten width param is a best-effort guess at the proxy's contract —
      // fall back to the grid-page size rather than lose the thumbnail entirely.
      try {
        const r = await fetch(p.img, { headers: HEADERS });
        if (r.ok) buf = Buffer.from(await r.arrayBuffer());
      } catch { /* fall through */ }
    }
    if (!buf || buf.length < 800) continue;
    const slug = p.category.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    // Sniff the real container — several listings serve PNG or WebP from a .jpg path.
    const ext = buf[0] === 0x89 ? 'png'
      : (buf[8] === 0x57 && buf[9] === 0x45) ? 'webp' : 'jpg';
    const base = `${String(i + 1).padStart(3, '0')}-${slug}.${ext}`;
    writeFileSync(join(THUMB_DIR, base), buf);
    p.thumb = `tools/ig2img/cache/thumbs/${base}`;
    saved++;
  }
  console.log(`\nthumbnails: ${saved}/${all.length}`);

  writeFileSync(join(OUT_DIR, 'kapruka-products.json'), JSON.stringify(all, null, 2));

  const byCat = all.reduce((m, p) => { (m[p.category] ||= []).push(p); return m; }, {});
  const md = [
    '# Kapruka product cache',
    '',
    `${all.length} real listings across ${Object.keys(byCat).length} departments, snapshotted from`,
    'kapruka.com. **Pick the product for a prompt from here — do not browse the site**, it costs',
    '1-2 minutes per run and adds nothing this file does not already have.',
    '',
    'Names on this site are poetic, not descriptive. When the product is the hero of the frame,',
    '**open its `thumb` with the Read tool and describe what you actually see** — never render a',
    'product from its name alone.',
    '',
    '⛔ **Core Rule 12 — count departments, not objects.** Any frame showing more than one product',
    'must span more than one department below. Cakes/flowers/chocolates/hampers are ONE reflex',
    'cluster and take at most about half of a multi-item set. Gifting to him is served badly by',
    'the classics: reach for electronics, watches, wallets, shoes, automobile, sports.',
    '',
    'Rebuild: `node tools/ig2img/build-product-cache.mjs` (env `IG2IMG_CACHE_PER_CAT`, default 7).',
    '',
    ...Object.entries(byCat).flatMap(([cat, ps]) => [
      `## ${cat}`,
      '',
      ...ps.map((p) => `- **${p.name}**${p.weight ? ` (${p.weight})` : ''}${p.price ? ` — ${p.price}` : ''}\n  ${p.url}${p.thumb ? `\n  thumb: ${p.thumb}` : ''}`),
      '',
    ]),
    '## Real Kapruka packaging (photographed assets, not listings)',
    '',
    'Use these when the concept shows the package rather than the product. Reference photographs',
    'live in `1-foundation/references/brand-assets/` — see `_brand-assets.md`.',
    '',
    '- **Cake box** — deep Retail Purple `#340A5C` rigid box, large Kapruka-Yellow `#FFC107`',
    '  upward-curving smile across the lid, small white caps tagline "Every Bite. Pure Happiness.",',
    '  white Kapruka wordmark, lion mascot, QR code.',
    '- **Flower box** · **gift packaging** · **branded bag** · **delivery van**.',
    '',
  ].join('\n');
  writeFileSync(join(OUT_DIR, 'kapruka-products.md'), md);

  console.log(`wrote ${all.length} products across ${Object.keys(byCat).length} departments`);
  console.log(`  ${join(OUT_DIR, 'kapruka-products.md')}`);
} finally {
  await page.close().catch(() => {});
  await chrome.close();
}
