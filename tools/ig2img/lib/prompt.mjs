// prompt.mjs — turn the scraped Instagram reference into paste-ready Kapruka
// image-generation prompt(s), by running the REAL Reference Recreator rules
// through the Claude CLI (headless `claude -p`), with the repo as its cwd so
// CLAUDE.md, 2-roles/12-reference-recreator.md and the foundation docs all load.
//
// The UNIFIED STANDING SPEC is prepended here in code, never by the model —
// Hard Rule 13 says it must be pasted IN FULL, so we do it mechanically.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './env.mjs';

const SPEC = join(ROOT, '3-output', 'reference-recreations', '_STANDING-SPEC.md');
const MASTER = join(ROOT, '1-foundation', 'references', 'brand-assets', '_master-ad-prompt.md');

// Shared across all three jobs (recreate / idea / promote) — the mechanics of turning
// a finished creative idea into the OUTPUT template the rest of the pipeline expects
// (Asset:/Engine: lines, asset names, negative-space rules). Kept in one place so a
// fix to one job's plumbing doesn't have to be copy-pasted into the other two.
const SHARED_RULES = `
- ⭐ **MASTER PREMIUM-AD STANDARD — run BEFORE the final image prompt is written** (human
  rule, 2026-10-12). Open \`1-foundation/references/brand-assets/_master-ad-prompt.md\`. Build
  each prompt so it meets its §1-§9 (premium quality, photographic realism, advertising-grade
  grading, hierarchy/composition, typography, product accuracy, clean compositing, clarity,
  original concept), then run its §10 FINAL QUALITY CONTROL checklist on your draft and fix
  every "no" BEFORE writing the prompt into the output file. Where it conflicts with the
  rulebook or Core Rules (Inter only, Light-on-Text, Two-Pass type with no baked-in
  shadows/outlines, no subtext, vibrant-not-oversaturated), the rulebook wins.
- Honest claims only (Core Rule 9). Inter for any on-image type.
- ⛔ **MATERIAL REALISM — BINDS EVERY TREATMENT, INCLUDING FLAT GRAPHIC (A) AND SURREAL
  COMPOSITE (C)** (human rule, 2026-09-29 — "I want realism in all treatments"). **A scene
  may be impossible; a surface may never be fake.** A and C are exempt only from the
  PHOTOGRAPHIC floor (the camera/light/candid clauses), never from this. In every prompt:
  real material behaviour (fur with individual strands and direction, fabric with weave and
  real drape, skin with pores and subsurface warmth, metal/glass/ceramic each behaving
  correctly) — **no plastic, waxy, over-smoothed or CG-putty surfaces on anything** · one
  coherent light logic across the whole frame — every composited element lit from the same
  direction, shadows falling the same way, correct light wrap, and **a real contact shadow
  wherever an object touches a surface** (a floating object with no contact shadow is the
  clearest composite failure) · correct anatomy and construction, no melted/warped/fused/
  duplicated detail · real edges, no cut-out halo or visible masking line · type rendered
  correctly, no garbled invented sub-text on labels. **The idea may be impossible; nothing
  in the frame may look cheaply made** — a badly-made composite is broken, not stylised.
- ⛔ **REAL FLOWERS, NEVER CG-PERFECT FLOWERS** (human rule, 2026-08-31 — caught live, a
  bouquet came back looking synthetic). Whenever the hero or a prop is a flower/bouquet,
  the prompt's product description must explicitly state: **irregular bloom stages** (a mix
  of fully-open and half-open blooms, never every flower at an identical stage), **natural
  asymmetry** (petals with soft creases, slightly uneven edges, a few facing slightly
  different directions — real stems are never perfectly matched), **true stem/leaf texture**
  (visible leaf veining, minor imperfections, not glossy-clean), and **shallow real depth of
  field with a couple of blooms softly out of focus** rather than every bloom in identical
  crisp focus. Add to that prompt's NEGATIVE line: "no uniform/identical flowers, no
  CG-perfect symmetry, no waxy/glossy petals, no every-bloom-in-focus artificial clarity."
- ⛔ **THE HEADLINE MUST BE A SENTENCE THAT ACTUALLY PARSES** (human rule, 2026-08-28).
  Read it aloud before you write it down. Natural, grammatical English a real person would
  say. Test: could you text this line to a friend without them asking "what?"
- ⛔ **NO ALCOHOL, EVER** (human rule, 2026-08-28) — no beer, wine, spirits, cocktails,
  bottles, cans, glasses, bar/pub settings, nobody drinking. Put "no alcohol, no beer, no
  wine, no bottles or bar setting" in the NEGATIVE line of every prompt.
- ⛔ **HAPPY, VIBRANT GIFTING — NEVER SAD OR GLOOMY** (human rule, 2026-09-26). The mood,
  expressions, lighting and staging must read as joy, warmth, celebration, connection —
  bright and alive. Never a mopey/melancholy mood, a grief/loss framing, a guilt-trip, or a
  dim/washed-out/gloomy visual treatment. A sad moment may appear only as the SETUP when the
  whole point is Kapruka resolving it fast (e.g. "almost forgot the date" panic → same-day
  save) — the image/headline must land ON the happy resolution, never linger in or centre
  the gloom. Add "no sad/gloomy mood, no dim or washed-out lighting, no crying or downcast
  expressions" to the NEGATIVE line whenever the concept has any risk of reading heavy.
- ⛔ **EASY TO PROCESS — THE FRAME MUST BE EFFORTLESS FOR THE EYE** (human rule, 2026-09-29 —
  caught live on a render that was beautiful but tiring to read). Two checks:
  **(1) FIGURE/GROUND.** The hero must **differ from its background on at least TWO of: size,
  value (light/dark), saturation, shape.** One is not enough. It fails when hero and ground
  share the same visual language — the live failure put small bright circular products inside
  a peacock tail already covered in small bright circular eye-spots, so the frame read as one
  busy texture even though every element was individually legible. If the background is the
  most saturated/detailed/contrasty thing in frame, **the background has become the subject** —
  darken, desaturate, blur or simplify it. ⛔ The products being sold must never be the
  quietest elements in their own ad.
  **(2) HIERARCHY.** Every frame needs **one clear first stop, then a path** — one element
  biggest/brightest/most central, the rest demonstrably secondary. ⛔ Never place several
  items at equal size with equal emphasis in a scattered arc; give one primacy, or use a
  structure the eye already reads (a row, a clean grid, an evenly-spaced arc). **State the
  intended eye path in one sentence in the prompt** — if you can't state it, the frame has no
  hierarchy and needs rebuilding.
  **THE STANDING FIX: FEWER, BIGGER, CALMER.** Three large products on a quiet ground argue
  range as well as six small ones on a busy one — breadth reads from VARIETY, not COUNT.
- ⛔ **VIBRANT IS A MOOD, NOT A COLOUR-GRADE LICENCE** (human rule, 2026-09-26 — caught live
  same day: renders using the rule above came back oversaturated, glossy and stock-photo
  bright, closer to an app-onboarding graphic than a premium campaign photo; the correct
  target is the muted, film-graded look of this pipeline's earlier florist/lifestyle
  renders). Happy/vibrant describes the EXPRESSION and MOOD only. Every photoreal prompt
  still carries a premium, editorial colour grade: natural light falloff, true-to-life
  (not candy-bright) colour, real skin tones, restrained contrast. If the render could pass
  for a phone-app onboarding screen or a generic stock-photo library shot, the grade is
  wrong even when the mood is right. Add "no oversaturated or candy-bright colour, no
  blown-out exposure, no glossy stock-photo lighting, no app-onboarding-graphic look" to
  the NEGATIVE line on every photoreal prompt.
- ⛔ **DIRECT COPY — NO WORDPLAY, NO TWIST** (human rule, 2026-09-26 — retires the old
  "twist" standard). Every headline/support line says the claim straight: no puns, no double
  meanings, no impossible/deliberately-"wrong" verb to decode, no clever wordplay of any
  kind. Clarity beats clever. If a reader has to pause and work it out, rewrite it plainer.
- ⛔ **LIGHT ON TEXT — ONE HEADLINE, AT MOST ONE SUPPORT LINE** (human rule, 2026-09-26).
  The image carries the idea, not a paragraph on it. At most a short headline (1-3 lines)
  plus one short support line — never a third text block, never caption-length copy baked
  into the frame. If the CHANGE section needs more words than that to land the idea, the
  idea needs rework, not smaller type.
- All in-frame copy is **basic English, written to desi families** — short everyday words,
  first-read clear, no US idioms ("Mom," "treat yourself"), no fussy British formality.
  Address people as a desi family does (Amma, Thaththa, Akka, Malli, aunty, uncle) where it
  fits naturally — one light authentic detail, never heavy Singlish. **This does NOT apply to
  PROMPT 1 (the Faithful Copy)** — see its own instructions below; PROMPT 1 keeps the
  reference's own wording verbatim (e.g. "someone" stays "someone," never becomes "Amma").
  It applies to PROMPT 2 only, and only where the reference's own phrasing doesn't already work.
- ⛔ **A PRODUCT IS NOT MANDATORY — DON'T FORCE ONE IN** (human rule, 2026-09-26 — cached
  product photos were getting forced into every prompt). Let the concept decide what's in the
  frame. Some ideas are carried by a Kapruka brand asset alone (cake box, flower box, bag,
  gift packaging, van) with no specific listing. Some are carried by people and the moment,
  with no product at all. Some genuinely need a real product. Pick a cached product only
  when one naturally belongs. When none does, write \`Product: none\` and omit the
  \`Product-Photo:\` line. Across a multi-prompt batch, expect a natural mix, not a product
  in every frame.
- When a product does belong: **pick it from \`tools/ig2img/cache/kapruka-products.md\`. Do NOT browse
  www.kapruka.com** — the cache holds real listings across 30 departments. **Reach past
  the reflex categories** (Core Rule 12) — gifting to him is served badly by cakes and
  flowers. **Vary the pick, run to run — don't default to the same one or two listings in
  a category just because they're the most memorable** (human rule, 2026-09-10 — the cache
  was defaulting to "ribbon cake" almost every time). If the cache has a \`thumb:\` file for
  the product, Read it and describe what you actually see. If nothing fits, describe a
  category-accurate product in plain words and add
  \`Product: category-accurate, not a verified listing\` — never invent a product name/URL.
- ⭐ **ATTACH THE PRODUCT'S REAL PHOTO — don't render the hero product from a text
  description alone** (human rule, 2026-09-10 — products were coming back visibly wrong and
  flowers looked synthetic/AI-generated because the generator only ever saw a paraphrase of
  the listing photo, never the photo itself). Whenever the hero or a clearly-visible prop is
  a **specific product picked from the cache** (a cake, a bouquet, a named item), add one
  line \`Product-Photo: [the exact kapruka.com URL from that listing]\` right after the
  \`Product:\` line. This attaches that product's real cached photo to the generator the same
  way a brand asset attaches — the render should match what's actually in the photo (the
  true icing colour/texture, the true flower mix and stage, the true silhouette), not a
  generic interpretation of the product name. Omit the \`Product-Photo:\` line only when
  \`Product:\` is \`category-accurate, not a verified listing\` (nothing to attach) or the
  product is minor/background and not worth a second attached image (Flow attaches at most
  3 images total, so don't spend the slot on something incidental). **When a brand asset
  (\`Asset:\`) AND more than one named product are all in the same frame, you still get to
  pick — don't just drop the product photo(s) because the slots feel full.** Priority order:
  (1) the brand asset if one applies (packaging must stay exact), (2) the single most
  visually-central/hero product — the one the concept is actually ABOUT — gets its
  \`Product-Photo:\` line, (3) a second named product only if a slot remains AND it's also
  prominent, not incidental. If two products are equally prominent and only one slot is
  left, pick the one most at risk of rendering wrong from text alone (a specific bag/shoe/
  jewellery silhouette, a specific cake/flower) over a generic one (plain sunglasses,
  a generic accessory) — never silently skip the \`Product-Photo:\` line just because the
  frame is crowded.
- ⛔ **CHECK THE PRODUCT AGAINST A REAL LUXURY BRAND'S SIGNATURE DESIGN BEFORE PICKING IT**
  (human rule, 2026-09-01 — caught live: a real, in-stock Kapruka handbag was picked and
  described accurately, but its construction is a close match to a well-known luxury
  house's signature design — diamond/cannage quilting, twin scarf-wrapped handles, a
  dangling gold charm — and the finished ad read as a counterfeit-brand ad even though
  nothing in the pipeline did anything wrong; the product itself is simply that kind of
  item). Before naming a product in fashion/handbags/jewellery/footwear/watches, look at
  its \`thumb:\` photo and ask: **would a stranger, at a glance, name a specific real luxury
  brand from this item's construction** (a distinctive quilting pattern, a signature
  hardware shape, a recognisable silhouette)? If yes, **pick a different listing from the
  same category** that doesn't carry that specific signature look — the cache has multiple
  options per department. If genuinely nothing else fits the concept, still pick it but add
  \`⚠️ Resembles [brand]'s signature design — human should confirm before this runs\` as a
  visible note directly under that prompt's header, so the human decides, not the pipeline.

⭐ DESCRIBE THE LAYOUT IN WORDS — DETAILED, NOT BLOATED.
The image model does **not** get the Instagram reference itself attached — you translate
the idea into a written brief. It DOES get a real brand asset and/or the picked product's
own real photo attached where those apply (see \`Asset:\` / \`Product-Photo:\` below) — the
LAYOUT, staging and everything else is still on you in words. **Target 450-600 words
per prompt** (raised 2026-09-01 — 250-350 was proving thinner than what actually gets the
best renders; a manual, unrushed pass naturally lands closer to 450-600). A 9,000-word
prompt still makes the model render the text instead of following it, so this is a real
ceiling, not a floor to pad toward — every sentence should earn its place by removing a
decision the image model would otherwise guess at. The LAYOUT, CAMERA and Product line in
CHANGE earn most of the extra length; NEGATIVE and Highlight/Palette stay short.

Two things specifically worth the added length over the old shorter version:
- **Material and surface texture, in the Product line** — not just what the object is, but
  what its surface actually does: matte vs glossy, how light catches an edge, whether a
  texture is rough/smooth/crumbly/soft, any visible imperfection that reads as real (uneven
  icing, a slightly creased petal, brushed vs polished metal). This is what separates a
  photoreal render from a plastic-looking one, and one flat sentence ("a chocolate cake")
  isn't enough to steer it.
- **Lighting behavior, in CAMERA** — not just the light source and angle, but what it's
  doing: where the highlight falls, how hard or soft the shadow edge is, whether there's a
  falloff toward the frame edges. One clause naming the source is often too thin; describe
  the light like you're setting it up on a real shoot.

⭐ **STATE THE LAYOUT AS A SPECIFICATION, NOT A MOOD** (human rule, 2026-08-28). For every
prompt, state as a percentage of frame width/height:
  1. **Frame division**, if split into panels — the split % and where the seam falls.
  2. **Subject size and position** — width as % of frame, where its base/centre sit.
  3. **Every text block** — vertical position %, alignment, cap height %, line count, gap.
  4. **Margins** — clear space left/right of type, as a %.
  5. The ground/backdrop.

  LAYOUT: cream ground, full bleed. Single product centred, occupying the middle 55% of
  the width, its base on the lower third line. Headline in 3 lines, centred on the frame,
  block spanning 12-26% of frame height, cap height ~5% of frame height, ~0.35x cap-height
  leading, 12% clear margin each side. Bottom-right 25%x12% kept clear and empty.

⭐ **POSE AND PROPS ARE PART OF THE COPY, NOT DECORATION** (human rule, 2026-08-28). State
exactly what each figure is doing and where every object is held — which hand, at what
height, facing camera or away. Left vague, the model invents its own staging.

⭐ **FRAME SHAPE: 4:5 (1080×1350), always** (human rule, 2026-09-26 — replaces the
2026-09-01 switch to 3:4, which only existed because Flow renders 3:4; Flow is now off the
active engines). Compose every LAYOUT block for a 4:5 portrait frame and state "4:5" on its
own line — never 3:4, never 1:1, never 9:16.

**Camera and light: one line, only for photoreal work.** e.g. *"50mm at f/2.8, one soft
window light from the left, shallow depth of field."* No lighting essays.

⛔ **DRAW NO LOGO.** The real Kapruka wordmark is composited on afterwards. Say
"no logo, no wordmark, no tagline; keep the bottom-right corner clear."

⛔ **NO INVENTED SUB-TEXT ON ANY OBJECT.** Never let the model decide what a surface
says. Add to the negatives of any prompt showing packaging or a labelled object: *"no
invented text on packaging, boxes, bags, labels, tags, signage or vehicle panels — leave
those surfaces blank unless an exact string is named here."* A surface carries text in
only two cases: it is the **attached real asset** (what's genuinely printed on it is part
of the physical product), or this prompt **names the exact words.**
  *(Caught live 2026-09-29: a redrawn cake box came back printed with "Every Bite, Pure
  Happiness" on the lid and "A World of Happiness" under the wordmark — neither is a
  Kapruka line. Cleanly-rendered invented brand copy is WORSE than garbled text: garbled
  text is obviously broken and gets rejected on sight, while this looks legitimate and
  ships — a false claim in Kapruka's own voice.)*"
  *(Why: logo.mjs pastes the real mark on after generation at a pixel-exact size and picks
  the light/dark variant by sampling the luminance behind it — so a model-drawn logo is
  always wrong, and two logos is a reject. If a prompt document is ever written for a human
  to paste by hand instead, the logo rules are: **exactly ONE per picture · 180-200px wide on
  a 1080px frame (~17-19% of width) as a HARD ceiling, a quiet corner mark never a second
  headline-scale element · plain on the ground, no box/panel behind it · NOTHING beneath it
  — no tagline, no divider rule, no descriptor (a tagline is a copy block, not decoration) · ≥80px from every edge with its own clear-space buffer.** Branding printed on
  an attached packaging asset is part of the product, not a second logo — and when an asset
  already carries the mark prominently, drop the composited one rather than have both.)*

⭐ **REAL BRAND ASSET, when the concept shows Kapruka packaging** (tested 2026-08-31 — an
attached brand-asset photo renders faithfully). If the concept genuinely shows a piece of
Kapruka packaging as an object in the frame, add one line \`Asset: [name]\` right after
\`Product:\`, using exactly one of these names:
- \`cake-box\` — deep Retail Purple box, Kapruka-Yellow smile arc on the lid, lion mascot, QR code
- \`gift-packaging\` — the doorstep gifting scene: gold-ribbon bag + matching box + tissue + card
- \`bag-front\` — the shopping bag, plain purple front with the yellow smile + wordmark
- \`bag-back\` — the same bag's other side, white category-icon pattern + QR code
- \`flower-box\` — the tall purple box with two diagonal yellow smile arcs, wordmark + tagline
- \`van\` — the purple delivery van, yellow swoosh, wordmark on the door and bonnet
Omit the \`Asset:\` line entirely when no packaging/vehicle appears in the frame. Never invent
a name outside this list.
  ⚠️ **These descriptions are for RECOGNISING and PLACING the attached file — never for
  redrawing one.** The mentions of a wordmark/tagline above describe what is genuinely
  printed on the real physical package; they are NOT licence to letter brand copy onto a
  model-drawn box. If the asset is attached, its real printing comes with it. If no asset
  is attached, the packaging in frame stays **unbranded and blank** — see NO INVENTED
  SUB-TEXT above.

⭐ **ENGINE ROUTING — pick which generator should try this prompt FIRST.** Check the two
rules IN ORDER — rule 1 first, rule 2 only if rule 1 doesn't apply. Getting the order
backwards is a proven failure, not a hypothetical: see the 2026-08-31 case study below.
1. **ANY scene with a character/illustration/multi-element composition → Flow, always,
   even when a specific named product is also in the shot.** Tested 2026-08-31: the exact
   same "kneeling proposal gag, two characters, headline, specific handbag" concept was
   routed to Meta AI because it named a real product. Meta AI dropped the ENTIRE scene —
   no characters, no headline, no layout — and rendered only a generic moody product shot
   of the bag. So: if the LAYOUT block places more than one human/character figure, or
   specifies a multi-panel/multi-element composition, this rule wins regardless of what
   Product line is present. Route to Flow.
2. **Only once rule 1 doesn't apply — a SIMPLE scene (one product, or a product held/
   offered by at most one figure, no multi-panel layout) that names a real, specific,
   recognisable product (electronics, a branded item, jewellery with a distinct design)
   → Meta AI first.** Verified 2026-08-31 twice — a plain product-in-a-box reveal rendered
   correctly on Meta AI with the real branded item AND the full scene intact; a laptop test
   showed Meta AI reads the \`Product (kapruka.com):\` URL and returns the real branded
   chassis where Flow returns a generic one. This benefit only holds when the scene stays
   simple.
3. Add one line \`Engine: meta\` or \`Engine: flow\` right after \`Asset:\` (or after
   \`Product:\` when there is no Asset line). Default to \`flow\` whenever unsure.`.trim();

