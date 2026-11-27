// designer.mjs — Ashadi's two design agents.
//
//   1. reverseEngineer()  — measures a reference creative into an EXACT layout spec: every
//      element's box (to 0.5% of the canvas), type (copy, family, weight, size, cap height,
//      tracking, leading, case, colour, alignment), logos, flat shapes, margins, white
//      space, alignment axes, z-order — and a text-free description of the picture layer.
//      It reads a copy of the reference with a measuring grid drawn on (grid.py) so
//      positions come off a ruler, not a guess.
//   2. adaptToKapruka()   — keeps that geometry exactly and swaps everything brand-specific
//      for Kapruka: copy (same job, same length, approved claims only), fonts (closest
//      Canva font, brand guidelines first), palette, logo, the scene's subject, and the
//      real packaging asset to attach. It also writes the TEXT-FREE scene prompt for the
//      image engines — all type lives in Canva as editable layers, never in the picture.
//
// Both run headless `claude -p` on Opus (same as lib/review.mjs) with Read access, from the
// project root so they can read the reference files and the brand docs themselves.
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './env.mjs';
import { runThinking, setAgentLogger } from './thinker.mjs';
import { lessonsText } from './promptbook.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const rel = (p) => relative(ROOT, p).split('\\').join('/');

export const CANVA_FONTS = ['Poppins', 'Inter', 'Montserrat', 'Playfair Display', 'DM Serif Display', 'Bebas Neue',
  'Oswald', 'Anton', 'Archivo Black', 'League Spartan', 'Raleway', 'Lato', 'Open Sans', 'Roboto'];

// Which AI answers the thinking steps (CLI or non-CLI/Gemini) is decided in thinker.mjs — strict, no silent fallback.
export { setAgentLogger };
const runClaude = runThinking;

function parseJson(raw, label) {
  const a = raw.indexOf('{'); const b = raw.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error(`${label} returned no JSON`);
  const body = raw.slice(a, b + 1);
  try { return JSON.parse(body); } catch { /* fall through: strip trailing commas */ }
  const noTrail = body.replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(noTrail); } catch { /* fall through: repair unescaped quotes inside text values */ }
  // A text value that quotes something (a bottle label, a phrase) with plain double quotes ends the string early; the error
  // points just past it. Escape the quote that closed the string early and try again — repeat, up to 60 times.
  let t = noTrail; let lastErr = null;
  for (let i = 0; i < 60; i++) {
    try { return JSON.parse(t); } catch (e) {
      lastErr = e;
      const m = /position (\d+)/.exec(e.message);
      const q = m ? t.lastIndexOf('"', Number(m[1]) - 1) : -1;
      if (q < 0) break;
      t = `${t.slice(0, q)}\\"${t.slice(q + 1)}`;
    }
  }
  try { mkdirSync(join(ROOT, 'tools', 'ig2img', 'web', 'data'), { recursive: true }); writeFileSync(join(ROOT, 'tools', 'ig2img', 'web', 'data', `bad-json-${label}.txt`), raw); } catch { /* diagnostics only */ }
  throw new Error(`${label} returned invalid JSON: ${lastErr ? lastErr.message : 'unreadable'} (raw reply saved to web/data/bad-json-${label}.txt)`);
}

/** Ask the thinking AI for JSON. One malformed answer (seen 2026-11-23: Gemini's kapruka-adapter reply broke at line 53) used
 *  to fail the whole job — re-ask once before giving up. Only a JSON problem is re-asked; any other error passes straight through. */
async function askJson(prompt, opts, label) {
  let last;
  for (let i = 1; i <= 2; i++) {
    const raw = await runClaude(prompt, opts);
    try { return parseJson(raw, label); } catch (e) {
      last = e;
      if (!/invalid JSON|no JSON/.test(e.message)) throw e;
    }
  }
  throw last;
}

/** Draw the measuring grid over each reference; returns [{ clean, grid, w, h }]. */
export function gridify(refFiles, outDir) {
  mkdirSync(outDir, { recursive: true });
  return refFiles.map((f, i) => {
    const grid = join(outDir, `ref-${String(i + 1).padStart(2, '0')}-grid.png`);
    const size = JSON.parse(execFileSync('python', [join(HERE, 'grid.py'), f, grid],
      { env: { ...process.env, PYTHONUTF8: '1' }, encoding: 'utf8' }).trim());
    return { clean: f, grid, ...size };
  });
}

