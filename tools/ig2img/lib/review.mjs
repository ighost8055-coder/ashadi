// review.mjs — look at what actually got generated, before it reaches Telegram.
//
// Image models routinely pass their own "did I follow the prompt" bar while still
// failing on things a human would catch instantly — CG-perfect symmetrical flowers,
// a warped hand, misspelled headline text, a logo that's subtly wrong. This runs a
// real vision-capable headless Claude pass over each candidate, scores it against
// the actual prompt + the standing anti-slop rules, and:
//   - when an engine produced more than one candidate (Flow returns 2), picks the
//     single best one instead of sending every variant,
//   - fails an image outright if it has a real defect, feeding back what's wrong so
//     the caller can regenerate with that steer.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const CHECKLIST = `
You have a documented failure mode to specifically hunt for: reviewers (including you, on
past batches) keep RUBBER-STAMPING synthetic-looking flowers as "natural" without actually
counting and comparing individual blooms — most often on the SMALL, DENSELY-CLUSTERED
filler flower, not the large hero blooms. For any bouquet/flowers in frame, you MUST do
this before anything else, and show your work in "flowerCheck":
  a. Identify EVERY distinct flower type in the frame separately — e.g. if there are roses
     AND a smaller clustered filler flower (chrysanthemums, baby's breath, daisies), review
     BOTH types independently. Do not let a genuinely-varied hero bloom (like the roses)
     earn a pass for a filler cluster you didn't actually scrutinise — the filler flower is
     where this fails most often, because many small near-identical rosettes packed tightly
     together LOOK uniform even in real photos, so it takes real attention to catch a
     synthetic one.
  b. For the SMALL CLUSTERED flower type specifically: pick 5 individual blooms from
     different parts of the cluster and compare them side by side in your head. Are their
     sizes, petal counts, and centre (stamen) visibility genuinely different from each
     other, or do they read like the same flower copy-pasted with minor rotation? Tight
     repetition of a near-identical small bloom is a FAIL even if the large hero blooms
     (e.g. roses) look fine.
  c. For the LARGE hero bloom type: is it open the same amount as its neighbours, or
     genuinely different (some tighter buds, some fully blown open, petals at different
     curl stages)? If you cannot point to at least 2-3 blooms that are CLEARLY different
     open-stages from each other, that is a FAIL.
  d. Zoom your attention to individual petal edges on BOTH flower types. Are they slightly
     irregular, torn, creased, uneven — the way real petals are? Or are they suspiciously
     smooth, symmetric, glossy, identical-looking copies of each other? Identical-looking
     petals across multiple blooms of the SAME type is the single strongest tell and is a
     FAIL on its own, independent of whether the other flower type in the same image passes.
  e. Is EVERY bloom in the bouquet in equally crisp focus, front to back? Real shallow
     depth-of-field photography always has some blooms softer than others. All-blooms-
     equally-sharp is a render tell and a FAIL.
If there are no flowers in the image, write "flowerCheck": "n/a" and skip this section.

Then check the image against ALL of these, in order — a single clear failure on ANY of
them is a FAIL, not a nitpick:

1. **AI-render tells (general).** Waxy/plastic-looking skin or surfaces, over-smoothed or
   over-symmetrical texture, uncanny-valley faces, melted/warped/artifacted detail, an
   obvious CG/3D-render look. A generated product that looks generated is a FAIL.
2. **Flowers** — see the mandatory flowerCheck above; any of (b)/(c)/(d) failing is a FAIL.
3. **Hands and faces.** Wrong number of fingers, a third hand, warped/melted facial
   features, an unnatural pose no real body could hold.
4. **Text.** Any misspelled word, warped/illegible lettering, a headline that doesn't
   match what the prompt specified, text rendered in a decorative/serif/script font
   instead of a clean geometric sans (Inter).
4b. **Text size, alignment, and breathing space — zero tolerance** (added 2026-09-01,
   sharpened same day: no exceptions for a "deliberate" overlap — clean separation
   always wins). Look specifically for: text or the logo sitting closer than roughly
   5% of frame width/height to any edge (the safe-margin rule — nothing should feel
   cramped against a border); a headline whose lines don't share the same alignment
   (some lines centred, others drifted left/right); ANY two elements (headline,
   support line, product, logo, a card/device graphic) touching, overlapping, or
   crowded with no visible gap between them — there is no exception for this, even if
   the brief describes an overlap as part of the device, the render must still show
   clean separation with a visible gap or a deliberate, crisp graphic boundary, never
   text/logo/product edges genuinely colliding or bleeding into each other; text set so
   small relative to the frame that it would be hard to read on a phone screen at a
   glance. Any of these is a FAIL.
5. **The Kapruka logo.** Present exactly once, not distorted, not redrawn wrong, not
   duplicated, not placed over busy detail where it's hard to read.
6. **Brand palette.** Retail Purple / Kapruka Yellow / cream / gold — not a generic or
   off-brand purple, not a random unrelated colour scheme dominating the frame.
7. **Composition matches the brief.** The described product, layout, and headline
   position are actually present — not a different scene entirely.
7b. **The idea, not just the object, is on screen** (added 2026-09-15, after a real
   miss: a "send goods not cash / delivery as care, not distrust" brief came back as a
   plain product photo of a rice bag with none of that argument present). A brief that
   states a Direction/angle/emotional argument is asking for a SPECIFIC SCENE or framing
   device that makes that argument visible — not just the correct product sitting in a
   generic product-shot setting. Read the brief's Direction/positioning text specifically,
   then ask: if you'd never seen the brief, would you get the intended message from the
   image alone, or does it just look like a catalogue photo of the item? If the brief
   describes a scene, moment, comparison, or framing device and the image is instead a
   plain hero product shot with no trace of that device, that is a FAIL — note it as
   "brief argument not depicted" even if the product/logo/text are all otherwise clean.
   This is a common failure mode specifically when a real product photo is attached as a
   reference — the engine anchors on reproducing the attached photo faithfully and drops
   the surrounding scene the brief asked for. Do not let "the product looks accurate"
   substitute for "the brief's actual idea is visible."
8. **General clutter/quality.** Nothing floating with no shadow/ground contact, nothing
   awkwardly cropped, no random extra artifacts in the frame.
8b. **No decorative internal markings** (added 2026-09-01). No stray divider/rule lines,
   corner ticks, dots, small ornamental icons, or grid marks anywhere in the frame that
   aren't an explicit, load-bearing part of the described device (e.g. a T2 split-band's
   one hard seam is fine and expected; a random thin line elsewhere "for balance" is not).
   The frame should read as clean and deliberate, not decorated. FAIL if present.