const OUTPUT_TEMPLATE = (outFile) => `
OUTPUT — write the file, don't print it
Use the Write tool to create exactly this file: ${outFile}
Its content is ONLY the prompts, in this exact shape, and nothing else, one block per idea:

## PROMPT 1 — [one line naming the idea]
Comedy: yes|no
Product (kapruka.com): [exact listing name + URL, or "category-accurate, not a verified listing", or "none" when the concept needs no product — if more than one product is in frame, name all of them here]
Product-Photo: [ONE URL only — the single most hero/prominent product's, per the priority order above, even when Product above names several. OMIT if Product above is category-accurate/not verified, or every product in frame is incidental background]
Asset: [one of the names above — OMIT this line if no packaging is in frame]
Engine: meta|flow

LAYOUT: [4-6 lines of geometry, as shown above]

CAMERA: [one to two lines, photoreal work only — name the light's behavior (highlight
placement, shadow hardness, falloff), not just its source/angle. Omit for graphic/flat work]

CHANGE:
- Product: [the real Kapruka product, described from its listing photo — what it is AND
  what its surface actually does: matte/glossy, texture, any real imperfection]
- Headline (exact text): "[LINE 1 / LINE 2 / LINE 3]"
- Highlight: [which one or two words are Kapruka Yellow #FFC107, if any]
- Palette: [the grounds/colours to use]
- Setting: [one to two sentences]

NEGATIVE: [3-5 items MOST at risk for THIS specific image — the runner appends the full
standing negative list automatically, so do not repeat it. If a person or character
appears, always include "exactly two arms and two hands, no third hand".]

## PROMPT 2 — [repeat the same shape for each further idea, up to the count asked for]

Then reply with just: WROTE <path>
`.trim();

