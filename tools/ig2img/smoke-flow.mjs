// smoke-flow.mjs — prove the Flow composer path works, without generating an image.
//
//   node tools/ig2img/smoke-flow.mjs
//
// Run this after ANY change to lib/flow.mjs. It catches the two failures that have
// actually happened: the composer never mounting, and an open settings popover
// swallowing the click on the prompt box.
import { connectChrome } from './lib/chrome.mjs';
import * as flow from './lib/flow.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = await connectChrome();
const page = await chrome.newPage();
try {
  const t0 = Date.now();
  await page.goto(flow.FLOW_PROJECT, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await sleep(5000);
  const res = await flow.__smoke(page, console.log);
  console.log('RESULT:', JSON.stringify(res), `${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exitCode = res.ok ? 0 : 1;
} finally {
  await page.close().catch(() => {});
  await chrome.close();
}
