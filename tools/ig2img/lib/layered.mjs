// layered.mjs — turn a layout spec into a layered .pptx that Canva imports as an EDITABLE
// design: the AI picture is one image layer, every line of copy is a real text box, the
// Kapruka logo is its own image layer, and simple shapes (bars, cards, scrims) are shapes.
//
// Why .pptx: Canva's design-import API accepts it, and a PowerPoint text box arrives in
// Canva as a text element you can click and retype — unlike text baked into a generated
// image. The canvas is defined in pixels and converted at 96 px per inch (PowerPoint's
// own px↔in ratio), so a 1080×1350 spec becomes an 11.25×14.0625 in slide.
//
// Spec shape (all boxes are PERCENT of the canvas, 0-100, measured from the top-left):
// {
//   canvas:   { w: 1080, h: 1350, background: '#F5F4EB' },
//   elements: [                                   // drawn in order: first = bottom layer
//     { type: 'image', src: 'C:/…/scene.png', box: { x, y, w, h }, fit: 'cover'|'contain' },
//     { type: 'shape', shape: 'rect'|'roundRect'|'ellipse', box, fill: '#340A5C', opacity: 1, radius_px: 24 },
//     { type: 'text',  text: 'Line one\nLine two', box,
//       font: { family: 'Inter', weight: 800, size_px: 72, color: '#340A5C', align: 'left'|'center'|'right',
//               valign: 'top'|'middle'|'bottom', line_height: 1.05, letter_spacing_px: 0, italic: false,
//               case: 'none'|'upper' } },
//     { type: 'logo',  src: 'C:/…/kapruka-logo.png', box },
//   ],
// }
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import { LOGO_LIGHT_BG, LOGO_DARK_BG } from './logo.mjs';

const require = createRequire(import.meta.url);
const PptxGenJS = require('pptxgenjs');

// Same brand marks the pipeline's logo compositor uses (logo.mjs): purple wordmark for
// light grounds, white wordmark for dark grounds — both transparent PNGs. A logo element
// may name its own src, or just say what it sits on: { type: 'logo', on: 'dark'|'light' }.
const logoFor = (el) => el.src || (el.on === 'dark' ? LOGO_DARK_BG : LOGO_LIGHT_BG);

const PX_PER_IN = 96;
const PT_PER_PX = 0.75;              // 72 pt per inch / 96 px per inch
const hex = (c, d = '000000') => String(c || d).replace('#', '').slice(0, 6).toUpperCase();

/** Families Canva definitely has; anything else falls back to Inter (the brand face). */
const KNOWN_FONTS = new Set(['Inter', 'Montserrat', 'Poppins', 'Playfair Display', 'DM Serif Display',
  'Bebas Neue', 'Oswald', 'Roboto', 'Open Sans', 'Lato', 'Raleway', 'Archivo Black', 'Anton', 'League Spartan']);

