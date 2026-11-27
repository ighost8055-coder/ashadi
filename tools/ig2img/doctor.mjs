// doctor.mjs — check the automation Chrome is ready: port open, ChatGPT signed
// in, Instagram signed in. Leaves both tabs open so you can log in on the spot.
//
//   node tools/ig2img/doctor.mjs
//
// Run it once after setup-profile.ps1, and any time a run reports a login error.
import { connectChrome, CDP_PORT, PROFILE_DIR } from './lib/chrome.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function checkChatGPT(page) {
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await sleep(9000);
  return page.evaluate(() => {
    const txt = document.body.innerText;
    const loggedOut = /Sign up for free/i.test(txt) || /Log in to get answers/i.test(txt);
    const account = document.querySelector('[data-testid="profile-button"]')?.innerText?.trim()
      || document.querySelector('button[aria-label*="Profile"], nav [class*="truncate"]')?.innerText?.trim() || '';
    return { loggedIn: !loggedOut, account: account.slice(0, 60) };
  });
}

async function checkInstagram(page) {
  await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await sleep(7000);
  return page.evaluate(() => ({
    loggedIn: !!document.querySelector('svg[aria-label="Home"], a[href="/direct/inbox/"], svg[aria-label="New post"]'),
    account: document.querySelector('a[href^="/"][role="link"] img[alt*="profile picture"]')?.getAttribute('alt')?.slice(0, 60) || '',
  }));
}

const mark = (ok) => (ok ? '  OK  ' : ' FAIL ');

console.log(`\nAutomation Chrome — port ${CDP_PORT}, profile "${PROFILE_DIR}"\n`);

let chrome;
try {
  chrome = await connectChrome();
  console.log(`${mark(true)} debug port reachable`);
} catch (e) {
  console.log(`${mark(false)} debug port\n\n${e.message}\n`);
  process.exit(1);
}

const results = {};
// Each check opens a tab and LEAVES IT OPEN, so you can sign in right there.
for (const [name, fn] of [['chatgpt', checkChatGPT], ['instagram', checkInstagram]]) {
  try {
    const page = await chrome.newPage();
    results[name] = await fn(page);
    const { loggedIn, account } = results[name];
    console.log(`${mark(loggedIn)} ${name}.com${account ? ` — ${account}` : ''}`);
  } catch (e) {
    results[name] = { loggedIn: false, error: e.message };
    console.log(`${mark(false)} ${name}.com — ${e.message.split('\n')[0]}`);
  }
}
await chrome.close();

const bad = [
  !results.chatgpt?.loggedIn && 'chatgpt.com',
  !results.instagram?.loggedIn && 'instagram.com',
].filter(Boolean);

if (!bad.length) {
  console.log('\nReady. WhatsApp an Instagram link + the word "create".\n');
} else {
  console.log(`\nSign in to ${bad.join(' and ')} in the Chrome window that just opened.`);
  console.log('It is the automation profile, separate from your everyday Chrome — the login sticks there.');
  console.log('Then re-run:  node tools/ig2img/doctor.mjs\n');
  process.exit(1);
}
