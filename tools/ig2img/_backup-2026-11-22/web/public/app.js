'use strict';

// All dynamic text goes through textContent (via h()) — captions, reviewer notes and
// Instagram handles come from outside this page and must never be parsed as HTML.

const $ = (sel, root = document) => root.querySelector(sel);

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const MODES = {
  design: {
    label: 'Design → Canva',
    noun: 'Design from',
    help: 'Paste a creative to rebuild. Ashadi measures its exact layout (placement, scale, margins, white space, type), adapts it to Kapruka, paints a text-free picture, and puts it in Canva with every line of copy as editable text.',
    sourceLabel: 'Instagram link of the creative',
    placeholder: 'https://www.instagram.com/p/…',
    countLabel: '',
    note: 'e.g. use the flower box, keep the headline under 5 words',
    submit: 'Design it in Canva',
  },
  recreate: {
    label: 'Recreate a post',
    noun: 'Recreate',
    help: 'Paste an Instagram post or reel. Ashadi reads it and rebuilds it as a Kapruka ad: a faithful copy, plus its own take.',
    sourceLabel: 'Instagram link',
    placeholder: 'https://www.instagram.com/p/…',
    countLabel: 'Variations per prompt',
    note: 'e.g. change only the headline to "Amma knows best"',
    submit: 'Recreate this post',
  },
  idea: {
    label: 'Ideas',
    noun: 'Ideas for',
    help: 'Name a persona and Ashadi will research it and write original ad ideas from scratch. No reference post needed.',
    sourceLabel: 'Persona',
    placeholder: 'e.g. Romantic — local',
    countLabel: 'How many ideas',
    note: 'e.g. lean into Poya-day gifting',
    submit: 'Get ideas',
  },
  promote: {
    label: 'Promote',
    noun: 'Promote',
    help: 'Pick something Kapruka really offers. Claims are checked against the approved business facts before any prompt is written.',
    sourceLabel: 'What to promote',
    placeholder: 'e.g. same-day delivery, or a kapruka.com link',
    countLabel: 'How many prompts',
    note: 'e.g. focus on last-minute birthdays',
    submit: 'Promote this',
  },
};
const MODE_ICON = { recreate: 'Recreate', idea: 'Ideas', promote: 'Promote', design: 'Canva design' };
// "Canva for all links" (2026-11-15): Instagram links always go through Design → Canva;
// the old flat-image Recreate tab is gone (its past runs still open from Past runs).
const MODE_ORDER = ['design', 'idea', 'promote'];
const STEP_LABELS = {
  design: ['Reference', 'Measure', 'Adapt', 'Picture', 'Canva'],
  recreate: ['Read post', 'Write prompts', 'Generate & review', 'Finish'],
  idea: ['Research', 'Write prompts', 'Generate & review', 'Finish'],
  promote: ['Check facts', 'Write prompts', 'Generate & review', 'Finish'],
};
const ACTIVE = ['queued', 'waiting', 'running'];

const state = {
  mode: MODE_ORDER.includes(localStorage.getItem('ashadi.mode')) ? localStorage.getItem('ashadi.mode') : 'design',
  runKind: 'run',
  jobs: new Map(),
  logs: new Map(),
  openLogs: new Set(),
  runs: [],
  runsFilter: 'all',
  runsShown: 24,
  runId: null,
  detail: null,
  status: null,
  lightbox: { items: [], index: 0 },
  tick: null,
};