const SPEC_SCHEMA = `{
 "canvas": {"w": <px>, "h": <px>, "aspect": "4:5", "background": "#hex", "background_kind": "flat|gradient|photo|texture"},
 "layout_summary": "<2 sentences: the structure in plain words>",
 "grid": {"margins_pct": {"top": n, "right": n, "bottom": n, "left": n},
          "alignment_axes": ["<e.g. headline + subhead + logo share a left edge at x=7%>"],
          "whitespace": ["<e.g. 9% empty band between headline block and product>"]},
 "scene": {"present": true, "box": {"x": n, "y": n, "w": n, "h": n}, "kind": "photo|3d-render|illustration|flat-graphic|none",
           "framing": "full-bleed|cutout-on-ground|framed-panel  (cutout-on-ground = objects float directly on the page colour, no visible picture edge; framed-panel = a photo with its own visible rectangular edge)",
           "subject": "<what is pictured — NO text, NO logos>", "composition": "<where things sit, scale, crop>",
           "camera": "<angle, lens feel, depth of field>", "lighting": "<direction, softness, colour>",
           "palette": ["#hex"], "negative_space": ["<calm areas the type sits on, as % boxes>"]},
 "elements": [
   {"id": "e1", "type": "text", "role": "headline|subhead|body|cta|price|label|tagline|badge",
    "text": "<exact copy, \\n for line breaks>", "box": {"x": n, "y": n, "w": n, "h": n},
    "font": {"family_guess": "<closest font name>", "category": "geometric sans|grotesque|humanist sans|serif|slab|script|condensed|display",
             "weight": 100-900, "size_px": n, "cap_height_px": n, "line_height": n, "letter_spacing_px": n,
             "case": "none|upper|title", "italic": false, "color": "#hex", "align": "left|center|right", "valign": "top|middle|bottom"},
    "highlights": [{"words": "<exact words in a different colour>", "color": "#hex"}], "confidence": "high|medium|low"},
   {"id": "e2", "type": "logo", "brand": "<whose>", "box": {...}, "on": "dark|light", "confidence": "..."},
   {"id": "e3", "type": "shape", "shape": "rect|roundRect|ellipse|pill", "box": {...}, "fill": "#hex", "opacity": 0-1, "radius_px": n, "confidence": "..."},
   {"id": "e4", "type": "image", "role": "product-cutout|inset-photo|sticker|icon", "box": {...}, "description": "...", "confidence": "..."}
 ],
 "ornaments": [{"description": "<arrows, swooshes, strokes, sparkles, icons — anything that is NOT a flat filled block>", "box": {...}}],
 "z_order": ["scene", "e3", "e1", "e2"],
 "hierarchy": ["<element ids / scene, first stop for the eye first>"],
 "why_it_works": ["<max 3 bullets>"]
}`;

/** Step 1 — measure the reference into an exact layout spec. */
export async function reverseEngineer({ refFiles, caption = '', outDir, log = console.log }) {
  const refs = gridify(refFiles, join(outDir, 'measure'));
  const main = refs[0];
  const files = refs.map((r, i) => `  slide ${i + 1}: clean = ${rel(r.clean)}   grid = ${rel(r.grid)}   (${r.w}x${r.h}px)`).join('\n');
  const prompt = `You are Ashadi's layout reverse-engineer: a senior graphic designer who MEASURES, never guesses.

Reference creative (Read EVERY file below with the Read tool before answering):
${files}
Caption (context only): ${JSON.stringify(String(caption).slice(0, 600))}

The GRID copy has magenta lines + labels every 10% and thin cyan lines every 5%, origin top-left.
Use the GRID copy to measure positions and sizes; use the CLEAN copy for colours, fonts, copy and detail.

Produce a spec so exact that a designer could rebuild slide 1's layout blind:
- Boxes are % of canvas width (x, w) and height (y, h), measured from the top-left, to 0.5 precision.
  Tight boxes: text = cap-top of the first line to the baseline/descender of the last line; logo = the mark itself.
- Text: transcribe the EXACT copy with its real line breaks. size_px and cap_height_px are for a ${main.w}px-wide canvas.
  Give weight (100-900), the closest real font family, category, letter_spacing_px, line_height (multiple of size),
  case, colour (sample the hex), alignment, and any words set in a different colour (highlights).
- Separate the SCENE (photographed / rendered / illustrated picture) from GRAPHIC layers (text, logos, flat shapes,
  badges, frames, scrims). The scene description must contain NO text, letters, logos or typography.
- "shape" is ONLY a flat filled block (rect, rounded rect, pill, circle) — a colour band, card, badge or scrim.
  Arrows, swooshes, strokes, underlines, sparkles and icons go in "ornaments" (they are not rebuilt as shapes).
- Record the white space: margins from each canvas edge to the nearest element, gaps between groups, and every
  alignment axis two or more elements share. Note the z-order and the eye's path (hierarchy).
- Do not invent anything you cannot see. Mark uncertain elements "confidence": "low".

Reply with ONLY one JSON object, no prose, in exactly this shape:
${SPEC_SCHEMA}`;
  log(`  → reverse-engineering ${refs.length} slide${refs.length > 1 ? 's' : ''} (Opus, measuring on a 5% grid)…`);
  const spec = await askJson(prompt, { label: 'reverse-engineer' }, 'reverse-engineer');
  spec.canvas = { w: main.w, h: main.h, ...(spec.canvas || {}), w: main.w, h: main.h };
  writeFileSync(join(outDir, 'reference-spec.json'), JSON.stringify(spec, null, 2));
  log(`  ✓ reference spec: ${(spec.elements || []).length} layers — ${spec.layout_summary || ''}`);
  return spec;
}

