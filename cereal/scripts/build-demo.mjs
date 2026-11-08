// Build a static, try-in-two-minutes demo of Cereal from sample projects.
// The real engine indexes generated Git repos, docs and agent logs; the results ship with the real interface.
// Usage: npm run demo   →   writes cereal/demo/ (open demo/index.html or host it as static files)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { icons, screens, wordmarks, covers, identities } from './demo-art.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CEREAL = path.dirname(HERE);
const OUT = path.join(CEREAL, 'demo');
const NOW = Date.now();
const HOUR = 3600e3;
const ago = (h) => new Date(NOW - h * HOUR);
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cereal-demo-')));
const SHOWN_ROOT = '~/Code';

const write = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
function git(cwd, args, when) {
  const d = (when || new Date(NOW)).toISOString();
  return execFileSync('git', ['-C', cwd, ...args], { env: { ...process.env, GIT_AUTHOR_NAME: 'Sam Rivera', GIT_AUTHOR_EMAIL: 'sam@example.com', GIT_COMMITTER_NAME: 'Sam Rivera', GIT_COMMITTER_EMAIL: 'sam@example.com', GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d } }).toString();
}
function repo(name, files, history) {
  const r = path.join(root, name);
  git(root, ['init', '-q', '-b', 'main', r]);
  for (const [f, s] of Object.entries(files)) write(path.join(r, f), s);
  git(r, ['add', '-A']);
  git(r, ['commit', '-q', '-m', history[0][1]], ago(history[0][0]));
  for (const [h, msg, file] of history.slice(1)) {
    // A history entry either appends a line to a file, or adds a set of files (product screenshots).
    if (file && typeof file === 'object') for (const [f, body] of Object.entries(file)) write(path.join(r, f), body);
    else fs.appendFileSync(path.join(r, file || 'CHANGELOG.md'), `\n- ${msg}\n`);
    git(r, ['add', '-A']);
    git(r, ['commit', '-q', '-m', msg], ago(h));
  }
  // Files carry the date of the last commit that touched the project, as they would on a real disk.
  const last = ago(history.at(-1)[0]);
  const touch = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.name === '.git') continue; const p = path.join(dir, e.name); if (e.isDirectory()) touch(p); else fs.utimesSync(p, last, last); } };
  touch(r);
  return r;
}

// ---------- sample projects ----------
const northwind = repo('northwind', {
  'README.md': '# Northwind\n\nAn offline-first field notes app for botanists who work without signal. Made by Northwind Field Co.\n',
  'Northwind.xcodeproj/project.pbxproj': '// sample\n',
  'brand/app-icon.svg': icons.northwind,
  'brand/wordmark.svg': wordmarks.northwind,
  'docs/DECISIONS.md': '# Northwind decisions\n\n## D01 — Notes sync only on Wi-Fi\n\n- **Date/status:** 2 November 2026; approved.\n- Field teams pay for cellular data themselves.\n\n## D02 — Photo storage format\n\n- **Date/status:** unresolved; HEIC vs JPEG needs reconciliation.\n- HEIC halves storage, but the herbarium importer only reads JPEG.\n\n## D03 — One tap to tag a specimen\n\n- **Date/status:** 30 October 2026; approved.\n',
  'docs/HANDOFF.md': '# Handoff\n\nThe map layer renders field plots. Offline tiles still load slowly on older iPads.\n\n## Open questions\n\n- Unresolved: cap the tile cache at 500 MB or 1 GB?\n- Unresolved: who signs off the herbarium export format?\n',
  'docs/RELEASE.md': `# Release 1.2\n\n**Ship date:** ${new Date(NOW + 2 * 864e5).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}, TestFlight build 14 to the Kew field team.\n`,
  'docs/MARKET.md': '# Market\n\n- TAM: about 1.4 million field botanists, ecologists and conservation volunteers who record plants away from signal.\n- Why now: an iPad can now hold a whole season of offline maps, and herbaria are digitising their intake.\n',
  'docs/TILE_CACHE.md': '# Tile cache\n\n**Purpose:** Keep this week\u2019s plots on the iPad so a cold start stays under two seconds.\n**Status:** The cache works; cold start is 2.4 s, and pre-decoding the home plot should bring it to 1.6 s.\n**Owner:** Field app team.\n\nThe cache keeps the plots you visited this week.\n\n```swift\n// Pre-decode the home plot so cold start skips the slowest step.\nfunc warmCache(for plot: Plot) async throws {\n    let tiles = try await store.tiles(near: plot.center, radius: 400)\n    for tile in tiles.prefix(12) {\n        cache[tile.id] = try decoder.decode(tile.data) // 2.4 s -> 1.6 s\n    }\n}\n```\n\n## Limits\n\n- 750 MB cap for now (see the handoff).\n',
}, [[240, 'Start Northwind'], [120, 'Specimen tagging in one tap', 'docs/DECISIONS.md'], [70, 'Map layer renders field plots'], [30, 'Cache offline map tiles'],
  [8, 'App Store screenshots for 1.2', { 'release/app-store/1-field-notes.svg': screens.northwind[0], 'release/app-store/2-offline-map.svg': screens.northwind[1], 'release/app-store/3-specimen.svg': screens.northwind[2] }],
  [6, 'Landing page header for the 1.2 launch', { 'marketing/landing-hero.svg': covers.northwind }],
  [5, 'Measure cold start on iPad mini']]);