/* ---------------------------------------------------------------- helpers */
const fmtDate = (ms) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
const plural = (n, s) => `${n} ${s}${n === 1 ? '' : 's'}`;
function fmtElapsed(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, 3500);
}
function jobTitle(j) {
  const code = j.source.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i)?.[1];
  if (j.mode === 'recreate') return `Recreate ${code || 'post'}`;
  if (j.mode === 'design') return `${j.origin === 'sithiji' ? 'Sithiji · ' : ''}Design from ${code || j.source}`;
  return `${MODES[j.mode].noun} ${j.source}`;
}
const shortTitle = (t) => { const s = String(t || '').replace(/^(FAITHFUL COPY|RECREATOR'S TAKE)\s*[—-]\s*/i, '').trim(); return s || String(t || ''); };

/* ---------------------------------------------------------------- composer */
const form = $('#composer');
const srcInput = $('#source');
const countSel = $('#count');
const noteInput = $('#instruction');

function setMode(mode) {
  state.mode = mode;
  localStorage.setItem('ashadi.mode', mode);
  const m = MODES[mode];
  for (const t of form.querySelectorAll('.tab')) {
    const on = t.dataset.mode === mode;
    t.setAttribute('aria-selected', on ? 'true' : 'false');
    t.tabIndex = on ? 0 : -1;
  }
  $('#panel-main').setAttribute('aria-labelledby', `tab-${mode}`);
  $('#mode-help').textContent = m.help;
  $('#source-label').textContent = m.sourceLabel;
  srcInput.placeholder = m.placeholder;
  srcInput.setAttribute('inputmode', mode === 'recreate' ? 'url' : 'text');
  if (mode === 'idea') srcInput.setAttribute('list', 'persona-list'); else srcInput.removeAttribute('list');
  $('#count-label').textContent = m.countLabel;
  $('.field-count').hidden = !m.countLabel;
  noteInput.placeholder = m.note;
  $('#submit').textContent = m.submit;
  showError('');
}
function fillCounts() {
  for (let i = 1; i <= 4; i++) countSel.append(h('option', { value: i }, i));
}
function showError(msg) {
  const el = $('#form-error');
  el.textContent = msg;
  el.hidden = !msg;
  srcInput.closest('.field').classList.toggle('invalid', !!msg);
}

form.querySelector('.tabs').addEventListener('click', (e) => {
  const t = e.target.closest('.tab');
  if (t) setMode(t.dataset.mode);
});
form.querySelector('.tabs').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const order = MODE_ORDER;
  const next = order[(order.indexOf(state.mode) + (e.key === 'ArrowRight' ? 1 : order.length - 1)) % order.length];
  setMode(next);
  $(`#tab-${next}`).focus();
  e.preventDefault();
});
srcInput.addEventListener('input', () => showError(''));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#submit');
  btn.disabled = true;
  showError('');
  try {
    const { job } = await api('/api/jobs', {
      method: 'POST',
      body: JSON.stringify({
        mode: state.mode, source: srcInput.value, count: Number(countSel.value), instruction: noteInput.value,
      }),
    });
    state.jobs.set(job.id, job);
    renderJobs();
    srcInput.value = '';
    noteInput.value = '';
    toast(job.status === 'running' ? 'Started.' : 'Added to the queue.');
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
  }
});

/* ---------------------------------------------------------------- status pills */
function renderPills() {
  const s = state.status;
  const box = $('#pills');
  box.replaceChildren();
  if (!s) return;
  const pill = (cls, text, title) => box.append(h('span', { class: `pill ${cls}`, title }, text));
  if (s.demo) pill('warn', 'Demo mode', 'Runs are simulated — nothing is generated.');
  const active = [...state.jobs.values()];
  const running = active.filter((j) => j.status === 'running').length;
  const waiting = active.filter((j) => j.status === 'queued' || j.status === 'waiting').length;
  if (running || waiting) {
    // Clickable: jumps to the job in "Now & next" and opens its live log.
    box.append(h('button', {
      type: 'button', class: 'pill busy pill-link', title: 'Show what\'s running',
      onclick: () => {
        const j = active.find((x) => x.status === 'running') || active.find((x) => x.status === 'waiting' || x.status === 'queued');
        if (j) { state.openLogs.add(j.id); renderJobs(); }
        const el = j && $(`[data-job="${j.id}"]`);
        (el || $('#jobs')).scrollIntoView({ behavior: 'smooth', block: 'center' });
        el?.classList.add('flash');
        setTimeout(() => el?.classList.remove('flash'), 1600);
      },
    }, `${running ? '1 running' : 'Waiting'}${waiting ? ` · ${waiting} queued` : ''} — view`));
  } else pill('ok', 'Idle');
  if (s.demo) { /* Chrome isn't used in demo mode */ } else if (s.chrome) pill('ok', 'Chrome ready', 'The automation Chrome is up.');
  else pill('', 'Chrome starts on first job', 'The automation Chrome isn\'t running yet; it\'s launched automatically when a job starts.');
  const cv = s.canva || {};
  if (cv.connected) pill('ok', `Canva${cv.name ? ` · ${cv.name}` : ''}`, 'Canva is connected — designs can be sent to it and pulled back.');
  else if (cv.configured) {
    box.append(h('a', {
      class: 'pill warn pill-link', href: '/canva/connect',
      title: cv.error ? `Canva: ${cv.error}` : 'Sign in to Canva once so Ashadi can import designs and pull finals back.',
    }, 'Connect Canva'));
  }
  const b = s.bot || {};
  const handle = b.username ? `@${b.username}` : 'Telegram bot';
  if (b.state === 'working') pill('busy', `${handle} is busy`, 'The Telegram bot is running a job. Jobs from this page wait for it, because both share one Chrome.');
  else if (b.state === 'unreachable') pill('warn', 'Telegram unreachable', `${handle} can't reach Telegram right now (${b.pollErrors} of its last 20 log lines are poll errors). This page doesn't use Telegram, so it keeps working.`);
}

