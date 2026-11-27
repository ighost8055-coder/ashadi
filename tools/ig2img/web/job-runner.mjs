// job-runner.mjs — runs ONE Ashadi job in its own process, so the web server can stop it.
//
// The server forks this file, sends the job over IPC, and receives log lines + the result
// back. "Stop" = the server kills this process and everything it started (taskkill /T on
// Windows — that includes helper processes). Chrome itself is never killed: this process
// only attaches to it over CDP, so the automation Chrome and its sign-ins stay up; at worst
// one half-used tab is left open.
//
// Every web / Telegram / Sithiji job is a 'design' job — the one pipeline (design.mjs runDesign):
//   reference job   → ref (link or uploaded image) [+ product link]  → direct / indirect decided by what is promoted
//   persona/promote → no reference → the strategist writes the brief
// The legacy 'idea' / 'promote' / 'recreate' modes (run.mjs, Claude CLI) are no longer started from here.
import { setDefaultResultOrder } from 'node:dns';
import { join } from 'node:path';
import { ROOT } from '../lib/env.mjs';

setDefaultResultOrder('ipv4first');
const send = (m) => { try { process.send?.(m); } catch {} };
const log = (...a) => send({ type: 'log', text: a.join(' ') });

process.on('message', async (job) => {
  if (job.aiMethod) process.env.ASHADI_AI_JOB = job.aiMethod;      // the method picked when this job started: CLI or non-CLI (lib/thinker.mjs)
  try {
    const { runDesign } = await import('../design.mjs');
    const { resolveReference } = await import('../lib/oneflow.mjs');
    const kind = job.kind || 'reference';
    let igUrl = ''; let refFiles = job.refFiles || []; let relation = ['direct', 'indirect'].includes(job.relation) ? job.relation : 'auto';

    if (job.ref) {
      const dir = join(ROOT, '3-output', 'ashadi-inbox', `refs-${Date.now()}`);
      const r = await resolveReference(job.ref, dir, { log });
      if (r.igUrl) igUrl = r.igUrl; else refFiles = r.files;
    } else if (!refFiles.length) {
      if (kind === 'reference') igUrl = job.source;                       // legacy: a bare Instagram link
      else relation = 'none';                                              // persona / promote with no reference
    }

    // How closely to copy (Sithiji card choice): 'direct' = the same design rebuilt for Kapruka with minimal change
    // (the pipeline's default 'adapt' style, same-product relation); 'adapt' = work out the reference's idea first
    // and rebuild it more freely for Kapruka ('creative' style).
    const fidelity = ['direct', 'adapt'].includes(job.fidelity) ? job.fidelity : '';
    const style = fidelity === 'adapt' ? 'creative' : fidelity === 'direct' ? 'adapt' : undefined;
    if (fidelity === 'direct' && relation === 'auto') relation = 'direct';
    let res;
    if (job.carousel && refFiles.length > 1 && !igUrl) {
      // a carousel: one design per slide, assembled into ONE multi-page Canva project
      const { runCarousel } = await import('../carousel.mjs');
      res = await runCarousel({
        refFiles, caption: job.caption || '', instruction: job.instruction || '', tag: job.tag || 'carousel',
        style, relation, productUrl: job.productUrl || '', log,
      });
    } else {
      res = await runDesign({
        igUrl, refFiles, caption: job.caption || '', instruction: job.instruction || '', tag: job.tag || '',
        relation, kind, text: job.text || '', productUrl: job.productUrl || '', ...(style ? { style } : {}), log,
        resumeRunId: job.resumeRunId || '', onRunDir: (dir) => send({ type: 'rundir', outDir: dir }),
      });
    }
    send({ type: 'done', outDir: res.outDir, count: res.result.variants.filter((v) => v.canva).length });
  } catch (e) {
    send({ type: 'error', message: e.message, outDir: e.outDir || null });
  } finally {
    setTimeout(() => process.exit(0), 300);       // let the last IPC message flush
  }
});
