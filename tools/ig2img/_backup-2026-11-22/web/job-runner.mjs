// job-runner.mjs — runs ONE Ashadi job in its own process, so the web server can stop it.
//
// The server forks this file, sends the job over IPC, and receives log lines + the result
// back. "Stop" = the server kills this process and everything it started (taskkill /T on
// Windows — that includes the headless `claude -p` agents and helper processes). Chrome
// itself is never killed: this process only attaches to it over CDP, so the automation
// Chrome and its sign-ins stay up; at worst one half-used tab is left open.
import { setDefaultResultOrder } from 'node:dns';

setDefaultResultOrder('ipv4first');
const send = (m) => { try { process.send?.(m); } catch {} };
const log = (...a) => send({ type: 'log', text: a.join(' ') });

process.on('message', async (job) => {
  try {
    if (job.mode === 'design') {
      const { runDesign } = await import('../design.mjs');
      const res = await runDesign({
        igUrl: job.refFiles?.length ? '' : job.source, refFiles: job.refFiles || [], caption: job.caption || '',
        instruction: job.instruction || '', tag: job.tag || '', log,
      });
      send({ type: 'done', outDir: res.outDir, count: res.result.variants.filter((v) => v.canva).length });
    } else {
      const { runPipeline } = await import('../run.mjs');
      // Mirrors telegram-bot.mjs: recreate → count = variations per prompt (2 prompts);
      // idea/promote → count = how many distinct prompts.
      const res = await runPipeline(job.source, {
        mode: job.mode,
        persona: job.mode === 'idea' ? job.source : '',
        thing: job.mode === 'promote' ? job.source : '',
        variations: job.mode === 'recreate' ? job.count : 1,
        maxPrompts: job.mode === 'recreate' ? 2 : job.count,
        instruction: job.instruction || '', notify: false, engine: null, log,
      });
      send({ type: 'done', outDir: res.outDir, count: res.images?.length ?? 0 });
    }
  } catch (e) {
    send({ type: 'error', message: e.message, outDir: e.outDir || null });
  } finally {
    setTimeout(() => process.exit(0), 300);       // let the last IPC message flush
  }
});