/* ---------------------------------------------------------------- jobs */
function stepsEl(job) {
  const labels = STEP_LABELS[job.mode];
  const done = job.status === 'done';
  return h('ol', { class: `steps${labels.length === 5 ? ' five' : ''}`, 'aria-label': 'Progress' }, labels.map((l, i) => {
    const n = i + 1;
    const cls = done || n < job.step ? 'done' : n === job.step ? 'active' : '';
    return h('li', { class: `step ${cls}`, 'aria-current': cls === 'active' ? 'step' : null }, l);
  }));
}

function jobEl(job) {
  const running = job.status === 'running';
  const el = h('div', { class: `job is-${job.status}`, 'data-job': job.id });
  el.append(h('div', { class: 'job-head' },
    h('div', { style: null },
      h('div', { class: 'job-title' }, jobTitle(job)),
      h('div', { class: 'job-meta', 'data-meta': job.id }, metaText(job))),
    h('span', { class: `status ${job.status}` }, job.status)));

  if (running || job.status === 'waiting') el.append(stepsEl(job));
  el.append(h('p', { class: `job-message${job.status === 'failed' ? ' is-error' : ''}`, 'data-msg': job.id }, job.message || ''));

  const actions = h('div', { class: 'job-actions' });
  if (job.runId && (job.status === 'done' || job.runKind === 'design')) {
    actions.append(h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: () => openRun(job.runId, true, job.runKind) },
      job.status === 'done' ? 'View results' : 'See how far it got'));
  }
  if (job.status === 'queued' || job.status === 'waiting') {
    actions.append(h('button', {
      type: 'button', class: 'btn btn-ghost btn-small',
      onclick: async () => { try { await api(`/api/jobs/${job.id}`, { method: 'DELETE' }); } catch (e) { toast(e.message); } },
    }, 'Cancel'));
  }
  if (running && job.stoppable) {
    actions.append(h('button', {
      type: 'button', class: 'btn btn-stop btn-small', disabled: job.stopping,
      onclick: async () => {
        if (!confirm(`Stop "${jobTitle(job)}"?\n\nIt's cut off where it is — anything already made stays in its folder, nothing more is generated or sent to Canva.`)) return;
        try { await api(`/api/jobs/${job.id}`, { method: 'DELETE' }); toast('Stopping…'); } catch (e) { toast(e.message); }
      },
    }, job.stopping ? 'Stopping…' : 'Stop'));
  }
  const hasLog = (state.logs.get(job.id) || []).length > 0;
  if (hasLog) {
    const open = state.openLogs.has(job.id);
    actions.append(h('button', {
      type: 'button', class: 'log-toggle', 'aria-expanded': open ? 'true' : 'false',
      onclick: () => { if (open) state.openLogs.delete(job.id); else state.openLogs.add(job.id); renderJobs(); },
    }, open ? 'Hide log' : 'Show log'));
  }
  if (actions.childNodes.length) el.append(actions);

  if (state.openLogs.has(job.id)) {
    const pre = h('pre', { class: 'log', 'data-log': job.id, tabindex: '0', 'aria-label': 'Run log' }, (state.logs.get(job.id) || []).join('\n'));
    el.append(pre);
    queueMicrotask(() => { pre.scrollTop = pre.scrollHeight; });
  }
  return el;
}

function metaText(job) {
  if (job.status === 'running' && job.startedAt) return `Running for ${fmtElapsed(Date.now() - job.startedAt)}`;
  if (job.finishedAt && job.startedAt) return `Took ${fmtElapsed(job.finishedAt - job.startedAt)}`;
  if (job.mode !== 'recreate' || job.instruction) return job.instruction ? `Note: ${job.instruction}` : '';
  return 'Added ' + fmtDate(job.createdAt);
}

function renderJobs() {
  const box = $('#jobs');
  const rank = { running: 0, waiting: 1, queued: 2 };
  const list = [...state.jobs.values()].sort((a, b) => {
    const ra = rank[a.status] ?? 9; const rb = rank[b.status] ?? 9;
    return ra - rb || (ra === 9 ? (b.finishedAt || 0) - (a.finishedAt || 0) : a.createdAt - b.createdAt);
  }).slice(0, 8);
  box.replaceChildren(...(list.length
    ? list.map(jobEl)
    : [h('p', { class: 'empty' }, 'Nothing running. Start something above, or open a past run on the right.')]));
  renderPills();
}

