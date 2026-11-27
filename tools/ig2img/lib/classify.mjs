// classify.mjs — read a raw Telegram message and decide which of the three jobs
// it's asking for, via a fast headless Claude call (no regex guessing).
//
//   recreate  — an Instagram link to reverse-engineer                ("recreate this", "create <link>")
//   idea      — ideas for a named persona, no source image           ("idea for the romantic gifter local")
//   promote   — a real Kapruka service/feature/landing page          ("promote same-day delivery")
//   none      — small talk, /start, or too ambiguous to act on
import { spawn } from 'node:child_process';

const INSTRUCTIONS = (body) => `
Classify ONE Telegram message for the Kapruka ig2img bot. Reply with ONLY a single-line
JSON object — no markdown fence, no explanation, nothing before or after it.

The bot has three jobs:
1. "recreate" — the human sent an Instagram post/reel link and wants it rebuilt as a
   Kapruka ad ("recreate this", "create <link>", or just a link + the word create).
2. "idea" — the human wants fresh ad ideas for a named persona/relationship-situation,
   with NO source image to recreate ("ideas for the romantic local gifter", "give me
   ideas for corporate staff gifting", "flowers ideas for parents international").
3. "promote" — the human wants a real Kapruka service, feature, or landing page turned
   into ad prompts (a URL on kapruka.com, or a named thing like "same-day delivery",
   "corporate gifting", "the flower category") — NOT a specific product recreation of
   an external Instagram post.
If none of these fit (small talk, /start, a bare link with no direction, unclear), use "none".

MESSAGE:
${JSON.stringify(body)}

Fields to fill:
- mode: "recreate" | "idea" | "promote" | "none"
- link: the Instagram URL if present, else null
- persona: for "idea" mode only — the persona/relationship-situation named or implied
  (e.g. "Romantic", "Parents", "Corporate staff", "Self-Purchaser"), else null
- thing: for "promote" mode only — the service/feature/page/URL named, in the human's
  own words (e.g. "same-day delivery", "corporate gifting", "https://kapruka.com/online/...")
  else null
- variations: an integer 1-4 if the message says "x2"/"x3"/"3 ideas"/etc, else 1
- instruction: anything else in the message that should steer the creative direction
  (free text, may be empty string)

Reply with exactly one line of JSON, matching this shape:
{"mode":"idea","link":null,"persona":"Romantic","thing":null,"variations":2,"instruction":""}
`.trim();

function runClaude(instructions, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const model = process.env.IG2IMG_CLASSIFY_MODEL || 'haiku';
    const child = spawn('claude', [
      '-p',
      '--model', model,
      '--permission-mode', 'acceptEdits',
      '--allowedTools', '""',
    ], { shell: true, windowsHide: true });

    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('classify timed out')); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`classify exited ${code}: ${err.slice(-300) || out.slice(-300)}`));
      resolve(out.trim());
    });
    child.stdin.write(instructions);
    child.stdin.end();
  });
}

const IG_URL = /https?:\/\/(?:www\.)?instagram\.com\/[^\s]+/i;

/**
 * @returns {Promise<{mode:'recreate'|'idea'|'promote'|'none', link:?string,
 *   persona:?string, thing:?string, variations:number, instruction:string}>}
 */
export async function classifyMessage(body, { log = console.log } = {}) {
  const fallbackLink = body.match(IG_URL)?.[0] || null;
  try {
    const raw = await runClaude(INSTRUCTIONS(body));
    const jsonText = raw.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonText) throw new Error('no JSON in classifier output');
    const parsed = JSON.parse(jsonText);
    const mode = ['recreate', 'idea', 'promote', 'none'].includes(parsed.mode) ? parsed.mode : 'none';
    const variations = Math.min(Math.max(Number(parsed.variations) || 1, 1), 4);
    return {
      mode,
      link: parsed.link || fallbackLink,
      persona: parsed.persona || null,
      thing: parsed.thing || null,
      variations,
      instruction: typeof parsed.instruction === 'string' ? parsed.instruction : '',
    };
  } catch (e) {
    log(`  ! classify failed (${e.message}) — falling back to link-based guess`);
    // Fallback: the old deterministic behaviour, so a classifier hiccup never
    // strands a message that would obviously have worked before.
    return {
      mode: fallbackLink && /\bcreate\b/i.test(body) ? 'recreate' : 'none',
      link: fallbackLink, persona: null, thing: null, variations: 1, instruction: '',
    };
  }
}