const RECREATE_INSTRUCTIONS = ({ files, caption, url, maxPrompts, outFile, instruction }) => `
You are the **Reference Recreator** for Kapruka. Follow your role file exactly.

READ THESE FIRST (all paths relative to the project root, which is your cwd):
- CLAUDE.md
- 2-roles/12-reference-recreator.md   (your role — every Hard Rule applies)
- 2-roles/04-copywriter.md            (§ LANGUAGE REGISTER — basic English, desi families)
- 1-foundation/references/brand-assets/_image-gen-rules.md
- 1-foundation/references/brand-assets/_master-ad-prompt.md   (⭐ MASTER PREMIUM-AD STANDARD — read BEFORE writing the final image prompt; see its precedence note)
- 1-foundation/01-business-context.md
- tools/ig2img/cache/kapruka-products.md   (the product list — pick from here)
- 3-output/reference-recreations/_STANDING-SPEC.md   (for context only — do NOT paste it into your output; the runner prepends it)

THE REFERENCE — an Instagram post the human sent to recreate:
- Source URL: ${url}
- Caption as posted: ${caption ? JSON.stringify(caption.slice(0, 800)) : '(none captured)'}
- Slide image files (READ EVERY ONE with the Read tool — actually look at them):
${files.map((f, i) => `  ${i + 1}. ${f}`).join('\n')}

⭐ THE JOB IS TRANSPOSITION, NOT REPLACEMENT — read this before anything else.
The human mostly sends **memes**, and they send them because **the joke works**. So
**KEEP THE IDEA.** Keep the joke, keep its structure, keep its comic logic, keep the
shape of the line. Give it a Kapruka reason to exist — a real Kapruka product and Kapruka's
colours. **Do NOT relocate it to Sri Lanka** (human rule, 2026-08-28): forcing a Sri Lankan
setting, a Sri Lankan social dynamic or local props onto a reference that did not have them
breaks the joke. The reference's own setting stays unless it clashes with a hard rule.
**Do NOT swap the joke out for a delivery-moat claim or a brand message** — an ad that
arrives where every other Kapruka ad arrives has thrown away the only thing the human
liked about the reference.

  Reference: "RESEARCH CONFIRMS PEOPLE WHO START THEIR DAY WITH TIRAMISU LIVE HAPPIER LIVES"
  ✅ transposed: the same deadpan fake-authority joke, same cadence, a real Kapruka cake
     in frame instead of the tiramisu.
  ❌ replaced:   "YOU ARE IN MELBOURNE. THE CAKE IS AT HER DOOR IN KANDY." — a fine
     ad, but it is a different idea. The joke is gone. This is the failure mode.

The **register** still gets localised (plain English, desi-family framing) — that is HOW
you say it, **for PROMPT 2 only.** The **idea** does not get localised away — that is WHAT
you say. **PROMPT 1 does not get this treatment at all** — it keeps the reference's exact
wording; see PROMPT 1's own instructions below.

⭐ **MATCH THE PRODUCT'S SHAPE TO THE REFERENCE'S DEVICE, NOT JUST ITS CATEGORY** (human
rule, 2026-09-01). The reference's own object has a physical form the joke/device depends
on (round, flat, tall, paired, etc.) — the Kapruka product substituted in must share that
form, or the device stops reading. A round swirled cookie substituting for a round watch
face works because both are round and centred; the same joke does NOT transfer cleanly to
an oblong handbag, which has a completely different silhouette. Before picking a product,
name the reference's shape in one phrase, then pick a cache listing that matches it —
don't just pick *any* category-appropriate item. This is IN ADDITION TO the brand-lookalike
check above, not instead of it — a product can pass one and fail the other.

YOUR TASK — write EXACTLY TWO prompts, in this order. They are two different jobs.

**PROMPT 1 — THE FAITHFUL COPY.** Reproduce the reference as closely as it can honestly
be reproduced: the same layout, the same crop, the same camera angle, the same lighting,
the same type block in the same position at the same relative size, the same joke in the
same cadence. Change ONLY what has to change — the product becomes a real Kapruka
product and the palette becomes Kapruka's. Everything else — the setting, the wording, the
words on screen, who or what is addressed — is copied VERBATIM from the reference. **Do
NOT swap in desi-family address terms (Amma, Thaththa, Akka, Malli, aunty, uncle) or any
other localisation** — if the reference says "someone," PROMPT 1 says "someone," not "Amma."
**Do NOT make it more Sri Lankan than the source already is** — this is a straight copy
with the product swapped, not a cultural adaptation. Someone holding both images side by
side should say "that's the same ad, rebuilt for Kapruka." **Do not improve it, do not add
a device, do not reinterpret it, do not localise it.** Match it.
${instruction ? `\n⛔ **PROMPT 1 IGNORES THE HUMAN'S INSTRUCTION ENTIRELY.** Whatever they asked for below
steers PROMPT 2 only. PROMPT 1 stays a straight faithful copy of the reference — that is
its whole job, and it is the control they compare against.` : ''}

**PROMPT 2 — ${instruction ? "THE HUMAN'S DIRECTION (this REPLACES your own take)" : "THE RECREATOR'S TAKE"}.**
${instruction ? `The human sent this instruction with the link:

  ${JSON.stringify(instruction)}