function onJobEvent(job) {
  const prev = state.jobs.get(job.id);
  state.jobs.set(job.id, { ...(prev || {}), ...job });
  if (job.status === 'done' && job.runId && prev?.status !== 'done') {
    toast(job.runKind === 'design' ? `Done — ${plural(job.imageCount ?? 0, 'design')} in Canva.` : `Done — ${plural(job.imageCount ?? 0, 'image')}.`);
    refreshRuns().then(() => openRun(job.runId, true, job.runKind));
  } else if (job.status === 'failed' && prev?.status !== 'failed') {
    toast('A job failed — see the log for details.');
  } else if (job.status === 'stopped' && prev?.status !== 'stopped') {
    toast('Job stopped.');
  }
  renderJobs();
}
function onLogEvent({ id, line }) {
  const lines = state.logs.get(id) || [];
  const hadLog = lines.length > 0;
  lines.push(line);
  if (lines.length > 2000) lines.shift();
  state.logs.set(id, lines);
  if (!hadLog) { renderJobs(); return; }          // first line: the "Show log" toggle must appear
  const pre = $(`[data-log="${id}"]`);
  if (pre) {
    const stick = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
    pre.append(document.createTextNode('\n' + line));
    if (stick) pre.scrollTop = pre.scrollHeight;
  }
}

function connectEvents() {
  const es = new EventSource('/api/events');
  es.addEventListener('job', (e) => onJobEvent(JSON.parse(e.data)));
  es.addEventListener('log', (e) => onLogEvent(JSON.parse(e.data)));
  es.addEventListener('design', (e) => {
    const { id } = JSON.parse(e.data);
    if (state.runKind === 'design' && state.runId === id) openRun(id, false, 'design');
    refreshRuns();
  });
  es.addEventListener('open', () => { loadJobs(); loadStatus(); });
}

async function loadJobs() {
  try {
    const { jobs } = await api('/api/jobs');
    for (const j of jobs) {
      const { log, ...rest } = j;
      state.jobs.set(j.id, rest);
      if (!state.logs.has(j.id) || state.logs.get(j.id).length < log.length) state.logs.set(j.id, log);
    }
    renderJobs();
  } catch { /* the pills will show it's unreachable */ }
}
async function loadStatus() {
  try { state.status = await api('/api/status'); } catch { state.status = null; }
  renderPills();
}

/* ---------------------------------------------------------------- viewer */
function viewerEmpty(loading) {
  return [h('div', { class: 'viewer-empty' },
    h('h2', null, loading ? 'Loading…' : 'Your results show up here'),
    h('p', null, loading ? '' : 'Create something on the left, or open any past run below.'))];
}

function shotEl(im, items) {
  const idx = items.indexOf(im);
  const flag = im.passed ? h('span', { class: 'shot-flag' }, '★ Reviewer pick') : null;
  return h('figure', { class: 'shot', style: null },
    h('button', {
      type: 'button', class: 'shot-img', 'aria-label': `Open ${im.name} full size`,
      onclick: () => openLightbox(items, idx),
    }, h('img', { src: im.url, alt: `${im.engine || 'Generated'} render: ${im.name}`, loading: 'lazy' }), flag),
    h('figcaption', { class: 'shot-foot' },
      h('div', { class: 'shot-row' },
        h('span', { class: 'shot-engine' }, im.engine || ''),
        h('a', { class: 'btn btn-ghost btn-small', href: `${im.url}${im.url.includes('?') ? '&' : '?'}download=1`, download: im.name }, 'Download')),
      !im.passed && im.reason ? h('details', { class: 'shot-reason' },
        h('summary', null, 'Didn’t fully pass review'),
        h('p', null, im.reason)) : null));
}

function promptEl(p) {
  if (!p.body) return null;
  return h('details', { class: 'prompt' },
    h('summary', null, 'View the prompt'),
    h('div', { class: 'prompt-body' },
      h('pre', null, p.body),
      h('button', {
        type: 'button', class: 'btn btn-ghost btn-small',
        onclick: async () => {
          try { await navigator.clipboard.writeText(p.body); toast('Prompt copied.'); } catch { toast('Couldn\'t copy — select the text instead.'); }
        },
      }, 'Copy prompt')));
}