/** Pixel size of a PNG/JPEG/WebP, or null. */
function imageSize(file) {
  const b = readFileSync(file);
  if (b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i < b.length - 9;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  if (b.slice(8, 12).toString() === 'WEBP') {
    const chunk = b.slice(12, 16).toString();
    if (chunk === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (chunk === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
  }
  return null;
}

// Approximate advance widths in em, for estimating whether a line fits its box. Tuned on
// Poppins (wide geometric); other families scale by WIDTH_FACTOR. An estimate, so fitting
// aims a few % under the box and the text box gets a little slack (see addText below).
const WIDTH_FACTOR = { Poppins: 1, Montserrat: 1, 'League Spartan': 0.95, Inter: 0.92, Roboto: 0.9, 'Open Sans': 0.92,
  Lato: 0.88, Raleway: 0.95, 'Archivo Black': 1.08, 'Playfair Display': 0.88, 'DM Serif Display': 0.9,
  'Bebas Neue': 0.62, Oswald: 0.66, Anton: 0.64 };
function charEm(c) {
  if (c === ' ') return 0.27;
  if (/[iljtfr.,:;!'|"`]/.test(c)) return 0.3;
  if (/[mwMW]/.test(c)) return 0.92;
  if (/[A-Z]/.test(c)) return 0.7;
  if (/[0-9]/.test(c)) return 0.6;
  if (/[a-z]/.test(c)) return 0.58;
  return 0.6;
}
function lineWidthPx(line, family, weight, sizePx, spacingPx) {
  const em = [...line].reduce((s, c) => s + charEm(c), 0) * (WIDTH_FACTOR[family] || 0.95) * (weight >= 700 ? 1.05 : weight >= 600 ? 1.02 : 1);
  return em * sizePx + Math.max(0, line.length - 1) * spacingPx;
}
function fitSize(text, family, weight, sizePx, spacingPx, boxWpx, boxHpx, lineHeight) {
  const lines = String(text).split('\n');
  const widest = Math.max(...lines.map((l) => lineWidthPx(l, family, weight, sizePx, spacingPx)), 1);
  const tall = lines.length * sizePx * lineHeight;
  const k = Math.min(1, (boxWpx * 0.97) / widest, (boxHpx * 1.3) / tall);
  return { size: sizePx * k, scaled: k < 0.98 };
}

/**
 * Split copy into coloured runs so highlighted words ("evening." in yellow) stay one
 * editable text box in Canva instead of separate boxes. Line breaks become breakLine runs.
 */
function textRuns(text, highlights = [], baseColour) {
  const hl = (highlights || []).filter((x) => x?.words).map((x) => ({ words: String(x.words), color: hex(x.color, baseColour) }));
  const lines = String(text).split('\n');
  const runs = [];
  lines.forEach((line, li) => {
    let rest = line;
    const segs = [];
    while (rest) {
      let hit = null;
      for (const x of hl) {
        const i = rest.toLowerCase().indexOf(x.words.toLowerCase());
        if (i >= 0 && (!hit || i < hit.i)) hit = { i, x };
      }
      if (!hit) { segs.push({ text: rest, color: baseColour }); break; }
      if (hit.i > 0) segs.push({ text: rest.slice(0, hit.i), color: baseColour });
      segs.push({ text: rest.slice(hit.i, hit.i + hit.x.words.length), color: hit.x.color });
      rest = rest.slice(hit.i + hit.x.words.length);
    }
    if (!segs.length) segs.push({ text: '', color: baseColour });
    segs.forEach((s, si) => runs.push({
      text: s.text,
      options: { color: s.color, ...(si === segs.length - 1 && li < lines.length - 1 ? { breakLine: true } : {}) },
    }));
  });
  return runs;
}

/**
 * Centre-crop a picture to the box's exact aspect ratio, so it can be placed 1:1.
 *
 * Why not pptxgenjs's own `sizing: {type: 'cover'}`: it computes the crop from the size
 * you place the image at, never the file's real pixel size — so the crop is always zero
 * and the picture is STRETCHED into the box (seen 2026-11-15: a 4:5 scene squashed into
 * a tall 0.46 panel). Cropping the file ourselves gives a true, centred "fill".
 */
function coverCrop(file, boxW, boxH) {
  const size = imageSize(file);
  if (!size?.w || !size?.h || !boxW || !boxH) return file;
  const want = boxW / boxH; const have = size.w / size.h;
  if (Math.abs(have - want) / want < 0.01) return file;
  const out = file.replace(/(\.\w+)?$/, `-fill${Math.round(want * 1000)}.jpg`);
  execFileSync('python', ['-c', `import sys
from PIL import Image
im=Image.open(sys.argv[1]).convert("RGB");W,H=im.size;r=float(sys.argv[3])
if W/H>r:
    nw=round(H*r);x=(W-nw)//2;im=im.crop((x,0,x+nw,H))
else:
    nh=round(W/r);y=(H-nh)//2;im=im.crop((0,y,W,y+nh))
im.save(sys.argv[2],quality=93,subsampling=0)`, file, out, String(want)], { env: { ...process.env, PYTHONUTF8: '1' } });
  return out;
}

/** Median colour of a picture's outer border, and whether that border is one even colour. */
function borderColour(file) {
  try {
    const out = execFileSync('python', ['-c', `import sys,json,statistics as st
from PIL import Image
im=Image.open(sys.argv[1]).convert("RGB");W,H=im.size;px=im.load();b=max(2,min(W,H)//100);pts=[]
for x in range(0,W,max(1,W//200)):
    for y in list(range(b))+list(range(H-b,H)): pts.append(px[x,y])
for y in range(0,H,max(1,H//200)):
    for x in list(range(b))+list(range(W-b,W)): pts.append(px[x,y])
ch=list(zip(*pts));med=[int(st.median(c)) for c in ch];sd=max(st.pstdev(c) for c in ch)
print(json.dumps({"hex":"%02X%02X%02X"%tuple(med),"sd":sd}))`, file], { env: { ...process.env, PYTHONUTF8: '1' }, encoding: 'utf8' });
    const r = JSON.parse(out.trim());
    return { hex: r.hex, even: r.sd < 10 };
  } catch { return null; }
}

/** Shrink a box to the image's own aspect ratio (never stretch a logo), anchored as asked. */
function fitInside(b, size, anchor = 'center') {
  if (!size?.w || !size?.h) return b;
  const ar = size.w / size.h;
  let w = b.w; let h = w / ar;
  if (h > b.h) { h = b.h; w = h * ar; }
  const x = anchor === 'left' ? b.x : anchor === 'right' ? b.x + b.w - w : b.x + (b.w - w) / 2;
  return { x, y: b.y + (b.h - h) / 2, w, h };
}


// Where Canva actually draws the ink, measured 2026-11-22 with a calibration design (Inter Bold, caps, sizes 60 and 130):
// middle-aligned text lands on the spec's box within 2px, top-aligned text lands about 0.076 x size too LOW and
// bottom-aligned text about 0.084 x size too HIGH. buildLayeredPptx corrects both, so ink lands where the spec says.
const INK_OFFSET_TOP = 0.076;
const INK_OFFSET_BOTTOM = 0.084;

/**
 * Keep stacked lines of type apart. A reference's measured boxes can overlap (a small word box sitting inside the
 * big word's box, "top"-aligned, seen 2026-11-22: "ONE" printed over "SCENT"), and a shrunk or moved line can
 * collide with its neighbour. For every pair of text layers that share a column, work out where their INK really is
 * (cap-top to baseline, from the same sizes the file is built with) and, top to bottom, push a line down until it
 * clears the one above by a small gap. Lines that already clear each other are left exactly as they are.
 */
function separateStackedText(elements, { W, H, log = () => {} }) {
  const out = elements.map((e) => (e.type === 'text' && e.box ? { ...e, box: { ...e.box }, font: { ...(e.font || {}) } } : e));
  const items = [];
  out.forEach((e, idx) => {
    if (e.type !== 'text' || !e.box) return;
    const f = e.font;
    const fam = KNOWN_FONTS.has(f.family || f.family_guess) ? (f.family || f.family_guess) : 'Inter';
    const text = f.case === 'upper' ? String(e.text || '').toUpperCase() : String(e.text || '');
    const bw = (e.box.w / 100) * W; const bh = (e.box.h / 100) * H;
    const lh = Number(f.line_height) || 1.1;
    const fit = fitSize(text, fam, Number(f.weight) || 400, Number(f.size_px) || 40, Number(f.letter_spacing_px) || 0, bw, bh, lh);
    const lines = text.split('\n').length;
    const cap = (Number(f.cap_height_px) || (Number(f.size_px) || 40) * 0.727) * (fit.size / (Number(f.size_px) || 40));
    const inkH = cap + (lines - 1) * fit.size * lh;
    const widest = Math.max(...text.split('\n').map((l) => lineWidthPx(l, fam, Number(f.weight) || 400, fit.size, Number(f.letter_spacing_px) || 0)), 1);
    items.push({ idx, e, size: fit.size, inkH, bw, widest, text });
  });
  const geom = (it) => {
    const e = it.e; const by = (e.box.y / 100) * H; const bh = (e.box.h / 100) * H; const bx = (e.box.x / 100) * W;
    const va = ['top', 'middle', 'bottom'].includes(e.font.valign) ? e.font.valign : 'top';
    const top = va === 'top' ? by : va === 'middle' ? by + (bh - it.inkH) / 2 : by + bh - it.inkH;
    const w = Math.min(it.widest, it.bw);
    const al = e.font.align || 'left';
    const x1 = al === 'center' ? bx + (it.bw - w) / 2 : al === 'right' ? bx + it.bw - w : bx;
    return { top, bottom: top + it.inkH, x1, x2: x1 + w };
  };
  const order = items.slice().sort((a, b) => geom(a).top - geom(b).top);
  const placed = [];
  for (const it of order) {
    let g = geom(it);
    for (const prev of placed) {
      const pg = geom(prev);
      const ov = Math.min(g.x2, pg.x2) - Math.max(g.x1, pg.x1);
      if (ov < 0.15 * Math.min(g.x2 - g.x1, pg.x2 - pg.x1)) continue;             // not in the same column
      const gap = Math.max(10, 0.22 * Math.min(it.size, prev.size));
      const need = pg.bottom + gap - g.top;
      if (g.top < pg.bottom + gap - 0.5 && g.bottom > pg.top && need > 0) {
        const maxBottom = H - 100;                                                    // the 100px bottom margin
        const dy = Math.min(need, Math.max(0, maxBottom - g.bottom));
        if (dy > 0.5) {
          it.e.box.y += (dy / H) * 100;
          log(`  · layered: moved "${it.text.split('\n')[0].slice(0, 24)}" down ${Math.round(dy)}px so it no longer touches "${prev.text.split('\n')[0].slice(0, 24)}"`);
          g = geom(it);
        }
        if (g.top < pg.bottom + gap - 1) log(`  ! layered: "${it.text.slice(0, 24)}" still crowds "${prev.text.slice(0, 24)}" (no room left above the bottom margin)`);
      }
    }
    placed.push(it);
  }
  return out;
}

/**
 * Build a layered .pptx. `spec` is one page's spec, or an ARRAY of specs for a multi-page file (a carousel:
 * Canva imports each slide as a page of ONE design). A single spec also writes its spec next to the file
 * (<name>.layers.json) so a carousel can be assembled from finished pages later.
 */
export async function buildLayeredPptx(spec, outFile, { log = () => {} } = {}) {
  const specs = Array.isArray(spec) ? spec : [spec];
  if (!Array.isArray(spec)) { try { writeFileSync(outFile.replace(/\.pptx$/i, '.layers.json'), JSON.stringify(spec)); } catch {} }
  const W = specs[0].canvas?.w || 1080;
  const H = specs[0].canvas?.h || 1350;
  const win = W / PX_PER_IN;
  const hin = H / PX_PER_IN;
  const box = (b = {}) => ({
    x: (Number(b.x) || 0) / 100 * win, y: (Number(b.y) || 0) / 100 * hin,
    w: Math.max(0.01, (Number(b.w) || 0) / 100 * win), h: Math.max(0.01, (Number(b.h) || 0) / 100 * hin),
  });

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'ASHADI', width: win, height: hin });
  pptx.layout = 'ASHADI';
  pptx.title = specs[0].title || 'Ashadi design';
  for (const spec of specs) {
  const slide = pptx.addSlide();
  slide.background = { color: hex(spec.canvas?.background, 'FFFFFF') };

  for (let el of separateStackedText(spec.elements || [], { W, H, log })) {
    const b = box(el.box);
    if (el.type === 'image' || el.type === 'logo') {
      if (el.type === 'logo') el = { ...el, src: logoFor(el) };
      if (!el.src || !existsSync(el.src)) { log(`  ! layered: skipped ${el.type} — file not found: ${el.src}`); continue; }
      if (el.type === 'image' && el.fit !== 'contain') {
        // A scene photo fills its box: centre-cropped to the box's shape first, never stretched.
        const filled = coverCrop(el.src, b.w, b.h);
        // blend: a picture that doesn't fill the canvas would sit in a visible box if its
        // backdrop isn't EXACTLY the page colour (seen 2026-11-15: grey studio sweep on a
        // white page). If the picture's border is a plain, even colour, the page takes it.
        if (el.blend) {
          const edge = borderColour(filled);
          if (edge?.even) { slide.background = { color: edge.hex }; log(`  · page colour matched to the picture's backdrop #${edge.hex} (no seam)`); }
        }
        slide.addImage({ path: filled, ...b, altText: el.alt || 'scene' });
      } else {
        // A logo (or a "contain" image) keeps its own proportions inside the box — a logo is
        // never stretched or cropped. Anchor: left | center | right (default: left for logos).
        const fitted = fitInside(b, imageSize(el.src), el.anchor || (el.type === 'logo' ? 'left' : 'center'));
        slide.addImage({ path: el.src, ...fitted, altText: el.type === 'logo' ? 'Kapruka logo' : (el.alt || 'image') });
      }
    } else if (el.type === 'shape') {
      // pill = a rounded rect with fully round ends; line = a thin filled rect.
      const rounded = el.shape === 'roundRect' || el.shape === 'pill';
      const kind = rounded ? pptx.ShapeType.roundRect : el.shape === 'ellipse' ? pptx.ShapeType.ellipse : pptx.ShapeType.rect;
      const shortPx = Math.min(b.w, b.h) * PX_PER_IN;
      slide.addShape(kind, {
        ...b,
        fill: { color: hex(el.fill, 'FFFFFF'), transparency: Math.round((1 - (el.opacity ?? 1)) * 100) },
        line: { type: 'none' },
        ...(rounded ? { rectRadius: el.shape === 'pill' ? 0.5 : Math.min(0.5, (Number(el.radius_px) || 0) / shortPx) } : {}),
      });
    } else if (el.type === 'text') {
      const f = el.font || {};
      const fam = f.family || f.family_guess;
      const family = KNOWN_FONTS.has(fam) ? fam : 'Inter';
      const text = f.case === 'upper' ? String(el.text || '').toUpperCase() : String(el.text || '');
      // Never let copy overflow its measured box (seen 2026-11-15: a tagline longer than the
      // reference's wrapped to a 2nd line and fell off the bottom of the canvas). Shrink the
      // size until the longest line fits the box width and all lines fit its height.
      const fitted = fitSize(text, family, Number(f.weight) || 400, Number(f.size_px) || 40,
        Number(f.letter_spacing_px) || 0, b.w * PX_PER_IN, b.h * PX_PER_IN, Number(f.line_height) || 1.1);
      if (fitted.scaled) log(`  · layered: "${text.split('\n')[0].slice(0, 30)}" shrunk ${Math.round(f.size_px)}→${Math.round(fitted.size)}px to fit its box`);
      // The spec measures text from the CAP-TOP of the first line; a text box starts at the
      // top of the line box, which sits above the cap height. Lift the box by that gap so
      // the glyphs land where they were measured.
      const sizePx = fitted.size;
      const capPx = (Number(f.cap_height_px) || (Number(f.size_px) || 40) * 0.7) * (fitted.size / (Number(f.size_px) || 40));
      const liftIn = Math.max(0, (sizePx * (Number(f.line_height) || 1.1) - capPx) / 2) / PX_PER_IN;
      // A little horizontal slack on the open side(s), so Canva's own line breaking (its font
      // metrics differ slightly from our estimate) never wraps a line we sized to fit.
      const slack = b.w * 0.06;
      const ax = f.align === 'right' ? b.x - slack : f.align === 'center' ? b.x - slack / 2 : b.x;
      const inkFix = (f.valign === 'bottom' ? INK_OFFSET_BOTTOM * sizePx : f.valign === 'middle' ? 0 : -INK_OFFSET_TOP * sizePx) / PX_PER_IN;
      const tb = { x: Math.max(0, ax), w: b.w + slack, y: Math.max(0, b.y - liftIn + inkFix), h: b.h + liftIn * 2 };
      const colour = hex(f.color, '1E1733');
      slide.addText(textRuns(text, el.highlights, colour), {
        ...tb,
        fontFace: family,
        fontSize: Math.max(6, Math.round(sizePx * PT_PER_PX * 10) / 10),
        bold: (Number(f.weight) || 400) >= 600,
        italic: !!f.italic,
        color: colour,
        align: ['left', 'center', 'right', 'justify'].includes(f.align) ? f.align : 'left',
        valign: ['top', 'middle', 'bottom'].includes(f.valign) ? f.valign : 'top',
        lineSpacingMultiple: Number(f.line_height) || 1.1,
        charSpacing: Math.round((Number(f.letter_spacing_px) || 0) * PT_PER_PX * 10) / 10,
        margin: 0,
        fit: 'none',
        wrap: true,
      });
    }
  }
  }   // one slide per spec
  await pptx.writeFile({ fileName: outFile });
  return outFile;
}