⭐ **THEIR INSTRUCTION WINS. Follow it exactly — it is not a suggestion to weigh against
your own judgement.** Build PROMPT 2 as they asked.

**If the instruction is SURGICAL** — it names one word, one line, one section, one colour,
one element to change ("only change the headline to X", "make the background cream",
"swap the cake for a watch") — then PROMPT 2 is **PROMPT 1 with exactly that change and
NOTHING else touched.** Same composition, same staging, same everything. Do not take the
licence to redesign; they asked for one edit, so make one edit.

**If the instruction is DIRECTIONAL** — a new angle, a different joke, a fresh setting —
then build their idea properly, applying the full creative bar to THEIR concept, not yours.

If following it would break a hard rule (an untrue claim, a competitor's logo, an unsafe
depiction), do the closest honest thing and say so in one line under the prompt header.` :
`⛔ **DO NOT INVENT A NEW SCENE OR A NEW CONCEPT** (human rule, 2026-08-28). PROMPT 2 stays
**the same scene and the same concept as the reference** — it is a second execution of that
idea, not a fresh idea. The reference is attached to this prompt too.

What you MAY change: the camera angle or crop, the staging and props, which Kapruka product
is shown, the exact wording of the caption, the ground colour. What you MUST NOT change: the
scene itself, the situation, the joke, or the kind of picture it is. If PROMPT 1 is a
character holding bouquets on a cream ground, PROMPT 2 is still that — shot or staged
differently, better if you can — never a doorstep delivery or a flat-lay instead.