/** A Canva design run: reference → Kapruka design in Canva → final pulled back. */
function renderDesign(v, d) {
  const finals = d.variants.filter((x) => x.final).length;
  const inCanva = d.variants.filter((x) => x.editUrl).length;
  const head = h('div', { class: 'viewer-head' },
    h('h2', { class: 'viewer-title' }, d.label),
    h('div', { class: 'badges' },
      h('span', { class: 'badge brand' }, 'Canva design'),
      h('span', { class: 'badge' }, fmtDate(d.at)),
      h('span', { class: 'badge' }, `${plural(inCanva, 'design')} in Canva`),
      finals ? h('span', { class: 'badge ok' }, `${plural(finals, 'final')} pulled back`) : null,
      d.source ? h('a', { class: 'badge', href: d.source, target: '_blank', rel: 'noopener noreferrer' }, 'Source post ↗') : null),
    d.instruction ? h('p', { class: 'note' }, h('b', null, 'Creative note: '), d.instruction) : null,
    d.error ? h('p', { class: 'err' }, `This run stopped early: ${d.error}`) : null);
  const parts = [head];

  if (d.reference.length) {
    parts.push(h('section', { class: 'section' },
      h('h3', { class: 'section-title' }, 'Reference'),
      h('div', { class: 'ref-row' }, d.reference.map((u, i) => h('img', {
        src: u, alt: `Reference ${i + 1}`, loading: 'lazy',
        onclick: () => openLightbox(d.reference.map((url, n) => ({ url, name: `reference-${n + 1}`, engine: 'Reference' })), i),
      })))));
  }

  // The idea behind the design — what the reference means and how Kapruka says it.
  const kc = d.concept?.kapruka_concept;
  if (kc?.one_line) {
    parts.push(h('section', { class: 'section' },
      h('h3', { class: 'section-title' }, 'The idea'),
      h('p', null, h('b', null, kc.one_line)),
      d.concept.reference_idea ? h('p', { class: 'note' }, h('b', null, 'Reference meant: '), d.concept.reference_idea) : null,
      kc.hook ? h('p', { class: 'note' }, h('b', null, 'Audience hook: '), kc.hook) : null,
      kc.visual ? h('p', { class: 'note' }, h('b', null, 'Picture: '), kc.visual) : null,
      kc.why_it_makes_sense ? h('p', { class: 'note' }, kc.why_it_makes_sense) : null,
      (d.concept.warnings || []).length ? h('p', { class: 'note' }, h('b', null, 'Check: '), d.concept.warnings.join(' · ')) : null));
  }

  const box = h('section', { class: 'section' }, h('h3', { class: 'section-title' }, 'Designs'));
  if (!d.variants.length) box.append(h('p', { class: 'empty' }, 'No design was made in this run.'));
  const grid = h('div', { class: 'variants' });
  for (const x of d.variants) {
    const pics = [x.preview && { url: x.preview, label: 'As sent to Canva', cls: '' }, x.final && { url: x.final, label: 'Final from Canva', cls: 'final' }].filter(Boolean);
    const lightItems = pics.map((p) => ({ url: p.url, name: p.label, engine: x.engine }));
    const btnPull = h('button', { type: 'button', class: 'btn btn-ghost btn-small' }, x.final ? 'Pull again from Canva' : 'Pull final from Canva');
    btnPull.addEventListener('click', async () => {
      btnPull.disabled = true;
      btnPull.textContent = 'Pulling from Canva…';
      try {
        state.detail = await api(`/api/designs/${encodeURIComponent(d.id)}/final`, { method: 'POST', body: JSON.stringify({ variant: x.index }) });
        renderViewer();
        toast('Final pulled from Canva.');
        refreshRuns();
      } catch (e) {
        toast(e.message);
        btnPull.disabled = false;
        btnPull.textContent = 'Pull final from Canva';
      }
    });
    // Not in Canva yet (the import failed): show the picture layer, and offer a re-send.
    if (!pics.length && x.scene) pics.push({ url: x.scene, label: 'Picture layer (not in Canva yet)', cls: '' });
    let btnRetry = null;
    if (x.canRetry) {
      btnRetry = h('button', { type: 'button', class: 'btn btn-canva btn-small' }, 'Retry sending to Canva');
      btnRetry.addEventListener('click', async () => {
        btnRetry.disabled = true;
        btnRetry.textContent = 'Sending to Canva…';
        try {
          state.detail = await api(`/api/designs/${encodeURIComponent(d.id)}/retry-canva`, { method: 'POST', body: '{}' });
          renderViewer();
          toast('Sent to Canva.');
          refreshRuns();
        } catch (e) {
          toast(e.message);
          btnRetry.disabled = false;
          btnRetry.textContent = 'Retry sending to Canva';
        }
      });
    }
    grid.append(h('div', { class: 'variant' },
      pics.length ? h('div', { class: `variant-pair${pics.length === 1 ? ' single' : ''}` }, pics.map((p, i) => h('figure', null,
        h('img', { src: p.url, alt: p.label, loading: 'lazy', onclick: () => openLightbox(lightItems, i) }),
        h('figcaption', { class: p.cls }, p.label)))) : null,
      h('div', { class: 'variant-foot' },
        h('span', { class: 'shot-engine' }, `Picture by ${x.engine}${x.finalAt ? ` · final ${fmtDate(Date.parse(x.finalAt))}` : ''}`),
        x.check ? h('ul', { class: 'checks' },
          h('li', { class: x.check.paintedText?.length ? 'bad' : 'ok' }, x.check.paintedText?.length
            ? `Text/logos still painted in the picture: ${x.check.paintedText.join(' · ')}` : `No text or logos painted in the picture${x.attempts > 1 ? ' (fixed on the 2nd try)' : ''}`),
          x.check.clash?.length ? h('li', { class: 'bad' }, `Picture objects run into: "${x.check.clash.join('", "')}" — move or resize in Canva`) : null,
          x.check.watermarkCropped ? h('li', { class: 'ok' }, 'AI watermark cropped off') : null,
          x.check.watermarkLeft ? h('li', { class: 'bad' }, 'AI watermark found away from the edge — remove it in Canva') : null,
          x.check.packagingLogos ? h('li', { class: 'ok' }, `Real Kapruka logo placed on ${plural(x.check.packagingLogos, 'bag/box')} as a Canva layer`) : null,
          x.check.notes ? h('li', { class: 'note-li' }, `Checker: ${x.check.notes}`) : null) : null,
        x.review ? h('div', { class: `review review-${x.review.verdict}` },
          h('b', null, x.review.verdict === 'production-ready' ? '✓ Art director: production-ready'
            : x.review.verdict === 'minor-fixes' ? 'Art director: minor fixes before posting' : 'Art director: not ready yet'),
          x.review.issues?.length ? h('ul', null, x.review.issues.map((i) => h('li', { class: `sev-${i.severity}` },
            h('span', null, i.what), i.fix_in_canva ? h('span', { class: 'fix' }, ` → ${i.fix_in_canva}`) : null))) : null) : null,
        x.polish && (x.polish.applied?.length || x.polish.needsNewPicture || x.polish.unfixable?.length) ? h('div', { class: 'review' },
          x.polish.applied?.length ? h('p', null, h('b', null, `Auto-fixed (${x.polish.rounds} round${x.polish.rounds === 1 ? '' : 's'}): `), x.polish.applied.join(' · ')) : null,
          x.polish.needsNewPicture ? h('p', null, h('b', null, 'Needs a new picture: '), x.polish.needsNewPicture) : null,
          x.polish.unfixable?.length ? h('p', { class: 'note' }, h('b', null, 'Left for you: '), x.polish.unfixable.join(' · ')) : null) : null,
        x.canvaError ? h('p', { class: 'err' }, `Canva: ${x.canvaError}`) : null,
        h('div', { class: 'variant-actions' },
          btnRetry,
          x.editUrl ? h('a', { class: 'btn btn-canva btn-small', href: x.editUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Edit in Canva ↗') : null,
          x.editUrl ? btnPull : null,
          x.final ? h('a', { class: 'btn btn-ghost btn-small', href: `${x.final}&download=1`, download: x.finalName || 'final.png' }, 'Download final') : null))));
  }
  if (d.variants.length) box.append(grid);
  parts.push(box);

  const facts = [];
  if (d.copy.length) facts.push(h('div', { class: 'fact' }, h('b', null, 'Kapruka copy (editable in Canva)'),
    h('ul', null, d.copy.map((c) => h('li', { class: 'copy-line' }, `${c.role ? `${c.role}: ` : ''}${c.text}`)))));
  if (d.changes.length) facts.push(h('div', { class: 'fact' }, h('b', null, 'What Ashadi changed from the reference'),
    h('ul', null, d.changes.map((c) => h('li', null, c)))));
  if (d.claims.length) facts.push(h('div', { class: 'fact' }, h('b', null, 'Claims used (checked against business context)'),
    h('ul', null, d.claims.map((c) => h('li', null, typeof c === 'string' ? c : JSON.stringify(c))))));
  if (facts.length) parts.push(h('section', { class: 'section' }, h('h3', { class: 'section-title' }, 'Details'), h('div', { class: 'facts' }, facts)));
  if (d.scenePrompt) parts.push(promptEl({ body: d.scenePrompt }));
  v.replaceChildren(...parts);
}

function renderViewer() {
  const v = $('#viewer');
  const d = state.detail;
  if (!d) { v.replaceChildren(...viewerEmpty(!!state.runId)); return; }
  if (d.kind === 'design') { renderDesign(v, d); return; }

  const picks = d.images.filter((i) => i.passed).length;
  const title = d.mode === 'recreate'
    ? h('a', { href: d.source, target: '_blank', rel: 'noopener noreferrer' }, `Recreation of ${d.label}`)
    : `${MODES[d.mode].noun} ${d.label}`;
  const items = d.images;
  const head = h('div', { class: 'viewer-head' },
    h('h2', { class: 'viewer-title' }, title),
    h('div', { class: 'badges' },
      h('span', { class: 'badge brand' }, MODE_ICON[d.mode]),
      h('span', { class: 'badge' }, fmtDate(d.at)),
      h('span', { class: 'badge' }, plural(d.images.length, 'image')),
      picks ? h('span', { class: 'badge ok' }, plural(picks, 'reviewer pick')) : null,
      d.images.length && !picks ? h('span', { class: 'badge warn' }, 'No image fully passed review') : null),
    d.instruction ? h('p', { class: 'note' }, h('b', null, 'Creative note: '), d.instruction) : null);

  const parts = [head];

  if (d.reference.length) {
    parts.push(h('section', { class: 'section' },
      h('h3', { class: 'section-title' }, d.reference.length > 1 ? 'Reference slides' : 'Reference'),
      h('div', { class: 'ref-row' }, d.reference.map((u, i) => h('img', {
        src: u, alt: `Reference slide ${i + 1}`, loading: 'lazy',
        onclick: () => openLightbox(d.reference.map((url, n) => ({ url, name: `reference-${n + 1}`, engine: 'Reference' })), i),
      }))),
      d.caption ? h('p', { class: 'caption' }, d.caption) : null));
  }

  // Group renders under the prompt that produced them.
  const byPrompt = new Map();
  for (const im of d.images) {
    const k = im.promptIndex || 0;
    if (!byPrompt.has(k)) byPrompt.set(k, []);
    byPrompt.get(k).push(im);
  }
  const promptByIdx = new Map(d.prompts.map((p) => [p.index, p]));
  const keys = [...new Set([...d.prompts.map((p) => p.index), ...byPrompt.keys()])].sort((a, b) => a - b);

  const results = h('section', { class: 'section' }, h('h3', { class: 'section-title' }, 'Results'));
  if (!d.images.length) results.append(h('p', { class: 'empty' }, 'This run has no saved images.'));
  for (const k of keys) {
    const p = promptByIdx.get(k);
    const ims = byPrompt.get(k) || [];
    if (!ims.length && !p) continue;
    results.append(h('div', { class: 'group' },
      p ? h('h4', { class: 'group-title' }, h('span', { class: 'num' }, `Prompt ${p.index}`), shortTitle(p.title)) : null,
      ims.length ? h('div', { class: 'images' }, ims.map((im) => shotEl(im, items))) : h('p', { class: 'empty' }, 'No image was generated for this prompt.'),
      p ? promptEl(p) : null));
  }
  parts.push(results);
  v.replaceChildren(...parts);
}

async function openRun(id, scroll, kind = 'run') {
  state.runId = id;
  state.runKind = kind;
  state.detail = null;
  renderViewer();
  renderRuns();
  try {
    const d = await api(`/api/${kind === 'design' ? 'designs' : 'runs'}/${encodeURIComponent(id)}`);
    if (state.runId !== id || state.runKind !== kind) return;   // user clicked something else meanwhile
    state.detail = d;
    renderViewer();
    if (scroll) $('#viewer').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  } catch (e) {
    state.runId = null;
    renderViewer();
    toast(e.message);
  }
}

/* ---------------------------------------------------------------- past runs */
function renderRuns() {
  const box = $('#runs');
  const all = state.runs;
  const filtered = state.runsFilter === 'all' ? all : all.filter((r) => r.mode === state.runsFilter);
  $('#runs-count').textContent = all.length ? `· ${all.length}` : '';
  const shown = filtered.slice(0, state.runsShown);
  box.replaceChildren(...(shown.length ? shown.map((r) => h('button', {
    type: 'button', class: 'run', 'aria-current': r.id === state.runId && (r.kind || 'run') === state.runKind ? 'true' : null,
    onclick: () => openRun(r.id, true, r.kind || 'run'),
  },
  r.thumb ? h('img', { class: 'run-thumb', src: r.thumb, alt: '', loading: 'lazy' }) : h('span', { class: 'run-thumb none' }, 'No image'),
  h('span', { class: 'run-info' },
    h('span', { class: 'run-label', title: r.label }, r.mode === 'recreate' || r.mode === 'design' ? r.label : `${MODES[r.mode].noun} ${r.label}`),
    h('span', { class: 'run-meta' }, r.kind === 'design'
      ? `${fmtDate(r.at)} · ${r.error ? 'stopped early' : `${r.imageCount} in Canva${r.finals ? ` · ${r.finals} final` : ''}`}`
      : `${fmtDate(r.at)} · ${plural(r.imageCount, 'image')}`)))) : [h('p', { class: 'empty' }, all.length ? 'No runs of this type yet.' : 'No past runs found.')]));
  const more = $('#runs-more');
  more.hidden = filtered.length <= state.runsShown;
  more.textContent = `Show more (${filtered.length - state.runsShown} left)`;
}

async function refreshRuns() {
  const [runs, designs] = await Promise.all([
    api('/api/runs').then((r) => r.runs.map((x) => ({ ...x, kind: 'run' }))).catch(() => []),
    api('/api/designs').then((r) => r.designs).catch(() => []),
  ]);
  state.runs = [...designs, ...runs].sort((a, b) => b.at - a.at);
  renderRuns();
}

$('#run-filters').addEventListener('click', (e) => {
  const c = e.target.closest('.chip');
  if (!c) return;
  state.runsFilter = c.dataset.filter;
  state.runsShown = 24;
  for (const b of $('#run-filters').querySelectorAll('.chip')) b.setAttribute('aria-pressed', b === c ? 'true' : 'false');
  renderRuns();
});
$('#runs-more').addEventListener('click', () => { state.runsShown += 24; renderRuns(); });

/* ---------------------------------------------------------------- lightbox */
const lb = $('#lightbox');
function showLightbox() {
  const { items, index } = state.lightbox;
  const im = items[index];
  if (!im) return;
  $('#lb-img').src = im.url;
  $('#lb-img').alt = im.name || '';
  $('#lb-caption').textContent = `${index + 1} / ${items.length} — ${im.engine || ''}${im.passed ? ' · reviewer pick' : ''}`;
  const dl = $('#lb-download');
  dl.href = `${im.url}${im.url.includes('?') ? '&' : '?'}download=1`;
  dl.setAttribute('download', im.name || 'image');
  $('#lb-prev').disabled = index === 0;
  $('#lb-next').disabled = index === items.length - 1;
}
function openLightbox(items, index) {
  state.lightbox = { items, index };
  showLightbox();
  if (!lb.open) lb.showModal();
}
function stepLightbox(d) {
  const n = state.lightbox.index + d;
  if (n < 0 || n >= state.lightbox.items.length) return;
  state.lightbox.index = n;
  showLightbox();
}
$('#lb-close').addEventListener('click', () => lb.close());
$('#lb-prev').addEventListener('click', () => stepLightbox(-1));
$('#lb-next').addEventListener('click', () => stepLightbox(1));
lb.addEventListener('click', (e) => { if (e.target === lb || e.target.classList.contains('lb-stage')) lb.close(); });
lb.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') stepLightbox(-1);
  else if (e.key === 'ArrowRight') stepLightbox(1);
});

