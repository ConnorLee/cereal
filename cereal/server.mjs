import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from './lib/store.mjs';
import { Engine } from './lib/engine.mjs';
import { projectDefs } from './lib/projects.mjs';
import { showCommit } from './lib/git.mjs';
import { isSecretPath, containsSecret } from './lib/safety.mjs';
import { tildify } from './lib/paths.mjs';
import { outlineSummary, claudeSummary } from './lib/summary.mjs';
import { BriefingStore, mailerFor, saveMailConfig, clearMailConfig, briefingStatus, applySettings, composeBriefing, deliver, startVerification, briefingInputs, briefingNews, newsTopics, confirmVerification, checkToken } from './lib/briefing-delivery.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 4317);
const HOST = '127.0.0.1';
const POLL_MS = Number(process.env.CEREAL_POLL_MS || 15000);

const store = new Store();
const engine = new Engine(store, projectDefs());
const briefings = new BriefingStore(store.dir);
// Rebuilt when the provider is changed in the app, so the scheduler picks it up without a restart.
let mailer = mailerFor(process.env, store.dir);
// Links in the email open this Mac's Cereal. Set CEREAL_APP_URL if Cereal is reachable at another address.
const APP_URL = (process.env.CEREAL_APP_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const previews = new Map(); // recent preview id -> link table, so links inside a preview open too

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json; charset=utf-8' };

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 1e6) throw Object.assign(new Error('Body too large'), { status: 413 }); }
  // Forms on the pause and unsubscribe pages, and one-click unsubscribe from mail providers, post as forms.
  if (/x-www-form-urlencoded/.test(req.headers['content-type'] || '')) return Object.fromEntries(new URLSearchParams(raw));
  return raw ? JSON.parse(raw) : {};
}

function run(cmd, args, timeout = 120000) {
  return new Promise((resolve) => execFile(cmd, args, { timeout }, (err, stdout) => resolve(err ? null : stdout.toString().trim())));
}

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler });

route('GET', '/api/state', async () => ({
  projects: engine.portfolio(),
  runtimes: engine.runtimes,
  unresolved: engine.unresolved,
  notifications: store.data.notifications.slice(-20),
  ui: store.data.ui,
  claude: !!process.env.ANTHROPIC_API_KEY,
}));

route('GET', '/api/edition', async () => engine.edition());
route('GET', '/api/projects/:id/discovery', async ({ id }) => store.project(engine.def(id).id).discovery || engine.discover(id));
route('POST', '/api/projects/:id/discover', async ({ id }) => engine.discover(id));

route('POST', '/api/pick-folder', async () => {
  const picked = await run('osascript', ['-e', 'POSIX path of (choose folder with prompt "Choose your project’s folder")'], 300000);
  return picked ? { path: picked.replace(/\/$/, '') } : { cancelled: true };
});

route('POST', '/api/projects', async (_p, body) => engine.addProject(String(body.name || ''), String(body.path || '').replace(/^~(?=\/|$)/, process.env.HOME).replace(/\/$/, '')));

route('POST', '/api/projects/:id/pick-folder', async ({ id }) => {
  // Native macOS folder picker. The user chooses; Cereal never browses on its own.
  const def = engine.def(id);
  const picked = await run('osascript', ['-e', `POSIX path of (choose folder with prompt "Choose a folder for ${def.name}")`], 300000);
  if (!picked) return { cancelled: true };
  return { candidate: await engine.addFolder(id, picked.replace(/\/$/, '')) };
});

route('POST', '/api/projects/:id/add-folder', async ({ id }, body) => ({ candidate: await engine.addFolder(id, String(body.path || '').replace(/\/$/, '')) }));

route('POST', '/api/projects/:id/approve', async ({ id }, body) => {
  const ids = Array.isArray(body.candidateIds) ? body.candidateIds.map(String) : [];
  const job = engine.approve(id, ids);
  if (body.wait) return job;
  job.catch((e) => console.error('index failed', id, e));
  return { started: true };
});

