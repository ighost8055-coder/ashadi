// run.mjs — one end-to-end run: Instagram link → Kapruka prompt → ChatGPT images → WhatsApp.
//
//   node tools/ig2img/run.mjs <instagram-url> [--variations 2] [--max-prompts 2] [--no-wa]
//
// Also used by webhook.mjs as a library (runPipeline).
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './lib/env.mjs';
import { connectChrome } from './lib/chrome.mjs';
import { scrapeInstagram, normaliseIgUrl } from './lib/ig.mjs';
import { buildPrompts, resolveAsset, resolveProductAsset, resolveEngine } from './lib/prompt.mjs';
import { generateInFlow } from './lib/flow.mjs';
import { generateInMeta } from './lib/meta.mjs';
import { generateInChatGPT } from './lib/chatgpt.mjs';
import { reviewCandidates } from './lib/review.mjs';
import { notifier } from './lib/notify.mjs';

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const today = () => new Date().toISOString().slice(0, 10);

// CHATGPT PRIMARY, FLOW + META AI AS FALLBACKS (human decision, 2026-09-14). The
// automation profile's ChatGPT account was previously free-tier and could not generate
// images at all (see the old note below, kept for history) — it is now signed in on a
// real ChatGPT Plus account, verified live end to end (a real generation completed,
// downloaded, and the composer accepts a real file-input upload for brand assets, no
// native OS file-chooser interception needed unlike Flow). Made primary per explicit
// instruction. Flow and Meta AI stay wired in as fallbacks for whatever ChatGPT's
// content filter refuses or a UI change breaks.
//
// HISTORY (2026-08-29, superseded above): Flow was primary, Meta AI the fallback — Flow
// matched a reference's ASL hand shape correctly where Meta AI drew a different gesture,
// and Meta AI couldn't hold a fixed aspect ratio across repeated prompts. ChatGPT was
// unwired at the time because that account was free-tier.
const ENGINES = {
  chatgpt: { label: 'ChatGPT', run: generateInChatGPT },
  flow: { label: 'Flow (Nano Banana Pro)', run: generateInFlow },
  meta: { label: 'Meta AI', run: generateInMeta },
};

// FLOW IS OFF THE NORMAL PATH (human decision, 2026-09-16) — "drop the flow,
// Meta is giving really nice images and it's super speed". The three engines
// render in PARALLEL, so a run costs as long as its SLOWEST engine: dropping
// the laggard is where the speed actually comes from, not from doing less work.
//
// Flow is deliberately still IN `ENGINES`, not deleted: `--engine flow`,
// IG2IMG_ENGINE=flow and any `Engine: flow` line the Recreator still writes all
// keep working for debug/comparison, and re-enabling it is one word in this
// list. Only the default parallel set changed.
//
// This is the SHARED pipeline — Pam's creative, Kelly's trend creative and the
// Telegram bot all run through it, so this applies to all three.
const ACTIVE_ENGINES = ['meta'];
const ACTIVE_LABEL = ACTIVE_ENGINES.map((k) => ENGINES[k].label).join(' + ');

function engineOrder(pref) {
  const first = ENGINES[pref] ? pref : 'chatgpt';
  return [first, ...Object.keys(ENGINES).filter((k) => k !== first)];
}

/** Rebuild the paste texts from a previous run's files, so a failure that happened
 *  at the generate stage doesn't re-do the slow scrape + Reference Recreator stages. */