/**
 * Step 1b — the IDEA, before any layout work is copied (human finding, 2026-11-17: "does the
 * entire concept make sense?" — it did not. A film-title poster with a stiletto dripping into
 * a jar is ONE joke; copying the drip and the title layout onto a globe and a gift bag kept the
 * form and lost the meaning). An art director explains what the reference MEANS, then rebuilds
 * that mechanism around something true and recognisable for Kapruka's audience.
 */
export async function conceptualise({ refSpec, refFiles, caption = '', instruction = '', outDir, log = console.log }) {
  const prompt = `You are Ashadi's creative director. A reference ad is about to be recreated for Kapruka. Before anyone copies
its layout, work out its IDEA — then rebuild that idea so it makes sense for Kapruka.

Read first (Read tool): 1-foundation/00-brand-guidelines.md, 1-foundation/01-business-context.md
Reference image(s): ${refFiles.map(rel).join(', ')}
Caption (context only): ${JSON.stringify(String(caption).slice(0, 600))}
Its measured copy: ${JSON.stringify((refSpec.elements || []).filter((e) => e.type === 'text').map((e) => e.text))}
${instruction ? `The requester's note (follow it): ${instruction}\n` : ''}
STEP A — decode the reference. In plain words:
- What is the joke / hook / promise, and what does EACH visual element and each line of copy stand for?
  (A parody poster, a pun, a before/after, a comparison, a seasonal moment, a product-as-hero reveal…)
- What does the viewer need to already know for it to land (a film, a phrase, a festival, a meme)?
- Why does the combination work — which parts are essential, which are decoration?

STANDING RULES (human, 2026-11-17 — never broken):
- ALL text is the Inter font (Canva honours Regular 400 / Bold 700). Headlines Bold.
- 100px margin on all four sides of the 1080x1350 canvas: no text, logo or product/object comes closer than 100px to any edge.
- The Kapruka logo sits near the top: its top edge no more than 110px from the top of the page (inside the 100px margin).
- Follow Kapruka's brand guidelines strictly (1-foundation/00-brand-guidelines.md: palette, tone, banned words, claims) — except the font, which is Inter.
- The product looks EXACTLY like the original in the post: if the reference's hero is a product Kapruka sells or could sell, show that same
  product with no changes (same shape, colour, packaging, details) — never redesigned, substituted or improved. Only a product that belongs to
  ANOTHER brand is replaced, by the nearest real Kapruka product.
- DO NOT OVER-LOCALISE: no Sinhala/Tamil words, kinship terms or slang (amma, akka, aiya, thatha, machan, aiyo and the like), no postcard clichés
  (elephants, tea pickers, flags). The audience is Sri Lankans at home and abroad, but the idea must be a universal, relatable gifting moment that
  reads naturally in plain English. Local context only where it is factual and relevant (LKR prices, island-wide delivery).
- CLEAN AND REFINED: uncluttered, generous white space, ONE idea per ad, a restrained palette, polished and high-end in feel (show it through
  restraint and craft — never by writing the word "premium" or any other banned word). High-quality, production-grade output only: no clutter,
  no gimmicky props, no cheap-looking AI artefacts.

STEP B — rebuild it for Kapruka (a Sri Lankan gifting and shopping site; audience: people in Sri Lanka and Sri Lankans
abroad sending to family at home). Rules:
- KEEP THE MECHANISM, not the objects. If the mechanism needs a reference the audience won't know, choose a different
  one that a Sri Lankan viewer recognises in two seconds: a well-known phrase or saying, a festival, a family moment, a
  real everyday situation. Do not invent facts, offers, prices or delivery promises (only what 01-business-context.md
  supports).
- EVERY object in the picture and EVERY line of copy must stand for something in the concept. No decorative props, no
  random "luxury" items, no gold drips or symbols copied because the reference had them.
- A real Kapruka product category is the punchline or the hero, shown as something a person would actually send.
- No third-party brands, logos or film titles in the picture or copy. Parody a SITUATION or a PHRASE, not a trademark.
- The headline and the tagline must say the same thing as the picture. If they don't connect, rewrite until they do.
- Never use: premium, luxury, exclusive, high-end, best, leading, biggest, amazing, incredible, premier.
- Self-check: would someone who has never seen the reference understand it? If not, change the idea.

Reply with ONLY one JSON object, no prose:
{
 "reference_idea": "<one sentence: what the reference is really saying>",
 "reference_decoded": [{"element": "<visual or line of copy>", "stands_for": "<what it means>"}],
 "needs_to_know": "<what the viewer must already know, or 'nothing'>",
 "transferable": "yes|partly|no",
 "kapruka_concept": {
   "one_line": "<the idea in one sentence a manager can approve>",
   "hook": "<the shared reference/situation a Sri Lankan viewer gets, and why it is real>",
   "headline_lines": ["<top-to-bottom lines of the main headline>"],
   "supporting_line": "<tagline / one-liner idea, or ''>",
   "visual": "<exactly what is pictured and what EACH object stands for — no text, no logos>",
   "product_role": "<which real Kapruka product category is hero/punchline>",
   "why_it_makes_sense": "<2 sentences: how picture + words land together for the audience>"
 },
 "rejected": ["<1-3 ideas you considered and dropped, with why>"],
 "confidence": "high|medium|low",
 "warnings": ["<anything the human should check, e.g. a cultural reference to confirm>"]
}`;
  log('  → working out what the reference means and how Kapruka should say it (Opus)…');
  const c = await askJson(prompt, { label: 'concept' }, 'concept');
  if (!c.kapruka_concept?.one_line || !c.kapruka_concept?.visual) throw new Error('concept agent wrote no usable concept');
  writeFileSync(join(outDir, 'concept.json'), JSON.stringify(c, null, 2));
  log(`  ✓ concept: ${c.kapruka_concept.one_line}`);
  return c;
}

/** Step 2 — same geometry, Kapruka everything else, plus a text-free scene prompt. */
export async function adaptToKapruka({ refSpec, refFiles, instruction = '', concept = null, replica = false, target = '', relation = 'direct', products = null, outDir, log = console.log }) {
  const hasPack = !!(products && products.sheet);
  const words = hasPack && products.labelWords?.length ? ` Printed words that must be spelled exactly: ${products.labelWords.map((w) => JSON.stringify(w)).join(', ')}.` : '';
  const targetBlock = `${target ? `WHAT WE PROMOTE (decides everything about the hero): ${target}.\n` : ''}${relation === 'indirect'
    ? `INDIRECT REFERENCE (human rule 2026-11-22): the reference advertises a DIFFERENT product or category from what we promote, so it is inspiration for the look only.
Keep its composition, camera angle, lighting, colour mood, type hierarchy and spacing. Replace its hero entirely with what we promote, and write new copy for what we promote
(same job and length per line). Do NOT carry over the reference's product, its device or its jokes unless they fit what we promote.\n`
    : ''}${hasPack ? `REAL PRODUCTS (attached to the image model as a product sheet): ${products.products.map((x) => `${x.title}${x.price ? ' (' + x.price + ')' : ''}`).join('; ')}.
Show exactly these products, drawn exactly as on the sheet (same shape, colour, packaging, printed words) — this replaces the "nearest real Kapruka product" rule and the
blank-packaging rule for these products. Write scene.prompt so it says the products are drawn exactly as in the attached product sheet.${words}
Never claim a price, offer or delivery promise that is not on the product page.\n` : ''}`;
  const noTextRule = hasPack
    ? '- No text, letters, numbers, logos, watermarks or signage anywhere in the image EXCEPT the words printed on the real products themselves (listed above), which must be spelled exactly. No headline, caption, price tag or sticker.'
    : '- ABSOLUTELY NO text, letters, numbers, words, logos, watermarks, labels, signage or UI anywhere in the image —\n  including on packaging, products, clothing, screens and backgrounds.';
  const prompt = `You are Ashadi, Kapruka's graphic designer. Rebuild a reference creative for Kapruka.

Read these first with the Read tool:
  1-foundation/00-brand-guidelines.md            (typography, colours, tone — the source of truth)
  1-foundation/01-business-context.md            (the ONLY claims you may make)
  1-foundation/references/brand-assets/_brand-assets.md   (real packaging assets + the attach rule)
  1-foundation/references/brand-assets/_image-gen-rules.md
Reference image(s): ${refFiles.map(rel).join(', ')}

${replica ? `REPLICA MODE (human decision 2026-11-17: "remove the creator's touch, do an exact replica"): recreate the reference as FAITHFULLY as possible.
There is no creative reinterpretation and no new idea. The ONLY differences from the reference are Kapruka's own: the logo, the Inter font, the Kapruka
colour palette for type, the 100px-margin / logo-position rules, and the banned-word and claims rules.
- COPY: keep the reference's wording word-for-word, with the same punctuation, case and line breaks. Change ONLY (a) another brand's name or trademark
  or a named person -> Kapruka or the plain generic word, and (b) a banned word. Do not rewrite, improve, shorten, localise or add anything.
- PICTURE: the same subject, objects, composition, crop, camera, light and colour mood as the reference — describe exactly what is in it (scene.subject
  and scene.prompt must read as a description of the reference's own picture). A product keeps its exact shape, colour, finish and details; only another
  brand's packaging or label becomes plain blank packaging (the real Kapruka logo is added in Canva).
- LAYOUT AND TYPE: exactly as measured (positions, scale, spacing, hierarchy, alignment), apart from the 100px margin rule.
` : ''}The reference's exact layout spec (measured):
${JSON.stringify(refSpec, null, 1)}

${concept ? `THE CONCEPT (approved direction — the layout below is only the container for it):
${JSON.stringify({ ...concept.kapruka_concept, reference_idea: concept.reference_idea }, null, 1)}
Every text layer's copy must express this concept (use headline_lines for the headline lockup, supporting_line for the
one-liner) and scene.subject / scene.prompt must show exactly "visual" — nothing more, no extra props. If a line is
too long for its box (±15% limit), tighten the wording but KEEP its meaning; never fall back to generic copy.
` : ''}STANDING RULES (human, 2026-11-17 — never broken):
- ALL text is the Inter font (Canva honours Regular 400 / Bold 700). Headlines Bold.
- 100px margin on all four sides of the 1080x1350 canvas: no text, logo or product/object comes closer than 100px to any edge.
- The Kapruka logo sits near the top: its top edge no more than 110px from the top of the page (inside the 100px margin).
- Follow Kapruka's brand guidelines strictly (1-foundation/00-brand-guidelines.md: palette, tone, banned words, claims) — except the font, which is Inter.
- The product looks EXACTLY like the original in the post: if the reference's hero is a product Kapruka sells or could sell, show that same
  product with no changes (same shape, colour, packaging, details) — never redesigned, substituted or improved. Only a product that belongs to
  ANOTHER brand is replaced, by the nearest real Kapruka product.
- DO NOT OVER-LOCALISE: no Sinhala/Tamil words, kinship terms or slang (amma, akka, aiya, thatha, machan, aiyo and the like), no postcard clichés
  (elephants, tea pickers, flags). The audience is Sri Lankans at home and abroad, but the idea must be a universal, relatable gifting moment that
  reads naturally in plain English. Local context only where it is factual and relevant (LKR prices, island-wide delivery).
- CLEAN AND REFINED: uncluttered, generous white space, ONE idea per ad, a restrained palette, polished and high-end in feel (show it through
  restraint and craft — never by writing the word "premium" or any other banned word). High-quality, production-grade output only: no clutter,
  no gimmicky props, no cheap-looking AI artefacts.

${targetBlock}KEEP EXACTLY: canvas, every element's box, margins, white space, alignment axes, z-order, hierarchy, the type
scale (size_px, weight, case, line_height, letter_spacing_px, align) and each text block's line count. Someone who
saw the reference must recognise the same layout and rhythm.

CHANGE to Kapruka:
- Copy: same job per element, same line count, and EACH LINE no more than 15% LONGER than the reference line's
  character count — this is a hard limit, because the type size and box are fixed (a longer line wraps or overflows).
  A shorter line is fine.
  Count the characters. Plain spoken words, clarity over clever. No invented facts, prices, offers or delivery promises — only what 01-business-context.md supports.
  Never use: premium, luxury, exclusive, high-end, best, leading, biggest, amazing, incredible, premier.
- Fonts: Inter ONLY, for every text layer (human rule 2026-11-17; this overrides the Poppins/DM Sans lines in the brand file).
  Canva gives imported text only two weights: 400 (Regular) or 700 (Bold) — use one of those. Headlines are 700.
- MARGINS: every text layer and the logo sit at least 100px from every canvas edge (x from 100 to 980px, y from 100 to 1250px on a
  1080x1350 canvas) — if the reference has type nearer an edge (e.g. a footer line), move it in. The logo's top edge is within 110px of the top.
- PRODUCT: the product must look exactly like the original in the post — see the standing rules below.
- Colours: map by role to the Kapruka palette — ground/type purple #340A5C (deep #241044), highlight yellow
  #FFC107, gold #D9A441, warm gold #F6C96A, cream #F5F4EB, white #FFFFFF.
- Colour hierarchy: if the reference sets some lockup words in an accent colour (small words like THE / EATS /
  THAT), keep that hierarchy with a Kapruka accent: on a light ground use the lighter purple #6B3FA0 (legible),
  gold #D9A441 only on a dark ground. Never leave a headline one flat colour when the reference has an accent.
  Record it per line via "highlights" or each line's own font.color.
- Logo: every logo becomes ONE Kapruka logo in the reference logo's box ("on": "dark" or "light" = what it sits
  on). If the reference has no logo, add one in the calmest corner that respects the margins.