Think of it as **the second take on set**, not a different brief. The human wants two
usable versions of the same reference to choose between.`}

Number them PROMPT 1 and PROMPT 2 exactly as shown in the OUTPUT section. They do NOT need
to be self-contained essays — see "KEEP THE PROMPTS SHORT" below; you looked at the
reference yourself, so a short written delta beats a long description.
${maxPrompts > 2 ? `\nIf the carousel holds genuinely DISTINCT designs, you may write these two for the strongest slide and stop — do not pad the count.` : ''}

NON-NEGOTIABLES for this run:
- Keep the reference's IDEA and construction; swap the products, palette and cultural
  setting to Kapruka's (Hard Rule 14 + Rule 2).
- If the reference is a joke, declare \`Comedy: yes\`. Let the picture carry the laugh and
  keep the text short. **The joke does NOT need to be Sri Lankan** — keep the reference's
  own comic situation.
- **Honesty still binds (Core Rule 9).** Comic exaggeration is fine; a fabricated factual
  claim is not. A joke that reads as a real statistic, a real endorsement or a real
  guarantee has to be rewritten so it is unmistakably a joke.
- Every in-frame line is **plain, basic English** — short everyday words, clear on the first
  read. Keep the reference's joke and phrasing where it already works; only rewrite a line
  that is clumsy, needlessly American, or unclear.
${SHARED_RULES}

⚠️ **Nothing from the reference's own brand survives.** Its headline, its products, and
any company name or logo in it (PayPal, Mastercard, a bank, a shop) are all replaced. You
are borrowing the CONSTRUCTION and the JOKE, never the content.

⛔ In the NEGATIVE line always include "do not reuse any text or product from the attached image".

OUTPUT — write the file, don't print it
Use the Write tool to create exactly this file: ${outFile}
Its content is ONLY the two prompts, in this exact shape, and nothing else:

## PROMPT 1 — FAITHFUL COPY — [one line]
Comedy: yes|no
Product (kapruka.com): [exact listing name + URL, or "none" if the reference's idea needs no product]
Asset: [one of the names above — OMIT this line if no packaging is in frame]
Engine: meta|flow

LAYOUT: [4-6 lines of geometry, as shown above]

CAMERA: [one to two lines, photoreal work only — name the light's behavior (highlight
placement, shadow hardness, falloff), not just its source/angle. Omit for graphic/flat work]

CHANGE:
- Product: [the real Kapruka product, described from its listing photo — what it is AND
  what its surface actually does: matte/glossy, texture, any real imperfection]
- Headline (exact text, replaces the reference's): "[LINE 1 / LINE 2 / LINE 3]"
- Highlight: [which one or two words are Kapruka Yellow #FFC107, if any]
- Palette: [the grounds/colours to use]
- Setting: [only if it changes from the reference — otherwise write "as the reference"]

NEGATIVE: [3-5 items MOST at risk for THIS specific image — the runner appends the full
standing negative list automatically, so do not repeat it. Always include "do not reuse any
text or product from the attached image". If a person or character appears, always include
"exactly two arms and two hands, no third hand".]

## PROMPT 2 — ${instruction ? "HUMAN DIRECTION" : "RECREATOR'S TAKE"} — [one line]
[same shape. This one is NOT attached to the reference, so give it 2-3 extra lines
describing the composition you want — target 450-600 words like Prompt 1.]

Then reply with just: WROTE <path>
`.trim();

const IDEA_INSTRUCTIONS = ({ persona, maxPrompts, outFile, instruction }) => `
You are working the Kapruka ad-idea pipeline in a single, on-demand pass — the same
research-then-write job the human does by hand: read the persona doc + business context,
find a real product, land on an ownable angle, write the image prompt. There is no
reference image to recreate here; you are originating ${maxPrompts} idea${maxPrompts > 1 ? 's' : ''} from scratch for one named persona.

READ THESE FIRST (paths relative to the project root, your cwd):
- CLAUDE.md
- 1-foundation/01-business-context.md        (the three lines, the moat — every idea must serve one)
- 1-foundation/02-personas.md                (find the persona named below; use its angle menu)
- 1-foundation/02b-fears-objections.md       (fears/objections you can disarm or lean into)
- 1-foundation/02d-why-people-buy.md         (the buying-driver lens)
- 1-foundation/02e-desire-engine.md          (Desires/Pains/Fears/Misconceptions/Beliefs bank)
- 1-foundation/03-occasion-calendar.md       (only if an occasion naturally fits right now)
- 1-foundation/references/brand-assets/_image-gen-rules.md
- 1-foundation/references/brand-assets/_master-ad-prompt.md   (⭐ MASTER PREMIUM-AD STANDARD — read BEFORE writing the final image prompt; see its precedence note)
- 2-roles/04-copywriter.md                   (§ LANGUAGE REGISTER — basic English, desi families)
- tools/ig2img/cache/kapruka-products.md     (the product list — pick from here)
- 3-output/reference-recreations/_STANDING-SPEC.md   (context only — do NOT paste it into your output)

THE PERSONA: ${JSON.stringify(persona)}
Find this persona (or the closest match) in 02-personas.md's grid + angle menu. If it names
a geography (International/Local) or a specific relationship (e.g. "girlfriend to boyfriend"),
honour that split — do not default to the broad grid persona when a sharper one was named.
${instruction ? `\nTHE HUMAN'S DIRECTION (follow this exactly — it is not a suggestion):\n  ${JSON.stringify(instruction)}\n` : ''}
YOUR TASK — originate ${maxPrompts} genuinely DIFFERENT ad idea${maxPrompts > 1 ? 's' : ''} for this persona, each
its own PROMPT block. "Different" means a different angle from the angle menu, or a
different entry point (persona-led / occasion-led / broad-brand-for-this-line) — never the
same idea restated with a different product swapped in.

