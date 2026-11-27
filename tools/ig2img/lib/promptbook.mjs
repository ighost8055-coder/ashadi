// promptbook.mjs — Ashadi's learning loop for picture prompts (human spec, 2026-11-22).
//
//   every finished design (reference OR no-reference) ──► recordRun()  ──► data/promptbook.json (the prompt, the conditions
//                                                                          it ran under, what the art director and picture
//                                                                          checker found, and your thumbs up/down)
//   a no-reference job ──► strategist ──► ensureLessons() distils the entries into upgraded style rules ──► playbookFor()
//                                         hands the rules + the best matching earlier prompts to the strategist.
//
// So when there is no reference, the creative strategist writes its prompt in the style that has actually worked, under
// the same conditions (real products attached, layout sketch, margins), and avoids what has needed fixing before — and
// each new design adds to the evidence, so the style keeps improving. Gemini only (no Claude CLI).
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { ROOT } from './env.mjs';
import { think } from './thinker.mjs';

const DATA_DIR = join(ROOT, 'tools', 'ig2img', 'data');
const FILE = join(DATA_DIR, 'promptbook.json');
const DESIGN_DIR = join(ROOT, '3-output', 'ashadi-designs');
const MIN_FOR_LESSONS = 3;          // distil once there is this much evidence
const REDISTIL_EVERY = 3;           // …and again after this many new entries (or any human rating)

const blank = () => ({ version: 1, entries: [], lessons: null, lessonsEntryCount: 0, ratedSinceLessons: 0, updatedAt: null });

export function loadBook() {
  try { return { ...blank(), ...JSON.parse(readFileSync(FILE, 'utf8')) }; } catch { return blank(); }
}
function saveBook(book) {
  mkdirSync(DATA_DIR, { recursive: true });
  book.updatedAt = new Date().toISOString();
  writeFileSync(FILE, JSON.stringify(book, null, 1));
}

// ---------------------------------------------------------------------------------------------------------
// Scoring: 0-100. The art director's verdict and issues, picture-stage defects, and your own rating.
// ---------------------------------------------------------------------------------------------------------
export function scoreOf(v, human = null) {
  const base = { 'production-ready': 100, 'minor-fixes': 70, 'not-ready': 30 }[v.review?.verdict] ?? 50;
  const pen = (v.review?.issues || []).reduce((a, i) => a + (i.severity === 'high' ? 8 : i.severity === 'medium' ? 3 : 1), 0);
  let s = base - pen;
  if (v.polish?.needsNewPicture) s -= 10;
  if ((v.attempts || 1) > 1) s -= 5;                       // the picture had to be regenerated for a defect
  if ((v.check?.paintedText || []).length) s -= 10;
  if (human === 'good') s += 20;
  if (human === 'bad') s -= 40;
  return Math.max(0, Math.min(100, Math.round(s)));
}

function entryFrom({ runName, index, v, kSpec, meta }) {
  const sceneBox = kSpec?.scene || {};
  return {
    id: `${runName}#${index}`, runId: runName, variant: index, at: new Date().toISOString(),
    engine: v.engine || '', relation: meta.relation || 'direct', kind: meta.kind || 'reference',
    target: String(meta.target || '').slice(0, 200), hasProducts: !!meta.hasProducts,
    framing: sceneBox.framing || '', subject: String(sceneBox.subject || '').slice(0, 300),
    scenePrompt: String(sceneBox.prompt || '').slice(0, 2400),
    attached: meta.attached || [],
    copy: (kSpec?.elements || []).filter((e) => e.type === 'text').map((e) => e.text).slice(0, 8),
    verdict: v.review?.verdict || null,
    issues: (v.review?.issues || []).slice(0, 6).map((i) => ({ severity: i.severity, what: String(i.what || '').slice(0, 140) })),
    rounds: v.polish?.rounds || 0, regenerated: (v.attempts || 1) > 1,
    painted: (v.check?.paintedText || []).slice(0, 4),
    human: null, baseScore: scoreOf(v), score: scoreOf(v),
  };
}

/** Record one finished run (every variant). Safe to call twice — entries are keyed by run + variant. */
export function recordRun({ runDir, result, kSpec, relation, kind, target, hasProducts, attached = [] }) {
  const book = loadBook();
  const runName = basename(runDir);
  let added = 0;
  for (const [i, v] of (result.variants || []).entries()) {
    if (!v.review) continue;                                // nothing was judged — nothing to learn from
    const e = entryFrom({ runName, index: i, v, kSpec, meta: { relation, kind, target, hasProducts, attached } });
    const at = book.entries.findIndex((x) => x.id === e.id);
    if (at >= 0) { e.human = book.entries[at].human; e.score = scoreOf(v, e.human?.rating); book.entries[at] = e; } else { book.entries.push(e); added++; }
  }
  book.entries = book.entries.slice(-400);
  saveBook(book);
  return added;
}