- Tagline (if the layout has one): ${concept?.kapruka_concept?.supporting_line
    ? `the concept's supporting_line (${JSON.stringify(concept.kapruka_concept.supporting_line)}) REPLACES "A world of choices" — it is the idea's second half. Never add both.`
    : 'if the reference line is a brand sign-off / tagline, use "A world of choices" on its own (never extended); if it is a spoken line, punchline or caption (a sentence with a voice), write a Kapruka line of the SAME job, voice and length instead — never swap a punchline for the tagline.'}
- Shapes: only flat filled blocks. Do not add ornaments (arrows, strokes, swooshes) as shapes or elements.
- Letter case: keep ONE consistent case scheme across a lockup, matching the reference (all-caps stays all-caps).
- Scene: same composition, camera, crop and light, Kapruka subject. ${concept
    ? 'Show the concept\'s "visual" in the reference\'s composition. Do NOT copy a device (melting, pouring, dripping) unless the concept itself needs it.'
    : 'Keep the reference\'s VISUAL DEVICE — the trick that makes the idea land (e.g. one object melting/pouring into another) — and keep EVERY object of that device exactly as in the reference: same shape, same colour, same finish (a glossy RED stiletto stays a glossy red stiletto; a trident stays a trident; red drips stay red). Do NOT recolour the device into Kapruka purple: brand colours apply to the type, the packaging and the layout only. Only the PRODUCT the device acts on (another brand\'s jar, bottle or packaging) is replaced by the nearest real Kapruka product. In scene.subject and scene.prompt, name each device object with its exact colour and material.'}
