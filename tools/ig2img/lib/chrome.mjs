// chrome.mjs — attach Playwright to YOUR real Chrome over CDP.
//
// Why attach instead of launching a Playwright browser: chatgpt.com and
// instagram.com both gate on a logged-in session and both flag vanilla
// automation builds. Your everyday Chrome profile is already signed in to
// ChatGPT (Premium) and Instagram, and already looks like a real browser —
// so we drive that, and whatever plan that account has is what generates.
//
// Chrome must have been started with --remote-debugging-port. Use
// `powershell -File tools/ig2img/start-chrome.ps1` (it relaunches Chrome
// with the port open, on your normal Default profile).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const CDP_PORT = Number(process.env.IG2IMG_CDP_PORT || 9222);

const CHROME_CANDIDATES = [
  process.env.IG2IMG_CHROME,
  join(process.env['ProgramFiles'] || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
  join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
  join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
].filter(Boolean);

// IMPORTANT: Chrome 136+ refuses to open --remote-debugging-port when the
// user-data-dir is the DEFAULT Chrome folder (an anti-cookie-theft measure), so
// the automation gets its own folder. `setup-profile.ps1` seeds that folder from
// your real profile, which carries the ChatGPT + Instagram logins across.
const USER_DATA = process.env.IG2IMG_PROFILE
  || join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Automation Profile');

export const PROFILE_DIR = process.env.IG2IMG_CHROME_PROFILE || 'Default';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chromeExe() {
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!found) throw new Error(`Chrome not found. Tried:\n  ${CHROME_CANDIDATES.join('\n  ')}`);
  return found;
}

async function portAlive(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch { return false; }
}

/** Start Chrome with the debug port if it isn't already listening. */
async function ensureChrome() {
  if (await portAlive(CDP_PORT)) return;

  spawn(chromeExe(), [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${USER_DATA}`,
    `--profile-directory=${PROFILE_DIR}`,
    '--restore-last-session',
  ], { detached: true, stdio: 'ignore' }).unref();

  for (let i = 0; i < 40; i++) {                    // up to ~20s
    await sleep(500);
    if (await portAlive(CDP_PORT)) return;
  }
  throw new Error(
    `Chrome is not exposing the debug port ${CDP_PORT}.\n` +
    `Profile folder: ${USER_DATA}\n` +
    `First run? Seed it once:   powershell -File tools/ig2img/setup-profile.ps1\n` +
    `Then start it:             powershell -File tools/ig2img/start-chrome.ps1`
  );
}

/**
 * Connect and hand back { browser, context, newPage() }.
 * Close only the pages you open — never the browser (it's the user's Chrome).
 */
export async function connectChrome() {
  await ensureChrome();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const context = browser.contexts()[0];
  if (!context) throw new Error('Chrome exposed no browser context — is a window open?');
  return {
    browser,
    context,
    async newPage() {
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      return page;
    },
    async close() { await browser.close().catch(() => {}); },   // detaches CDP; Chrome stays open
  };
}