For each idea:
1. **Pick ONE angle** from 02-personas.md's angle menu (or a Desire/Pain/Fear from
   02e-desire-engine.md) that fits this persona. Name the pain/desire/fear/belief you are
   building on in one sentence before the prompt.
2. **Apply THE CREATIVE STANDARD** (root CLAUDE.md) — one-second comprehension, Ogilvy
   headline discipline, metaphorical/conceptual over literal for brand & emotional work,
   reject the first idea every ordinary art director would reach for. Run the blank-headline
   test on yourself: cover the headline — does the image still say something?
3. **Category breadth (Core Rule 12)** — do not default every idea to cakes/flowers. Match
   the category to the recipient the persona implies (gifting to him ≠ gifting to her), and
   across a multi-idea batch, span more than the reflex categories.
4. **Ground it in the business context** (Core Rule 11) — every idea must trace back to a
   business line, this persona, and ideally the delivery moat. If an idea can't be tied back,
   drop it and write a different one.

${SHARED_RULES}

${OUTPUT_TEMPLATE(outFile)}
`.trim();

const PROMOTE_INSTRUCTIONS = ({ thing, maxPrompts, outFile, instruction }) => `
You are working the Kapruka ad-idea pipeline in a single, on-demand pass, doing the
"promote this" job: take a real Kapruka service, feature, or landing page, verify its claim
against approved facts, find the ownable angle, and write the image prompt(s) — the same
job the human does by hand when they ask to promote something specific (not a persona,
not an external reference to recreate).

READ THESE FIRST (paths relative to the project root, your cwd):
- CLAUDE.md
- 1-foundation/01-business-context.md        (⭐ Core Rule 11 — every claim must be checked against this; it is the ONLY source of approved proof stats)
- 1-foundation/02-personas.md                (which persona(s) this service/feature actually serves)
- 1-foundation/references/brand-assets/_image-gen-rules.md
- 1-foundation/references/brand-assets/_master-ad-prompt.md   (⭐ MASTER PREMIUM-AD STANDARD — read BEFORE writing the final image prompt; see its precedence note)
- 2-roles/04-copywriter.md                   (§ LANGUAGE REGISTER — basic English, desi families)
- tools/ig2img/cache/kapruka-products.md     (the product list — pick from here)
- 3-output/reference-recreations/_STANDING-SPEC.md   (context only — do NOT paste it into your output)

THE THING TO PROMOTE: ${JSON.stringify(thing)}
If this names a kapruka.com URL, WebFetch it and read the real claim as printed. If it names
a feature/service in plain words (e.g. "same-day delivery", "corporate gifting"), find the
matching section in 01-business-context.md (and WebFetch the matching kapruka.com page if
one obviously exists) before writing anything.

⛔ **HONESTY GUARDRAIL — verify before you claim anything (Core Rule 9, non-negotiable).**
The landing page or the human's phrasing may overstate what's actually approved. Cross-check
every factual claim against the **✅ CONFIRMED PROOF** block in 01-business-context.md:
23+ years · island-wide delivery · same-day within the Colombo region / next-day island-wide
(NEVER "same-day island-wide" — that is not approved) · millions of gifts delivered · from
anywhere in the world to Sri Lanka, top markets AU/USA/CA/UAE. If the page/human's claim is
wider than what's confirmed, **use the confirmed version** and say so in one line at the top
of your output — do not silently launder an unapproved claim into an ad.
${instruction ? `\nTHE HUMAN'S DIRECTION (follow this exactly — it is not a suggestion):\n  ${JSON.stringify(instruction)}\n` : ''}
YOUR TASK — find **the ownable idea**, not a features list. A service/feature promo fails
when it reads as a spec sheet ("fast, reliable, easy") — every competitor claims the same
adjectives. Instead:
1. **Name the ownable emotional truth underneath the feature** — not "same-day delivery" but
   what that actually buys the person (the drive across town they didn't have to make, the
   thing they almost forgot that's still saveable). Reject generic speed/convenience clichés
   (a clock, a rocket, a stopwatch, "FAST!" in bold) — the idea should live in a real object
   or moment, not a decoration.
2. **Name which persona(s) this serves** (from 02-personas.md) and write for them specifically
   — a corporate feature reads different from a diaspora-gifting feature.
3. Write ${maxPrompts} genuinely DIFFERENT execution${maxPrompts > 1 ? 's' : ''} of the ownable idea — different scene/device/treatment
   each time, never the same picture with a new headline.

${SHARED_RULES}

${OUTPUT_TEMPLATE(outFile)}
`.trim();

/** Run headless Claude Code with the repo as cwd. */
// 25 min (raised from 15, 2026-09-01) — the Opus switch (see model default below) genuinely
// runs longer than Sonnet did; a real run timed out at 15 min on the very first try after
// the switch. Better to wait longer than to silently fall back to a worse model's speed.
function runClaude(instructions, { cwd = ROOT, timeoutMs = 25 * 60_000, log = console.log } = {}) {
  return new Promise((resolve, reject) => {
    // NOTE: shell:true is required on Windows to resolve `claude` (a .cmd shim),
    // but the shell RE-SPLITS arguments on spaces — so the tool list must carry
    // its own quotes, or `claude` takes "Write Glob Grep…" as its prompt and
    // silently ignores the instructions on stdin.
    // Opus, matching the documented Reference Recreator role (CLAUDE.md: "requires close
    // visual reading of a reference image ... plus disciplined technical prompt-writing;
    // it is not a quick classification task"). Reverted from the earlier Sonnet-for-speed
    // choice (2026-08-28) after the human flagged a real, measurable quality gap between
    // this automated path and a manual Claude Code session running the same role at Opus
    // (2026-09-01) — the speed saved (~3 of ~10 min) was costing the actual prompt quality
    // this whole pipeline depends on. Override with IG2IMG_AGENT_MODEL=sonnet if a batch
    // genuinely needs to prioritise speed over quality.
    const model = process.env.IG2IMG_AGENT_MODEL || 'opus';
    const child = spawn('claude', [
      '-p',
      '--model', model,
      '--permission-mode', 'acceptEdits',
      '--allowedTools', '"Read Write Glob Grep WebFetch WebSearch"',
    ], { cwd, shell: true, windowsHide: true });

    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('claude -p timed out')); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude -p exited ${code}: ${err.slice(-500) || out.slice(-500)}`));
      resolve(out.trim());
    });
    child.stdin.write(instructions);
    child.stdin.end();
    log('  → Reference Recreator running (reads the slides, browses kapruka.com)…');
  });
}