- Products shown must be real, sellable gifts (filled, finished, recognisable) — never empty or generic props.
- Keep scene.framing exactly as measured (cutout-on-ground stays objects-on-the-page, no picture edge).
- PACKAGING RULE (human rule, 2026-11-15): every logo goes on in Canva, never painted by the image model. So any
  Kapruka bag, box or packaging in the scene is painted PLAIN AND BLANK: matte Kapruka purple #4B2386 (bags have
  white twisted-rope handles), completely unprinted — no logo, no wordmark, no text, no smile arc, no pattern.
  Leave the front face flat and clearly visible so the real logo can be placed on it afterwards. scene.attach = [].
${instruction ? `- The requester's note (follow it): ${instruction}\n` : ''}
${lessonsText() ? `${lessonsText()}
` : ''}Then write scene.prompt — 150-250 words for an image model that paints ONLY the picture layer:
${noTextRule}
- Keep these areas calm, low-detail and uncluttered because type sits on them later: list each text/logo box as
  % of the frame. Match the reference's light, palette mood and depth of field. 4:5 portrait.
- Photographic realism: real materials, one consistent light direction, real contact shadows, no plastic AI sheen.

Reply with ONLY one JSON object, no prose: the same shape as the reference spec, with Kapruka values, plus
 "scene": {..., "prompt": "<the text-free scene prompt>", "attach": ["<asset file name>"]},
 "changes": ["<what changed from the reference and why, max 8>"],
 "claims_used": ["<each factual claim in the copy + where 01-business-context.md supports it>"]`;
  log('  → adapting to Kapruka (same geometry; copy, fonts, palette, logo, scene)…');
  const spec = await askJson(prompt, { label: 'kapruka-adapter' }, 'kapruka-adapter');
  spec.canvas = { ...(refSpec.canvas || {}), ...(spec.canvas || {}), w: refSpec.canvas.w, h: refSpec.canvas.h };
  if (!spec.scene?.prompt) throw new Error('kapruka-adapter wrote no scene prompt');
  writeFileSync(join(outDir, 'kapruka-spec.json'), JSON.stringify(spec, null, 2));
  log(`  ✓ Kapruka spec: ${(spec.elements || []).filter((e) => e.type === 'text').length} text layers`);
  return spec;
}

/**
 * Final step — an art director's pass over what Canva ACTUALLY rendered (the exported
 * preview), against the reference. Flags anything below production standard so a human
 * knows exactly what to fix in Canva before it ships.
 */
// How this job relates to its reference ('direct' | 'indirect' | 'none') and the words printed on the real products —
// set once per job by runDesign so every art-director check judges the right thing.
let reviewCtx = { relation: 'direct', productWords: [], productNames: [], subject: '' };
export function setReviewContext(ctx = {}) { reviewCtx = { relation: 'direct', productWords: [], productNames: [], subject: '', ...ctx }; }

export async function reviewDesign({ previewFile, refFiles, concept = null, replica = false, log = console.log }) {
  const prompt = `You are Kapruka's senior art director doing the final production check on an ad design.