route('GET', '/api/projects/:id/retained', async ({ id }) => engine.retained(engine.def(id).id));
route('POST', '/api/projects/:id/forget', async ({ id }, body) => {
  // Deleting derived context is a deliberate user action, confirmed in the UI.
  if (body.confirm !== true) throw Object.assign(new Error('Confirmation required'), { status: 400 });
  return engine.forget(engine.def(id).id);
});

route('POST', '/api/projects/:id/reindex', async ({ id }) => engine.index(engine.def(id).id));
route('GET', '/api/projects/:id/capsule', async ({ id }) => engine.capsule(engine.def(id).id));
route('POST', '/api/projects/:id/enter', async ({ id }) => engine.enter(engine.def(id).id));
route('POST', '/api/projects/:id/workspace', async ({ id }, body) => engine.saveWorkspace(engine.def(id).id, {
  tab: typeof body.tab === 'string' ? body.tab : undefined,
  focus: body.focus && typeof body.focus === 'object' ? body.focus : undefined,
  drawer: body.drawer === null || (body.drawer && typeof body.drawer === 'object') ? body.drawer : undefined,
  scroll: typeof body.scroll === 'number' ? body.scroll : undefined,
}, { leave: body.leave === true }));

route('GET', '/api/projects/:id/doc/:docId', async ({ id, docId }) => {
  const doc = engine.docById(engine.def(id).id, docId);
  if (!doc) {
    const blocked = (store.project(id).index?.unavailable || []).some((u) => u.code === 'blocked');
    throw Object.assign(new Error(blocked ? 'This document isn’t available while macOS blocks its folder.' : 'This document is no longer in the index. Re-index to refresh it.'), { status: 404 });
  }
  if (isSecretPath(doc.path)) throw Object.assign(new Error('Refused'), { status: 403 });
  const text = await fs.readFile(doc.path, 'utf8').catch(() => null);
  if (text == null) return { ...doc, missing: true, text: '' };
  if (containsSecret(text)) return { ...doc, text: '', refused: 'This file now appears to contain a credential, so Cereal will not display it.' };
  return { ...doc, text: text.slice(0, 200000), display: tildify(doc.path) };
});

// Summarize one document. With an API key, Claude reads this document only, on your click; without one,
// the summary is built from the document's own structure.
route('POST', '/api/projects/:id/doc/:docId/summary', async ({ id, docId }, body) => {
  const doc = engine.docById(engine.def(id).id, docId);
  if (!doc || isSecretPath(doc.path)) throw Object.assign(new Error('This document isn’t available.'), { status: 404 });
  const text = await fs.readFile(doc.path, 'utf8').catch(() => null);
  if (text == null) throw Object.assign(new Error('This file is no longer on disk. Refresh the project.'), { status: 404 });
  if (containsSecret(text)) throw Object.assign(new Error('This file appears to contain a credential, so Cereal won’t summarize it.'), { status: 403 });
  const outline = outlineSummary(text);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || body.mode === 'outline') return { ...outline, claude: !!key };
  try {
    return { ...outline, ...(await claudeSummary(text, doc.title, { key, model: process.env.CEREAL_MODEL || 'claude-sonnet-5-5' })), claude: true };
  } catch (e) {
    return { ...outline, claude: true, claudeError: e.message };
  }
});

route('GET', '/api/projects/:id/commit/:sha', async ({ id, sha }, _b, url) => {
  const repo = url.searchParams.get('repo');
  if (!engine.ownsRepo(engine.def(id).id, repo)) throw Object.assign(new Error('Repository is not an approved source of this project'), { status: 403 });
  const out = await showCommit(repo, sha);
  if (!out) throw Object.assign(new Error('Commit not found'), { status: 404 });
  return { sha, repo, text: out.slice(0, 60000) };
});