9. **No dead/empty space.** Look at the bottom and side margins specifically — if more
   than roughly 15-20% of the frame is blank/empty ground with nothing composed into it
   (a common failure: content was composed for a different aspect ratio than it actually
   rendered into, leaving a large unused strip), that is a FAIL. The frame should be
   composed to use its actual full canvas, not just the top portion of it.
10. **Recognisable luxury-brand lookalike.** For any fashion/handbag/jewellery/footwear/
    watch product: would a stranger, at a glance, name a specific real luxury brand from
    this item alone (a distinctive quilting/stitching pattern, a signature hardware shape,
    a recognisable silhouette, dangling branded-style charms)? This is a FAIL even if the
    item is a genuine Kapruka listing — a generated AD reading as a counterfeit-brand ad is
    a real problem independent of sourcing honesty. Note it as a defect and name the brand
    it resembles, so the human can decide whether to swap the product or accept it knowingly.

Being lenient here defeats the entire point of this review pass. When genuinely unsure
whether a bloom pattern is "natural enough," FAIL it — the cost of one extra regeneration
is far lower than the cost of a visibly fake bouquet reaching a real ad.
`.trim();

const REVIEW_INSTRUCTIONS = ({ promptBody, files }) => `
You are the final quality reviewer for a batch of Kapruka ad images, before they reach a
human on Telegram. You are given the brief that was used to generate them, and ${files.length}
candidate image${files.length > 1 ? 's' : ''} from ONE engine for ONE prompt (all attempting the
same brief). Look at each image closely with the Read tool.

THE BRIEF THAT WAS USED TO GENERATE THESE:
${promptBody.slice(0, 3000)}

THE CANDIDATE IMAGE FILE${files.length > 1 ? 'S' : ''}:
${files.map((f, i) => `  ${i + 1}. ${f}`).join('\n')}

CHECKLIST — apply to every candidate:
${CHECKLIST}

