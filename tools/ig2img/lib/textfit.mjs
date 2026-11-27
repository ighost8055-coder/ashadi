// textfit.mjs — fit text inside its box BEFORE it is built, so a long line can never run into the 100px margin.
//
// Inter is not installed on this PC (Canva renders it), so widths come from an advance-width table of Inter Bold in em
// units. Calibrated 2026-11-25 against a real Canva render (1080 px wide): "Real-time Kapruka updates on WhatsApp" at 44 px
// Bold measured 875 px (table: 875); "Stop guessing if" at 76 px measured 590 px (table: 594). Regular is ~6% narrower.
const W = {};
const put = (chars, w) => { for (const c of chars) W[c] = w; };
// lower case
Object.assign(W, { a: .57, b: .62, c: .56, d: .62, e: .58, f: .37, g: .62, h: .61, i: .27, j: .27, k: .57, l: .27, m: .90, n: .61, o: .61, p: .62, q: .62, r: .38, s: .53, t: .38, u: .61, v: .56, w: .84, x: .55, y: .56, z: .52 });
// upper case
Object.assign(W, { A: .71, B: .70, C: .73, D: .76, E: .62, F: .60, G: .77, H: .76, I: .30, J: .53, K: .68, L: .57, M: .91, N: .77, O: .81, P: .67, Q: .81, R: .69, S: .66, T: .64, U: .74, V: .70, W: 1.0, X: .68, Y: .66, Z: .64 });
put('0123456789', .63);
Object.assign(W, { ' ': .27, '.': .30, ',': .30, ':': .30, ';': .30, '!': .30, '?': .55, "'": .27, '’': .27, '"': .42, '-': .40, '–': .62, '—': .95, '/': .40, '&': .75, '%': .90, '(': .35, ')': .35, '+': .62, '#': .70, '@': 1.0, '*': .45, '$': .65 });
const FALLBACK = .60;   // anything not in the table (accents, symbols): a medium-wide glyph

/** Estimated width of ONE line in px. */
export function lineWidthPx(text, sizePx, { bold = true, letterSpacingPx = 0 } = {}) {
  let em = 0; let n = 0;
  for (const ch of String(text)) { em += W[ch] ?? FALLBACK; n++; }
  return em * (bold ? 1 : 0.94) * sizePx + Math.max(0, n - 1) * letterSpacingPx;
}

/**
 * The font size (px) at which the widest line of `text` fits `availPx`. Never grows the type; never shrinks below `minRatio`
 * of the original (a line that still does not fit is left to wrap — a rare, very long line).
 */
export function fitSize(text, sizePx, availPx, { bold = true, letterSpacingPx = 0, minRatio = 0.6 } = {}) {
  const lines = String(text).split(/\r?\n/);
  const widest = Math.max(0, ...lines.map((l) => lineWidthPx(l, sizePx, { bold, letterSpacingPx })));
  if (!widest || widest <= availPx) return sizePx;
  return Math.max(sizePx * minRatio, sizePx * (availPx / widest));
}