/** One-time seeding from every design folder already on disk, so the loop starts with what has been learned so far. */
export function backfill() {
  const book = loadBook();
  if (book.entries.length) return 0;
  let added = 0;
  let names = [];
  try { names = readdirSync(DESIGN_DIR, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_')).map((d) => d.name).sort(); } catch { return 0; }
  for (const runName of names) {
    try {
      const dir = join(DESIGN_DIR, runName);
      const result = JSON.parse(readFileSync(join(dir, 'design.json'), 'utf8'));
      const kSpec = JSON.parse(readFileSync(join(dir, 'kapruka-spec.json'), 'utf8'));
      if (!kSpec?.scene?.prompt) continue;
      for (const [i, v] of (result.variants || []).entries()) {
        if (!v.review) continue;
        book.entries.push(entryFrom({ runName, index: i, v, kSpec, meta: { relation: result.relation || 'direct', kind: result.kind === 'design' ? 'reference' : 'reference', target: result.target || '', hasProducts: !!result.products, attached: [] } }));
        added++;
      }
    } catch { /* an old or partial run: skip it */ }
  }
  if (added) saveBook(book);
  return added;
}

/** Your thumbs up / down on a finished design. Feeds the score and triggers a re-distil on the next no-reference job. */
export function rate(runId, rating, note = '') {
  if (!['good', 'bad'].includes(rating)) throw new Error('rating must be "good" or "bad"');
  const book = loadBook();
  let n = 0;
  for (const e of book.entries) {
    if (e.runId !== runId) continue;
    e.human = { rating, note: String(note || '').slice(0, 300), at: new Date().toISOString() };
    e.score = Math.max(0, Math.min(100, Math.round((e.baseScore ?? e.score) + (rating === 'good' ? 20 : -40))));
    n++;
  }
  if (n) { book.ratedSinceLessons = (book.ratedSinceLessons || 0) + 1; saveBook(book); }
  return n;
}

// ---------------------------------------------------------------------------------------------------------
// Distil: turn the entries into upgraded style rules (Gemini). Runs lazily, when a no-reference job needs them.
// ---------------------------------------------------------------------------------------------------------
function parseJson(text) {
  let s = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('the distiller did not return JSON');
  s = s.slice(a, b + 1);
  try { return JSON.parse(s); } catch { return JSON.parse(s.replace(/,\s*([}\]])/g, '$1')); }
}
const brief = (e, n = 520) => `[score ${e.score}${e.human ? `, you said ${e.human.rating}${e.human.note ? `: "${e.human.note}"` : ''}` : ''}] `
  + `conditions: ${e.relation}${e.hasProducts ? ', real product sheet attached' : ''}${e.framing ? `, ${e.framing}` : ''}, ${e.engine || 'engine n/a'}${e.regenerated ? ', picture needed regenerating' : ''}\n`
  + `  prompt: ${e.scenePrompt.replace(/\s+/g, ' ').slice(0, n)}\n`
  + `  result: ${e.verdict || 'n/a'}${e.issues.length ? ` — ${e.issues.slice(0, 4).map((i) => `${i.severity}: ${i.what}`).join(' | ')}` : ''}${e.painted.length ? ` — painted text: ${e.painted.join(', ')}` : ''}`;

