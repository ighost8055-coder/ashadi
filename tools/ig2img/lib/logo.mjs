// logo.mjs — paste the REAL Kapruka wordmark onto a finished render, picking the
// variant that actually reads against whatever is behind it.
//
// Image models cannot redraw a logotype reliably; every render came back subtly
// wrong (letterforms off, smile misplaced, colours drifting). The rulebook already
// forbids redrawing it — Hard Rule 8: the logo is an ATTACHED asset, never a
// reconstruction. So the prompts ask for NO logo and a clear bottom-right corner,
// and the genuine file is composited here, pixel-exact, every time.
//
// Uses the attached Chrome's canvas, so there's no image-library dependency.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './env.mjs';

const DIR = join(ROOT, '1-foundation', 'references', 'brand-assets', 'logo');

// Two variants: white for dark grounds, Retail Purple for light ones.
export const LOGO_LIGHT_BG = process.env.IG2IMG_LOGO_DARK || join(DIR, 'kapruka-logo-purple.png');
export const LOGO_DARK_BG = process.env.IG2IMG_LOGO || join(DIR, 'send-online-logo.png');

function dataUrl(file) {
  try { return existsSync(file) ? 'data:image/png;base64,' + readFileSync(file).toString('base64') : null; }
  catch { return null; }
}

/**
 * Composite the logo onto `inFile`, writing `outFile`.
 *
 * The variant is chosen by sampling the mean luminance of the exact patch the logo
 * will cover — a fixed white mark disappears on a cream flat-lay, and a fixed purple
 * one disappears on the purple band, so neither can be hard-coded.
 *
 * The render is centre-cropped to `aspect` (default 4:5) first. Pass width/height to
 * resize; omit them to keep the cropped render's native pixels.
 *
 * @returns {Promise<string|null>} outFile, or null if the step failed
 */
