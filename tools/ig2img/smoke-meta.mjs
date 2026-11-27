// smoke-meta.mjs — exercise lib/meta.mjs's real generateInMeta() end to end (one small,
// safe prompt), so the actual driver is verified, not just an ad-hoc probe script.
//
//   node tools/ig2img/smoke-meta.mjs
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/env.mjs';
import { connectChrome } from './lib/chrome.mjs';
import { generateInMeta } from './lib/meta.mjs';

const outDir = join(ROOT, 'tools', 'ig2img', '_smoke-meta');
mkdirSync(outDir, { recursive: true });
const chrome = await connectChrome();
try {
  const body = 'A single red rose in a plain glass vase, centred on a soft cream background, warm studio lighting, minimalist product photography. No text, no logo.';
  const files = await generateInMeta(chrome, body, outDir, { slug: 'smoke', body, want: 1, log: console.log });
  console.log('SAVED:', files);
} finally {
  await chrome.close();
}