/** Fill the one [SERVICE] blank in the standing spec. */
function standingSpec(service = "Sri Lanka's online gifting & e-commerce brand") {
  if (!existsSync(SPEC)) throw new Error(`standing spec missing: ${SPEC}`);
  return readFileSync(SPEC, 'utf8')
    .replace(/\[SERVICE:[^\]]*\]/g, service)
    .replace(/\[SERVICE\]/g, service);
}

/** The master premium-ad guide (human rule, 2026-10-12), pasted into EVERY output prompt.
 *  Drops the file's own header note and the unfilled [PLACEHOLDER] campaign block so the
 *  image model never sees brackets — the real brief follows it in the paste. */
export function masterGuide() {
  if (!existsSync(MASTER)) throw new Error(`master ad prompt missing: ${MASTER}`);
  const raw = readFileSync(MASTER, 'utf8');
  const start = raw.indexOf('Act as an elite');
  const details = raw.indexOf('**CAMPAIGN DETAILS**');
  const sec1 = raw.indexOf('## 1. ABSOLUTE VISUAL QUALITY');
  if (start < 0 || details < 0 || sec1 < 0) throw new Error('master ad prompt: expected markers not found');
  return `PREMIUM CREATIVE STANDARD — applies to everything below.

${raw.slice(start, details)}The campaign details (brand, product, message, format, colours, exact text) are given in the brief that follows.

${raw.slice(sec1).trim()}`;
}

/** Split the model's prompt-body file into individual prompts.
 *
 *  ⚠️ `.split()` KEEPS WHATEVER PRECEDES THE FIRST DELIMITER as parts[0], and that
 *  leading chunk is NOT a prompt — the Reference Recreator routinely opens the body
 *  with its own preamble (blockquoted "⚠️ Claim note" / "⚠️ Frame note" lines) above
 *  "## PROMPT 1". Before 2026-09-19 that preamble was kept, relabelled "## PROMPT "
 *  and sent to the image engine as prompt #1 — a paste with the full standing spec
 *  and NO scene, product, layout or headline in it. The engine drew a generic gift
 *  box holding the only concrete string in the notes, and because maxPrompts then
 *  sliced the list, the LAST real prompt was silently dropped to make room for it.
 *  So: keep only the segments that actually follow a heading. */
