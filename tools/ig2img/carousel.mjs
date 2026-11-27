// carousel.mjs — a multi-slide reference becomes ONE Canva project with one page per slide.
//
// Each slide goes through the normal pipeline (runDesign: measure → adapt → picture → Canva → art-director
// check/repair), one at a time on the shared automation Chrome. The best finished version of every slide is then
// assembled into a single multi-slide .pptx and imported as ONE Canva design, so the team edits the whole carousel
// in one place. The per-slide designs stay in 3-output/ashadi-designs as drafts.
import { mkdirSync, writeFileSync, copyFileSync, readFileSync, existsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { ROOT } from './lib/env.mjs';
import { buildLayeredPptx } from './lib/layered.mjs';
import { importDesign, exportPages } from './lib/canva.mjs';
import { runDesign, reviewScore, DESIGN_DIR, pullFinal } from './design.mjs';

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

/** The best variant of a finished slide run that reached Canva and left its layers on disk. */
function bestVariant(outDir, result) {
  const ok = (result.variants || [])
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => v.canva && v.pptx && existsSync(join(outDir, v.pptx.replace(/\.pptx$/i, '.layers.json'))));
  if (!ok.length) return null;
  ok.sort((a, b) => reviewScore(b.v.review) - reviewScore(a.v.review));
  return ok[0].v;
}

export async function runCarousel({ refFiles, caption = '', instruction = '', tag = 'carousel', style, relation = 'auto', productUrl = '', log = console.log }) {
  const n = refFiles.length;
  const pages = [];
  const slideRuns = [];
  for (const [i, file] of refFiles.entries()) {
    log(`\n━━ Carousel slide ${i + 1} of ${n} ━━`);
    const note = `${instruction ? `${instruction} ` : ''}(This is slide ${i + 1} of ${n} of ONE carousel: keep the same look, palette, type and voice as the other slides.)`.slice(0, 500);
    const res = await runDesign({
      refFiles: [file], caption, instruction: note, tag: `${tag}-s${i + 1}`, relation, productUrl, ...(style ? { style } : {}), log,
    });
    const v = bestVariant(res.outDir, res.result);
    if (!v) throw new Error(`Slide ${i + 1} of ${n} didn't produce a usable design (see its run: ${basename(res.outDir)}).`);
    pages.push(JSON.parse(readFileSync(join(res.outDir, v.pptx.replace(/\.pptx$/i, '.layers.json')), 'utf8')));
    slideRuns.push({ dir: basename(res.outDir), engine: v.engine, verdict: v.review?.verdict || null, editUrl: v.canva?.editUrl || null });
  }

  log(`\n━━ Assembling ${n} pages into one Canva project ━━`);
  const outDir = join(DESIGN_DIR, `${tag}-carousel-${stamp()}`);
  mkdirSync(join(outDir, 'reference'), { recursive: true });
  const refNames = refFiles.map((f, i) => {
    const name = `ref-${String(i + 1).padStart(2, '0')}${extname(f).toLowerCase() || '.jpg'}`;
    copyFileSync(f, join(outDir, 'reference', name));
    return name;
  });
  const result = {
    kind: 'design', source: null, instruction: instruction || null, startedAt: new Date().toISOString(), caption: caption || null,
    reference: refNames, title: `${pages[0].title || 'Carousel'} · ${n} pages`.slice(0, 50), variants: [], slideRuns,
  };
  const save = () => writeFileSync(join(outDir, 'design.json'), JSON.stringify(result, null, 2));
  const pptx = await buildLayeredPptx(pages, join(outDir, 'carousel.pptx'), { log });
  const v = { engine: `Carousel · ${n} pages`, pptx: basename(pptx), pages: n, attempts: 1 };
  result.variants.push(v);
  save();
  try {
    const [d] = await importDesign(pptx, `Ashadi · ${result.title}`.slice(0, 50), { log });
    v.canva = { id: d.id, editUrl: d.editUrl, viewUrl: d.viewUrl };
    const saved = await exportPages(d.id, join(outDir, 'preview'), { width: 1080, pages: Array.from({ length: n }, (_, i) => i + 1), log });
    v.previews = saved.map((f) => basename(f));
    v.preview = v.previews[0];
    log(`  ✓ one Canva project, ${n} pages: ${d.editUrl || d.id}`);
  } catch (e) {
    v.canvaError = e.message;
    result.error = `The carousel was built, but sending it to Canva failed: ${e.message}`;
    save();
    throw Object.assign(new Error(result.error), { outDir });
  }
  result.finishedAt = new Date().toISOString();
  save();
  try { await pullFinal(outDir, 0, { log }); } catch (e) { log(`  ! final export failed (${String(e.message).slice(0, 120)}) — use "pull final"`); }
  log(`✅ Done — carousel of ${n} pages in one Canva project.`);
  return { outDir, result: JSON.parse(readFileSync(join(outDir, 'design.json'), 'utf8')) };
}