export async function compositeLogo(browserish, inFile, outFile, {
  width = null, height = null, widthPct = 0.20, marginPct = 0.08,
  // Clear space demanded AROUND the mark, as a share of canvas width. The spot
  // picker scores this padded rect, not the logo's own footprint — see the
  // comment on `spots` below. 0.05 of 1080 is ~54px of empty ground on every
  // side, which is what stops the mark sitting on the headline's shoulder.
  clearPct = 0.05,
  upscaleTo = 0, log = console.log, aspect = 4 / 5,
  // When a REAL brand asset was attached to the generation, the frame already carries
  // genuine Kapruka branding — pasting a composited mark on top makes it a second logo,
  // which the rulebook's "ONE Kapruka logo per picture" rule forbids. Caught live
  // 2026-08-31 on an attached gift-packaging photo. skipLogo still runs the upscale +
  // sharpen pass, just without the final drawImage of the mark.
  skipLogo = false,
} = {}) {
  const light = dataUrl(LOGO_LIGHT_BG);      // purple mark, for light backgrounds
  const dark = dataUrl(LOGO_DARK_BG);        // white mark, for dark backgrounds
  if (!skipLogo && !light && !dark) { log?.(`  ! no logo asset in ${DIR} — leaving the image unbranded`); return null; }

  const page = await browserish.newPage();
  try {
    await page.goto('about:blank');
    const out = await page.evaluate(async ({ imgSrc, lightSrc, darkSrc, W, H, wp, mp, cp, upTo, skip, ar }) => {
      const raw = await createImageBitmap(await (await fetch(imgSrc)).blob());

      // Centre-crop to the delivery aspect (4:5) before anything else — engines return
      // their own native shape (Meta AI has come back 3:4 and 3:2), and the frame
      // invariant is 1080×1350.
      let cropW = raw.width, cropH = raw.height;
      if (ar) {
        if (raw.width / raw.height > ar) cropW = Math.round(raw.height * ar);
        else cropH = Math.round(raw.width / ar);
      }
      const bmp = document.createElement('canvas');
      bmp.width = cropW; bmp.height = cropH;
      bmp.getContext('2d').drawImage(raw, Math.round((raw.width - cropW) / 2), Math.round((raw.height - cropH) / 2),
        cropW, cropH, 0, 0, cropW, cropH);

      // Target size. `upTo` enlarges to that width (keeping aspect) when the render
      // is smaller. This is RESAMPLING, not detail synthesis — it makes a bigger,
      // cleaner file for upload; it cannot invent detail the model didn't draw.
      let cw = W || bmp.width, ch = H || bmp.height;
      if (!W && upTo && bmp.width < upTo) {
        cw = upTo;
        ch = Math.round(bmp.height * (upTo / bmp.width));
      }

      // Enlarge in <=2x steps: one big jump blurs far more than a few small ones.
      let src = bmp, sw = bmp.width, sh = bmp.height;
      while (sw * 2 <= cw) {
        const step = document.createElement('canvas');
        step.width = sw * 2; step.height = sh * 2;
        const sctx = step.getContext('2d');
        sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = 'high';
        sctx.drawImage(src, 0, 0, step.width, step.height);
        src = step; sw = step.width; sh = step.height;
      }

      const canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, cw, ch);

      // Light unsharp mask, only when we actually enlarged — recovers the edge
      // crispness that any resample costs, without the halos of a heavy sharpen.
      if (cw > bmp.width) {
        const blurC = document.createElement('canvas');
        blurC.width = cw; blurC.height = ch;
        const bctx = blurC.getContext('2d');
        bctx.filter = 'blur(1px)';
        bctx.drawImage(canvas, 0, 0);
        const sharp = ctx.getImageData(0, 0, cw, ch);
        const blur = bctx.getImageData(0, 0, cw, ch);
        const a = sharp.data, b = blur.data, amount = 0.6;
        for (let i = 0; i < a.length; i += 4) {
          a[i] = Math.max(0, Math.min(255, a[i] + amount * (a[i] - b[i])));
          a[i + 1] = Math.max(0, Math.min(255, a[i + 1] + amount * (a[i + 1] - b[i + 1])));
          a[i + 2] = Math.max(0, Math.min(255, a[i + 2] + amount * (a[i + 2] - b[i + 2])));
        }
        ctx.putImageData(sharp, 0, 0);
      }

      if (skip) {
        return { png: canvas.toDataURL('image/png').split(',')[1],
                 skipped: true, w: cw, h: ch, srcW: bmp.width, srcH: bmp.height };
      }

      // Geometry first, so we can sample exactly where the logo would land.
      const probe = lightSrc || darkSrc;
      const probeBmp = await createImageBitmap(await (await fetch(probe)).blob());
      const lw = Math.round(cw * wp);
      const lh = Math.round(lw * (probeBmp.height / probeBmp.width));
      const m = Math.round(cw * mp);

      /** Mean luminance + how busy a patch is (variance of luminance).
       *  Defaults to the logo's own footprint; pass a rect to measure a
       *  different area (the padded clear-space box). Clamped to the canvas,
       *  so a corner candidate never reads off-image pixels. */
      const measure = (px, py, pw = lw, ph = lh) => {
        const x0 = Math.max(0, Math.round(px)), y0 = Math.max(0, Math.round(py));
        const w = Math.max(1, Math.min(Math.round(pw), cw - x0));
        const h = Math.max(1, Math.min(Math.round(ph), ch - y0));
        const d = ctx.getImageData(x0, y0, w, h).data;
        let sum = 0, sumSq = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) {
          const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          sum += l; sumSq += l * l; n++;
        }
        const mean = sum / n;
        return { mean, sd: Math.sqrt(Math.max(0, sumSq / n - mean * mean)) };
      };

      // Candidates, in order of preference. A flat patch (low standard deviation) is
      // empty; a busy one has type or subject in it. Picking by emptiness stops the
      // logo landing on the headline, which a fixed corner eventually always does.
      //
      // ⚠️ BUSYNESS IS MEASURED OVER A PADDED RECT, NOT THE LOGO'S OWN FOOTPRINT
      // (fixed 2026-09-15 — caught live on a render where the mark sat top-left with
      // the headline starting immediately beneath it, letterforms almost touching).
      // Scoring only the covered box made a flat scrap of wall directly ABOVE a
      // headline look like the emptiest spot on the canvas: the type was one pixel
      // outside the measured area, so it scored zero. The padded box is the logo plus
      // `clearPct` of clear space on every side, so a corner only wins when the space
      // AROUND the mark is empty too — which is what "a clear corner" actually means.
      //
      // `mean` stays sampled from the footprint alone: it picks the white-vs-purple
      // variant, and that depends on what is directly BEHIND the mark, not beside it.
      // NOTE: `cp` (the caller's clearPct), NOT clearPct itself. This function body is
      // serialised and runs inside the BROWSER — it cannot see Node-side variables, so
      // every value it needs must arrive through the argument object below. Referencing
      // the Node name threw `ReferenceError: clearPct is not defined`, which the outer
      // catch swallowed into `return null`, which the callers read as "logo step failed"
      // and silently shipped the RAW render instead: unbranded, un-upscaled, native
      // aspect. Live from the 2026-09-15 clear-space change until 2026-09-18.
      const pad = Math.round(cw * cp);
      const spots = [
        { name: 'bottom-right', x: cw - lw - m, y: ch - lh - m, bias: 0 },
        { name: 'bottom-left', x: m, y: ch - lh - m, bias: 4 },
        { name: 'top-right', x: cw - lw - m, y: m, bias: 8 },
        { name: 'top-left', x: m, y: m, bias: 10 },
        { name: 'bottom-centre', x: Math.round((cw - lw) / 2), y: ch - lh - m, bias: 6 },
      ].map((s) => {
        const fp = measure(s.x, s.y);                                        // under the mark
        const around = measure(s.x - pad, s.y - pad, lw + pad * 2, lh + pad * 2);
        // `crowd` is detail that exists AROUND the mark but not under it — the
        // exact signature of a flat scrap of wall pressed against a headline.
        return { ...s, mean: fp.mean, sd: fp.sd, crowd: Math.max(0, around.sd - fp.sd) };
      });

      // score = what the mark lands ON (primary) + what crowds it (secondary,
      // CAPPED) + a small preference for the conventional corner.
      //
      // The cap matters: without it a very crowded neighbour could push the mark
      // onto a corner that is genuinely busy underneath, which is worse than being
      // merely close to something. Capped, the crowd term can break a tie between
      // a clear corner and a cramped one, but can never justify landing on content.
      const CROWD_CAP = 25;
      const score = (s) => s.sd + s.bias + 0.9 * Math.min(s.crowd, CROWD_CAP);
      const best = spots.reduce((a, b) => (score(a) <= score(b) ? a : b));

      const useWhite = best.mean < 140;       // dark ground → white mark
      const chosen = (useWhite ? darkSrc : lightSrc) || darkSrc || lightSrc;

      const logo = await createImageBitmap(await (await fetch(chosen)).blob());
      ctx.drawImage(logo, best.x, best.y, lw, Math.round(lw * (logo.height / logo.width)));

      return { png: canvas.toDataURL('image/png').split(',')[1], luma: Math.round(best.mean),
               spot: best.name, busy: Math.round(best.sd), crowd: Math.round(best.crowd),
               variant: useWhite ? 'white' : 'purple', w: cw, h: ch, srcW: bmp.width, srcH: bmp.height };
    }, { imgSrc: 'data:image/png;base64,' + readFileSync(inFile).toString('base64'),
         lightSrc: light, darkSrc: dark, W: width, H: height, wp: widthPct, mp: marginPct,
         cp: clearPct, upTo: upscaleTo, skip: skipLogo, ar: aspect });

    writeFileSync(outFile, Buffer.from(out.png, 'base64'));
    const grew = out.w > out.srcW;
    const upscaleNote = grew ? `upscaled ${out.srcW}x${out.srcH} → ${out.w}x${out.h} + sharpened` : 'native size';
    log?.(out.skipped
      ? `  · ${upscaleNote} (no composited logo — real branding already in frame)`
      : `  · logo: ${out.variant} mark at ${out.spot} (luma ${out.luma}, busy ${out.busy}, crowd ${out.crowd})${grew ? ` · ${upscaleNote}` : ''}`);
    return outFile;
  } catch (e) {
    log?.(`  ! logo composite failed: ${e.message}`);
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}