Read with the Read tool:
  the Kapruka design (as rendered by Canva): ${rel(previewFile)}
  the reference it was rebuilt from:        ${refFiles.length ? refFiles.map(rel).join(', ') : '(none: no reference for this job)'}

Judge it as a finished social ad at production standard. Check, concretely:
- text: any overlap, collision, clipping, overflow, awkward wrap, orphan word, cramped spacing, low contrast
- layout: does it keep the reference's placement, scale, margins and white space? anything misaligned or off-grid?
- picture: distortion/stretching, seams or visible box edges, AI artefacts, anything painted (text/logo) that shouldn't be
- brand: the real Kapruka logo, correct and undistorted, its top edge within 110px of the top of the page; Kapruka colours; all type in Inter (headline Bold)
- margins: measure it — text, logo and product/objects must all be at least 100px from every edge of the 1080x1350 canvas (flag any that are closer, or any object cut off by an edge)
- product: the product must look exactly like the original in the post — flag any redesign, substitution or distortion
${reviewCtx.productWords?.length ? `- product labels (human rule 2026-11-22: real products are drawn from their real pictures): the real products are ${JSON.stringify(reviewCtx.productNames || [])}; the BRAND and PRODUCT-NAME words that must be spelled EXACTLY are: ${reviewCtx.productWords.map((w) => JSON.stringify(w)).join(', ')}. Flag a garbled, changed or invented brand/product-name word, or a wrong shape or colour, as a HIGH issue starting "product:". Fine print (ingredient or volume lines, legal text, barcodes, tiny back-label words) cannot be legible at ad size: NEVER flag it as missing or wrong.\n` : ''}- guidelines: judge against 1-foundation/00-brand-guidelines.md strictly (banned words, tone, claims, palette)
${reviewCtx.relation === 'none' ? `- BRIEF (judge this first): there is no reference — this is an original ad. Judge it as a standalone ad: ONE clear idea, a strong hierarchy, the promoted product clearly the hero, brand fit. Never raise "adapt:" issues. When the picture fills the whole poster (a full-bleed photo), the picture IS the background: never ask for a flat #340A5C background, only that the type stays legible and the brand colours are present.${reviewCtx.subject ? ` SUBJECT TEST (HIGH if it fails): imagine ALL the text covered — can a stranger still tell the ad is about "${reviewCtx.subject}"? There must be a recognisable visual anchor of it (the product, or the interface/object people associate with it). A picture that suits any brand or message (a person smiling at a phone, a gift on a table) fails: raise a HIGH issue starting "subject:" saying what anchor is missing; it needs a new picture, not a layer fix.` : ''}`
  : reviewCtx.relation === 'indirect' ? `- INDIRECT REFERENCE (judge this first): the reference advertises a different product, so only its LOOK should echo here (composition feel, lighting, colour mood, type hierarchy). The hero must be the promoted product. Do NOT demand the same layout or objects, and never raise "adapt:" issues.`
  : replica ? `- REPLICA (judge this first, harshly): this must be an EXACT replica of the reference — same layout, spacing, type hierarchy, imagery/subject, composition and
  wording (only another brand's name swapped for Kapruka's, plus Kapruka's logo, Inter font, palette and the 100px margins). Compare element by element and flag
  any difference in layout, copy or picture as a HIGH issue starting "replica:". Do NOT judge whether the idea is clever — only how faithful it is.`
  : concept ? `- CONCEPT (judge this first, harshly): the intended idea was: ${JSON.stringify(concept.kapruka_concept?.one_line)} — visual: ${JSON.stringify(concept.kapruka_concept?.visual)}.
  Does every object and every line of copy stand for something? Do picture and words say ONE thing? Flag decorative props and a headline/tagline/picture that do not connect as a HIGH issue ("concept: ...").`
  : `- ADAPTATION (judge this first, harshly): this must be the SAME design as the reference — same layout, spacing, type hierarchy, composition and visual device —
  rebuilt for Kapruka (Kapruka copy of the same length and job, Kapruka product, Kapruka logo, brand palette, Inter, 100px margins). Compare element by element and flag any
  difference in layout, composition or visual device as a HIGH issue starting "adapt:". Do NOT judge whether the idea is clever and do not ask for a new one; DO flag copy that is
  broken, nonsensical or contradicts the picture. Objects the reference crops or bleeds off an edge are kept WHOLE inside the 100px margin here (a standing rule) — do not flag that.`}