YOUR TASK:
1. Read every candidate image file with the Read tool — actually look at it closely,
   especially the flowers/hands/text/logo if present.
2. Score each candidate: PASS (no real defect) or FAIL (name the specific defect).
3. If one or more candidates PASS, pick the single BEST one (best matches the brief,
   cleanest execution) — even among passing candidates there's usually a clear best.
4. If ALL candidates FAIL, do not pick one — say so, and write ONE combined regeneration
   note describing exactly what to fix (e.g. "the bouquet's flowers are too uniform/glossy
   and every bloom is in identical sharp focus — regenerate with irregular bloom stages,
   natural asymmetry, and a couple of blooms softly out of focus").

Reply with ONLY a single-line JSON object per candidate examined, wrapped in one top-level
object — no markdown fence, no explanation before or after it. "flowerCheck" is REQUIRED
on every candidate (use "n/a" only when there are genuinely no flowers in frame) and must
contain your actual bloom-by-bloom observations from steps (a)-(d) above, not a summary:

{"candidates":[{"file":"<path>","flowerCheck":"<your bloom-by-bloom notes, or n/a>","verdict":"pass|fail","defects":["<only if fail>"]}],"verdict":"pass|fail","bestFile":"<winning path or null>","reason":"<one sentence>","defects":["<combined, only if overall fail>"]}
`.trim();

// 10 min (raised from 5, 2026-09-01, alongside the Opus switch below) — narrower task
// than the Recreator (apply a checklist to N images) so less headroom needed, but Opus
// is still slower than the Sonnet this timeout was originally tuned for.
function runClaude(instructions, { timeoutMs = 10 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    // Opus (moved from Sonnet, 2026-09-01) — catching a subtle defect like uniform/
    // synthetic-looking flowers is close visual judgment, not a simple classification;
    // Sonnet demonstrably missed that exact case in testing. Costs more time/tokens per
    // review pass (up to 2 passes per prompt on a regeneration), accepted deliberately.
    const model = process.env.IG2IMG_REVIEW_MODEL || 'opus';
    const child = spawn('claude', [
      '-p',
      '--model', model,
      '--permission-mode', 'acceptEdits',
      '--allowedTools', '"Read"',
    ], { shell: true, windowsHide: true });

    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('review timed out')); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`review exited ${code}: ${err.slice(-400) || out.slice(-400)}`));
      resolve(out.trim());
    });
    child.stdin.write(instructions);
    child.stdin.end();
  });
}

/**
 * Review a batch of candidate images (from ONE engine, for ONE prompt) against the
 * brief that generated them. Picks the best passing candidate, or reports a fail with
 * a regeneration note.
 *
 * @param {string[]} files - candidate image paths (e.g. Flow's 2 variants)
 * @param {string} promptBody - the brief text that was sent to the engine
 * @returns {Promise<{verdict:'pass'|'fail', bestFile:?string, reason:string, defects:string[]}>}
 */
export async function reviewCandidates(files, promptBody, { log = console.log } = {}) {
  if (!files.length) return { verdict: 'fail', bestFile: null, reason: 'no candidates generated', defects: ['no images'] };
  try {
    const raw = await runClaude(REVIEW_INSTRUCTIONS({ promptBody, files }));
    const jsonText = raw.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonText) throw new Error('no JSON in reviewer output');
    const parsed = JSON.parse(jsonText);
    const verdict = parsed.verdict === 'pass' ? 'pass' : 'fail';
    const bestFile = verdict === 'pass' && files.includes(parsed.bestFile) ? parsed.bestFile : (verdict === 'pass' ? files[0] : null);
    const result = {
      verdict, bestFile,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      defects: Array.isArray(parsed.defects) ? parsed.defects.map(String) : [],
    };
    log(`  · review: ${verdict}${bestFile ? ` — picked ${bestFile.split(/[\\/]/).pop()}` : ''}${result.defects.length ? ` — ${result.defects.join('; ')}` : ''}`);
    return result;
  } catch (e) {
    // A reviewer crash/timeout should never block the whole pipeline — fail open by
    // passing the first candidate through, but log loudly so it's visible this batch
    // went out UNREVIEWED.
    log(`  ! review failed (${e.message}) — passing ${files[0]} through UNREVIEWED`);
    return { verdict: 'pass', bestFile: files[0], reason: 'reviewer unavailable — unreviewed', defects: [] };
  }
}
