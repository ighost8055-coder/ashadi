// seen.mjs — fingerprints of every image an engine has ever saved, shared by all engines.
//
// Why (2026-11-15): meta.ai re-showed an earlier creation after a new prompt and the
// engine saved it as the "new" result — 23 of 259 past raw renders turned out to be exact
// repeats. Any candidate whose bytes were saved before is rejected, whatever the page does.
// One shared file + a merge-on-write, so two engines running at once don't clobber each other.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from './env.mjs';

const SEEN_FILE = join(ROOT, 'tools', 'logs', 'meta-seen-images.json');   // name kept: it predates Gemini
export const sha = (buf) => createHash('sha256').update(buf).digest('hex');

function readFileSet() {
  try { return new Set(JSON.parse(readFileSync(SEEN_FILE, 'utf8'))); } catch { return null; }
}

let seen = null;
function load() {
  if (seen) return seen;
  seen = readFileSet();
  if (seen) return seen;
  // First use: fingerprint every raw render already on disk, so past images count too.
  seen = new Set();
  const walk = (dir, depth) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory() && depth < 4) walk(p, depth + 1);
      else if (/-raw\.(webp|png|jpe?g)$/i.test(e.name)) { try { seen.add(sha(readFileSync(p))); } catch {} }
    }
  };
  walk(join(ROOT, '3-output'), 0);
  writeFileSync(SEEN_FILE, JSON.stringify([...seen]));
  return seen;
}

/** True if these exact bytes were saved before (by any engine, in any process). */
export function alreadySeen(buf) {
  const h = sha(buf);
  if (load().has(h)) return true;
  const disk = readFileSet();                 // another process may have saved it meanwhile
  if (disk?.has(h)) { seen.add(h); return true; }
  return false;
}

/** Record these bytes as saved. Merges with the file so concurrent engines don't lose entries. */
export function markSeen(buf) {
  const h = sha(buf);
  load().add(h);
  const disk = readFileSet() || new Set();
  for (const x of disk) seen.add(x);
  try { writeFileSync(SEEN_FILE, JSON.stringify([...seen])); } catch {}
}