/* ---------------------------------------------------------------- boot */
{
  // Back from the Canva sign-in page (/canva/callback redirects here).
  const q = new URLSearchParams(location.search);
  if (q.get('canva') === 'connected') toast('Canva connected.');
  else if (q.get('canva') === 'error') toast(`Canva didn't connect: ${q.get('reason') || 'unknown error'}`);
  if (q.has('canva')) history.replaceState(null, '', '/');
}
fillCounts();
setMode(state.mode);
renderJobs();
renderViewer();
Promise.all([loadStatus(), loadJobs(), refreshRuns()]).then(() => {
  connectEvents();
  // Open the most recent run so the page isn't empty on first load.
  const live = [...state.jobs.values()].find((j) => j.status === 'done' && j.runId);
  if (live) openRun(live.runId, false, live.runKind || 'run');
  else if (state.runs[0]) openRun(state.runs[0].id, false, state.runs[0].kind || 'run');
});
setInterval(loadStatus, 15_000);
// Keep "Running for 1m 20s" ticking without re-rendering the whole list.
setInterval(() => {
  for (const j of state.jobs.values()) {
    if (j.status !== 'running' || !j.startedAt) continue;
    const el = $(`[data-meta="${j.id}"]`);
    if (el) el.textContent = metaText(j);
  }
}, 1000);