- overall: would a senior designer approve this to post today?

Reply with ONLY one JSON object, no prose:
{"verdict": "production-ready|minor-fixes|not-ready",
 "issues": [{"severity": "high|medium|low", "what": "<the problem, max 20 words>", "fix_in_canva": "<the exact fix, max 20 words>"}],
 "strengths": ["<max 3, max 12 words each>"]}`;
  log('  → final art-director check on the Canva render (Opus)…');
  return await askJson(prompt, { label: 'art-director', timeoutMs: 8 * 60_000 }, 'art-director');
}

/**
 * Repair pass (human rule, 2026-11-17: "in any context it should fix" — not a per-bug patch).
 * Takes the art director's issues for THIS design and turns each fixable one into a precise
 * patch of the design's own layers (move/resize/recolour/retext a layer, nudge or scale the
 * picture). Issues that only a new picture can fix are reported, not guessed at. The caller
 * applies the patches (design.mjs applyFixes), rebuilds, re-reviews and keeps whichever is better.
 */
export async function fixDesign({ previewFile, layers, issues, concept = null, replica = false, log = console.log }) {
  const brief = layers.elements.map((e) => (e.type === 'image'
    ? { id: '(picture)', type: 'image', box: e.box }
    : { id: e.id, type: e.type, role: e.role, text: e.text, box: e.box,
      ...(e.font ? { font: { family: e.font.family, size_px: e.font.size_px, weight: e.font.weight, color: e.font.color, align: e.font.align } } : {}),
      ...(e.fill ? { fill: e.fill } : {}), ...(e.on ? { on: e.on } : {}) }));
  const prompt = `You are Ashadi's production fixer. The art director found problems in a finished Kapruka ad. Fix every one that can be
fixed by editing the design's LAYERS, with the smallest change that solves it.

Read (Read tool): the design as Canva rendered it: ${rel(previewFile)}
Canvas: ${layers.canvas.w}x${layers.canvas.h}px, page colour ${layers.canvas.background}. Boxes are % of canvas width (x,w) and height (y,h).
The layers (top-left origin; "(picture)" is the full-page picture layer):
${JSON.stringify(brief, null, 1)}

