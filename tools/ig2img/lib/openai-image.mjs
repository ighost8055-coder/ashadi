// openai-image.mjs — generate with OpenAI's image API (gpt-image-2).
//
// Why this is the preferred engine:
//   * 2048x2560 is EXACTLY 4:5, so the output invariant is met natively — no crop,
//     no upscale, and downscaling to 1080x1350 sharpens rather than softens.
//   * It's a plain HTTP call, so it can't break the way a scraped UI can.
// The trade-off is that it bills per image, whereas Flow rides an existing plan.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { env } from './env.mjs';
import { compositeLogo } from './logo.mjs';

const KEY = () => env(['OPENAI_API_KEY_IG2IMG', 'OPENAI_API_KEY']);
const MODEL = process.env.IG2IMG_OPENAI_MODEL || 'gpt-image-2';
const SIZE = process.env.IG2IMG_OPENAI_SIZE || '2048x2560';    // 4:5 exactly
const MAX_PROMPT = 30_000;    // the API rejects very long prompts

/**
 * The paste text is "STANDING SPEC --- PROMPT BODY". The body is written to be
 * self-contained (Hard Rule 5), so when the combined text is too long for the API
 * we send the body alone rather than truncating mid-sentence and losing the
 * negatives at the end.
 */
function fitPrompt(text, log) {
  if (text.length <= MAX_PROMPT) return text;
  const body = text.split(/\n---\n/).slice(1).join('\n---\n').trim();
  if (body && body.length <= MAX_PROMPT) {
    log?.(`  · prompt trimmed to the self-contained body (${text.length} → ${body.length} chars)`);
    return body;
  }
  const cut = (body || text).slice(0, MAX_PROMPT);
  log?.(`  ! prompt truncated to ${MAX_PROMPT} chars — the tail of the negative list may be lost`);
  return cut;
}

/**
 * Run one prompt through the OpenAI image API.
 * `browserish` is only used for the logo composite (canvas), matching the other engines.
 * @returns {Promise<string[]>} saved image paths
 */
export async function generateWithOpenAI(browserish, promptText, outDir, {
  slug = 'render', variations = 1, log = console.log, logo = true, timeoutMs = 8 * 60_000,
} = {}) {
  mkdirSync(outDir, { recursive: true });
  const prompt = fitPrompt(promptText, log);

  log(`  → OpenAI ${MODEL} at ${SIZE} (${prompt.length.toLocaleString()} chars)`);
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt, size: SIZE, n: Math.min(Math.max(variations, 1), 4) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json().catch(() => ({}));
  if (json.error) throw new Error(`OpenAI: ${json.error.message}`);
  if (!json.data?.length) throw new Error('OpenAI returned no image');

  const saved = [];
  for (const [i, item] of json.data.entries()) {
    const n = String(i + 1).padStart(2, '0');
    const raw = join(outDir, `${slug}-openai-${n}-raw.png`);

    const buf = item.b64_json
      ? Buffer.from(item.b64_json, 'base64')
      : Buffer.from(await (await fetch(item.url)).arrayBuffer());
    writeFileSync(raw, buf);

    const out = join(outDir, `${slug}-openai-${n}.png`);
    const done = logo ? await compositeLogo(browserish, raw, out, { log }) : null;
    saved.push(done || raw);
    log(`  ✓ saved ${basename(done || raw)} (${SIZE}${done ? ', real logo composited' : ''})`);
  }
  return saved;
}