export async function ensureLessons({ chrome, log = console.log }) {
  backfill();
  const book = loadBook();
  const n = book.entries.length;
  if (n < MIN_FOR_LESSONS) { log(`  · playbook: only ${n} earlier design${n === 1 ? '' : 's'} recorded — not enough to learn from yet`); return book.lessons; }
  const fresh = n - (book.lessonsEntryCount || 0) + 0;
  if (book.lessons && fresh < REDISTIL_EVERY && !(book.ratedSinceLessons > 0)) return book.lessons;

  log(`  → playbook: learning from ${n} earlier designs${book.ratedSinceLessons ? ` and ${book.ratedSinceLessons} rating(s) from you` : ''}…`);
  const ranked = [...book.entries].sort((a, b) => b.score - a.score);
  const best = ranked.slice(0, 7); const worst = ranked.slice(-7).filter((e) => !best.includes(e));
  const prompt = `You maintain the PICTURE-PROMPT PLAYBOOK for Ashadi, Kapruka's ad designer. Each earlier design below has the prompt its picture was made from, the conditions it ran under, and how it turned out (art director, picture checks, the human's rating). Learn what makes a picture prompt succeed here and what keeps causing defects, then UPGRADE the rules.
${book.lessons ? `\nCURRENT RULES (version ${book.lessons.version}) — keep what the evidence still supports, fix or drop what it contradicts, add what is new:\n${JSON.stringify({ style_rules: book.lessons.style_rules, avoid: book.lessons.avoid, structure: book.lessons.structure })}\n` : ''}
BEST RESULTS:
${best.map((e) => brief(e)).join('\n\n')}

WORST RESULTS:
${worst.map((e) => brief(e)).join('\n\n') || '(none yet)'}

Write rules a strategist can follow when there is NO reference image: how to structure the prompt, what to specify (placement, light, surface, contact shadow, product orientation, label visibility), wording that worked, and wording or situations that caused problems (painted text, clipped or cut-off objects, ghost panels, distorted products, wrong colours, objects too small, crowded layout). Use only what the evidence supports; be concrete, one line each.
Reply: {"style_rules":["up to 10 short rules"],"avoid":["up to 10 short rules"],"structure":"how to lay out a scene prompt, in 3 sentences max","what_changed":"one sentence: how these rules differ from the current ones (or 'first version')"}`;
  const l = parseJson(await think(`Reply with ONLY one JSON object, no commentary, no code fence.\n\n${prompt}`, { label: 'playbook' }));
  const prevHistory = book.lessons?.history || [];
  book.lessons = {
    version: (book.lessons?.version || 0) + 1, updatedAt: new Date().toISOString(), basedOn: n,
    style_rules: (l.style_rules || []).map(String).slice(0, 10), avoid: (l.avoid || []).map(String).slice(0, 10),
    structure: String(l.structure || ''), history: [...prevHistory, { v: (book.lessons?.version || 0) + 1, at: new Date().toISOString(), what: String(l.what_changed || '') }].slice(-8),
  };
  book.lessonsEntryCount = n; book.ratedSinceLessons = 0;
  saveBook(book);
  log(`  ✓ playbook v${book.lessons.version}: ${book.lessons.style_rules.length} style rules, ${book.lessons.avoid.length} things to avoid — ${book.lessons.history.at(-1).what}`);
  return book.lessons;
}

// ---------------------------------------------------------------------------------------------------------
// What the strategist (and the adapter) are shown.
// ---------------------------------------------------------------------------------------------------------
const toks = (s) => new Set(String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 3));

/** Short rules only — safe to add to any prompt. */
export function lessonsText() {
  const L = loadBook().lessons;
  if (!L) return '';
  return `PROVEN PICTURE-PROMPT LESSONS (playbook v${L.version}, learned from ${L.basedOn} designs):\n`
    + `${L.structure ? `Structure: ${L.structure}\n` : ''}`
    + `${L.style_rules.length ? `Do:\n${L.style_rules.map((r) => `- ${r}`).join('\n')}\n` : ''}`
    + `${L.avoid.length ? `Avoid (these caused defects before):\n${L.avoid.map((r) => `- ${r}`).join('\n')}\n` : ''}`;
}

/** The full playbook for a no-reference job: the rules, plus the best earlier prompts that ran under similar conditions. */
export function playbookFor({ target = '', hasProducts = false, framing = 'cutout-on-ground' }) {
  const book = loadBook();
  const used = { entries: book.entries.length, lessons: book.lessons?.version || 0 };
  if (!book.entries.length) return { text: '', used };
  const want = toks(target);
  const scored = book.entries.filter((e) => e.scenePrompt.length > 200).map((e) => {
    const sim = (e.hasProducts === hasProducts ? 2 : 0) + (e.framing === framing ? 1 : 0)
      + Math.min(3, [...toks(`${e.target} ${e.subject}`)].filter((t) => want.has(t)).length);
    return { e, rank: e.score * 0.7 + sim * 10 };
  }).sort((a, b) => b.rank - a.rank);
  const good = scored.filter((x) => x.e.score >= 60).slice(0, 3).map((x) => x.e);
  const bad = scored.filter((x) => x.e.score < 50 && x.e.issues.length).slice(0, 2).map((x) => x.e);
  const text = `${lessonsText()}\n`
    + `${good.length ? `EARLIER PROMPTS THAT WORKED (follow their level of detail and structure, not their subject):\n${good.map((e) => brief(e, 700)).join('\n\n')}\n\n` : ''}`
    + `${bad.length ? `EARLIER PROMPTS THAT HAD PROBLEMS (do not repeat these mistakes):\n${bad.map((e) => brief(e, 400)).join('\n\n')}\n` : ''}`;
  return { text: text.trim(), used };
}