route('GET', '/api/projects/:id/session/:sid', async ({ id, sid }) => {
  const s = engine.sessionById(engine.def(id).id, sid);
  if (!s) throw Object.assign(new Error('Session is not attributed to this project'), { status: 404 });
  return s;
});

// Images from project repos are served inert: SVG can't run script, and browsers must not sniff types.
function sendImage(res, img) {
  if (!img) { send(res, 404, { error: 'No image' }); return null; }
  res.writeHead(200, { 'content-type': img.type, 'cache-control': 'max-age=3600', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
  res.end(img.buf);
  return null;
}
route('GET', '/api/projects/:id/icon', async ({ id }, _b, _u, res) => sendImage(res, await engine.iconBytes(engine.def(id).id)));
route('GET', '/api/projects/:id/wordmark', async ({ id }, _b, _u, res) => sendImage(res, await engine.wordmarkBytes(engine.def(id).id)));
route('GET', '/api/projects/:id/hero/:i', async ({ id, i }, _b, _u, res) => sendImage(res, await engine.heroBytes(engine.def(id).id, i)));

route('POST', '/api/projects/:id/reveal', async ({ id }, body) => {
  // Reveal in Finder only. A user click, inside an approved source; never opens or runs files.
  const target = String(body.path || '');
  if (!engine.ownsPath(engine.def(id).id, target)) throw Object.assign(new Error('Path is outside this project’s approved sources'), { status: 403 });
  await run('open', ['-R', target], 10000);
  return { ok: true };
});

route('GET', '/api/notifications', async (_p, _b, url) => {
  const after = Number(url.searchParams.get('after') || 0);
  return { notifications: store.data.notifications.filter((n) => n.id > after), runtimes: engine.runtimes };
});

route('POST', '/api/refresh', async () => {
  await engine.refreshAgents();
  await engine.checkGitHeads();
  return { runtimes: engine.runtimes };
});

route('POST', '/api/projects/:id/brief', async ({ id }) => {
  // Optional Claude synthesis. Sends only this project's capsule facts — never files or other projects.
  const c = engine.capsule(engine.def(id).id);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { available: false, reason: 'Set ANTHROPIC_API_KEY to let Claude write a narrative briefing. The source-linked capsule works without it.' };
  const facts = [...c.leftOff, ...c.changed, ...c.attention, ...c.decisions.slice(0, 6)].map((f, i) => `[${i + 1}] (${f.kind}) ${f.text}${f.detail ? ' — ' + String(f.detail).slice(0, 200) : ''}`).join('\n');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.CEREAL_MODEL || 'claude-sonnet-5-5', max_tokens: 500, messages: [{ role: 'user', content: `You are briefing a developer returning to the project "${c.name}". Using ONLY the numbered facts below, write 3-5 short sentences: where they left off, what changed, what needs their judgment. Cite facts as [n]. Do not add anything not in the facts.\n\n${facts}` }] }),
  });
  const j = await r.json();
  if (!r.ok) return { available: false, reason: j.error?.message || `Claude API error ${r.status}` };
  return { available: true, text: j.content?.map((x) => x.text).join('') || '', model: j.model };
});

// ---------- Morning briefing ----------