Issues to fix (severity, problem, suggested fix):
${JSON.stringify(issues, null, 1)}
${replica ? 'This is an EXACT REPLICA of the reference: never reword copy (only swap a banned word or another brand\'s name) and never restyle; move/resize only to match the reference or the margin rules.\n' : concept ? `The concept (do not change its meaning): ${JSON.stringify(concept.kapruka_concept?.one_line)}\n` : ''}
Rules:
- Keep the standing rules: all text stays Inter; every text layer and the logo stay at least 100px from every canvas edge; the logo's top edge stays within 110px of the top. Never change a font family.
- Express each fix as a patch to a layer id, or to the picture via "scene". Only touch what an issue names.
- Layer patch: {"id": "<layer id>", "box": {"x","y","w","h"}  (give only the numbers that change),
  "font": {"size_px","color","weight"}  (weight 400 or 700; colour as #RRGGBB; text layers only),
  "text": "<new copy>"  (keep the meaning; never use: premium, luxury, exclusive, high-end, best, leading, biggest, amazing, incredible, premier),
  "remove": true  (never for logos)}.
- Spacing/alignment fixes: compute the new boxes so gaps are equal and axes shared; keep text inside 5% margins.
- Colour fixes must stay legible (3:1 for large type, 4.5:1 for small) against what the text sits on, and use the Kapruka palette:
  purple #340A5C / #4B2386 / #6B3FA0, yellow #FFC107, gold #D9A441, cream #F5F4EB, white.
- "scene": {"scale": 0.7-1.15, "dx": -12..12, "dy": -12..12}  moves/scales the WHOLE picture layer (percent of the page) — use for a picture that is
  too big, clipped by an edge, or crowding type. The page colour continues behind it. Packaging logos move with it.
- An issue that needs a different picture (wrong/odd object, artefact, melted detail, wrong colour of a product) cannot be
  fixed by layers: put it in "regenerate_picture" with a note for the image model. Do not invent a layer patch for it.
- If an issue is not real, or cannot be fixed safely, list it in "unfixable" with the reason.

Reply with ONLY one JSON object, no prose:
{"elements": [<layer patches>], "scene": {"scale": 1, "dx": 0, "dy": 0} or null,
 "regenerate_picture": {"needed": false, "note": ""}, "unfixable": ["<issue — why>"], "summary": "<one line>"}`;
  log('  → fixer: turning the art director\'s issues into layer patches (Opus)…');
  return await askJson(prompt, { label: 'fixer', timeoutMs: 8 * 60_000 }, 'fixer');
}

/**
 * Step 4b — look at a generated picture layer before it goes anywhere near Canva.
 * Finds (a) any text / letters / logos / brand marks the model painted in despite the
 * rules, (b) AI watermarks or "made with AI" badges, (c) the front face of every
 * bag/box/packaging, so the real Kapruka logo can be placed on it as a Canva layer.
 */
export async function inspectScene({ sceneFile, outDir, log = console.log }) {
  const [g] = gridify([sceneFile], join(outDir, 'measure', 'scene'));
  const prompt = `You are Ashadi's picture checker. Read BOTH files with the Read tool:
  clean = ${rel(g.clean)}
  grid  = ${rel(g.grid)}   (magenta lines + labels every 10%, cyan every 5%, origin top-left; image is ${g.w}x${g.h}px)

This picture is the BACKGROUND layer of an ad. Text and logos are added later in Canva, so the picture itself
must contain none. Inspect it closely, zooming into every corner and every product surface.

Report, with boxes as % of the image (x, y, w, h from the top-left, 0.5 precision, measured on the grid copy):
1. text_or_logos: EVERY visible letter, word, number, logo, wordmark, brand mark, label or sign — including
   garbled pseudo-text and anything printed on bags, boxes, clothes, screens or walls. Empty list if none.
2. watermark: any AI watermark, "Imagined with AI" / "AI generated" badge, sparkle icon or corner stamp.
3. packaging: the front FACE of every Kapruka-style GIFT/SHOPPING BAG or GIFT BOX only — the flat, most visible face a
   logo would be printed on. NOT handbags, purses, products, product boxes or anything that is itself the gift.
   surface = "dark" or "light" (what a logo would sit on). Skip items under 5% of the image width.
4. objects: a tight box for EACH distinct object or connected group (e.g. the globe, the ribbon, the bag with what's
   in it, a puddle) — including its shadow where darker than the backdrop, spills and drips.
5. objects_box: ONE tight box around ALL the objects together.
6. people: every visible part of a real human (face, torso, arm, hand, fingers), and any hand-shaped mark, outline,
   sleeve remain or finger gap left on an object. Name each briefly. Empty list if none.

Reply with ONLY one JSON object, no prose:
{"text_or_logos": [{"what": "<the text or mark>", "box": {"x": n, "y": n, "w": n, "h": n}}],
 "watermark": {"present": false, "box": null, "edge": "bottom-left|bottom-right|top-left|top-right|none"},
 "packaging": [{"kind": "bag|box", "face": {"x": n, "y": n, "w": n, "h": n}, "surface": "dark|light", "angle": "front|three-quarter|side"}],
 "objects": [{"what": "<object>", "box": {"x": n, "y": n, "w": n, "h": n}}],
 "objects_box": {"x": n, "y": n, "w": n, "h": n},
 "people": ["<human part or hand-shaped mark>"],
 "notes": "<anything else wrong: extra fingers, melted objects, fake-looking surfaces — or empty>"}`;
  log('  → checking the picture for text, logos, watermarks and packaging faces (Opus)…');
  const qa = await askJson(prompt, { label: 'picture-checker', timeoutMs: 12 * 60_000 }, 'picture-checker');
  qa.text_or_logos ||= []; qa.packaging ||= []; qa.people ||= []; qa.watermark ||= { present: false };
  qa.size = { w: g.w, h: g.h };
  return qa;
}