git(northwind, ['worktree', 'add', '-q', '-b', 'feature/photo-export', path.join(root, 'northwind-photo-export')]);
write(path.join(northwind, 'docs/HANDOFF.md'), fs.readFileSync(path.join(northwind, 'docs/HANDOFF.md'), 'utf8') + '\nTile cache limit is set to 750 MB for now.\n');
const research = path.join(root, 'northwind-research');
write(path.join(research, 'interviews.md'), '# Field interviews\n\nSample research notes.\n');
write(path.join(research, 'synthesis.md'), '# Synthesis\n\nSample synthesis.\n');
for (const f of ['interviews.md', 'synthesis.md']) fs.utimesSync(path.join(research, f), ago(48), ago(48));

const lumen = repo('lumen', {
  'README.md': '# Lumen\n\nAmbient lighting scenes for small venues, run from one phone. Made by Lumen Lighting Labs.\n',
  'brand/app-icon.svg': icons.lumen,
  'brand/wordmark.svg': wordmarks.lumen,
  'package.json': '{ "name": "lumen" }\n',
  'docs/PRODUCT_DECISIONS.md': '# Lumen decisions\n\n## D01 — Scenes are shared by link\n\n- **Date/status:** 30 October 2026; confirmed.\n\n## D02 — No account for guests\n\n- **Date/status:** 1 November 2026; approved.\n',
  'docs/MARKET.md': '# Market\n\n- Market size: roughly 60,000 small music venues and bars in Europe and North America run their own lighting.\n- Why now: Wi-Fi light fixtures now cost less than $40, so one phone can run a whole room.\n',
  'docs/HANDOFF.md': '# Handoff\n\nBridge pairing works on iOS. Android pairing still drops after the first scene.\n\n## Next steps\n\n- Pair the bridge in under a minute on Android.\n',
}, [[300, 'Start Lumen'], [96, 'Scene editor with live preview'], [50, 'Share scenes by link', 'docs/PRODUCT_DECISIONS.md'],
  [40, 'Scene editor mockup for the venue pitch', { 'design/mockups/scene-editor.svg': screens.lumen }],
  [36, 'Venue landing page header', { 'marketing/landing-hero.svg': covers.lumen }], [26, 'iOS bridge pairing']]);