// Each project's news topics: the reader's own, or suggestions from its description (shown, never sent until news is on).
const briefingProjects = () => {
  const settings = briefings.read().settings;
  return engine.defs.map((d) => {
    const connected = store.project(d.id).sources.length > 0;
    const topics = connected ? newsTopics(settings, { def: d, capsule: engine.capsule(d.id) }) : [];
    return { id: d.id, name: d.name, connected, accent: d.brand?.accent, newsTopics: topics, newsTopicsCustom: !!settings.news?.topics?.[d.id] };
  });
};
route('GET', '/api/briefing', async () => ({ ...briefingStatus(briefings.read(), { mailer }), projects: briefingProjects() }));
route('POST', '/api/briefing/settings', async (_p, body) => {
  const ids = engine.defs.map((d) => d.id);
  briefings.update((d) => { d.settings = applySettings(d.settings, body, { projectIds: ids }); });
  return { ...briefingStatus(briefings.read(), { mailer }), projects: briefingProjects() };
});
route('POST', '/api/briefing/verify', async (_p, body) => startVerification({ bstore: briefings, mailer, email: String(body.email || '').trim() }));
route('POST', '/api/briefing/verify/confirm', async (_p, body) => ({ settings: confirmVerification({ bstore: briefings, code: body.code }) }));
route('POST', '/api/briefing/mail', async (_p, body) => {
  saveMailConfig(store.dir, { key: body.key, from: body.from });
  mailer = mailerFor(process.env, store.dir);
  return { ...briefingStatus(briefings.read(), { mailer }), projects: briefingProjects() };
});
route('POST', '/api/briefing/mail/clear', async () => {
  clearMailConfig(store.dir);
  mailer = mailerFor(process.env, store.dir);
  return { ...briefingStatus(briefings.read(), { mailer }), projects: briefingProjects() };
});
route('GET', '/api/briefing/preview', async () => {
  const data = briefings.read();
  const inputs = briefingInputs(engine, data.settings);
  const news = await briefingNews({ bstore: briefings, data, inputs }).catch(() => null);
  const { id, briefing, email, linkTable } = composeBriefing({ engine, data: briefings.read(), appUrl: APP_URL, provider: mailer.label, inputs, news });
  previews.set(id, linkTable);
  for (const k of [...previews.keys()].slice(0, -5)) previews.delete(k);
  const { snapshot, ...shown } = briefing;
  return { id, subject: email.subject, preheader: email.preheader, html: email.html, text: email.text, briefing: shown };
});
route('POST', '/api/briefing/test', async () => deliver({ engine, bstore: briefings, mailer, appUrl: APP_URL, kind: 'test' }));
route('GET', '/api/briefing/history/:hid', async ({ hid }) => {
  const h = briefings.read().history.find((x) => x.id === hid);
  if (!h) throw Object.assign(new Error('That briefing is no longer kept.'), { status: 404 });
  return { id: h.id, subject: h.subject, at: h.sentAt, kind: h.kind, status: h.status, html: h.html };
});
route('GET', '/api/briefing/open/:bid/:n', async ({ bid, n }) => {
  const table = previews.get(bid) || briefings.read().history.find((x) => x.id === bid)?.linkTable;
  const hit = table?.[n];
  if (!hit) throw Object.assign(new Error('That link has expired.'), { status: 404 });
  return hit;
});
// Links in the email: a GET shows a page with one button (so link scanners can't act); the POST does it.
const briefingPage = (title, body) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Cereal</title><body style="margin:0;background:#FBFBFC;color:#17161B;font:17px/1.55 -apple-system,Helvetica,Arial,sans-serif"><main style="max-width:520px;margin:12vh auto;padding:0 24px"><p style="font-size:24px;font-weight:600;letter-spacing:-.5px;margin:0 0 28px">cereal<span style="color:#6E5FE8">.</span></p>${body}</main></body>`;
for (const action of ['pause', 'unsubscribe']) {
  const verb = action === 'pause' ? 'Pause the morning briefing' : 'Unsubscribe from the morning briefing';
  route('GET', `/api/briefing/${action}`, async (_p, _b, url, res) => {
    const token = url.searchParams.get('token') || '';
    const ok = checkToken(briefings.read().secret, action, token);
    send(res, ok ? 200 : 400, briefingPage(verb, ok
      ? `<h1 style="font-size:32px;line-height:1.15;letter-spacing:-1px;font-weight:500;margin:0 0 12px">${verb}?</h1><p style="color:#48464F">${action === 'pause' ? 'No briefings until you resume them in Cereal. Your settings stay as they are.' : 'Cereal stops emailing you. You can turn the briefing back on in Cereal at any time.'}</p><form method="post"><input type="hidden" name="token" value="${token.replace(/[^\w-]/g, '')}"><button style="margin-top:16px;font:600 16px -apple-system,Helvetica,Arial,sans-serif;padding:12px 22px;border:0;border-radius:999px;background:#17161B;color:#fff;cursor:pointer">${action === 'pause' ? 'Pause emails' : 'Unsubscribe'}</button></form>`
      : '<h1 style="font-size:28px;font-weight:500">This link isn’t valid.</h1><p style="color:#48464F">Open Cereal to manage your briefing.</p>'), 'text/html; charset=utf-8');
    return null;
  });
  route('POST', `/api/briefing/${action}`, async (_p, body, _u, res) => {
    if (!checkToken(briefings.read().secret, action, body.token)) { send(res, 400, briefingPage('Not valid', '<h1 style="font-size:28px;font-weight:500">This link isn’t valid.</h1>'), 'text/html; charset=utf-8'); return null; }
    briefings.update((d) => { if (action === 'pause') d.settings.paused = true; else Object.assign(d.settings, { enabled: false, unsubscribed: true }); });
    send(res, 200, briefingPage('Done', `<h1 style="font-size:32px;line-height:1.15;letter-spacing:-1px;font-weight:500;margin:0 0 12px">${action === 'pause' ? 'Briefings paused.' : 'You’re unsubscribed.'}</h1><p style="color:#48464F">${action === 'pause' ? 'Resume any time from Morning Briefing in Cereal.' : 'No more morning emails. You can turn them back on in Cereal.'}</p>`), 'text/html; charset=utf-8');
    return null;
  });
}

// While Cereal is open it checks once a minute; the launchd agent (npm run briefing:launchd) covers the rest.
// Both go through the same claimed delivery window, so a morning is never sent twice.
async function briefingTick() {
  try {
    const r = await deliver({ engine, bstore: briefings, mailer, appUrl: APP_URL, kind: 'scheduled' });
    if (r.ok === false) console.error('briefing send failed:', r.error);
  } catch (e) { console.error('briefing', e.message); }
  setTimeout(briefingTick, 60000).unref();
}

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'Forbidden' });
  try {
    const buf = await fs.readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(buf);
  } catch {
    const buf = await fs.readFile(path.join(PUBLIC, 'index.html'));
    res.writeHead(200, { 'content-type': TYPES['.html'] });
    res.end(buf);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  // Reject cross-origin writes: only this page may drive the API.
  if (req.method !== 'GET' && req.headers.origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.origin)) return send(res, 403, { error: 'Cross-origin request refused' });
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(url.pathname);
    if (!m) continue;
    try {
      const body = req.method === 'POST' ? await readJson(req) : {};
      const params = Object.fromEntries(Object.entries(m.groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]));
      const out = await r.handler(params, body, url, res);
      if (out !== null && !res.headersSent) send(res, 200, out);
    } catch (e) {
      if (!res.headersSent) send(res, e.status || 500, { error: e.message || String(e) });
    }
    return;
  }
  send(res, 404, { error: 'Not found' });
});

async function poll() {
  try {
    await engine.refreshAgents();
    await engine.checkGitHeads();
  } catch (e) {
    console.error('poll failed', e.message);
  }
  setTimeout(poll, POLL_MS).unref();
}

server.listen(PORT, HOST, () => {
  console.log(`Cereal running at http://${HOST}:${PORT}  (data: ${tildify(store.dir)})`);
  // Restore: re-index approved projects in the background; cached capsules serve immediately.
  for (const d of projectDefs()) if (store.project(d.id).sources.length) engine.index(d.id).catch((e) => console.error('index', d.id, e.message));
  poll();
  setTimeout(briefingTick, 20000).unref();
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { store.flush(); process.exit(0); });