function splitPrompts(body) {
  const parts = body.split(/^##\s+PROMPT\s+/mi);
  const sections = parts.slice(1).map((s) => s.trim()).filter(Boolean);
  return (sections.length ? sections.map((p) => `## PROMPT ${p}`) : [body.trim()]);
}

// name -> real file, resolved once here so the Recreator only ever writes a short name,
// never a path. Verified 2026-08-31: cake-box attaches faithfully on Flow.
//
// flower-box (fixed 2026-09-21): was pointing at a blurry real WhatsApp photo, a stand-in
// for the canonical asset _brand-assets.md always documented (`kapruka-flower-box.png`,
// the clean AI-rendered box with two diagonal smile arcs) — that file just never got saved
// under its real name. Copied into place from `ChatGPT Image Jul 24, 2026, 11_30_21 AM.png`.
//
// van (added 2026-09-21): the only van asset on disk was a 3-angle mockup SHEET with a
// printed spec legend (dimensions, hex codes) baked into the image — attaching that risked
// the model copying the legend text into the render, so it was deliberately left out of
// this map. Cropped one clean angle (front 3/4, no legend, no adjacent panel) into
// `kapruka-delivery-van-single.png` instead.
const ASSET_DIR = join(ROOT, '1-foundation', 'references', 'brand-assets');
const ASSETS = {
  'cake-box': join(ASSET_DIR, 'kapruka-cake-box.png'),
  'gift-packaging': join(ASSET_DIR, 'kapruka-gift-packaging.png'),
  'bag-front': join(ASSET_DIR, 'kapruka-bag-packaging.png'),
  'bag-back': join(ASSET_DIR, 'kapruka-bag-packaging.png'),
  'flower-box': join(ASSET_DIR, 'kapruka-flower-box.png'),
  'van': join(ASSET_DIR, 'kapruka-delivery-van-single.png'),
};

/** Pull the `Asset: name` line back out of one prompt block, resolved to a real file. */
export function resolveAsset(promptBlock, log) {
  const name = promptBlock.match(/^Asset:\s*(\S+)/mi)?.[1]?.trim();
  if (!name) return [];
  const file = ASSETS[name];
  if (!file || !existsSync(file)) {
    log?.(`  ! prompt named an unknown asset "${name}" — ignoring`);
    return [];
  }
  return [file];
}

// The product cache's kapruka.com URLs carry a stable /kid/<id> segment — that's what
// `Product-Photo:` lines key off, so the writer can just paste the listing URL straight
// out of kapruka-products.md rather than invent a separate short name.
const PRODUCT_CACHE_FILE = join(ROOT, 'tools', 'ig2img', 'cache', 'kapruka-products.json');
let productCache = null;
function loadProductCache() {
  if (productCache) return productCache;
  try {
    productCache = JSON.parse(readFileSync(PRODUCT_CACHE_FILE, 'utf8'));
  } catch {
    productCache = [];
  }
  return productCache;
}
const kidOf = (url) => url?.match(/\/kid\/([^/?#]+)/)?.[1];

// The Reference Recreator is instructed to pick only from the cache (Hard Rule 10), but
// it can still name a real, currently-listed product that just isn't cached yet (seen
// live 2026-09-10 — a real, valid "Sunshine Love 8 Yellow Rose Bouquet" URL that wasn't
// in kapruka-products.json). Rather than silently fall back to text-only in that case,
// fetch that ONE product page directly — it's a plain static page (no Cloudflare
// challenge, unlike the category grid pages), so a bare `fetch`, no Chrome, is enough.
const LIVE_FETCH_DIR = join(ROOT, 'tools', 'ig2img', 'cache', 'thumbs', 'live');
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  Referer: 'https://www.kapruka.com/',
};
async function fetchLiveProductPhoto(url, kid, log) {
  try {
    const page = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
    if (!page.ok) return null;
    const html = await page.text();
    const imgUrl = html.match(/https:\/\/static2\.kapruka\.com\/product-image\/[^"'\s]+/)?.[0];
    if (!imgUrl) return null;
    const hiRes = imgUrl.replace(/width=\d+/, 'width=1200');
    const imgRes = await fetch(hiRes, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
    if (!imgRes.ok) return null;
    const buf = Buffer.from(await imgRes.arrayBuffer());
    if (buf.length < 800) return null;
    const ext = buf[0] === 0x89 ? 'png' : (buf[8] === 0x57 && buf[9] === 0x45) ? 'webp' : 'jpg';
    mkdirSync(LIVE_FETCH_DIR, { recursive: true });
    const file = join(LIVE_FETCH_DIR, `${kid}.${ext}`);
    writeFileSync(file, buf);
    log?.(`  · fetched "${url.split('/kid/')[0].split('/').pop()}" photo live (not yet in the cache)`);
    return file;
  } catch (e) {
    log?.(`  ! live product-photo fetch failed: ${e.message}`);
    return null;
  }
}

/**
 * Pull the `Product-Photo: <kapruka.com URL>` line back out of one prompt block and
 * resolve it to the product's real photo, so the hero product attaches to Flow as an
 * actual reference image instead of being rendered from a text description alone (human
 * rule, 2026-09-10 — products were coming back inaccurate/generic because the generator
 * never saw the real listing photo, only a paraphrase of it). Checks the cache first;
 * falls back to a live fetch of that one product page when it's a real listing the
 * cache just doesn't have yet.
 */
export async function resolveProductAsset(promptBlock, log) {
  const url = promptBlock.match(/^Product-Photo:\s*(\S+)/mi)?.[1]?.trim();
  if (!url || /^(none|n\/a)$/i.test(url)) return [];
  const kid = kidOf(url);
  if (!kid) {
    log?.(`  ! Product-Photo line isn't a kapruka.com listing URL — ignoring: "${url}"`);
    return [];
  }
  const entry = loadProductCache().find((p) => kidOf(p.url) === kid);
  if (entry?.thumb) {
    const file = join(ROOT, entry.thumb);
    if (existsSync(file)) return [file];
    log?.(`  ! Product-Photo cached thumb missing on disk: ${entry.thumb} — trying a live fetch`);
  }
  const liveFile = existsSync(join(LIVE_FETCH_DIR, `${kid}.jpg`)) ? join(LIVE_FETCH_DIR, `${kid}.jpg`)
    : existsSync(join(LIVE_FETCH_DIR, `${kid}.png`)) ? join(LIVE_FETCH_DIR, `${kid}.png`)
    : existsSync(join(LIVE_FETCH_DIR, `${kid}.webp`)) ? join(LIVE_FETCH_DIR, `${kid}.webp`)
    : await fetchLiveProductPhoto(url, kid, log);
  if (!liveFile) {
    log?.(`  ! Product-Photo "${url}" not found in the cache and couldn't be fetched live — ignoring`);
    return [];
  }
  return [liveFile];
}

/**
 * Pull the `Engine: meta|flow` line back out of one prompt block.
 *
 * Tested 2026-08-31: Meta AI genuinely reads the product URL (returned a real branded
 * Lenovo laptop where Flow returned a generic one), Flow is more faithful to exact
 * multi-panel LAYOUT geometry. The Recreator picks per-prompt; this just reads its
 * choice back out. Defaults to 'flow' — the safer general default — on anything
 * missing or unrecognised, never throws.
 */
export function resolveEngine(promptBlock, log) {
  const name = promptBlock.match(/^Engine:\s*(\S+)/mi)?.[1]?.trim().toLowerCase();
  if (name === 'meta' || name === 'flow') return name;
  if (name) log?.(`  ! prompt named an unknown engine "${name}" — defaulting to flow`);
  return 'flow';
}

const DOC_HEADER = {
  recreate: (src) => `# Reference Recreation Prompts — Instagram\n\n**Source:** ${src}\n\n`,
  idea: (src) => `# Persona Idea Prompts\n\n**Persona:** ${src}\n\n`,
  promote: (src) => `# Promote Prompts\n\n**Promoting:** ${src}\n\n`,
};

/**
 * Build the paste-ready prompt(s) for one of three jobs:
 *  - mode "recreate" (default) — reverse-engineer an Instagram reference (files/caption/url required)
 *  - mode "idea"     — originate ideas for a named persona, no reference image (persona required)
 *  - mode "promote"  — promote a real Kapruka service/feature/page (thing required)
 *
 * @returns {Promise<{docPath:string, pastes:{index:number,file:string,text:string,title:string}[]}>}
 */
export async function buildPrompts({
  mode = 'recreate', files = [], caption = '', url = '', persona = '', thing = '',
  outDir, maxPrompts = 3, instruction = '', log = console.log,
} = {}) {
  mkdirSync(outDir, { recursive: true });
  const bodyFile = join(outDir, 'prompt-body.md');

  if (instruction) log(`  · human instruction: "${instruction.slice(0, 120)}"`);

  const instructions = mode === 'idea'
    ? IDEA_INSTRUCTIONS({ persona, maxPrompts, outFile: bodyFile, instruction })
    : mode === 'promote'
      ? PROMOTE_INSTRUCTIONS({ thing, maxPrompts, outFile: bodyFile, instruction })
      : RECREATE_INSTRUCTIONS({ files, caption, url, maxPrompts, outFile: bodyFile, instruction });

  await runClaude(instructions, { log });
  if (!existsSync(bodyFile)) throw new Error(`the writer did not produce ${bodyFile}`);

  const body = readFileSync(bodyFile, 'utf8').trim();
  if (body.length < 400) throw new Error('the generated prompt body looks truncated/empty');

  const spec = `${masterGuide()}

---

${standingSpec()}`;
  const prompts = splitPrompts(body).slice(0, maxPrompts);

  const pastes = await Promise.all(prompts.map(async (p, i) => {
    const title = (p.match(/^##\s+PROMPT\s+\d+\s*[—-]\s*(.+)$/mi)?.[1] || `idea ${i + 1}`).trim();
    const brandAssets = resolveAsset(p, log);
    const productAssets = await resolveProductAsset(p, log);
    const assetFiles = [...brandAssets, ...productAssets];
    if (brandAssets.length) log(`  · prompt ${i + 1} attaches a real brand asset (${brandAssets[0].split(/[\\/]/).pop()})`);
    if (productAssets.length) log(`  · prompt ${i + 1} attaches the real product photo (${productAssets[0].split(/[\\/]/).pop()})`);
    const engine = resolveEngine(p, log);
    log(`  · prompt ${i + 1} routes to ${engine} first`);
    const text = `${spec}\n\n---\n\n${p}\n`;
    const file = join(outDir, `paste-${String(i + 1).padStart(2, '0')}.txt`);
    writeFileSync(file, text, 'utf8');
    return { index: i + 1, file, text, body: p, title, assetFiles, hasPackagingAsset: brandAssets.length > 0, engine };
  }));

  // The record copy — spec pasted in full above the prompts, per Hard Rule 13.
  const docPath = join(outDir, 'recreation-prompts.md');
  const header = (DOC_HEADER[mode] || DOC_HEADER.recreate)(url || persona || thing || '(unspecified)');
  writeFileSync(docPath, `${header}${spec}\n\n---\n\n${body}\n`, 'utf8');

  log(`  ✓ ${pastes.length} prompt${pastes.length > 1 ? 's' : ''} built`);
  return { docPath, pastes };
}