const paperboat = repo('paperboat', {
  'README.md': '# Paperboat\n\nA quiet newsletter tool for writers who publish once a month. Made by Paperboat Press.\n',
  'brand/app-icon.svg': icons.paperboat,
  'brand/wordmark.svg': wordmarks.paperboat,
  'package.json': '{ "name": "paperboat" }\n',
  'docs/DECISIONS.md': '# Paperboat decisions\n\n## D01 — Plain text emails by default\n\n- **Date/status:** 12 October 2026; approved.\n',
}, [[900, 'Start Paperboat'], [500, 'Plain text sending'], [420, 'Archive page screenshot', { 'docs/screenshots/archive.svg': screens.paperboat }],
  [410, 'Homepage header', { 'marketing/landing-hero.svg': covers.paperboat }], [400, 'Archive page']]);

// ---------- agent sessions (Claude Code and Codex log formats) ----------
const claudeDir = path.join(root, 'claude');
function claude(dir, id, cwd, title, task, text, hoursAgo, extra = []) {
  const at = (hoursAgo === 0 ? new Date() : ago(hoursAgo)).toISOString();
  const lines = [
    { type: 'user', sessionId: id, cwd, gitBranch: 'main', timestamp: at, message: { content: task } },
    ...extra.map((e) => ({ ...e, sessionId: id, timestamp: at })),
    { type: 'assistant', sessionId: id, timestamp: at, message: { content: [{ type: 'text', text }] } },
    { type: 'custom-title', customTitle: title },
  ];
  write(path.join(claudeDir, dir, `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}
const tool = (content) => ({ type: 'user', message: { content: [{ type: 'tool_result', content }] } });
const edit = (file) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: file } }] } });
claude('northwind', 'nw-cache', northwind, 'Offline tile cache', 'Measure cold-start load time on an iPad mini with no network and report the slowest step.', 'Cold start is 2.4 s with the cache warm. The slowest step is decoding the first tile; pre-decoding the home plot would save about 0.8 s.', 5,
  [edit(path.join(northwind, 'Sources/Map/TileCache.swift')), tool('Executed 18 tests, with 0 failures'), tool(`[main ${git(northwind, ['rev-parse', '--short', 'HEAD']).trim()}] Measure cold start on iPad mini\n 2 files changed`)]);
claude('lumen', 'lu-scenes', lumen, 'Scene editor polish', 'Make the live preview smooth on older phones.', 'Live preview now holds 60 fps on an iPhone 11 by batching colour updates.', 30, [tool('Tests: 41 passed, 41 total')]);
claude('paperboat', 'pb-archive', paperboat, 'Archive page', 'Add a public archive of past issues.', 'Archive page ships with one page per issue and an RSS feed.', 400);

const codexSessions = path.join(root, 'codex', 'sessions');
function codex(id, cwd, name, task, message, hoursAgo) {
  const at = ago(hoursAgo).toISOString();
  const lines = [
    { timestamp: at, type: 'session_meta', payload: { id, timestamp: at, cwd } },
    { timestamp: at, type: 'event_msg', payload: { type: 'task_started' } },
    { timestamp: at, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: task }] } },
    { timestamp: at, type: 'event_msg', payload: { type: 'task_complete', last_agent_message: message } },
  ];
  write(path.join(codexSessions, '2026', '11', `rollout-${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  fs.appendFileSync(path.join(root, 'codex', 'session_index.jsonl'), JSON.stringify({ id, thread_name: name, updated_at: at }) + '\n');
}
codex('cx-photo', path.join(root, 'northwind-photo-export'), 'Photo export screen', 'Draft the photo export screen for herbarium submissions.', 'Export screen drafted. It writes JPEG for now; the HEIC decision (D02) is still open.', 20);
codex('cx-android', lumen, 'Android bridge pairing', 'Find why Android pairing drops after the first scene.', 'The bridge closes the socket when the phone sleeps. A keep-alive every 20 s fixes it in testing; not committed yet.', 3);

// ---------- run Cereal's engine on the samples ----------
process.env.CEREAL_DATA_DIR = path.join(root, 'data');
process.env.CEREAL_CLAUDE_DIR = claudeDir;
process.env.CEREAL_CODEX_DIR = codexSessions;
const { Store } = await import('../lib/store.mjs');
const { Engine } = await import('../lib/engine.mjs');
const { showCommit } = await import('../lib/git.mjs');
const { normalizeOne } = await import('../lib/projects.mjs');
const { outlineSummary } = await import('../lib/summary.mjs');
const defs = [
  { id: 'northwind', name: 'Northwind', tagline: 'Offline-first field notes for botanists', keyword: 'northwind', seeds: [root], markers: ['*.xcodeproj'], brand: identities.northwind.brand, news: ['offline maps', 'field botany', 'herbarium'] },
  { id: 'lumen', name: 'Lumen', tagline: 'Ambient lighting scenes for small venues', keyword: 'lumen', seeds: [root], markers: ['package.json'], brand: identities.lumen.brand, news: ['smart lighting', 'live music venues'] },
  { id: 'paperboat', name: 'Paperboat', tagline: 'A quiet newsletter for writers who publish monthly', keyword: 'paperboat', seeds: [root], markers: ['package.json'], brand: identities.paperboat.brand, news: ['email newsletters', 'newsletter platform'] },
].map(normalizeOne);
const store = new Store(process.env.CEREAL_DATA_DIR);
const engine = new Engine(store, defs);
engine.startedAt = 0;

const data = { builtAt: NOW, projects: {}, docs: {}, commits: {}, sessions: {}, discovery: {}, retained: {} };
for (const d of defs) {
  const disc = await engine.discover(d.id);
  data.discovery[d.id] = disc;
  await engine.approve(d.id, disc.candidates.filter((c) => c.recommended).map((c) => c.id));
}
fs.chmodSync(research, 0o000); // show how Cereal behaves when macOS blocks a folder
try {
  await engine.index('northwind');
  await engine.refreshAgents();

  const capture = () => {
    const out = { portfolio: engine.portfolio(), capsules: {}, unresolved: engine.unresolved };
    for (const d of defs) out.capsules[d.id] = engine.capsule(d.id);
    return out;
  };
  data.before = capture();
  data.edition = engine.edition();
  for (const d of defs) {
    data.retained[d.id] = engine.retained(d.id);
    for (const doc of store.project(d.id).index?.docs || []) { const text = fs.readFileSync(doc.path, 'utf8'); data.docs[doc.id] = { ...doc, text, summary: { ...outlineSummary(text), claude: false } }; }
    for (const r of store.project(d.id).index?.repos || []) for (const c of r.commits) data.commits[c.sha] = (await showCommit(r.path, c.sha)) || '';
  }

  // Later: a Northwind agent finishes while you're looking at another project.
  claude('northwind', 'nw-heic', path.join(root, 'northwind-photo-export'), 'HEIC fallback for herbarium export', 'Add a JPEG fallback so the herbarium importer accepts HEIC photos.', 'Added a JPEG fallback on export. 9 tests pass. This resolves the importer half of D02; the storage choice still needs your call.', 0,
    [edit(path.join(root, 'northwind-photo-export/Sources/Export/PhotoExport.swift')), tool('# pass 9\n# fail 0')]);
  await engine.refreshAgents();
  data.after = capture();

  // A synthetic morning briefing: today's, measured against yesterday morning's, plus yesterday's itself.
  const { buildBriefing, snapshotOf } = await import('../lib/briefing.mjs');
  const { renderBriefingEmail } = await import('../lib/briefing-email.mjs');
  const { briefingInputs, defaultSettings } = await import('../lib/briefing-delivery.mjs');
  const tz = 'America/New_York';
  const inputs = briefingInputs(engine, defaultSettings(tz));
  const asOf = (t) => inputs.map((p) => ({
    ...p,
    capsule: { ...p.capsule, attention: (p.capsule.attention || []).filter((a) => !a.at || Date.parse(a.at) < t), leftOff: (p.capsule.leftOff || []).filter((l) => !l.at || Date.parse(l.at) < t) },
    index: { ...p.index, repos: (p.index?.repos || []).map((r) => ({ ...r, commits: r.commits.filter((c) => Date.parse(c.date) < t) })) },
    sessions: p.sessions.filter((x) => Date.parse(x.lastAt) < t),
  }));
  const snap = (ps) => Object.fromEntries(ps.map((p) => [p.def.id, snapshotOf(p)]));
  const links = { manage: '#/briefing', pause: '#/briefing', unsubscribe: '#/briefing' };
  // Real headlines for the sample topics, fetched when the demo is built. Offline builds simply have none.
  const { gatherNews, suggestTopics } = await import('../lib/news.mjs');
  let news = null;
  try { news = await gatherNews(inputs.map((p) => ({ id: p.def.id, topics: suggestTopics(p) })), { now: NOW }); } catch (e) { console.warn('news skipped:', e.message); }
  // The edition's "Market and why now" shows the same headlines, as the app does with news on.
  data.edition.newsEnabled = true;
  for (const d of data.edition.dispatches) {
    const p = inputs.find((x) => x.def.id === d.projectId);
    d.newsTopics = p ? suggestTopics(p) : [];
    d.news = news?.[d.projectId]?.items || [];
  }
  const compose = (id, projects, previous, now, withNews = null) => {
    const table = {};
    const link = (projectId, src) => { const n = Object.keys(table).length + 1; table[n] = { projectId, src }; return `#/briefing/open/${id}/${n}`; };
    const b = buildBriefing({ projects, previous, now, timeZone: tz, link, news: withNews });
    const email = renderBriefingEmail(b, { links, provider: 'the Cereal demo (nothing is sent)' });
    return { id, subject: email.subject, preheader: email.preheader, html: email.html, text: email.text, at: new Date(now).toISOString(), table };
  };
  const yesterday = NOW - 25 * HOUR;
  const before = asOf(yesterday);
  const prevEmail = compose('demoyesterday', before, { snapshot: snap(asOf(yesterday - 24 * HOUR)), deliveredAt: new Date(yesterday - 24 * HOUR).toISOString() }, yesterday);
  const today = compose('demotoday', inputs, { snapshot: snap(before), deliveredAt: new Date(yesterday).toISOString() }, NOW, news);
  const plain = compose('demotoday', inputs, { snapshot: snap(before), deliveredAt: new Date(yesterday).toISOString() }, NOW);
  data.briefing = {
    today: { id: today.id, subject: today.subject, preheader: today.preheader, html: today.html, text: today.text },
    todayNoNews: { id: plain.id, subject: plain.subject, preheader: plain.preheader, html: plain.html, text: plain.text },
    history: [{ id: prevEmail.id, kind: 'scheduled', subject: prevEmail.subject, at: prevEmail.at, status: 'sent', projects: defs.map((d) => d.id), html: prevEmail.html, preheader: prevEmail.preheader }],
    links: { [today.id]: today.table, [prevEmail.id]: prevEmail.table },
    projects: defs.map((d) => ({ id: d.id, name: d.name, connected: true, accent: d.brand.accent, newsTopics: d.news, newsTopicsCustom: true })),
    newsFetchedAt: news ? new Date(NOW).toISOString() : null,
    timeZone: tz,
  };
  data.notification = store.data.notifications.at(-1) || null;
  for (const d of defs) data.sessions[d.id] = Object.fromEntries((store.project(d.id).agents || []).map((s) => [s.id, s]));
} finally {
  fs.chmodSync(research, 0o755);
}

// ---------- write the static site ----------
// Icons and header images become plain files next to the demo; their URLs are rewritten to match.
const media = new Map();
// Empty the folder rather than replace it, so a static server already serving demo/ picks up the new build.
fs.mkdirSync(OUT, { recursive: true });
for (const e of fs.readdirSync(OUT)) fs.rmSync(path.join(OUT, e), { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'media'), { recursive: true });
const ext = (type) => ({ 'image/svg+xml': 'svg', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[type] || 'bin');
for (const d of defs) {
  const cap = data.after.capsules[d.id];
  if (cap.iconUrl) { const img = await engine.iconBytes(d.id); if (img) { const f = `media/${d.id}-icon.${ext(img.type)}`; fs.writeFileSync(path.join(OUT, f), img.buf); media.set(cap.iconUrl, f); } }
  if (cap.wordmarkUrl) { const img = await engine.wordmarkBytes(d.id); if (img) { const f = `media/${d.id}-wordmark.${ext(img.type)}`; fs.writeFileSync(path.join(OUT, f), img.buf); media.set(cap.wordmarkUrl, f); } }
  for (const [i, im] of (cap.hero?.images || []).entries()) { const img = await engine.heroBytes(d.id, i); if (img) { const f = `media/${d.id}-hero-${i}.${ext(img.type)}`; fs.writeFileSync(path.join(OUT, f), img.buf); media.set(im.url, f); } }
}
let json = JSON.stringify(data);
for (const [url, file] of media) json = json.split(JSON.stringify(url).slice(1, -1)).join(file);
json = json.split(root).join(SHOWN_ROOT).split(`/private${root}`).join(SHOWN_ROOT);
for (const f of ['app.js', 'ui.js', 'style.css', 'ui.css']) fs.copyFileSync(path.join(CEREAL, 'public', f), path.join(OUT, f));
fs.copyFileSync(path.join(HERE, 'demo-shim.js'), path.join(OUT, 'demo-shim.js'));
fs.writeFileSync(path.join(OUT, 'demo-data.js'), `window.CEREAL_DEMO = ${json};\n`);
const html = fs.readFileSync(path.join(CEREAL, 'public', 'index.html'), 'utf8')
  .replace('href="/style.css"', 'href="style.css"')
  .replace('href="/ui.css"', 'href="ui.css"')
  .replace('<script type="module" src="/app.js"></script>', '<script src="demo-data.js"></script>\n  <script src="demo-shim.js"></script>\n  <script type="module" src="app.js"></script>')
  .replace('<title>Cereal</title>', `<title>Cereal — demo</title>\n  <meta name="description" content="Try Cereal with three sample projects: where you left off, what changed, and a morning briefing. No sign-up.">\n  <meta property="og:type" content="website">\n  <meta property="og:title" content="Cereal — try the demo">\n  <meta property="og:description" content="Three sample projects: pick up where you left off, switch with ⌘K, and read the morning briefing. No sign-up.">\n  <meta property="og:image" content="https://cereal.work/og.jpg">\n  <meta property="og:image:width" content="1200">\n  <meta property="og:image:height" content="675">\n  <meta name="twitter:card" content="summary_large_image">\n  <meta name="twitter:image" content="https://cereal.work/og.jpg">`);
// The Get Cereal page is the site's home; the demo lives one click away at demo.html.
fs.writeFileSync(path.join(OUT, 'demo.html'), html);
fs.copyFileSync(path.join(HERE, 'get-cereal.html'), path.join(OUT, 'index.html'));
fs.copyFileSync(path.join(HERE, 'get-cereal.html'), path.join(OUT, 'get.html'));
fs.copyFileSync(path.join(HERE, 'og.jpg'), path.join(OUT, 'og.jpg'));
fs.cpSync(path.join(CEREAL, 'public', 'brand'), path.join(OUT, 'brand'), { recursive: true });
// The homepage's animation library, vendored so the site loads nothing from elsewhere.
fs.mkdirSync(path.join(OUT, 'vendor'), { recursive: true });
for (const f of ['motion.js', 'motion.LICENSE.md']) fs.copyFileSync(path.join(HERE, 'vendor', f), path.join(OUT, 'vendor', f));
fs.copyFileSync(path.join(CEREAL, 'public', 'manifest.webmanifest'), path.join(OUT, 'manifest.webmanifest'));
store.flush(); // settle pending writes before the sample folder goes away
fs.rmSync(root, { recursive: true, force: true });
console.log(`Demo written to ${path.relative(process.cwd(), OUT) || OUT} (${(json.length / 1024).toFixed(0)} KB of sample data)`);