async function reusePrompts(outDir, log) {
  const files = readdirSync(outDir).filter((f) => /^paste-\d+\.txt$/.test(f)).sort();
  if (!files.length) return null;
  const body = existsSync(join(outDir, 'prompt-body.md')) ? readFileSync(join(outDir, 'prompt-body.md'), 'utf8') : '';
  // Split prompt-body.md back into its per-prompt sections, so the engines get the
  // short self-contained body — NOT the 47k spec+prompt paste, which an image model
  // starts rendering as body copy.
  // .slice(1) drops what precedes the first "## PROMPT" heading — the Recreator's own
  // preamble notes, which are not a prompt. Keeping it sent a scene-less paste to the
  // engine as prompt #1 and pushed a real prompt off the end of the list. Same fix and
  // same reasoning as splitPrompts() in lib/prompt.mjs — keep the two in step.
  const sections = body.split(/^##\s+PROMPT\s+/mi).slice(1).map((s) => s.trim()).filter(Boolean)
    .map((s) => `## PROMPT ${s}`);

  const pastes = await Promise.all(files.map(async (f, i) => {
    const text = readFileSync(join(outDir, f), 'utf8');
    const section = sections[i] || '';
    const title = (section.match(/^##\s+PROMPT\s+\d+\s*[—-]\s*(.+)$/mi)?.[1] || `recreation ${i + 1}`).trim();
    // Brand asset (cake box, packaging) and the product's own real photo are both real
    // Kapruka reference images — attach both the same way, up to Flow's 3-image cap. Kept
    // as separate lists (not just merged) because they need different handling downstream:
    // a packaging asset already carries the Kapruka wordmark in-frame (skip the composited
    // logo); a bare product photo (a cake, a bouquet) does not (logo still gets composited).
    const brandAssetFiles = resolveAsset(section || text, log);
    const productAssetFiles = await resolveProductAsset(section || text, log);
    const assetFiles = [...brandAssetFiles, ...productAssetFiles];
    const engine = resolveEngine(section || text, log);
    return { index: i + 1, file: join(outDir, f), text, body: section || text, title, assetFiles, hasPackagingAsset: brandAssetFiles.length > 0, engine };
  }));
  log(`  ✓ reusing ${pastes.length} prompt${pastes.length > 1 ? 's' : ''} from ${outDir}`);
  return { docPath: join(outDir, 'recreation-prompts.md'), pastes };
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'untitled';

export async function runPipeline(rawUrlOrTopic, {
  mode = 'recreate',          // 'recreate' (Instagram link) | 'idea' (persona) | 'promote' (service/page)
  persona = '', thing = '',   // required for mode 'idea' / 'promote' respectively
  variations = 1, maxPrompts = 2, notify = true, to = undefined, log = console.log,
  // No default here (was 'flow') — an explicit engine FORCES every prompt in the run to
  // that engine's order (an override); leaving it unset lets each prompt route on its
  // own Engine: line from the Recreator (2026-08-31 intelligent routing). Reading
  // IG2IMG_ENGINE still forces, same as always, for anyone relying on that env var.
  engine = process.env.IG2IMG_ENGINE || null, reuse = false,
  channel = 'whatsapp', instruction = '',
} = {}) {
  const url = mode === 'recreate' ? normaliseIgUrl(rawUrlOrTopic) : '';
  const dirTag = mode === 'recreate' ? `ig-${slug(url.replace(/\/$/, '').split('/').pop())}`
    : mode === 'idea' ? `idea-${slug(persona)}`
    : `promote-${slug(thing)}`;
  const outDir = join(ROOT, '3-output', 'reference-recreations', `${dirTag}-${today()}`);
  mkdirSync(outDir, { recursive: true });

  const chat = notifier(notify ? channel : 'none', to);
  const say = async (msg) => { log(msg); await chat.text(msg).catch(() => {}); };
  const chrome = await connectChrome();

  try {
    let docPath, pastes, ref = null, refSlides = [];
    const reused = reuse ? await reusePrompts(outDir, log) : null;

    if (reused) {
      log(`\n[1-2/4] Reusing the existing prompt (skipping scrape/research + writer)`);
      ({ docPath, pastes } = reused);
      const refDir = join(outDir, 'reference');            // slides from the original run
      if (existsSync(refDir)) {
        refSlides = readdirSync(refDir).filter((f) => /\.(jpg|png)$/i.test(f)).sort().map((f) => join(refDir, f));
      }
    } else if (mode === 'recreate') {
      log(`\n[1/4] Instagram`);
      ref = await scrapeInstagram(chrome, url, join(outDir, 'reference'), { log });
      refSlides = ref.files;
      await say(`📥 Read ${ref.files.length} slide${ref.files.length > 1 ? 's' : ''}. Writing the Kapruka recreation prompt…`);

      log(`\n[2/4] Reference Recreator`);
      ({ docPath, pastes } = await buildPrompts({ mode, ...ref, outDir, maxPrompts, instruction, log }));
    } else if (mode === 'idea') {
      if (!persona) throw new Error('mode "idea" needs a persona');
      await say(`🧠 Researching "${persona}" and writing ${maxPrompts} idea${maxPrompts > 1 ? 's' : ''}…`);
      log(`\n[1-2/4] Idea writer — persona: ${persona}`);
      ({ docPath, pastes } = await buildPrompts({ mode, persona, outDir, maxPrompts, instruction, log }));
    } else if (mode === 'promote') {
      if (!thing) throw new Error('mode "promote" needs a thing to promote');
      await say(`🧠 Checking "${thing}" against approved facts and writing ${maxPrompts} prompt${maxPrompts > 1 ? 's' : ''}…`);
      log(`\n[1-2/4] Promote writer — thing: ${thing}`);
      ({ docPath, pastes } = await buildPrompts({ mode, thing, outDir, maxPrompts, instruction, log }));
    } else {
      throw new Error(`unknown mode "${mode}"`);
    }
    await say(`🧠 ${pastes.length} prompt${pastes.length > 1 ? 's' : ''} ready. Generating the image…`);

    // ALL ENGINES, ALWAYS (human decision, 2026-08-31, extended to ChatGPT 2026-09-14) —
    // every prompt renders on ChatGPT + Flow + Meta AI in parallel (separate CDP tabs on
    // the same Chrome, so this is safe concurrently — see lib/chrome.mjs's newPage()),
    // and every result is sent. This replaces the earlier fallback/routing model (try
    // one, fall through on failure) — `engine`/forced-single-engine and the Engine: line
    // from the Recreator now only matter for CLI/debug single-engine runs
    // (`--engine chatgpt|flow|meta`), not the normal path.
    //
    // REVIEW, THEN SEND EVERYTHING (human decisions 2026-08-31 + 2026-09-10). Every
    // engine's generation still runs through lib/review.mjs — if every candidate has a
    // real defect, it regenerates ONCE more with the reviewer's defect note folded into
    // the prompt. But nothing rendered is discarded any more: every variant from every
    // attempt (both the first pass and, if it ran, the regenerated fix) reaches
    // Telegram, each one labelled with the reviewer's verdict/reason so the human can
    // see which the reviewer preferred and why — the review still gates NOTHING silently
    // reaching Telegram unflagged (the 2026-08-31 problem), it just no longer also
    // silently drops variants the review didn't pick (the 2026-09-10 fix).
    const forcedOrder = engine ? [engine] : null;
    log(`\n[3/4] Generate + review — ${forcedOrder ? ENGINES[forcedOrder[0]].label : `${ACTIVE_LABEL}, all`}`);
    const images = [];

    async function generateOnce(run, promptText, slug, opts) {
      try {
        return await run(chrome, promptText, join(outDir, 'renders'), opts);
      } catch (e) {
        log(`  ! generation failed: ${e.message}`);
        if (e.refused) throw e;
        log(`  · retrying once…`);
        return await run(chrome, promptText, join(outDir, 'renders'), opts);
      }
    }

    for (const p of pastes) {
      const slug = `p${String(p.index).padStart(2, '0')}`;
      const keys = forcedOrder || ACTIVE_ENGINES;
      if (!forcedOrder) log(`  · prompt ${p.index}: ${ACTIVE_LABEL} in parallel`);

      const attempts = await Promise.allSettled(keys.map(async (key) => {
        const { label, run } = ENGINES[key];
        const baseOpts = {
          variations, want: 1, slug, log, body: p.body,
          // ⛔ NEVER attach the IG reference itself (2026-08-28). That puts Nano
          // Banana into image-EDIT mode: it hands the reference straight back,
          // third-party branding and all. Seen twice — a PayPal meme returned
          // verbatim, and a tiramisu ad that kept its original headline. The model
          // gets a short written LAYOUT block instead; see lib/prompt.mjs.
          //
          // ✅ A REAL KAPRUKA BRAND ASSET is different and DOES attach faithfully on
          // Flow — tested 2026-08-31 (correct colours/logo/mascot, composed into a fresh
          // scene, not handed back). Meta AI FAILED that same 2026-08-31 test (rendered a
          // DIFFERENT, wrong Kapruka box from memory instead of the attached photo), so
          // attach was kept off for Meta AI ever since — but that made brand-asset
          // attachment silently dead the moment Flow left ACTIVE_ENGINES (2026-09-16),
          // since Meta became the only engine actually running. Re-enabled 2026-09-21 for
          // a fresh live re-test on today's Meta AI — the meta.ai product has kept shipping
          // since August, so August's failure isn't assumed to still hold. If a run shows
          // Meta AI drawing the WRONG asset from memory again (ignoring the attached
          // photo), that's the signal to revert this to Flow-only and keep Meta on a text
          // description instead.
          //
          // ChatGPT (tested 2026-09-14): the UPLOAD mechanism works (a real
          // <input type="file"> exists in the DOM, setInputFiles lands the file in the
          // composer, ChatGPT visibly acknowledges the attachment) but FIDELITY FAILS
          // THE SAME WAY META AI'S DID. Test: attached the real Kapruka wordmark
          // (purple "kapruka" + yellow smile, no other mark) and asked for it placed
          // top-left, nothing else. ChatGPT ignored the attached file entirely and drew
          // a generic "Kapruka.com" logotype with a tree icon from its own training —
          // not the real brand mark at all. So `attach` stays OFF for chatgpt — every
          // logo/brand mark still goes through compositeLogo() (logo.mjs) pixel-exact
          // after generation, never trusted to an in-generation attachment on chatgpt.
          attach: key !== 'chatgpt' ? (p.assetFiles || []) : [],
          // A packaging asset already shows the Kapruka wordmark in-frame — skip the
          // composited logo (flow.mjs's existing rule). A bare product photo (a cake, a
          // bouquet, no packaging) does NOT carry the logo, so it must stay composited —
          // explicit here rather than flow.mjs's old default of "true whenever anything
          // is attached", which wrongly skipped the logo on product-only attachments.
          attachIsPackaging: key !== 'chatgpt' ? !!p.hasPackagingAsset : false,
        };

        const firstFiles = await generateOnce(run, p.text, slug, baseOpts);
        // p.body, NOT p.text — p.text is the 41KB standing spec PREPENDED to this
        // prompt's own brief (see buildPrompts), and REVIEW_INSTRUCTIONS truncates its
        // promptBody to 3000 chars. Passing p.text meant the reviewer almost always saw
        // only the generic house spec and never the prompt-specific Direction/brief text
        // it was supposed to check the image against (found 2026-09-15, alongside the
        // 7b concept-adherence checklist item — this is why 7 alone never caught it).
        const firstReview = await reviewCandidates(firstFiles, p.body, { log });
        // ⭐ Send EVERYTHING generated, not just the reviewer's single pick — and, when a
        // regeneration happens, BOTH attempts' images, not just the better one (human
        // rule, 2026-09-10). Each attempt keeps its own files/review instead of the
        // second attempt silently replacing the first — nothing rendered gets dropped.
        const roundResults = [{ files: firstFiles, review: firstReview }];

        if (firstReview.verdict === 'fail') {
          log(`  · ${label} prompt ${p.index} failed review (${firstReview.defects.join('; ') || firstReview.reason}) — regenerating once with the fix…`);
          const steer = `\n\n⚠️ REGENERATION NOTE — the previous attempt had a real defect the reviewer caught: ${firstReview.reason}. Specifically: ${firstReview.defects.join('; ')}. Fix this exactly, keep everything else the same.`;
          const secondFiles = await generateOnce(run, p.text + steer, slug, baseOpts).catch((e) => { log(`  ! ${label} regeneration failed: ${e.message}`); return []; });
          if (secondFiles.length) {
            const secondReview = await reviewCandidates(secondFiles, p.body, { log });
            roundResults.push({ files: secondFiles, review: secondReview });
          }
        }

        return { key, label, roundResults };
      }));

      let gotAny = false;
      for (const a of attempts) {
        if (a.status === 'fulfilled' && a.value.roundResults?.some((r) => r.files.length)) {
          gotAny = true;
          for (const round of a.value.roundResults) {
            for (const file of round.files) {
              const isBest = file === round.review.bestFile;
              const passed = round.review.verdict === 'pass' && isBest;
              images.push({ file, title: p.title, engine: a.value.label, passed, reason: round.review.reason, isBest });
            }
          }
        } else if (a.status === 'rejected') {
          log(`  ! engine failed on prompt ${p.index}: ${a.reason?.message}`);
        }
      }
      if (!gotAny) {
        const reasons = attempts.map((a) => a.reason?.message).filter(Boolean).join(' · ');
        await say(`⛔ Prompt ${p.index} ("${p.title}") failed on every engine.${reasons ? ` (${reasons})` : ''}`);
      }
    }
    if (!images.length) throw new Error('no images were generated by any engine');

    log(`\n[4/4] Send — ${chat.channel}`);
    for (const [i, img] of images.entries()) {
      const tag = img.passed ? ' ⭐ reviewer pick' : img.isBest ? '' : ' (alt variation)';
      const flag = img.passed ? '' : `\n⚠️ Didn't fully pass review${img.reason ? `: ${img.reason}` : ''}.`;
      await chat.image(img.file, `${i + 1}/${images.length} — ${img.title} [${img.engine}]${tag}${flag}`)
        .then(() => log(`  ✓ sent ${basename(img.file)}`))
        .catch((e) => log(`  ! could not send ${basename(img.file)}: ${e.message}`));
    }
    await chat.text(`✅ Done — ${images.length} image${images.length > 1 ? 's' : ''}.\nFiles + prompts: ${outDir}`).catch(() => {});

    writeFileSync(join(outDir, 'run.json'), JSON.stringify({
      mode, source: url || persona || thing || null, instruction: instruction || null,
      caption: ref?.caption ?? null, slides: ref?.files ?? [], doc: docPath,
      prompts: pastes.map((p) => ({ index: p.index, title: p.title, file: p.file })),
      images: images.map((i) => ({ file: i.file, engine: i.engine, passed: i.passed, reason: i.reason || null })),
      finishedAt: stamp(),
    }, null, 2));

    log(`\nDone → ${outDir}`);
    return { outDir, images: images.map((i) => i.file), docPath };
  } catch (err) {
    log(`\nFAILED: ${err.message}`);
    await chat.text(`❌ Couldn't finish that one.\n${err.message}`).catch(() => {});
    throw err;
  } finally {
    await chrome.close();                       // detaches CDP; your Chrome stays open
  }
}

// ---- CLI ----
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const url = args.find((a) => !a.startsWith('--'));
  const num = (flag, dflt) => {
    const i = args.indexOf(flag);
    return i >= 0 ? Number(args[i + 1]) : dflt;
  };
  if (!url) {
    console.error('usage: node tools/ig2img/run.mjs <instagram-url> [--variations 2] [--max-prompts 2] [--reuse] [--no-wa]');
    process.exit(1);
  }
  const flag = (name, dflt) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : dflt;
  };
  runPipeline(url, {
    variations: num('--variations', 1),
    maxPrompts: num('--max-prompts', 2),
    notify: !args.includes('--no-wa'),
    engine: flag('--engine', process.env.IG2IMG_ENGINE || null),
    reuse: args.includes('--reuse'),
  }).catch(() => process.exit(1));
}
