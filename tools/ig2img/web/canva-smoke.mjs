// canva-smoke.mjs — one-off check that the Ashadi → Canva path works end to end and that
// text arrives as EDITABLE text: builds a small layered .pptx (picture + two text boxes +
// logo), imports it into the connected Canva account, and prints the design's edit link.
//
//   node tools/ig2img/web/canva-smoke.mjs [path-to-a-picture.png]
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../lib/env.mjs';
import { buildLayeredPptx } from '../lib/layered.mjs';
import { importDesign } from '../lib/canva.mjs';

const outDir = join(ROOT, '3-output', 'canva-smoke');
mkdirSync(outDir, { recursive: true });

const recDir = join(ROOT, '3-output', 'reference-recreations');
const picture = process.argv[2] || (() => {
  for (const d of readdirSync(recDir).sort().reverse()) {
    const r = join(recDir, d, 'renders');
    if (!existsSync(r)) continue;
    const f = readdirSync(r).find((n) => /-raw\.(jpe?g|png|webp)$/i.test(n) && !/\.webp$/i.test(n)) || readdirSync(r).find((n) => /\.png$/i.test(n));
    if (f) return join(r, f);
  }
  throw new Error('no picture found — pass one as an argument');
})();
const spec = {
  title: 'Ashadi smoke test',
  canvas: { w: 1080, h: 1350, background: '#F5F4EB' },
  elements: [
    { type: 'image', src: picture, box: { x: 0, y: 0, w: 100, h: 72 }, fit: 'cover' },
    { type: 'shape', shape: 'rect', box: { x: 0, y: 72, w: 100, h: 28 }, fill: '#340A5C' },
    { type: 'text', text: 'Same-day cake delivery', box: { x: 7, y: 76, w: 70, h: 10 },
      font: { family: 'Inter', weight: 800, size_px: 64, color: '#FFFFFF', align: 'left', line_height: 1.0 } },
    { type: 'text', text: 'Order by 2pm, delivered in Colombo today.', box: { x: 7, y: 88, w: 70, h: 5 },
      font: { family: 'Inter', weight: 400, size_px: 30, color: '#FFC107', align: 'left' } },
    { type: 'logo', on: 'dark', box: { x: 72, y: 87, w: 21, h: 7 }, anchor: 'right' },
  ],
};

const file = await buildLayeredPptx(spec, join(outDir, 'smoke.pptx'), { log: console.log });
console.log(`built ${file}`);
const designs = await importDesign(file, spec.title, { log: console.log });
for (const d of designs) console.log(`imported design ${d.id}\n  edit: ${d.editUrl}`);
if (process.argv.includes('--export')) {
  const { exportPng } = await import('../lib/canva.mjs');
  const png = await exportPng(designs[0].id, join(outDir, 'smoke-from-canva.png'), { log: console.log });
  console.log(`exported ${png}`);
}
