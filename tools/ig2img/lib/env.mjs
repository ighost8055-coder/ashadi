// env.mjs — read the project-root .env, tolerating BOTH dotenv (`KEY=value`)
// and the JS style already in this file (`var KEY = 'value';`), same as wa-send.sh.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..', '..', '..');            // project root
const ENV_FILE = join(ROOT, '.env');

let cache = null;

function load() {
  if (cache) return cache;
  cache = {};
  if (!existsSync(ENV_FILE)) throw new Error(`.env not found at ${ENV_FILE}`);
  for (const raw of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+|var\s+|const\s+|let\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim().replace(/;$/, '').trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    cache[m[1]] = v;                                          // later lines win
  }
  return cache;
}

/** Read a key, checking aliases in order. Throws when required and absent. */
export function env(names, { required = true, fallback = '' } = {}) {
  const e = load();
  for (const n of [].concat(names)) if (e[n]) return e[n];
  if (required) throw new Error(`missing in .env: ${[].concat(names).join(' / ')}`);
  return fallback;
}

export const WA_TOKEN        = () => env(['WA_TOKEN']);
export const WA_PHONE_ID     = () => env(['WA_PHONE_ID', 'PHONE_ID']);
export const WA_ADMIN_NUMBER = () => env(['WA_ADMIN_NUMBER', 'ADMIN_NUM']);
export const WA_VERIFY_TOKEN = () => env(['WA_VERIFY_TOKEN'], { required: false, fallback: 'kapruka-ig2img' });
