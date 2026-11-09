// Cereal — client. Plain modules, no framework: the server owns context; the client renders it fast.
import { Icon, Badge, Card, Fields, Tabs, selectTab, bindTabs, Accordion, AccordionItem, Table, SheetHeader, Stats } from './ui.js';

const $ =(sel, el = document) => el.querySelector(sel);
const view = $('#view');
const drawer = $('#drawer');
const switcher = $('#switcher');

const S = {
  state: null,           // /api/state
  capsules: {},          // projectId -> capsule (instant switching renders from here)
  route: { name: 'portfolio' },
  current: null,         // project id being viewed
  lastNote: 0,
  swIndex: 0,
  drawerSrc: null,
  restoring: false,
};

// ---------- utilities ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = (o) => encodeURIComponent(JSON.stringify(o));
const dec = (s) => JSON.parse(decodeURIComponent(s));

function rel(iso) {
  if (!iso) return '';
  const d = (Date.now() - Date.parse(iso)) / 1000;
  if (d < 45) return 'just now';
  if (d < 3600) return `${Math.round(d / 60)}m ago`;
  if (d < 86400) return `${Math.round(d / 3600)}h ago`;
  if (d < 86400 * 7) return `${Math.round(d / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const base = (p) => String(p || '').split('/').filter(Boolean).pop() || p;
const tild = (p) => String(p || '').replace(/^\/Users\/[^/]+/, '~');

async function api(path, opts = {}) {
  const res = await fetch(path, { method: opts.body ? 'POST' : (opts.method || 'GET'), headers: opts.body ? { 'content-type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}
const post = (path, body = {}) => api(path, { body });

const PROV = {
  git: ['From Git', 'Verified directly from Git metadata'],
  agent: ['Agent reported', 'Reported by a Claude Code or Codex session; not independently verified'],
  human: ['Decision', 'A decision a person recorded in a project document'],
  doc: ['From a doc', 'Stated in an indexed project document'],
  you: ['You', 'Your own activity in Cereal'],
  inferred: ['Inferred', 'A link Cereal inferred from evidence, not confirmed'],
};
const prov = (k) => `<span class="prov prov-${esc(k)}" title="${esc(PROV[k]?.[1] || '')}">${esc(PROV[k]?.[0] || k)}</span>`;
// The same provenance as a badge, for the panel and the tabs.
const PROV_VARIANT = { git: 'success', agent: 'warning', human: 'brand', doc: 'secondary', you: 'secondary', inferred: 'outline' };
const provBadge = (k) => Badge(esc(PROV[k]?.[0] || k), { variant: PROV_VARIANT[k] || 'secondary', title: PROV[k]?.[1], cls: `prov-badge prov-${esc(k)}` });

const srcChip = (s) => `<button type="button" class="src" data-src="${enc(s)}" title="Open ${esc(tild(s.label))}">${sourceLabel({ ...s, label: tild(s.label).slice(0, 72) })}</button>`;

// Each project's colour carries its identity. Text and button colours are derived so they stay readable.
function luminance(hex) {
  const n = parseInt(String(hex || '#6E5FE8').slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
// A project can name its brand typeface (installed on this Mac); its name is then set in it.
const brandFonts = new Map();
function brandFont(font) {
  if (!font) return '';
  if (!brandFonts.has(font)) {
    const family = `cereal-brand-${brandFonts.size + 1}`;
    const style = document.createElement('style');
    style.textContent = `@font-face { font-family: "${family}"; src: local(${JSON.stringify(font)}), local(${JSON.stringify(font.replace(/\s+/g, ''))}); font-display: swap; }`;
    document.head.appendChild(style);
    brandFonts.set(font, family);
  }
  return `--p-font:"${brandFonts.get(font)}";`;
}
function brandVars(b) {
  if (!b) return '';
  const on = luminance(b.accent) > 0.3 ? '#17161B' : '#FFFFFF';
  return `--p-surface:${b.surface};--p-ink:${b.ink};--p-accent:${b.accent};--p-glow:${b.glow};--p-on:${on};${brandFont(b.font)}`;
}
// The project's name as its brand would set it: its wordmark file, else its typeface, else ours.
const nameMark = (p) => (p.wordmarkUrl ? `<img class="brand-wordmark" src="${esc(p.wordmarkUrl)}" alt="${esc(p.name)}">` : `<span class="name-text">${esc(p.name)}</span>`);
const project = (id) => S.state?.projects.find((p) => p.id === id);
// The project's real app icon or logo when Cereal found one; a lettered tile only as a last resort.
const icon = (p, size = 'md') => p.iconUrl
  ? `<img class="picon picon-${size}" src="${esc(p.iconUrl)}" alt="" loading="lazy">`
  : `<span class="picon picon-${size} mono" aria-hidden="true">${esc(p.name[0])}</span>`;

// The header: the latest product someone committed, as a device mockup or a full image, fading into the page.
function heroFigure(hero, { size = 'story', caption = false } = {}) {
  if (!hero?.images?.length) return '';
  // A project page's cover is the first thing on screen, so it loads straight away; covers further down wait.
  const load = size === 'page' ? 'fetchpriority="high"' : 'loading="lazy"';
  const imgs = hero.images.map((img) => `<img src="${esc(img.url)}" alt="" ${load} decoding="async" width="${img.w}" height="${img.h}">`);
  const body = hero.layout === 'devices'
    ? `<div class="devices">${imgs.map((i) => `<div class="device">${i}</div>`).join('')}</div>`
    : imgs[0];
  return `<figure class="hero hero-${hero.layout} hero-${size}">${body}</figure>
    ${caption ? `<p class="hero-caption">${hero.pinned ? 'Your chosen cover. A newer product shot will replace it automatically.' : `Latest product shot, from ${q(hero.subject || 'a commit', 60)} ${esc(ago(hero.at))}`}</p>` : ''}`;
}
const pchip = (p) => (p ? `<span class="pchip" style="--p-accent:${p.brand.accent}"><i aria-hidden="true"></i>${esc(p.name)}</span>` : '');
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const word = (n) => WORDS[n] || String(n);
const Word = (n) => { const w = word(n); return w[0].toUpperCase() + w.slice(1); };
const longDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });

// Time as it reads in a sentence: "five hours ago", "yesterday", "on October 22".
function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 86400) { const h = Math.round(s / 3600); return h === 1 ? 'an hour ago' : `${word(h) === String(h) ? h : word(h)} hours ago`; }
  if (s < 172800) return 'yesterday';
  if (s < 604800) return `${word(Math.round(s / 86400))} days ago`;
  return `on ${longDate(iso)}`;
}
// Titles read as names: keep the part before a colon, and cut long ones at a word.
function shortTitle(t, n = 48) {
  let s = String(t || '').trim();
  const head = s.split(/:\s/)[0];
  if (head.length >= 8 && head.length < s.length) s = head;
  if (s.length <= n) return s;
  const cut = s.slice(0, n).replace(/\s+\S*$/, '');
  return (cut.length > 12 ? cut : s.slice(0, n - 1)) + '…';
}
const q = (t, n = 48) => `<q>${esc(shortTitle(t, n))}</q>`;
const why = (kind, at, extra) => [PROV[kind]?.[0] || '', at ? ago(at) : '', extra || ''].filter(Boolean).join(', ').replace(/^./, (c) => c.toUpperCase());

/**
 * A project as a short story: what an agent finished, where you left off, what needs your call.
 * Every sentence is built from a sourced fact and opens that source; nothing is generated.
 * `x` is a portfolio entry or a capsule (they share these fields).
 */
function storySentences(x, { leadWithLeftOff = false } = {}) {
  const out = [];
  const lf = x.leftOff?.[0];
  const review = (x.attention || []).find((a) => a.sessionId);
  const reviews = (x.attention || []).filter((a) => a.sessionId).length;
  const sessions = x.agents?.recent || [];

  let agent = null;
  if (review) {
    const s = sessions.find((y) => y.id === review.sessionId);
    const tool = s?.tool === 'codex' ? 'Codex' : 'Claude';
    const title = s?.title || review.text.replace(/ is ready for review$/, '');
    const test = s?.test?.status === 'passed' ? ' and says its tests pass' : s?.test?.status === 'failed' ? ', but its tests failed' : '';
    agent = { html: `<b>${tool}</b> finished ${q(title)}${test}.`, src: review.sources?.[0], why: why('agent', review.at, reviews > 1 ? `${word(reviews - 1)} more waiting` : ''), id: review.sessionId };
  } else if (x.agents?.active?.length) {
    const s = x.agents.active[0];
    agent = { html: `<b>${s.tool === 'codex' ? 'Codex' : 'Claude'}</b> is working on ${q(s.title || 'a task')} right now.`, src: { type: 'session', tool: s.tool, id: s.id, label: s.title }, why: why('agent', s.lastAt), id: s.id };
  }

  let left = null;
  if (lf) {
    const t = lf.text;
    let html;
    if (/^Last commit: /.test(t)) html = `The last commit, ${q(t.slice(13))}, landed ${ago(lf.at)}.`;
    else if (/^(Claude Code|Codex) worked on /.test(t)) html = `${t.startsWith('Codex') ? 'Codex' : 'Claude'} last worked on ${q(t.replace(/^(Claude Code|Codex) worked on /, ''))}.`;
    else if (/^You were reading /.test(t)) html = `You were reading <b>${esc(t.slice(17).split(',')[0])}</b>${esc(t.includes(',') ? ',' + t.split(',').slice(1).join(',') : '')}.`;
    else html = `${esc(t)}.`;
    const sameAsAgent = agent && lf.sources?.some((s) => s.id && s.id === agent.id);
    if (!sameAsAgent) left = { html, src: lf.sources?.[0], why: why(lf.kind, lf.at) };
  }

  let next = null;
  const open = x.questions?.[0];
  if (open) {
    const m = /^([A-Z]{1,8}[-\d]*\d+)\s*[—–-]\s*(.+)$/.exec(open.text);
    next = { html: m ? `<b>${esc(m[1])}</b>, ${esc(m[2].charAt(0).toLowerCase() + m[2].slice(1))}, still needs your call.` : `${q(open.text)} is still open.`, src: open.sources?.[0], why: why(open.kind, open.at) };
  } else if (x.blocked?.some((b) => b.code === 'blocked')) {
    const n = x.blocked.filter((b) => b.code === 'blocked').length;
    next = { html: `macOS is hiding ${word(n)} of its folders.`, src: { type: 'retained', label: `What Cereal keeps about ${x.name}` }, why: 'Its contents stay hidden until access is back' };
  }

  for (const s of leadWithLeftOff ? [left, agent, next] : [agent, left, next]) if (s) out.push(s);
  // A quiet project gets one plain sentence, not a repeated date.
  if (!out.length && x.state?.lastAt && Date.now() - Date.parse(x.state.lastAt) > 3 * 864e5) {
    out.push({ html: `Nothing has moved since ${longDate(x.state.lastAt)}.`, why: 'From Git and your agent logs' });
  }
  return out.slice(0, 3);
}

const sentence = (s) => `<span class="s" tabindex="0"${s.src ? ` data-src="${enc(s.src)}"` : ''} data-why="${esc(s.why || '')}">${s.html}</span>`;

function fact(f, opts = {}) {
  const first = (f.sources || [])[0];
  return `<li class="fact ${f.severity ? 'sev-' + f.severity : ''}" data-fact="${esc(f.id)}"${first ? ` data-src="${enc(first)}" tabindex="0"` : ''}${opts.project ? ` data-project="${opts.project.id}"` : ''}>
    <p class="fact-text">${esc(f.text)}</p>
    ${f.detail ? `<p class="fact-detail">${esc(String(f.detail).slice(0, 320))}</p>` : ''}
    <p class="fact-meta">${prov(f.kind)}${f.at ? `<time datetime="${esc(f.at)}" title="${esc(when(f.at))}">${rel(f.at)}</time>` : ''}${(f.sources || []).slice(0, 3).map(srcChip).join('')}</p>
  </li>`;
}

// ---------- data ----------

async function loadState() {
  S.state = await api('/api/state');
  renderChrome();
  return S.state;
}

async function loadCapsule(id) {
  const c = await api(`/api/projects/${id}/capsule`);
  S.capsules[id] = c;
  return c;
}

// ---------- chrome: pills, runtimes ----------

function renderChrome() {
  const st = S.state;
  if (!st) return;
  $('#pills').innerHTML = st.projects.map((p) => {
    const active = S.current === p.id && S.route.name !== 'portfolio';
    const n = p.connected ? (S.current === p.id ? 0 : p.counts.changes) : 0;
    return `<button type="button" class="pill ${active ? 'active' : ''}" data-go="${p.id}" style="${brandVars(p.brand)}" aria-current="${active}">
      ${icon(p, 'xs')}<span class="pill-name">${esc(p.name)}</span>${p.agents.active.length ? '<span class="live-dot" title="Agent working"></span>' : ''}${n ? `<span class="badge">${n > 99 ? '99+' : n}</span>` : ''}
    </button>`;
  }).join('');
  const rt = st.runtimes;
  $('#runtimes').innerHTML = rt
    ? ['claude', 'codex'].map((k) => `<span class="rt ${rt[k]?.available ? 'ok' : 'off'}" title="${esc(rt[k]?.available ? `${rt[k].files} session files found in ${tild(rt[k].root)}` : `No ${k} sessions found`)}"><i></i>${k === 'claude' ? 'Claude Code' : 'Codex'}</span>`).join('')
    : '<span class="rt pending"><i></i>Reading agent sessions…</span>';
}

// ---------- routing ----------

function parseRoute() {
  const h = location.hash.replace(/^#/, '') || '/';
  let m;
  if ((m = /^\/p\/([\w-]+)\/sources$/.exec(h))) return { name: 'sources', id: m[1] };
  if ((m = /^\/p\/([\w-]+)$/.exec(h))) return { name: 'project', id: m[1] };
  if ((m = /^\/briefing\/open\/(\w+)\/(\d+)$/.exec(h))) return { name: 'briefing-open', bid: m[1], n: m[2] };
  if (/^\/briefing\/?$/.test(h)) return { name: 'briefing' };
  return { name: 'portfolio' };
}

async function onRoute() {
  const next = parseRoute();
  const prev = S.route;
  if (prev.name === 'project' && (next.name !== 'project' || next.id !== prev.id)) leaveProject(prev.id);
  S.route = next;
  if (next.id) S.current = next.id;
  if (next.name !== 'project') closeDrawer({ persist: false });
  if (next.name === 'portfolio') { S.portfolioPainted = false; return renderPortfolio(); }
  if (next.name === 'sources') return renderSources(next.id);
  if (next.name === 'briefing') return renderBriefing();
  if (next.name === 'briefing-open') return openBriefingLink(next.bid, next.n);
  return renderProject(next.id);
}

function leaveProject(id) {
  // Preserve this project's workspace exactly as you left it.
  const ws = { scroll: window.scrollY, tab: currentTab(), drawer: S.drawerSrc || null, leave: true };
  if (S.capsules[id]) S.capsules[id].workspace = { ...(S.capsules[id].workspace || {}), ...ws };
  post(`/api/projects/${id}/workspace`, ws).catch(() => {});
}

function goProject(id, { open } = {}) {
  S.pendingOpen = open || null;
  if (location.hash === `#/p/${id}`) return onRoute();
  location.hash = `#/p/${id}`;
}

// ---------- Screen A: Portfolio ----------

const urgency = (p) => (!p.connected ? 0 : (p.needs?.reviews || 0) * 4 + p.agents.active.length * 3 + (p.needs?.risks || 0) * 2 + (p.counts.changes ? 1 : 0));

async function renderPortfolio() {
  document.title = 'Cereal';
  S.current = null;
  if (S.route.name === 'portfolio' && !S.portfolioPainted) window.scrollTo(0, 0);
  renderChrome();
  if (!S.state) view.innerHTML = skeletonPortfolio();
  try { await loadState(); } catch (e) { return errorView(e, renderPortfolio); }
  const st = S.state;
  if (!st.projects.length) {
    view.innerHTML = `<section class="home"><h1 class="story-text home-empty">Nothing to pick up yet. Tell Cereal what you’re building.</h1>${addProjectForm(true)}</section>`;
    return;
  }
  const ordered = [...st.projects].sort((a, b) => urgency(b) - urgency(a));
  const waiting = st.projects.filter((p) => p.needs?.reviews || p.needs?.risks || p.questions?.length).length;
  const [edition, briefing] = await Promise.all([api('/api/edition').catch(() => null), api('/api/briefing').catch(() => null)]);
  if (edition?.newsLoading) setTimeout(() => refreshEdition(), 3000);
  S.portfolioPainted = true;
  view.innerHTML = `
  <section class="home">
    ${editionHtml(edition)}
    ${briefingEntry(briefing)}
    <p class="home-intro">${Word(st.projects.length)} project${st.projects.length === 1 ? '' : 's'}. ${waiting ? `${Word(waiting)} ${waiting === 1 ? 'has' : 'have'} something waiting for you.` : 'Nothing is waiting on you.'}</p>
    <div class="stories">${ordered.map(storyBlock).join('')}</div>
    <details class="add-project"><summary>Add a project</summary>${addProjectForm(false)}</details>
    ${st.unresolved?.length ? `<details class="unresolved"><summary>${plural(st.unresolved.length, 'agent session')} Cereal couldn’t place</summary>
      <p class="hint">They touched project folders, but not clearly one project, so Cereal leaves them unassigned instead of guessing.</p>
      <ul>${st.unresolved.slice(0, 8).map((s) => `<li>${esc(s.title)} <span class="muted">${esc(s.attribution.evidence)}, ${rel(s.lastAt)}</span></li>`).join('')}</ul></details>` : ''}
  </section>`;
}

// ---------- the morning edition ----------
// A short paper at the top of the day: what moved, in plain words, with the detail folded away.
const dayKey = () => new Date().toLocaleDateString('en-CA');
function editionHtml(ed) {
  if (!ed?.dispatches?.length) return '';
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const read = localStorage.getItem('cereal-edition-read') === dayKey();
  return `<section class="edition${read ? ' is-read' : ''}" id="edition">
    <p class="edition-mast"><span>Morning edition</span><span>${esc(today)}</span></p>
    <div class="edition-body">
      <h1 class="edition-lede">${esc(ed.text)}</h1>
      <div class="dispatches">${ed.dispatches.map((d) => dispatchHtml({ ...d, newsEnabled: ed.newsEnabled, newsLoading: ed.newsLoading })).join('')}</div>
      <button type="button" class="btn quiet edition-done" data-act="edition-done">Done reading</button>
    </div>
    <button type="button" class="edition-reopen" data-act="edition-open">You’ve read today’s edition. Read it again</button>
  </section>`;
}
function edItems(items, empty) {
  if (!items.length) return `<p class="ed-empty">${esc(empty)}</p>`;
  return `<ul class="ed-list">${items.map((i) => `<li${i.src ? ` data-src="${enc(i.src)}" tabindex="0"` : ''}>
    <p class="ed-text">${i.kind === 'market' || i.kind === 'whynow' ? `<span class="ed-tag ed-${i.kind}">${i.kind === 'whynow' ? 'Why now' : 'Market'}</span>` : prov(i.kind)} ${esc(i.text)}</p>
    ${i.detail ? `<p class="ed-detail">${esc(String(i.detail).slice(0, 220))}</p>` : ''}
    ${i.src ? `<p class="ed-src">${sourceLabel({ ...i.src, label: tild(i.src.label || '').slice(0, 72) })}</p>` : ''}</li>`).join('')}</ul>`;
}
// This week's news on what the project is building (searched by topic words only), then what its own docs say.
function marketHtml(d) {
  const topics = (d.newsTopics || []).map((t) => `“${esc(t)}”`).join(', ');
  const change = '<a class="ed-more" href="#/briefing">Change topics</a>';
  let news;
  if (!d.newsTopics?.length) news = `<p class="ed-empty">Give ${esc(d.name)} a one-line tagline and Cereal will follow the news on what it’s building.</p>`;
  else if (!d.newsEnabled) news = `<div class="ed-news-off"><p>See this week’s news on ${topics}. Only those words are searched; nothing from ${esc(d.name)}’s files leaves your Mac.</p><p><button type="button" class="btn quiet" data-act="edition-news-on">Turn on news</button> ${change}</p></div>`;
  else if (d.newsLoading) news = `<p class="ed-empty">Looking for this week’s news on ${topics}…</p>`;
  else if (!d.news?.length) news = `<p class="ed-empty">No news this week on ${topics}. ${change}</p>`;
  else news = `<ul class="ed-list ed-news">${d.news.map((n) => `<li><a class="ed-news-link" href="${esc(n.url)}" target="_blank" rel="noopener"><span class="ed-tag ed-intheNews">In the news</span>${esc(n.title)}</a>
    <p class="ed-src">${esc([n.source, n.at ? ago(n.at) : '', n.topic ? `on “${n.topic}”` : ''].filter(Boolean).join(' · '))}</p></li>`).join('')}</ul>`;
  const notes = d.market?.length ? `<p class="ed-sub">From ${esc(d.name)}’s documents</p>${edItems(d.market, '')}` : '';
  return news + notes;
}
// News is searched in the background; the edition fills in when it's ready.
async function refreshEdition(tries = 0) {
  if (S.route.name !== 'portfolio' || !$('#edition')) return;
  const ed = await api('/api/edition').catch(() => null);
  if (!ed || S.route.name !== 'portfolio' || !$('#edition')) return;
  if (ed.newsLoading) { if (tries < 15) setTimeout(() => refreshEdition(tries + 1), 3000); return; }
  const open = [...document.querySelectorAll('#edition details')].map((x) => x.open);
  $('#edition').outerHTML = editionHtml(ed);
  document.querySelectorAll('#edition details').forEach((x, i) => { if (open[i] != null) x.open = open[i]; });
}
function dispatchHtml(d) {
  return `<article class="dispatch" style="${brandVars(d.brand)}" data-project="${d.projectId}">
    <p class="dispatch-kicker">${d.iconUrl ? `<img class="dispatch-icon" src="${esc(d.iconUrl)}" alt="">` : ''}${nameMark(d)}</p>
    <h2 class="dispatch-head"${d.headline.src ? ` data-src="${enc(d.headline.src)}" tabindex="0"` : ''}>${esc(d.headline.text)}</h2>
    <p class="dispatch-deck">${esc(d.deck)}</p>
    ${fold('Market and why now', marketHtml(d), true, 'ed-fold')}
    ${fold('What’s new in the product', edItems(d.product, `Nothing shipped ${d.span}.`), false, 'ed-fold')}
    ${fold('How it got here', edItems(d.process, 'No decisions or branches recorded yet.'), false, 'ed-fold')}
  </article>`;
}

// The blank slate is the first thing a new user sees, so adding a project happens right here, not in a config file.
// In Cereal for Mac, folders come from the native dialog or a drop on the window; no paths to type.
const isDesktop = () => !!window.cerealNative;
if (isDesktop()) document.documentElement.classList.add('is-desktop');
const pickFolder = () => (isDesktop() ? window.cerealNative.pickFolder() : post('/api/pick-folder').catch(() => ({ cancelled: true })));
const folderName = (p) => base(p).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
function desktopDrop(first) {
  return `<div class="drop-zone${first ? ' first' : ''}">
    <p class="drop-title">${first ? 'Drag a project folder here.' : 'Add a project: drag its folder onto this window.'}</p>
    <p class="drop-sub">Or choose one. macOS asks once whether Cereal may read it. Cereal shows you what it found and reads nothing until you approve.</p>
    <button type="button" class="btn primary" data-act="desktop-add">Choose a folder…</button>
    <p class="status-msg" id="addStatus" role="status"></p>
  </div>`;
}

function addProjectForm(first) {
  if (isDesktop()) return desktopDrop(first);
  return `<form class="add-form" id="addForm">
    ${first ? '<p>Name a project and choose its folder. Cereal looks there with Git, shows you what it found, and reads nothing until you approve it.</p>' : ''}
    <label>Name<input name="name" required placeholder="e.g. Field Notes" autocomplete="off"></label>
    <label>Folder<span class="folder-row"><input name="path" required placeholder="~/Code/field-notes" autocomplete="off"><button type="button" class="btn" data-act="pick-new">Choose…</button></span></label>
    <div class="add-actions"><button type="submit" class="btn primary">Add project</button><span class="status-msg" id="addStatus" role="status"></span></div>
  </form>`;
}

function stateLine(p) {
  if (!p.connected) return 'Not connected yet';
  const visit = p.lastVisitAt ? `you were here ${ago(p.lastVisitAt)}` : 'you haven’t opened it in Cereal yet';
  return `${p.state.label}, ${visit}`;
}

function storyBlock(p) {
  const name = `<a class="story-name" href="#/p/${p.id}" data-go="${p.id}">${p.iconUrl ? `<img class="story-icon" src="${esc(p.iconUrl)}" alt="">` : ''}${nameMark(p)}</a>`;
  const shell = (text, actions) => `<article class="story" data-card="${p.id}" data-project="${p.id}" style="${brandVars(p.brand)}">
    ${p.hero ? `<a class="hero-link" href="#/p/${p.id}" data-go="${p.id}" aria-label="Open ${esc(p.name)}">${heroFigure(p.hero)}</a>` : ''}
    <p class="story-text">${name} ${text}</p>
    <p class="story-why" data-default="${esc(stateLine(p))}">${esc(stateLine(p))}</p>
    <div class="story-actions">${actions}</div></article>`;
  if (!p.connected) return shell(`isn’t connected yet. Choose its folders and Cereal will tell you where things stand.`, `<a class="pick" href="#/p/${p.id}/sources">Choose folders</a>`);
  const sentences = storySentences(p);
  const text = sentences.length ? sentences.map(sentence).join(' ') : 'is quiet. Nothing new has turned up.';
  return shell(text, `${p.pickUp ? `<button type="button" class="pick" data-pick="${p.id}">Pick up</button>` : ''}<a class="btn quiet" href="#/p/${p.id}" data-go="${p.id}">Open ${esc(p.name)}</a>${p.indexing ? '<span class="muted">Updating…</span>' : ''}`);
}

// One agent session as a row: who ran it, what it did, how Cereal linked it, what it reported.
const TOOL = { codex: 'Codex', 'claude-code': 'Claude Code' };
const STATUS = { running: ['Working', 'success'], error: ['Stopped with an error', 'destructive'], idle: ['Idle', 'secondary'] };
const statusBadge = (st) => { const [l, v] = STATUS[st] || STATUS.idle; return Badge(`<span class="dot ${esc(st)}"></span>${l}`, { variant: v }); };
const testBadge = (t) => (t ? Badge(`${Icon(t.status === 'passed' ? 'check' : 'alert')}${t.status === 'passed' ? 'Tests passed' : 'Tests failed'}`, { variant: t.status === 'passed' ? 'success' : 'destructive', title: `${t.summary || ''} (reported by the agent)` }) : '');
const linkBadge = (at = {}) => (at.confidence === 'verified-path' ? Badge(`${Icon('shield')}In checkout`, { variant: 'success', title: 'Ran inside an approved checkout' }) : at.confidence === 'inferred' ? Badge('Inferred', { variant: 'outline', title: at.evidence }) : '');
const toolAvatar = (tool) => `<span class="tool-avatar ${tool === 'codex' ? 'codex' : 'claude'}" aria-hidden="true">${tool === 'codex' ? 'Cx' : 'C'}</span>`;
function agentRow(a) {
  return `<li class="ui-row agent-row" data-src="${enc({ type: 'session', tool: a.tool, id: a.id, label: a.title })}" role="button" tabindex="0">
    ${toolAvatar(a.tool)}
    <div class="ui-row-main"><p class="ui-row-title">${esc(a.title || 'Untitled session')}</p>
    ${a.latest?.text ? `<p class="ui-row-sub clamp">${esc(a.latest.text)}</p>` : ''}
    <div class="ui-row-meta">${statusBadge(a.status)}${linkBadge(a.attribution)}${testBadge(a.test)}${a.branch ? Badge(esc(a.branch), { variant: 'outline', cls: 'ui-badge-mono' }) : ''}</div></div>
    <span class="ui-row-side">${esc(TOOL[a.tool] || 'Agent')} · ${rel(a.lastAt)}</span>
  </li>`;
}

// ---------- Screen B: Project Context ----------

function currentTab() {
  return $('.tabs [aria-selected="true"]')?.dataset.tab || 'decisions';
}

async function renderProject(id) {
  const p = project(id) || (await loadState().catch(() => null), project(id));
  if (!p) return errorView(new Error(`No project “${id}”`));
  document.title = `${p.name} · Cereal`;
  renderChrome();
  if (!p.connected) { location.hash = `#/p/${id}/sources`; return; }

  const cached = S.capsules[id];
  if (cached) paintProject(cached, { restore: true });
  else view.innerHTML = skeletonProject(p);

  try {
    const fresh = await post(`/api/projects/${id}/enter`);
    if (S.route.id !== id) return;
    const sameAsShown = cached && cached.revision === fresh.revision && cached.counts.changes === fresh.counts.changes && cached.leftOff.length === fresh.leftOff.length && cached.agents.total === fresh.agents.total;
    S.capsules[id] = fresh;
    if (!sameAsShown) paintProject(fresh, { restore: !cached });
    loadState().catch(() => {});
  } catch (e) {
    if (!cached) errorView(e, () => renderProject(id));
  }
}

function paintProject(c, { restore } = {}) {
  const ws = c.workspace || {};
  const keepScroll = !restore ? window.scrollY : null;
  const tab = (!restore && $('.tabs') ? currentTab() : null) || ws.tab || 'decisions';
  const sentences = storySentences(c, { leadWithLeftOff: true });
  const [primary, ...others] = c.resume.slice(0, 3);
  const copyCmd = c.resume.find((r) => r.command)?.command;
  const visit = c.firstVisit ? 'First visit, so here is the last week' : `You were last here ${ago(c.since)}`;
  view.innerHTML = `
  <section class="ctx ${c.hero ? 'has-hero' : ''}" style="${brandVars(c.brand)}" data-project="${c.projectId}">
    ${heroFigure(c.hero, { size: 'page', caption: true })}
    <header class="ctx-head">
      ${icon({ id: c.projectId, name: c.name, iconUrl: c.iconUrl }, 'xl')}
      <div class="ctx-title"><h1>${nameMark({ name: c.name, wordmarkUrl: c.wordmarkUrl })}</h1><p class="tagline">${esc(c.tagline || c.description?.text?.slice(0, 120) || '')}</p></div>
      <div class="actions"><a class="btn quiet" href="#/p/${c.projectId}/sources">Folders</a><button class="btn quiet" data-act="reindex">Refresh</button>${S.state?.claude ? '<button class="btn quiet" data-act="brief">Brief with Claude</button>' : ''}</div>
    </header>
    <div class="pickup story">
      <p class="pickup-label">Pick up where you left off</p>
      <p class="story-text pickup-text">${sentences.length ? sentences.map(sentence).join(' ') : 'Nothing to pick up yet.'}</p>
      <p class="story-why" data-default="${esc(visit)}">${esc(visit)}</p>
      ${primary ? `<div class="pickup-actions">
        <button type="button" class="resume-btn primary" data-src="${enc(primary.target)}">${esc(primary.label)}</button>
        ${others.map((r) => `<button type="button" class="resume-btn" data-src="${enc(r.target)}" title="${esc(r.sub || '')}">${esc(r.label)}</button>`).join('')}
        ${copyCmd ? `<button type="button" class="resume-btn copy" data-copy="${esc(copyCmd)}" title="${esc(copyCmd)}">Copy resume command</button>` : ''}
      </div>` : ''}
    </div>
    ${blockedBanner(c)}
    <div id="brief"></div>
    ${capsuleSection('What’s next', 'attention', c.attention, 'Nothing is waiting on you.', 5)}
    ${capsuleSection(c.firstVisit ? 'This week' : 'Since you were last here', 'changed', c.changed, c.firstVisit ? 'Nothing changed in the last seven days.' : 'Nothing new since you were last here.', 5)}
    <section class="details ui-tabs">
      <div class="ui-tabs-list ui-tabs-segmented tabs" role="tablist" aria-label="Project details">${projectTabs(c).map((t) => `<button role="tab" type="button" class="ui-tabs-trigger" data-tab="${t.id}" aria-selected="${t.id === tab}" data-state="${t.id === tab ? 'active' : 'inactive'}" tabindex="${t.id === tab ? 0 : -1}" title="${esc(t.title)}">${t.label}</button>`).join('')}</div>
      <div class="ui-tabs-content tab-panel" id="tabPanel" role="tabpanel">${tabPanel(c, tab)}</div>
    </section>
  </section>`;
  if (restore) {
    requestAnimationFrame(() => window.scrollTo(0, ws.scroll || 0));
    const jump = S.pendingOpen;
    const open = jump || ws.drawer;
    S.pendingOpen = null;
    if (open) openSource(open, { persist: !!jump });
    else closeDrawer({ persist: false });
    if (ws.focus?.source) highlightFocus(ws.focus.source);
  } else if (keepScroll != null) {
    window.scrollTo(0, keepScroll);
    if (S.pendingOpen) { openSource(S.pendingOpen); S.pendingOpen = null; }
  }
}

// Error states are part of the design: say what happened, what Cereal is still showing, and how to fix it.
function blockedBanner(c) {
  const blocked = (c.blocked || []).filter((b) => b.code === 'blocked');
  const missing = (c.blocked || []).filter((b) => b.code !== 'blocked');
  let html = '';
  if (blocked.length) {
    const kept = blocked.map((b) => b.retained).filter(Boolean);
    const docs = kept.reduce((n, r) => n + r.docs, 0);
    const repos = kept.reduce((n, r) => n + r.repos, 0);
    const history = kept.length
      ? `Last indexed ${esc(when(kept[0].indexedAt))}: ${[repos && plural(repos, 'repository', 'repositories'), docs && plural(docs, 'document')].filter(Boolean).join(' and ')}. Their contents stay hidden until access is back.`
      : 'Nothing has been read from them.';
    html += `<div class="blocked" role="status"><p><b>macOS is blocking Cereal from reading ${blocked.length === 1 ? 'one of ' : `${word(blocked.length)} of `}${esc(c.name)}’s folders.</b> ${history}</p>
      <p>${window.CEREAL_DEMO ? 'This sample blocks one folder on purpose, to show what Cereal does when macOS hides a folder: it keeps only counts, never the contents. Nothing is broken.' : 'To restore access, start Cereal from Terminal with <code>cd cereal &amp;&amp; npm start</code>, or allow it in System Settings › Privacy &amp; Security › Files and Folders, then choose Re-index.'}</p>
      <p><button type="button" class="btn sm" data-src="${enc({ type: 'retained', label: `What Cereal keeps about ${c.name}` })}">What Cereal keeps</button></p></div>`;
  }
  if (missing.length) html += `<div class="blocked" role="status"><p><b>${missing.length === 1 ? 'A folder' : `${word(missing.length)} folders`} Cereal was reading ${missing.length === 1 ? 'is' : 'are'} gone.</b> ${missing.map((b) => esc(tild(b.path))).join(', ')}</p><p>Choose Sources to remove ${missing.length === 1 ? 'it' : 'them'} or pick a new location.</p></div>`;
  return html;
}

function highlightFocus(src) {
  const key = enc(src);
  for (const b of view.querySelectorAll('[data-src]')) if (b.dataset.src === key) b.classList.add('was-focus');
}

const SECTION_FACTS = { attention: (c) => c.attention, changed: (c) => c.changed, left: (c) => c.leftOff.slice(1) };
function capsuleSection(title, key, facts, empty, limit = Infinity) {
  const shown = facts.slice(0, limit);
  return `<section class="cap-sec" id="sec-${key}"><h2 class="section-h">${esc(title)}${facts.length ? `<span class="count">${facts.length}</span>` : ''}</h2>
    ${facts.length ? `<ul class="facts">${shown.map((f) => fact(f)).join('')}</ul>${facts.length > shown.length ? `<button type="button" class="more" data-more="${key}">Show ${facts.length - shown.length} more</button>` : ''}` : `<p class="empty">${empty}</p>`}</section>`;
}

const wtRow = (g) => (w) => `<tr data-src="${enc({ type: 'worktree', path: w.path, label: `${base(w.path)} · ${w.branch || 'detached'}` })}" tabindex="0" class="${w.path === g.focus ? 'focus' : ''}">
  <td><span class="cell-main">${tk('file', base(w.path))}</span>${w.path === g.path ? ' ' + Badge('main', { variant: 'secondary' }) : ''}${w.path === g.focus ? ' ' + Badge('most active', { variant: 'brand' }) : ''}</td>
  <td>${Badge(esc(w.branch || (w.prunable ? '—' : 'detached')), { variant: 'outline', cls: 'ui-badge-mono' })}</td>
  <td>${w.last ? `${esc(w.last.subject.slice(0, 56))}<span class="cell-sub">${tk('sha', w.last.short || '')} ${esc(w.last.author || '')} · ${rel(w.last.date)}</span>` : w.prunable ? Badge('missing on disk', { variant: 'warning' }) : ''}</td>
  <td>${w.dirty ? Badge(`${w.dirty} uncommitted`, { variant: 'warning', title: 'Uncommitted tracked changes' }) : ''}</td></tr>`;

// The four detail tabs, as one segmented toggle. Counts live in each card's header, and in the tooltip.
function projectTabs(c) {
  const docs = Object.values(c.docs || {}).reduce((n, list) => n + list.length, 0);
  return [
    { id: 'decisions', label: 'Decisions', title: plural(c.decisions.length, 'decision') },
    { id: 'documents', label: 'Documents', title: plural(docs, 'document') },
    { id: 'git', label: 'Git', title: plural(c.git.reduce((n, g) => n + g.worktrees.length, 0), 'checkout') },
    { id: 'agents', label: 'Agents', title: plural(c.agents.total, 'linked session') },
  ];
}

const decisionTitle = (d) => (d.key ? d.text.replace(new RegExp(`^${d.key}\\s*[—–:-]\\s*`), '') : d.text);
function decisionStatus(d) {
  const t = String(d.detail || '').toLowerCase();
  if (d.unresolved || /unresolved|open|pending|needs/.test(t)) return Badge(`${Icon('alert')}Needs your call`, { variant: 'warning' });
  if (/superseded|rejected|reversed|dropped/.test(t)) return Badge('Superseded', { variant: 'secondary' });
  if (/approved|confirmed|accepted|decided|agreed/.test(t)) return Badge(`${Icon('check')}${/confirmed/.test(t) ? 'Confirmed' : 'Approved'}`, { variant: 'success' });
  return '';
}
const srcAttrs = (f) => (f.sources?.[0] ? ` data-src="${enc(f.sources[0])}" tabindex="0" role="button"` : '');
function decisionRow(d) {
  return `<li class="ui-row decision-row"${srcAttrs(d)}>
    ${d.key ? Badge(esc(d.key), { variant: 'outline', cls: 'ui-badge-mono row-key' }) : ''}
    <div class="ui-row-main"><p class="ui-row-title">${esc(decisionTitle(d))}</p>${d.detail ? `<p class="ui-row-sub">${esc(String(d.detail).slice(0, 220))}</p>` : ''}
    <div class="ui-row-meta">${provBadge(d.kind)}${(d.sources || []).slice(0, 1).map(srcChip).join('')}</div></div>
    <span class="ui-row-side">${decisionStatus(d)}</span></li>`;
}

const DOC_ORDER = ['decision', 'handoff', 'product', 'instructions', 'release', 'architecture', 'design', 'verification', 'notes'];
const DOC_NAMES = { decision: 'Decisions', handoff: 'Handoffs', product: 'Product & strategy', instructions: 'Instructions', release: 'Release', architecture: 'Architecture', design: 'Design', verification: 'Verification & tests', notes: 'Notes' };
const docRow = (d) => `<li><button type="button" class="doc ui-row" data-src="${enc({ type: 'doc', docId: d.id, path: d.path, line: 1, label: d.rel })}">${Icon('file', 'row-icon')}<span class="ui-row-main"><span class="d-title ui-row-title">${esc(d.title)}</span><span class="d-meta ui-row-meta">${pathHtml(d.rel)}<span>${esc(d.checkout)}</span>${d.branch ? Badge(esc(d.branch), { variant: 'outline', cls: 'ui-badge-mono' }) : ''}</span></span><span class="ui-row-side">${rel(d.mtime)}</span></button></li>`;

function tabPanel(c, tab) {
  if (tab === 'decisions') {
    const decisions = c.decisions.length
      ? Card({ title: 'Decisions', description: 'From decision records in your documents. Each opens where it was written.', action: Badge(String(c.decisions.length), { variant: 'secondary' }), body: `<ul class="ui-rows">${c.decisions.map(decisionRow).join('')}</ul>`, cls: 'flush' })
      : Card({ title: 'Decisions', body: '<p class="ui-empty">No decision records found. Cereal looks for headings like “D01 — …” or “ADR-012”.</p>' });
    const questions = c.questions.length
      ? Card({ title: `${Icon('alert')}Open questions`, description: 'Still waiting for an answer in the indexed documents.', action: Badge(String(c.questions.length), { variant: 'warning' }), body: `<ul class="ui-rows">${c.questions.map(decisionRow).join('')}</ul>`, cls: 'flush' })
      : Card({ title: 'Open questions', body: '<p class="ui-empty">None recorded in the indexed documents.</p>' });
    return decisions + questions;
  }
  if (tab === 'documents') {
    const groups = DOC_ORDER.filter((k) => c.docs[k]?.length);
    const total = groups.reduce((n, k) => n + c.docs[k].length, 0);
    const items = groups.map((k) => AccordionItem({ title: esc(DOC_NAMES[k]), meta: Badge(String(c.docs[k].length), { variant: 'secondary' }), open: ['decision', 'handoff', 'product'].includes(k), cls: 'docgroup', body: `<ul class="ui-rows">${c.docs[k].slice(0, 40).map(docRow).join('')}</ul>` }));
    if (c.references?.length) items.push(AccordionItem({ title: 'Design & reference files', meta: Badge(String(c.references.length), { variant: 'secondary' }), cls: 'docgroup', body: `<p class="hint">Listed by name only. Cereal never opens binary files.</p><ul class="ui-rows">${c.references.map((r) => `<li><button type="button" class="doc ui-row" data-src="${enc({ type: 'folder', path: r.path, label: r.rel })}">${Icon('folder', 'row-icon')}<span class="ui-row-main"><span class="d-title ui-row-title">${esc(base(r.rel))}</span><span class="d-meta ui-row-meta">${Badge(esc(r.kind.toUpperCase()), { variant: 'outline' })}${pathHtml(r.rel)}</span></span><span class="ui-row-side">${rel(r.mtime)}</span></button></li>`).join('')}</ul>` }));
    return items.length
      ? Card({ title: 'Documents', description: `${plural(total, 'document')} indexed read-only, grouped by what they are for.`, body: Accordion(items), cls: 'flush docs-card' })
      : Card({ title: 'Documents', body: '<p class="ui-empty">No documents indexed.</p>' });
  }
  if (tab === 'git') {
    if (!c.git.length) return Card({ title: 'Git', body: '<p class="ui-empty">No repository connected.</p>' });
    return c.git.map((g) => {
      const head = ['Checkout', 'Branch', 'Last commit', ''];
      const more = g.worktrees.length > 8 ? AccordionItem({ title: `Show ${g.worktrees.length - 8} more checkouts`, body: Table({ head, rows: g.worktrees.slice(8).map(wtRow(g)) }) }) : '';
      const branches = AccordionItem({ title: `${Icon('branch')}Recent branches`, meta: Badge(String(g.branches.length), { variant: 'secondary' }), body: `<ul class="ui-rows">${g.branches.map((b) => `<li class="ui-row static">${Badge(esc(b.name), { variant: 'outline', cls: 'ui-badge-mono' })}<span class="ui-row-main"><span class="ui-row-sub">${esc(b.subject.slice(0, 80))}</span></span><span class="ui-row-side">${rel(b.date)}</span></li>`).join('')}</ul>` });
      return Card({
        cls: 'flush repo',
        title: `${Icon('folder')}${esc(base(g.path))}`,
        description: pathHtml(g.path),
        action: Badge(`${Icon('shield')}Read-only`, { variant: 'outline', title: 'Cereal reads Git without taking locks or changing anything' }),
        body: `${Stats([[g.worktrees.length, 'checkouts'], [g.branchTotal, 'branches'], [g.commitCount14d, 'commits in 14 days']])}
          ${Table({ head, rows: g.worktrees.slice(0, 8).map(wtRow(g)), cls: 'wt' })}
          ${Accordion([more, branches].filter(Boolean), 'repo-more')}`,
      });
    }).join('');
  }
  return c.agents.recent.length
    ? Card({ title: 'Agent sessions', description: `${plural(c.agents.total, 'session')} linked from the last three weeks. Read-only: Cereal never starts or resumes agents for you.`, action: Badge(String(c.agents.total), { variant: 'secondary' }), body: `<ul class="ui-rows agents">${c.agents.recent.map(agentRow).join('')}</ul>`, cls: 'flush' })
    : Card({ title: 'Agent sessions', body: '<p class="ui-empty">No Claude Code or Codex sessions are linked to this project. Sessions are linked when they run inside an approved checkout, or when their file paths clearly point into one.</p>' });
}

// ---------- Morning Briefing ----------
// The edition, delivered: a preview of tomorrow's email, past briefings, and when and where it goes.

const timeLabel = (iso, tz) => new Date(iso).toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit', timeZone: tz });
function briefingStatusLine(st) {
  const s = st.settings;
  const last = st.last;
  const lastBit = last ? (last.status === 'sent' ? `Last one delivered ${rel(last.at)}.` : `The last one didn’t send${last.error ? `: ${last.error}` : ''}.`) : '';
  if (s.unsubscribed) return { tone: 'off', text: 'You unsubscribed. Turn it back on below whenever you like.' };
  if (!s.enabled) return { tone: 'off', text: `Email is off. ${s.verified ? 'Turn it on below.' : 'Verify an address below to turn it on.'}` };
  if (s.paused) return { tone: 'paused', text: `Paused. ${lastBit}` };
  return { tone: 'on', text: `Next briefing ${st.next ? timeLabel(st.next, s.timeZone) : 'soon'}. ${lastBit}` };
}

function briefingEntry(st) {
  if (!st) return '';
  const line = briefingStatusLine(st);
  return `<a class="briefing-entry tone-${line.tone}" href="#/briefing"><span class="be-mark" aria-hidden="true"></span><span class="be-body"><span class="be-title">Morning Briefing</span><span class="be-status">${st.settings.enabled ? esc(line.text) : 'Start your day with Cereal. Get this edition in your inbox every morning.'}</span></span><span class="be-go">${st.settings.enabled ? 'Manage' : 'Set it up'} →</span></a>`;
}

async function renderBriefing() {
  document.title = 'Morning Briefing · Cereal';
  S.current = null;
  renderChrome();
  if (!S.briefing) view.innerHTML = `<section class="briefing-page"><p class="kicker">Morning Briefing</p><h1 class="bp-title">Start your day with Cereal.</h1><div class="skeleton tall"></div></section>`;
  try {
    const [st, pv] = await Promise.all([api('/api/briefing'), api('/api/briefing/preview').catch((e) => ({ error: e.message }))]);
    S.briefing = { tab: 'preview', device: 'desktop', theme: 'light', viewing: null, ...(S.briefing || {}), st, pv };
    paintBriefing();
  } catch (e) { errorView(e, renderBriefing); }
}

function mailFrame({ subject, preheader, html, from = 'Cereal' }, { device, theme }) {
  const doc = (theme === 'dark' ? html.replace('@media (prefers-color-scheme:dark){', '@media all{') : html).replace('<head>', '<head><base target="_top">');
  return `<div class="mail ${device === 'mobile' ? 'is-mobile' : ''} ${theme === 'dark' ? 'is-dark' : ''}">
    <div class="mail-head"><p class="mail-from"><span class="mail-avatar" aria-hidden="true"></span><b>${esc(from)}</b><span class="muted">briefing@cereal</span></p><p class="mail-subject">${esc(subject)}</p>${preheader ? `<p class="mail-pre">${esc(preheader)}</p>` : ''}</div>
    <iframe class="mail-body" title="${esc(subject)}" sandbox="allow-same-origin allow-top-navigation-by-user-activation allow-popups" srcdoc="${esc(doc)}"></iframe>
  </div>`;
}

const segmented = (name, value, options) => `<div class="ui-tabs-list ui-tabs-segmented mini" role="group">${options.map(([v, l]) => `<button type="button" class="ui-tabs-trigger" data-bset="${name}" data-value="${v}" data-state="${v === value ? 'active' : 'inactive'}" aria-pressed="${v === value}">${l}</button>`).join('')}</div>`;

function paintBriefing() {
  const B = S.briefing;
  const { st, pv } = B;
  const s = st.settings;
  const line = briefingStatusLine(st);
  const preview = pv.error
    ? `<p class="ui-empty">Couldn’t build a preview: ${esc(pv.error)}</p>`
    : `<div class="mail-tools">${segmented('device', B.device, [['desktop', 'Desktop'], ['mobile', 'Phone']])}${segmented('theme', B.theme, [['light', 'Light'], ['dark', 'Dark']])}<span class="grow"></span><span class="muted small-note">Built now from your projects. Links open the work in Cereal.</span></div>${mailFrame(pv, B)}`;
  const history = st.history.length
    ? Card({ cls: 'flush', title: 'Previous briefings', description: 'The last thirty, kept on this Mac.', body: `<ul class="ui-rows">${st.history.map((h) => `<li class="ui-row" data-bhistory="${esc(h.id)}" role="button" tabindex="0">${Icon('archive', 'row-icon')}<span class="ui-row-main"><span class="ui-row-title">${esc(h.subject)}</span><span class="ui-row-meta">${Badge(h.kind === 'test' ? 'Test' : 'Morning', { variant: h.kind === 'test' ? 'outline' : 'secondary' })}${Badge(h.status === 'sent' ? `${Icon('check')}Delivered` : 'Not sent', { variant: h.status === 'sent' ? 'success' : 'destructive' })}</span></span><span class="ui-row-side">${esc(when(h.at))}</span></li>`).join('')}</ul>` }) + (B.viewing ? `<div class="history-view">${mailFrame(B.viewing, B)}</div>` : '')
    : Card({ title: 'Previous briefings', body: '<p class="ui-empty">None yet. Your first briefing will appear here after it’s delivered, along with any test emails.</p>' });
  const tzs = (Intl.supportedValuesOf?.('timeZone') || [s.timeZone]);
  const verify = st.pendingVerification
    ? `<div class="field-row"><input class="ui-input code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6-digit code"><button type="button" class="ui-button ui-button-sm" data-bact="verify">Verify</button><button type="button" class="ui-button ui-button-ghost ui-button-sm" data-bact="send-code">Send again</button></div><p class="small-note">${st.provider.external ? `We emailed a code to ${esc(st.pendingVerification.email)}.` : `No email provider is set up, so nothing was sent. ${B.demoCode || B.localCode ? `Your code is <b class="mono">${esc(B.demoCode || B.localCode)}</b>; it works only on this Mac.` : 'Send a code to see it here.'}`}</p>`
    : '';
  const provider = st.provider;
  const providerCard = provider.name === 'demo'
    ? Card({ title: 'Email provider', description: 'This demo never sends email. Everything stays in this browser.', body: '<p class="small-note">Run Cereal on your Mac to deliver a real briefing.</p>' })
    : provider.external && provider.managedBy === 'app'
      ? Card({ title: 'Email provider', description: `Sending through ${esc(provider.label)}.`, body: `
        <div class="mail-provider"><span class="mono">${esc(provider.from)}</span><span class="muted small-note">Key ${esc(provider.keyHint || '')}</span><span class="grow"></span><button type="button" class="ui-button ui-button-ghost ui-button-sm danger" data-bact="clear-mail">Remove key</button></div>
        <p class="small-note">The key is saved on this Mac in a file only you can read. It is never sent in an email or shown again.</p>` })
      : provider.external
        ? Card({ title: 'Email provider', description: `Sending through ${esc(provider.label)}, set by the environment.`, body: '<p class="small-note">To manage it here instead, unset <code>CEREAL_MAIL_PROVIDER</code>, <code>RESEND_API_KEY</code> and <code>CEREAL_MAIL_FROM</code>, then save a key below.</p>' })
        : Card({ title: 'Email provider', description: 'Cereal sends through Resend. Until one is set up, briefings are written to an outbox on this Mac and never sent.', body: `
          <div class="field"><label class="ui-label" for="resendFrom">Sending address</label><input class="ui-input" id="resendFrom" name="resendFrom" placeholder="Cereal &lt;briefing@yourdomain.com&gt;" autocomplete="off"></div>
          <div class="field"><label class="ui-label" for="resendKey">Resend API key</label><input class="ui-input mono" id="resendKey" name="resendKey" type="password" placeholder="re_…" autocomplete="off"></div>
          <p class="small-note">Create a free account at <b>resend.com</b>, verify a domain (or use <span class="mono">onboarding@resend.dev</span> to email yourself), then paste the key here. Verification and test sends use it immediately.</p>`,
          footer: `<button type="button" class="ui-button ui-button-sm" data-bact="save-mail">Save provider</button>` });
  const delivery = `
    <form id="briefingForm" class="briefing-form" autocomplete="off">
    ${Card({ title: 'Email', description: 'Off until you turn it on. One email each morning, never one per project.', action: s.verified ? Badge(`${Icon('check')}Verified`, { variant: 'success' }) : Badge('Not verified', { variant: 'outline' }), body: `
      <label class="ui-switch-row"><span><b>Send me the morning briefing</b><span class="small-note">${s.verified ? esc(s.email) : 'Verify an address first.'}</span></span><input type="checkbox" class="ui-switch" name="enabled" ${s.enabled ? 'checked' : ''} ${s.verified ? '' : 'disabled'}></label>
      <div class="field"><label class="ui-label" for="bEmail">Email address</label><div class="field-row"><input class="ui-input" id="bEmail" name="email" type="email" placeholder="you@studio.com" value="${esc(st.pendingVerification?.email || s.email || '')}"><button type="button" class="ui-button ui-button-outline ui-button-sm" data-bact="send-code">${s.verified ? 'Change' : 'Send code'}</button></div></div>
      ${verify}` })}
    ${Card({ title: 'When', description: st.next ? `Next: ${esc(timeLabel(st.next, s.timeZone))}.` : 'Choose a time; nothing is sent until the briefing is on.', body: `
      <div class="field-grid">
        <div class="field"><label class="ui-label" for="bTime">Time</label><input class="ui-input" id="bTime" name="time" type="time" value="${esc(s.time)}" step="900"></div>
        <div class="field"><label class="ui-label" for="bTz">Time zone</label><select class="ui-input" id="bTz" name="timeZone">${tzs.map((z) => `<option ${z === s.timeZone ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></div>
      </div>
      <div class="field"><span class="ui-label">Days</span>${segmented('cadence', s.cadence, [['daily', 'Every day'], ['weekdays', 'Weekdays']])}</div>
      <p class="small-note">Daylight saving is handled for you. If your Mac is asleep at ${esc(s.time)}, the briefing goes out when it wakes, until early afternoon.</p>` })}
    ${Card({ title: 'What’s included', description: 'Only the projects you choose, and only short summaries.', body: `
      <div class="checks">${st.projects.filter((p) => p.connected).map((p) => `<label class="ui-check"><input type="checkbox" name="project" value="${esc(p.id)}" ${!s.projects || s.projects.includes(p.id) ? 'checked' : ''}><span class="check-dot" style="--p-accent:${esc(p.accent || '#6E5FE8')}"></span>${esc(p.name)}</label>`).join('')}</div>
      <div class="field"><span class="ui-label">Detail</span>${segmented('detail', s.detail, [['full', 'Titles and summaries'], ['minimal', 'Headlines only']])}</div>
      <p class="small-note privacy">${Icon('shield')}<span>Sending a briefing through an email provider gives that provider the summary text. Cereal never includes files, document text, agent conversations, file paths or anything that looks like a secret. <b>Headlines only</b> leaves out the names of commits, sessions and decisions too.</span></p>` })}
    ${Card({ title: 'In the news', description: 'Recent headlines about what each project is building, from Google News and Hacker News.', action: s.news?.enabled ? Badge(`${Icon('check')}On`, { variant: 'success' }) : Badge('Off', { variant: 'outline' }), body: `
      <label class="ui-switch-row"><span><b>Add relevant news to the briefing</b><span class="small-note">Up to three headlines per project, each one matching a topic below.</span></span><input type="checkbox" class="ui-switch" name="newsEnabled" ${s.news?.enabled ? 'checked' : ''}></label>
      ${st.projects.filter((p) => p.connected).map((p) => `<div class="field"><label class="ui-label" for="news-${esc(p.id)}"><span class="check-dot" style="--p-accent:${esc(p.accent || '#6E5FE8')};display:inline-block;margin-right:6px"></span>${esc(p.name)} topics</label><input class="ui-input" id="news-${esc(p.id)}" name="newsTopics" data-project="${esc(p.id)}" value="${esc((p.newsTopics || []).join(', '))}" placeholder="e.g. anonymous video calls, habit tracking"><p class="small-note">${p.newsTopicsCustom ? 'Your topics.' : 'Suggested from the project’s description. Edit to make them yours.'} Separate with commas, up to four.</p></div>`).join('')}
      <p class="small-note privacy">${Icon('shield')}<span>Only these topic words are sent, to Google News and Hacker News, when a briefing is written. Nothing from your projects goes with them. Each headline says which topic it matched.</span></p>` })}
    ${providerCard}
    ${Card({ title: 'Delivery', description: st.provider.external ? `When and how each briefing goes out.` : 'Without a provider, briefings are saved to an outbox on this Mac instead of being sent.', body: Fields([
      ['Status', `<span class="dot-status tone-${line.tone}"></span>${esc(line.text)}`],
      ['Scheduler', 'Runs while Cereal is open. For mornings when it’s closed, install the background scheduler with <code>npm run briefing:launchd -- --install</code>.'],
    ]), footer: `<button type="button" class="ui-button ui-button-sm" data-bact="test" ${s.verified ? '' : 'disabled'}>${Icon('sparkles')}<span>Send test email</span></button>
      ${s.enabled ? `<button type="button" class="ui-button ui-button-outline ui-button-sm" data-bact="${s.paused ? 'resume' : 'pause'}">${s.paused ? 'Resume' : 'Pause'}</button><button type="button" class="ui-button ui-button-ghost ui-button-sm danger" data-bact="unsubscribe">Unsubscribe</button>` : ''}
      <span class="small-note" id="bMsg" role="status"></span>` })}
    </form>`;
  view.innerHTML = `<section class="briefing-page">
    <p class="kicker">Morning Briefing</p>
    <h1 class="bp-title">Start your day with Cereal.</h1>
    <p class="bp-lede">Your morning read on everything you’re building: what moved, where you left off, and the one thing worth your attention today.</p>
    <p class="bp-status tone-${line.tone}"><span class="dot-status tone-${line.tone}"></span>${esc(line.text)}</p>
    ${Tabs({ id: 'briefingTabs', value: B.tab, cls: 'bp-tabs', items: [
      { value: 'preview', label: '<span class="tab-full">Tomorrow’s briefing</span><span class="tab-short">Tomorrow</span>', ariaLabel: 'Tomorrow’s briefing', panel: preview },
      { value: 'history', label: 'Previous', panel: history },
      { value: 'delivery', label: 'Delivery', panel: delivery },
    ] })}
  </section>`;
  $('#briefingTabs .ui-tabs-list').classList.add('ui-tabs-segmented');
  for (const f of view.querySelectorAll('iframe.mail-body')) f.addEventListener('load', () => { try { f.style.height = `${f.contentDocument.documentElement.scrollHeight + 4}px`; } catch { /* cross-origin */ } });
}

async function saveBriefing(patch, msg) {
  const out = $('#bMsg');
  try {
    S.briefing.st = await post('/api/briefing/settings', patch);
    paintBriefing();
    if (msg && $('#bMsg')) $('#bMsg').textContent = msg;
  } catch (e) { if (out) out.textContent = e.message; else alert(e.message); }
}

async function briefingAction(act, t) {
  const B = S.briefing;
  const say = (m) => { const o = $('#bMsg'); if (o) o.textContent = m; };
  if (act === 'send-code') {
    const email = $('#briefingForm [name=email]').value.trim();
    t.disabled = true;
    try { const r = await post('/api/briefing/verify', { email }); B.demoCode = r.demoCode || null; B.localCode = r.code || null; B.st = await api('/api/briefing'); paintBriefing(); $('#briefingForm [name=code]')?.focus(); }
    catch (e) { t.disabled = false; alert(e.message); }
    return;
  }
  if (act === 'save-mail') {
    const key = $('#briefingForm [name=resendKey]').value.trim();
    const from = $('#briefingForm [name=resendFrom]').value.trim();
    t.disabled = true;
    try {
      B.st = await post('/api/briefing/mail', { key, from });
      B.st = await api('/api/briefing');
      paintBriefing();
      const o = $('#bMsg'); if (o) o.textContent = `Sending through Resend as ${B.st.provider.from}. Send a test to check it.`;
    } catch (e) { t.disabled = false; alert(e.message); }
    return;
  }
  if (act === 'clear-mail') {
    if (!confirm('Remove the email provider from this Mac? Briefings will go back to the local outbox until you set another one.')) return;
    try {
      B.st = await post('/api/briefing/mail/clear');
      B.st = await api('/api/briefing');
      paintBriefing();
      const o = $('#bMsg'); if (o) o.textContent = 'Provider removed. Briefings are saved to the outbox on this Mac.';
    } catch (e) { alert(e.message); }
    return;
  }
  if (act === 'verify') {
    try { await post('/api/briefing/verify/confirm', { code: $('#briefingForm [name=code]').value }); B.demoCode = null; B.localCode = null; B.st = await api('/api/briefing'); paintBriefing(); say('Address verified. Turn the briefing on when you’re ready.'); }
    catch (e) { alert(e.message); }
    return;
  }
  if (act === 'test') {
    t.disabled = true; say('Sending…');
    try {
      const r = await post('/api/briefing/test');
      B.st = await api('/api/briefing'); paintBriefing();
      say(r.ok ? (r.provider === 'outbox' ? 'Saved to the outbox on this Mac. Open Previous to read it.' : `Sent to ${B.st.settings.email}.`) : `Didn’t send: ${r.error}`);
    } catch (e) { say(e.message); t.disabled = false; }
    return;
  }
  if (act === 'pause') return saveBriefing({ paused: true }, 'Paused. Nothing will be sent until you resume.');
  if (act === 'resume') return saveBriefing({ paused: false }, 'Resumed.');
  if (act === 'unsubscribe') { if (confirm('Stop the morning briefing emails? You can turn them back on any time.')) return saveBriefing({ enabled: false }, 'Unsubscribed. No more emails.'); }
}

async function openBriefingLink(bid, n) {
  try {
    const hit = await api(`/api/briefing/open/${encodeURIComponent(bid)}/${encodeURIComponent(n)}`);
    goProject(hit.projectId, { open: hit.src });
  } catch (e) { errorView(e, () => openBriefingLink(bid, n)); }
}

// ---------- Sources (discovery & approval) ----------

async function renderSources(id) {
  const p = project(id) || (await loadState().catch(() => null), project(id));
  if (!p) return errorView(new Error(`No project “${id}”`));
  document.title = `${p.name} folders · Cereal`;
  renderChrome();
  view.innerHTML = `<section class="sources"><h1>Which folders belong to ${esc(p.name)}?</h1><p class="lead">Looking for ${esc(p.name)} in Git metadata…</p><div class="skeleton tall"></div></section>`;
  let disc;
  try { disc = await api(`/api/projects/${id}/discovery`); } catch (e) { return errorView(e, () => renderSources(id)); }
  paintSources(p, disc);
}

function paintSources(p, disc) {
  const cands = disc.candidates || [];
  const anyApproved = cands.some((c) => c.approved);
  const checked = (c) => (anyApproved ? c.approved : c.recommended);
  view.innerHTML = `<section class="sources">
    <h1>Which folders belong to ${esc(p.name)}?</h1>
    <p class="lead">Cereal groups folders by Git repository, so every worktree of a repo counts once. Nothing is read until you approve it, and indexing never changes a file. Secrets, <code>.env</code> files, keys, dependencies and build output are always skipped.</p>
    ${disc.blocked?.length ? `<div class="blocked" role="status"><p><b>macOS is blocking Cereal from looking in ${disc.blocked.map((b) => esc(tild(b))).join(' and ')}.</b></p><p>Start Cereal from Terminal with <code>cd cereal &amp;&amp; npm start</code>, or allow access in System Settings › Privacy &amp; Security › Files and Folders, then choose Look again.</p></div>` : ''}
    ${cands.length ? '' : `<div class="empty-card"><p>No folders for ${esc(p.name)} turned up in the usual places. Choose one yourself.</p></div>`}
    <form id="srcForm"><ul class="cands">${cands.map((c) => `<li class="cand ${c.canonical ? 'canonical' : ''}">
      <label><input type="checkbox" name="c" value="${esc(c.id)}" ${checked(c) ? 'checked' : ''}>
      <div class="cand-body"><p class="cand-title">${esc(c.label)} <span class="kind">${c.kind === 'repository' ? 'Git repository' : 'Documents folder'}</span>${c.canonical ? '<span class="tag hot">Main source</span>' : ''}${c.manual ? '<span class="tag">Added by you</span>' : ''}</p>
      <p class="cand-path mono">${esc(tild(c.path))}</p>
      <ul class="evidence">${(c.evidence || []).map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
      ${c.note ? `<p class="cand-note">${esc(c.note)}</p>` : ''}
      ${c.worktrees?.length > 1 ? `<details><summary>${c.worktrees.length} checkouts</summary><ul class="wtlist">${c.worktrees.map((w) => `<li>${esc(base(w.path))}, ${esc(w.branch || 'detached')}${w.prunable ? ', <i>missing</i>' : ''}${w.last ? `: ${esc(w.last.subject.slice(0, 60))} (${rel(w.last.date)})` : ''}</li>`).join('')}</ul></details>` : ''}
      </div></label></li>`).join('')}</ul>
    ${disc.unrelated?.length ? `<p class="hint">Left out as unrelated: ${disc.unrelated.map((u) => esc(tild(u.path))).join(', ')}</p>` : ''}
    <div class="src-actions"><button type="button" class="btn quiet" data-act="pick">Choose a folder…</button><button type="button" class="btn quiet" data-act="rescan">Look again</button><span class="grow"></span><button type="submit" class="btn primary">Approve and index</button></div>
    </form><p class="status-msg" id="srcStatus" role="status"></p></section>`;
}

// ---------- Screen C: Context Switcher ----------

// Typing in the switcher picks the project whose name starts with (or else contains) what was typed.
function typeInSwitcher(key) {
  clearTimeout(S.swQueryTimer);
  S.swQuery = (S.swQuery || '') + key.toLowerCase();
  S.swQueryTimer = setTimeout(() => { S.swQuery = ''; if (!switcher.hidden) paintSwitcher(); }, 1200);
  const names = S.state.projects.map((p) => p.name.toLowerCase());
  let i = names.findIndex((n) => n.startsWith(S.swQuery));
  if (i < 0) i = names.findIndex((n) => n.includes(S.swQuery));
  if (i >= 0) S.swIndex = i;
  paintSwitcher();
}

function openSwitcher() {
  if (!S.state) return;
  S.swQuery = '';
  S.swIndex = Math.max(0, S.state.projects.findIndex((p) => p.id !== S.current));
  paintSwitcher();
  switcher.hidden = false;
  $('.sw-item.active', switcher)?.focus();
}
function closeSwitcher() { switcher.hidden = true; }

function paintSwitcher() {
  const ps = S.state.projects;
  const notes = S.state.notifications.slice(-4).reverse();
  switcher.innerHTML = `<div class="sw-backdrop" data-act="close-sw"></div><div class="sw-panel">
    <div class="sw-head"><span>Switch project${S.swQuery ? ` <span class="sw-query">${esc(S.swQuery)}</span>` : ''}</span><span class="muted">Type a name or <kbd>↑</kbd><kbd>↓</kbd>, <kbd>↵</kbd> to open</span></div>
    <ul class="sw-list">${ps.map((p, i) => {
      const c = S.capsules[p.id];
      const resume = c?.resume?.[0] || null;
      const isCur = p.id === S.current && S.route.name === 'project';
      return `<li><div class="sw-item ${i === S.swIndex ? 'active' : ''} ${p.brand.mode}" style="${brandVars(p.brand)}" data-sw="${i}" tabindex="-1" role="option" aria-selected="${i === S.swIndex}">
        ${icon(p, 'md')}
        <div class="sw-body"><p class="sw-name">${esc(p.name)} ${isCur ? '<span class="tag">current</span>' : ''} <span class="sw-state">${esc(p.state.label)}</span></p>
        <p class="sw-changes">${!p.connected ? 'Not connected yet' : !p.lastVisitAt ? 'Not opened yet' : p.counts.changes ? `<b>${plural(p.counts.changes, 'change')}</b> since you left ${rel(p.lastVisitAt)}` : `Nothing new since you left ${rel(p.lastVisitAt)}`}${p.agents.active.length ? `<span class="live-dot"></span>${word(p.agents.active.length)} working` : ''}</p>
        ${(c?.leftOff?.[0] || p.leftOff?.[0]) ? `<p class="sw-resume">${esc((c?.leftOff?.[0] || p.leftOff[0]).text)}</p>` : resume ? `<p class="sw-resume">${esc(resume.label)}</p>` : ''}</div>
        <span class="sw-key">${i + 1}</span></div></li>`;
    }).join('')}</ul>
    ${notes.length ? `<div class="sw-notes"><p class="muted">Recent</p>${notes.map((n) => `<button type="button" class="sw-note" data-note="${n.id}">${pchip(project(n.projectId))}${esc(n.text)} <span class="muted">${esc(n.tool === 'codex' ? 'Codex' : n.kind === 'commit' ? 'New commit' : 'Claude Code')}, ${rel(n.at)}</span></button>`).join('')}</div>` : ''}
  </div>`;
}

function chooseSwitcher(i) {
  const p = S.state.projects[i];
  closeSwitcher();
  if (!p) return;
  if (!p.connected) location.hash = `#/p/${p.id}/sources`;
  else goProject(p.id);
}

// ---------- Source drawer ----------

const KIND = { doc: ['file', 'Document'], commit: ['commit', 'Commit'], session: ['bot', 'Agent session'], worktree: ['branch', 'Checkout'], folder: ['folder', 'Folder'], retained: ['archive', 'What Cereal keeps'] };
const sheetProject = (p) => (p ? ` <span class="sheet-project">· ${icon(p, 'xs')}${esc(p.name)}</span>` : '');

// git show --stat, read back into its parts: who, when, what, and which files.
function parseCommit(text) {
  const lines = String(text || '').split('\n');
  const [sha = '', who = '', date = ''] = lines;
  const m = /^(.*?)\s*<([^>]*)>$/.exec(who) || [];
  const files = [];
  const msg = [];
  let summary = '';
  for (const l of lines.slice(3)) {
    const f = /^\s(\S.*?)\s+\|\s+(\d+|Bin.*?)\s*(\+*)(-*)\s*$/.exec(l);
    if (f) { files.push({ path: f[1], n: Number(f[2]) || 0, plus: f[3].length, minus: f[4].length }); continue; }
    if (/^\s\d+ files? changed/.test(l)) { summary = l.trim(); continue; }
    if (!files.length) msg.push(l);
  }
  const num = (re) => Number(re.exec(summary)?.[1] || 0);
  const body = msg.join('\n').trim().split('\n');
  return { sha, author: m[1] || who, email: m[2] || '', date, subject: body[0] || '', body: body.slice(1).join('\n').trim(), files, summary, adds: num(/(\d+) insertions?/), dels: num(/(\d+) deletions?/) };
}
const diffBar = (plus, minus) => {
  const a = Math.round((plus / (plus + minus || 1)) * 5);
  return `<span class="diffbar" aria-hidden="true">${Array.from({ length: 5 }, (_, i) => `<i class="${i < a ? 'add' : 'del'}"></i>`).join('')}</span>`;
};

function docOutline(text) {
  const out = [];
  String(text || '').split('\n').forEach((l, i) => { const h = /^(#{1,4})\s+(.*)$/.exec(l); if (h) out.push({ level: h[1].length, text: h[2].replace(/[*`]/g, ''), line: i + 1 }); });
  return out;
}

const sheetIntro = (title, meta = '', actions = '') => `<div class="sheet-intro"><h2 class="dr-title">${title}</h2>${meta ? `<p class="dr-path">${meta}</p>` : ''}${actions ? `<div class="dr-actions">${actions}</div>` : ''}</div>`;
const rowsOf = (items, empty) => (items.length ? `<ul class="ui-rows">${items.join('')}</ul>` : `<p class="ui-empty pad">${empty}</p>`);
const fileRow = (p, side = '') => `<li class="ui-row static">${Icon('file', 'row-icon')}<span class="ui-row-main"><span class="ui-row-title mono-title">${pathHtml(p)}</span></span>${side ? `<span class="ui-row-side">${side}</span>` : ''}</li>`;

async function openSource(src, { persist = true } = {}) {
  const pid = S.current;
  if (!pid || !src) return;
  const p = project(pid);
  const [kindIcon, kindLabel] = KIND[src.type] || ['info', src.type];
  S.drawerSrc = src;
  drawer.setAttribute('aria-hidden', 'false');
  drawer.setAttribute('style', brandVars(p?.brand));
  drawer.classList.add('open');
  document.body.classList.add('drawer-open');
  drawer.innerHTML = `${SheetHeader({ icon: kindIcon, kind: kindLabel, project: sheetProject(p) })}<div class="dr-body"><div class="skeleton"></div></div>`;
  if (persist) {
    const focus = { label: src.label, source: src };
    if (S.capsules[pid]) S.capsules[pid].workspace = { ...(S.capsules[pid].workspace || {}), focus, drawer: src };
    post(`/api/projects/${pid}/workspace`, { focus, drawer: src }).catch(() => {});
  }
  const body = $('.dr-body', drawer);
  try {
    if (src.type === 'doc') body.innerHTML = await docSheet(pid, src);
    else if (src.type === 'commit') body.innerHTML = await commitSheet(pid, src);
    else if (src.type === 'session') body.innerHTML = await sessionSheet(pid, src);
    else if (src.type === 'retained') body.innerHTML = await retainedSheet(pid, src, p);
    else if (src.type === 'worktree' || src.type === 'folder') body.innerHTML = checkoutSheet(pid, src);
    if (src.type === 'doc') {
      // Documents always open at the top. A cited line is marked, and one click away.
      const line = body.querySelector(`.mdoc [data-line="${src.line || 1}"]`);
      if (line && src.line > 1) line.classList.add('hl');
      body.scrollTop = 0;
    }
  } catch (e) {
    body.innerHTML = `<p class="ui-empty">Couldn’t open this source: ${esc(e.message)}</p>`;
  }
}

async function docSheet(pid, src) {
  const d = await api(`/api/projects/${pid}/doc/${src.docId}`);
  const readable = !d.refused && !d.missing;
  const words = readable ? String(d.text).split(/\s+/).filter(Boolean).length : 0;
  const outline = readable ? docOutline(d.text) : [];
  const meta = `${pathHtml(d.display || d.rel)}${d.branch ? Badge(`${Icon('branch')}${esc(d.branch)}`, { variant: 'outline', cls: 'ui-badge-mono' }) : ''}${d.mtime ? Badge(`${Icon('clock')}Edited ${esc(rel(d.mtime))}`, { variant: 'secondary', title: when(d.mtime) }) : ''}${readable ? Badge(`${Math.max(1, Math.round(words / 230))} min read`, { variant: 'secondary' }) : ''}`;
  const actions = `${readable ? `<button class="ui-button ui-button-sm summarize" data-summarize="${esc(src.docId)}">${Icon('sparkles')}<span>Summarize</span></button>` : ''}
    ${readable && src.line > 1 ? `<button class="ui-button ui-button-outline ui-button-sm" data-jump-line="${src.line}">Jump to line ${src.line}</button>` : ''}
    <button class="ui-button ui-button-ghost ui-button-sm" data-reveal="${esc(d.path)}">${Icon('finder')}Reveal in Finder</button>`;
  const details = Card({ title: 'About this document', body: Fields([
    ['Path', pathHtml(d.display || d.rel)],
    d.checkout && ['Checkout', `${tk('file', d.checkout)}${d.branch ? ' ' + Badge(esc(d.branch), { variant: 'outline', cls: 'ui-badge-mono' }) : ''}`],
    d.category && ['Kind', esc(DOC_NAMES[d.category] || d.category)],
    d.mtime && ['Last edited', `${esc(when(d.mtime))} <span class="muted">${esc(rel(d.mtime))}</span>`],
    readable && ['Length', `${words.toLocaleString()} words, ${plural(String(d.text).split('\n').length, 'line')}`],
    ['Access', `${Badge(`${Icon('shield')}Read-only`, { variant: 'outline' })}<span>Opened from disk, never sent anywhere</span>`],
  ]) });
  if (!readable) return sheetIntro(esc(d.title), meta, actions) + `<p class="ui-empty">${d.refused ? esc(d.refused) : 'This file is no longer on disk. Re-index to refresh.'}</p>${details}`;
  const outlineRows = outline.map((h) => `<li class="ui-row" data-jump-line="${h.line}" role="button" tabindex="0" style="--lvl:${h.level - 1}"><span class="ui-row-main"><span class="ui-row-title">${esc(h.text)}</span></span><span class="ui-row-side">${tk('num', `L${h.line}`)}</span></li>`);
  return sheetIntro(esc(d.title), meta, actions) + '<div class="doc-summary" id="docSummary" hidden></div>' + Tabs({ id: 'docTabs', value: 'read', cls: 'sheet-tabs', items: [
    { value: 'read', label: 'Document', panel: `<article class="mdoc">${renderDoc(d.text)}</article>` },
    { value: 'outline', label: 'Outline', count: outline.length || null, panel: Card({ cls: 'flush outline', body: rowsOf(outlineRows, 'No headings in this document.') }) },
    { value: 'details', label: 'Details', panel: details },
  ] });
}

async function commitSheet(pid, src) {
  const c = await api(`/api/projects/${pid}/commit/${src.sha}?repo=${encodeURIComponent(src.repo)}`);
  const k = parseCommit(c.text);
  const subject = k.subject || String(src.label).split(' · ').slice(1).join(' · ') || src.label;
  const overview = Card({ title: 'Commit', description: 'Read straight from Git. Cereal changed nothing to show it.', action: provBadge('git'), body: Fields([
    ['Author', `<span>${esc(k.author)}</span>${k.email ? `<span class="muted">${esc(k.email)}</span>` : ''}`],
    k.date && ['Committed', `<span>${esc(when(k.date))}</span><span class="muted">${esc(rel(k.date))}</span>`],
    ['SHA', `<span class="mono">${tk('sha', k.sha || src.sha)}</span>`],
    ['Repository', pathHtml(c.repo)],
    k.body && ['Message', `<span class="pre">${esc(k.body)}</span>`],
    k.summary && ['Changes', `${Badge(plural(k.files.length || 1, 'file'), { variant: 'secondary' })}${k.adds ? Badge(`+${k.adds}`, { variant: 'success' }) : ''}${k.dels ? Badge(`−${k.dels}`, { variant: 'destructive' }) : ''}`],
  ]) });
  const files = rowsOf(k.files.map((x) => fileRow(x.path, `${tk('num', String(x.n))} ${diffBar(x.plus, x.minus)}`)), 'No file list in this commit.');
  return sheetIntro(esc(subject), `${Badge(esc(src.sha.slice(0, 10)), { variant: 'outline', cls: 'ui-badge-mono' })}${pathHtml(c.repo)}`) + Tabs({ id: 'commitTabs', value: 'overview', cls: 'sheet-tabs', items: [
    { value: 'overview', label: 'Overview', panel: overview },
    { value: 'files', label: 'Files', count: k.files.length || null, panel: Card({ cls: 'flush', title: esc(k.summary || 'Files'), body: files }) },
    { value: 'raw', label: 'Raw', panel: gitShow(c.text) },
  ] });
}

async function sessionSheet(pid, src) {
  const s = await api(`/api/projects/${pid}/session/${encodeURIComponent(src.id)}`);
  const at = s.attribution || {};
  const cmd = s.cwd ? `cd ${JSON.stringify(s.cwd)} && ${s.resume}` : s.resume;
  const meta = `${Badge(esc(TOOL[s.tool] || 'Agent'), { variant: 'secondary' })}${statusBadge(s.status)}${testBadge(s.test)}<span>${esc(rel(s.lastAt))}, started ${esc(when(s.startedAt))}</span>`;
  const commits = rowsOf((s.commits || []).map((c) => `<li class="ui-row static">${c.verified ? Badge(`${Icon('check')}${c.outside ? `In ${esc(base(c.repo))}` : 'In Git'}`, { variant: 'success', title: 'Cereal found this commit in the repository' }) : Badge('Not in Git', { variant: 'destructive', title: 'The agent reported it, but Cereal could not find it' })}<span class="ui-row-main"><span class="ui-row-title">${esc(c.subject)}</span></span><span class="ui-row-side">${tk('sha', c.sha.slice(0, 9))}</span></li>`), 'No commits reported in this session.');
  const files = rowsOf((s.filesChanged || []).slice(-30).map((x) => fileRow(x)), 'None recorded in the readable part of the log.');
  const overview = `
    ${s.task ? Card({ title: 'Task', action: provBadge('agent'), body: `<p class="card-text">${esc(s.task)}</p>` }) : ''}
    ${Card({ title: 'Latest report', description: s.latest ? 'In the agent’s own words' : '', action: testBadge(s.test), body: s.latest ? `<p class="card-text">${esc(s.latest.text)}</p>${s.test ? `<p class="small-note">Tests: ${esc(s.test.summary)}, as reported in the session output.</p>` : ''}` : '<p class="ui-empty">No report found in the readable part of the log.</p>' })}
    ${Card({ title: 'How Cereal linked it', action: linkBadge(at), body: Fields([
      ['Evidence', esc(at.evidence || 'Unresolved')],
      s.cwd && ['Working directory', `<span class="mono">${pathHtml(s.cwd)}</span>`],
      s.branch && ['Branch', Badge(esc(s.branch), { variant: 'outline', cls: 'ui-badge-mono' })],
    ]) })}`;
  return sheetIntro(esc(s.title || 'Session'), meta) + Tabs({ id: 'sessionTabs', value: 'overview', cls: 'sheet-tabs', items: [
    { value: 'overview', label: 'Overview', panel: overview },
    { value: 'commits', label: 'Commits', count: s.commits?.length || null, panel: Card({ cls: 'flush', title: 'Commits', description: 'Each one checked against Git.', body: commits }) },
    { value: 'files', label: 'Files', count: s.filesChanged?.length || null, panel: Card({ cls: 'flush', title: 'Files changed', body: files }) },
    { value: 'resume', label: 'Resume', panel: Card({ title: `${Icon('terminal')}Resume in your terminal`, description: 'Cereal never runs it for you.', body: `<div class="resume-cmd mocha"><code>${commandHtml(cmd)}</code></div>`, footer: `<button class="ui-button ui-button-outline ui-button-sm" data-copy="${esc(cmd)}">${Icon('copy')}<span>Copy command</span></button>` }) },
  ] });
}

async function retainedSheet(pid, src, p) {
  const r = await api(`/api/projects/${pid}/retained`);
  const blocked = r.blocked.map((b) => `<li class="ui-row static">${Badge(b.code === 'blocked' ? 'Blocked by macOS' : b.code === 'missing' ? 'Folder gone' : 'Unreadable', { variant: b.code === 'blocked' ? 'warning' : 'destructive' })}<span class="ui-row-main"><span class="ui-row-title mono-title">${pathHtml(b.path)}</span><span class="ui-row-sub">${b.retained ? `Last indexed ${esc(when(b.retained.indexedAt))} (${plural(b.retained.docs, 'document')}). Only these counts are kept.` : 'Nothing kept.'}</span></span></li>`);
  return sheetIntro(esc(src.label), `Stored only on this Mac, in <span class="mono">${pathHtml(r.dataFile)}</span>. Never shared.`)
    + Card({ title: 'Readable now', action: Badge(`${Icon('shield')}Local only`, { variant: 'outline' }), body: Fields([
      ['Documents', String(r.readable.documents)],
      ['Repositories', String(r.readable.repositories)],
      ['Design files', String(r.readable.designFiles)],
      ['Agent sessions', `${r.agentSessions}, read from your local Claude Code and Codex logs`],
      r.indexedAt && ['Indexed', esc(when(r.indexedAt))],
      ['Your place', r.workspace.hasOpenItem ? 'The item you had open, your tab and scroll position' : 'Nothing saved'],
    ]) })
    + Card({ cls: 'flush', title: 'Approved folders', action: Badge(String(r.approvedFolders.length), { variant: 'secondary' }), body: rowsOf(r.approvedFolders.map((x) => `<li class="ui-row static">${Icon('folder', 'row-icon')}<span class="ui-row-main"><span class="ui-row-title mono-title">${pathHtml(x.path)}</span></span></li>`), 'None') })
    + Card({ cls: 'flush', title: 'Unavailable', action: Badge(String(r.blocked.length), { variant: r.blocked.length ? 'warning' : 'secondary' }), body: rowsOf(blocked, 'None') })
    + Card({ title: 'Forget this project', description: 'Removes everything Cereal derived from it. Your folder approvals stay, so you can re-index later. Project files are never touched.', footer: `<button class="ui-button ui-button-outline ui-button-sm danger" data-act="forget">Forget ${esc(p?.name || 'this project')}’s context</button>` });
}

function checkoutSheet(pid, src) {
  const wt = S.capsules[pid]?.git.flatMap((g) => g.worktrees).find((w) => w.path === src.path);
  const actions = `<button class="ui-button ui-button-outline ui-button-sm" data-reveal="${esc(src.path)}">${Icon('finder')}Reveal in Finder</button><button class="ui-button ui-button-ghost ui-button-sm" data-copy="cd ${esc(JSON.stringify(src.path))}">${Icon('copy')}<span>Copy cd command</span></button>`;
  const clean = wt?.dirty == null ? (wt?.prunable ? Badge('Folder missing on disk', { variant: 'warning' }) : 'Unknown') : wt.dirty ? Badge(`${wt.dirty} tracked file${wt.dirty === 1 ? '' : 's'} modified`, { variant: 'warning' }) : Badge(`${Icon('check')}Clean`, { variant: 'success' });
  return sheetIntro(esc(base(src.path)), `<span class="mono">${pathHtml(src.path)}</span>`, actions)
    + (wt ? Card({ title: 'Checkout', action: provBadge('git'), body: Fields([
      ['Branch', Badge(`${Icon('branch')}${esc(wt.branch || 'detached')}`, { variant: 'outline', cls: 'ui-badge-mono' })],
      wt.last && ['Last commit', `<span>${esc(wt.last.subject)}</span><span class="muted">${tk('sha', wt.last.short)} ${esc(wt.last.author)} · ${esc(rel(wt.last.date))}</span>`],
      ['Uncommitted', clean],
    ]) }) : '');
}

function closeDrawer({ persist = true } = {}) {
  const was = S.drawerSrc;
  S.drawerSrc = null;
  drawer.classList.remove('open');
  document.body.classList.remove('drawer-open');
  drawer.setAttribute('aria-hidden', 'true');
  if (persist && was && S.current && S.route.name === 'project') {
    if (S.capsules[S.current]) S.capsules[S.current].workspace = { ...(S.capsules[S.current].workspace || {}), drawer: null };
    post(`/api/projects/${S.current}/workspace`, { drawer: null }).catch(() => {});
  }
}

// ---------- syntax colour and folding ----------
// Code reads in Catppuccin Mocha on dark blocks; code-like tokens in light text use its Latte sibling.

const tk = (cls, t) => `<span class="tk-${cls}">${esc(t)}</span>`;
function pathHtml(p) {
  const s = tild(p);
  const m = /^(.*\/)?([^/]*?)(:\d+)?$/.exec(s) || [];
  return `<span class="path">${m[1] ? tk('dir', m[1]) : ''}${tk('file', m[2] || s)}${m[3] ? tk('num', m[3]) : ''}</span>`;
}
function sourceLabel(s) {
  const label = tild(s.label || '');
  if (s.type === 'doc' || s.type === 'folder') return pathHtml(label);
  if (s.type === 'commit') { const [sha, ...rest] = label.split(' · '); return `${tk('sha', sha)} ${esc(rest.join(' · '))}`; }
  if (s.type === 'worktree') { const [name, branch] = label.split(' · '); return `${tk('file', name)}${branch ? ' ' + tk('branch', branch) : ''}`; }
  if (s.type === 'session') { const [tool, ...rest] = label.split(' · '); return rest.length ? `${tk('kw', tool)} ${esc(rest.join(' · '))}` : esc(label); }
  return esc(label);
}
const fold = (summary, html, open = true, cls = '') => `<details class="fold ${cls}"${open ? ' open' : ''}><summary>${summary}</summary><div class="fold-body">${html}</div></details>`;

const KW = new Set('import export from const let var function return if else for while do switch case break continue new class extends super this await async try catch finally throw typeof instanceof in of yield default func struct enum protocol extension guard self Self static private public internal fileprivate init deinit override final lazy weak some any where true false nil null undefined None True False def lambda pass elif with as cd echo export sudo npm npx node git'.split(' '));
function codeLine(line) {
  let out = '';
  const re = /(\/\/.*$|#(?!!).*$|--\s.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)(\s*\()?|(\s--?[\w-]+)|([{}()[\];,.<>=+\-*/%!&|?:@]+)/g;
  let last = 0;
  for (const m of line.matchAll(re)) {
    out += esc(line.slice(last, m.index));
    if (m[1]) out += tk('com', m[1]);
    else if (m[2]) out += tk('str', m[2]);
    else if (m[3]) out += tk('num', m[3]);
    else if (m[4]) out += (KW.has(m[4]) ? tk('kw', m[4]) : m[5] ? tk('fn', m[4]) : /^[A-Z]/.test(m[4]) ? tk('type', m[4]) : esc(m[4])) + esc(m[5] || '');
    else if (m[6]) out += tk('flag', m[6]);
    else out += tk('op', m[7]);
    last = m.index + m[0].length;
  }
  return out + esc(line.slice(last));
}
function codeBlock(lines, firstLine = null) {
  return `<pre class="code mocha">${lines.map((l, i) => `<span class="cl"${firstLine ? ` data-line="${firstLine + i}"` : ''}>${codeLine(l) || ' '}</span>`).join('')}</pre>`;
}
function gitShow(text) {
  const lines = text.split('\n');
  const head = [], msg = [], stat = [];
  let phase = 'head';
  lines.forEach((l, i) => {
    if (phase === 'head' && i > 2 && l === '') { phase = 'msg'; return; }
    if (phase !== 'head' && /^ \S.*\|\s+\d+/.test(l) || /^ \d+ files? changed/.test(l)) { phase = 'stat'; }
    (phase === 'head' ? head : phase === 'msg' ? msg : stat).push(l);
  });
  const headHtml = head.map((l, i) => (i === 0 ? tk('sha', l) : i === 1 ? tk('key', l) : tk('num', l))).join('\n');
  const statHtml = stat.map((l) => {
    const m = /^(\s*)(\S.*?)(\s+\|\s+)(\d+)\s*(\+*)(-*)\s*$/.exec(l);
    if (m) return `${m[1]}${pathHtml(m[2])}${esc(m[3])}${tk('num', m[4])} ${tk('add', m[5])}${tk('del', m[6])}`;
    return esc(l).replace(/(\d+) insertions?\(\+\)/, '<span class="tk-add">$&</span>').replace(/(\d+) deletions?\(-\)/, '<span class="tk-del">$&</span>');
  }).join('\n');
  return `<pre class="code mocha">${headHtml}\n\n${esc(msg.join('\n').trim())}</pre>${stat.length ? fold(`${tk('num', String(stat.filter((l) => / \| /.test(l)).length))} files changed`, `<pre class="code mocha">${statHtml}</pre>`, stat.length <= 12) : ''}`;
}
function commandHtml(cmd) {
  return esc(cmd)
    .replace(/&quot;([^&]*)&quot;/g, '<span class="tk-str">&quot;$1&quot;</span>')
    .replace(/(^|&amp;&amp;\s*)(cd|claude|codex)\b/g, '$1<span class="tk-kw">$2</span>')
    .replace(/(\s)(--?[\w-]+)/g, '$1<span class="tk-flag">$2</span>');
}

function inline(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<span class="lref" title="$2">$1</span>');
}

function renderDoc(text) {
  const lines = text.split('\n');
  let html = '';
  let open = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const n = i + 1;
    if (/^```/.test(l)) {
      const start = i + 1;
      let j = start;
      while (j < lines.length && !/^```/.test(lines[j])) j++;
      const block = lines.slice(start, j);
      const lang = l.replace(/^```/, '').trim();
      const pre = codeBlock(block, start + 1);
      html += `<div class="ln fence" data-line="${n}"></div>` + (block.length > 14 ? fold(`${lang ? tk('kw', lang) + ' ' : ''}${plural(block.length, 'line')} of code`, pre, false, 'code-fold') : pre);
      i = j;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h && h[1].length <= 3 && i > 0) {
      // Each section folds under its heading.
      html += `${open ? '</div></details>' : ''}<details class="doc-sec" open><summary class="ln h h${h[1].length}" data-line="${n}">${inline(h[2])}</summary><div class="doc-sec-body">`;
      open = true;
      continue;
    }
    if (isPlain(l)) {
      let para = '';
      while (i < lines.length && isPlain(lines[i])) { para += `<span class="ln p" data-line="${i + 1}">${inline(lines[i].trim())}</span> `; i++; }
      i--;
      html += `<p class="para">${para.trim()}</p>`;
      continue;
    }
    html += lineHtml(l, n);
  }
  return html + (open ? '</div></details>' : '');
}

function isPlain(l) {
  // Labelled lines (**Status:** …) keep their own line; ordinary wrapped lines flow into one paragraph.
  return l.trim() && !/^(#{1,6}\s|\s*[-*]\s+|\s*\d+\.\s+|\||>\s?|```|\s*\*\*[^*]{1,40}:\*\*|\s*\*\*[^*]{1,40}\*\*:)/.test(l);
}

function lineHtml(l, n) {
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) return `<div class="ln h h${h[1].length}" data-line="${n}">${inline(h[2])}</div>`;
    if (/^\s*[-*]\s+/.test(l)) return `<div class="ln li" data-line="${n}" style="--indent:${Math.min(4, Math.floor(l.search(/\S/) / 2))}">${inline(l.replace(/^\s*[-*]\s+/, ''))}</div>`;
    if (/^\s*\d+\.\s+/.test(l)) return `<div class="ln li num" data-line="${n}">${inline(l.trim())}</div>`;
    if (/^\|/.test(l)) return `<div class="ln tr" data-line="${n}">${esc(l)}</div>`;
    if (/^>\s?/.test(l)) return `<div class="ln quote" data-line="${n}">${inline(l.replace(/^>\s?/, ''))}</div>`;
    if (!l.trim()) return `<div class="ln blank" data-line="${n}"></div>`;
    return `<div class="ln p" data-line="${n}">${inline(l)}</div>`;
}

// ---------- document summary ----------

function jumpToLine(n) {
  const body = $('.dr-body', drawer);
  const line = body?.querySelector(`.mdoc [data-line="${n}"]`);
  if (!line) return;
  // The line lives in the Document tab; show that tab first.
  const panel = line.closest('.ui-tabs-content');
  if (panel?.hidden) selectTab(panel.closest('.ui-tabs').querySelector(`.ui-tabs-trigger[data-ui-tab="${panel.dataset.uiPanel}"]`));
  for (let el = line.parentElement; el && el !== body; el = el.parentElement) if (el.tagName === 'DETAILS') el.open = true;
  line.classList.add('hl');
  const top = line.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - body.clientHeight / 3;
  body.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

const lineLink = (n) => `<button type="button" class="line-link" data-jump-line="${n}">${tk('num', `L${n}`)}</button>`;

async function summarizeDoc(btn) {
  const box = $('#docSummary');
  const label = btn.querySelector('span') || btn;
  if (!box) return;
  if (!box.hidden && box.dataset.for === btn.dataset.summarize) { box.hidden = true; label.textContent = 'Summarize'; return; }
  box.hidden = false;
  box.dataset.for = btn.dataset.summarize;
  box.innerHTML = Card({ title: `${Icon('sparkles')}Summary`, description: 'Reading the document…', cls: 'summary-card' });
  btn.disabled = true;
  try {
    const s = await post(`/api/projects/${S.current}/doc/${btn.dataset.summarize}/summary`);
    box.innerHTML = summaryHtml(s);
    label.textContent = 'Hide summary';
  } catch (e) {
    box.innerHTML = Card({ title: 'Summary', description: `Couldn’t summarize this document: ${esc(e.message)}`, cls: 'summary-card' });
  } finally {
    btn.disabled = false;
  }
}

function summaryHtml(s) {
  const kicker = s.mode === 'claude'
    ? `By Claude (${esc(s.model || '')}), from this document only`
    : `From the document’s own structure, ${plural(s.minutes, 'minute')} to read in full${s.claudeError ? `. Claude was unavailable: ${esc(s.claudeError)}` : s.claude ? '' : '. Set ANTHROPIC_API_KEY for a written summary.'}`;
  const list = (items, fn) => `<ul class="sum-list">${items.map(fn).join('')}</ul>`;
  const more = s.mode === 'claude' ? [] : [
    s.decisions.length && AccordionItem({ title: 'Decisions', meta: Badge(String(s.decisions.length), { variant: 'secondary' }), open: true, body: list(s.decisions, (d) => `<li>${esc(d.text)}${d.status ? ` <span class="muted">${esc(d.status)}</span>` : ''} ${lineLink(d.line)}</li>`) }),
    s.questions.length && AccordionItem({ title: 'Open questions', meta: Badge(String(s.questions.length), { variant: 'warning' }), open: true, body: list(s.questions, (q) => `<li>${esc(q.text)} ${lineLink(q.line)}</li>`) }),
    s.sections.length && AccordionItem({ title: 'Sections', meta: Badge(String(s.sections.length), { variant: 'secondary' }), body: list(s.sections, (h) => `<li>${esc(h.text)} ${lineLink(h.line)}</li>`) }),
  ].filter(Boolean);
  const body = s.mode === 'claude'
    ? `<p class="sum-lead">${esc(s.text).replace(/\(L(\d+)\)/g, (_, n) => lineLink(n))}</p>`
    : `${s.lead ? `<p class="sum-lead">${esc(s.lead)}</p>` : ''}
       ${s.facts.length ? `<dl class="sum-facts">${s.facts.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(f.text)} ${lineLink(f.line)}</dd>`).join('')}</dl>` : ''}
       ${more.length ? Accordion(more, 'sum-more') : ''}`;
  return Card({ title: `${Icon('sparkles')}Summary`, description: kicker, action: s.mode === 'claude' ? Badge('Claude', { variant: 'brand' }) : Badge('Outline', { variant: 'secondary' }), body, cls: 'summary-card' });
}

// ---------- notifications ----------

async function pollNotes() {
  try {
    const r = await api(`/api/notifications?after=${S.lastNote}`);
    for (const n of r.notifications) {
      S.lastNote = Math.max(S.lastNote, n.id);
      showToast(n);
    }
    if (r.notifications.length) {
      await loadState();
      const cur = S.current;
      if (cur && S.route.name === 'project' && r.notifications.some((n) => n.projectId === cur)) {
        S.capsules[cur] = await api(`/api/projects/${cur}/capsule`);
        paintProject(S.capsules[cur]);
      }
    }
  } catch { /* server restarting; try again */ }
  setTimeout(pollNotes, 6000);
}

function showToast(n) {
  // One card per event, however many times it is reported.
  if ($(`#toasts [data-note-id="${n.id}"]`)) return;
  const p = project(n.projectId);
  const elsewhere = !(S.route.name === 'project' && S.current === n.projectId);
  const el = document.createElement('div');
  el.className = `toast ${p?.brand.mode || ''}`;
  el.dataset.noteId = n.id;
  el.dataset.projectId = n.projectId;
  el.setAttribute('style', brandVars(p?.brand));
  el.innerHTML = `<div class="t-head">${p ? icon(p, 'xs') : ''}<b>${esc(n.title)}</b><span class="muted">${rel(n.at)}</span></div>
    <p class="t-text">${esc(n.text)}</p>${n.detail ? `<p class="t-detail">${esc(String(n.detail).slice(0, 160))}</p>` : ''}
    <div class="t-actions">${elsewhere ? `<button class="btn primary sm" data-jump="${n.id}">Jump back to ${esc(p?.name || 'project')}</button>` : `<button class="btn ghost sm" data-jump="${n.id}">Open</button>`}<button class="btn ghost sm" data-dismiss>Dismiss</button></div>`;
  $('#toasts').appendChild(el);
  if (!elsewhere) setTimeout(() => dismissToast(el), 9000);
}

function dismissToast(el) {
  el.classList.add('leaving');
  setTimeout(() => el.remove(), 200);
}

function jumpTo(noteId) {
  const n = S.state?.notifications.find((x) => x.id === Number(noteId));
  if (!n) return;
  // You're going to that project now, so its cards have done their job.
  for (const el of document.querySelectorAll(`#toasts .toast[data-project-id="${n.projectId}"]`)) dismissToast(el);
  goProject(n.projectId, { open: n.target });
}

// ---------- empty / loading / error ----------

function skeletonPortfolio() {
  return `<section class="home"><p class="home-intro">Reading your projects…</p><div class="stories"><div class="skeleton story-skel"></div><div class="skeleton story-skel"></div></div></section>`;
}
function skeletonProject(p) {
  return `<section class="ctx" style="${brandVars(p.brand)}"><header class="ctx-head">${icon(p, 'xl')}<div class="ctx-title"><h1>${esc(p.name)}</h1><p class="tagline">Finding where you left off…</p></div></header><div class="pickup story"><div class="skeleton story-skel"></div></div></section>`;
}
function errorView(e, retry) {
  view.innerHTML = `<section class="error-state"><h1>Cereal can’t reach its server.</h1><p>${esc(e.message)}</p><p class="muted">Your saved context is safe on disk. If the server stopped, run <code>npm start</code> in the <code>cereal</code> folder.</p>${retry ? '<button class="btn primary" data-act="retry">Try again</button>' : ''}</section>`;
  S.retry = retry;
}

// ---------- events ----------

document.addEventListener('click', async (ev) => {
  const t = ev.target.closest('button, a, [data-src], [data-sw], [data-go], [data-pick], [data-jump-line], [data-bhistory]');
  if (!t) return;
  if (t.dataset.go && !t.matches('a[href^="#/p/"][href$="/sources"]')) { ev.preventDefault(); return goProject(t.dataset.go); }
  if (t.dataset.pick) { const p = project(t.dataset.pick); return goProject(p.id, { open: p.pickUp?.target }); }
  if (t.dataset.more) {
    const c = S.capsules[S.current];
    const sec = t.closest('.cap-sec');
    if (c && sec) { sec.querySelector('.facts').innerHTML = SECTION_FACTS[t.dataset.more](c).map((f) => fact(f)).join(''); t.remove(); }
    return;
  }
  if (t.dataset.summarize) return summarizeDoc(t);
  if (t.dataset.bact) return briefingAction(t.dataset.bact, t);
  if (t.dataset.bset) {
    const { bset, value } = t.dataset;
    if (bset === 'device' || bset === 'theme') { S.briefing[bset] = value; return paintBriefing(); }
    return saveBriefing({ [bset]: value });
  }
  if (t.dataset.bhistory) {
    try { S.briefing.viewing = await api(`/api/briefing/history/${t.dataset.bhistory}`); S.briefing.tab = 'history'; paintBriefing(); $('.history-view')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { alert(e.message); }
    return;
  }
  if (t.dataset.uiTab && t.closest('#briefingTabs') && S.briefing) { S.briefing.tab = t.dataset.uiTab; return; }
  if (t.dataset.jumpLine) return jumpToLine(Number(t.dataset.jumpLine));
  if (t.dataset.copy != null) { navigator.clipboard?.writeText(t.dataset.copy); const o = t.textContent; t.textContent = 'Copied'; setTimeout(() => (t.textContent = o), 1200); return; }
  if (t.dataset.reveal) { post(`/api/projects/${S.current}/reveal`, { path: t.dataset.reveal }).catch((e) => alert(e.message)); return; }
  if (t.dataset.jump) { dismissToast(t.closest('.toast')); return jumpTo(t.dataset.jump); }
  if (t.dataset.dismiss != null) return dismissToast(t.closest('.toast'));
  if (t.dataset.note) { closeSwitcher(); return jumpTo(t.dataset.note); }
  if (t.dataset.sw) return chooseSwitcher(Number(t.dataset.sw));
  if (t.dataset.tab) {
    const c = S.capsules[S.current];
    for (const b of document.querySelectorAll('.tabs [role=tab]')) { b.setAttribute('aria-selected', String(b === t)); b.dataset.state = b === t ? 'active' : 'inactive'; b.tabIndex = b === t ? 0 : -1; }
    const panel = $('#tabPanel');
    panel.innerHTML = tabPanel(c, t.dataset.tab);
    if (c) c.workspace = { ...(c.workspace || {}), tab: t.dataset.tab };
    post(`/api/projects/${S.current}/workspace`, { tab: t.dataset.tab }).catch(() => {});
    return;
  }
  if (t.dataset.src) {
    const pid = t.closest('[data-project]')?.dataset.project;
    const src = dec(t.dataset.src);
    if (S.route.name !== 'project' && pid) return goProject(pid, { open: src });
    return openSource(src);
  }
  const act = t.dataset.act;
  if (!act) return;
  if (act === 'close-drawer') return closeDrawer();
  if (act === 'close-sw') return closeSwitcher();
  if (act === 'retry') return S.retry?.();
  if (act === 'edition-news-on') {
    t.disabled = true;
    try { await post('/api/briefing/settings', { news: { enabled: true } }); } catch (e) { t.disabled = false; return alert(e.message); }
    return refreshEdition();
  }
  if (act === 'edition-done') { localStorage.setItem('cereal-edition-read', dayKey()); $('#edition')?.classList.add('is-read'); window.scrollTo({ top: 0 }); return; }
  if (act === 'edition-open') { localStorage.removeItem('cereal-edition-read'); $('#edition')?.classList.remove('is-read'); return; }
  if (act === 'pick-new') {
    const r = await pickFolder();
    if (r.path) { $('#addForm [name=path]').value = tild(r.path); const n = $('#addForm [name=name]'); if (!n.value) n.value = folderName(r.path); }
    return;
  }
  if (act === 'desktop-add') {
    const r = await pickFolder();
    if (!r.path) return;
    const status = $('#addStatus');
    if (status) status.textContent = 'Looking for it with Git…';
    try { const p = await post('/api/projects', { name: folderName(r.path), path: r.path }); await loadState(); location.hash = `#/p/${p.id}/sources`; }
    catch (e) { if (status) status.textContent = e.message; else alert(e.message); }
    return;
  }
  if (act === 'forget') {
    const name = project(S.current)?.name || 'this project';
    if (!confirm(`Forget everything Cereal knows about ${name}? Folder approvals stay; project files are not touched.`)) return;
    try { await post(`/api/projects/${S.current}/forget`, { confirm: true }); delete S.capsules[S.current]; closeDrawer({ persist: false }); await loadState(); renderProject(S.current); } catch (e) { alert(e.message); }
    return;
  }
  if (act === 'reindex') {
    t.textContent = 'Indexing…'; t.disabled = true;
    try { await post(`/api/projects/${S.current}/reindex`); S.capsules[S.current] = await loadCapsule(S.current); paintProject(S.capsules[S.current]); } catch (e) { alert(e.message); }
    return;
  }
  if (act === 'brief') {
    const box = $('#brief');
    box.innerHTML = '<div class="brief"><p class="muted">Asking Claude to brief you from the facts below…</p></div>';
    try {
      const r = await post(`/api/projects/${S.current}/brief`);
      box.innerHTML = r.available ? `<div class="brief"><p class="muted">Claude (${esc(r.model)}), written only from the facts below</p><p>${esc(r.text)}</p></div>` : `<div class="brief off"><p>${esc(r.reason)}</p></div>`;
    } catch (e) { box.innerHTML = `<div class="brief off"><p>${esc(e.message)}</p></div>`; }
    return;
  }
  if (act === 'pick' || act === 'rescan') {
    const id = S.route.id;
    const status = $('#srcStatus');
    status.textContent = act === 'pick' ? 'Waiting for you to choose a folder…' : 'Re-scanning…';
    try {
      if (act === 'pick') {
        if (isDesktop()) { const r = await pickFolder(); if (!r.path) { status.textContent = 'No folder chosen.'; return; } await post(`/api/projects/${id}/add-folder`, { path: r.path }); }
        else { const r = await post(`/api/projects/${id}/pick-folder`); if (r.cancelled) { status.textContent = 'No folder chosen.'; return; } }
      }
      else await post(`/api/projects/${id}/discover`);
      paintSources(project(id), await api(`/api/projects/${id}/discovery`));
    } catch (e) { status.textContent = e.message; }
  }
});

document.addEventListener('change', (ev) => {
  const form = ev.target.closest('#briefingForm');
  if (!form || ['email', 'code'].includes(ev.target.name)) return;
  if (ev.target.name === 'enabled') return saveBriefing({ enabled: ev.target.checked }, ev.target.checked ? 'On. Your first briefing arrives at the next delivery time.' : 'Off. Nothing will be sent.');
  if (ev.target.name === 'project') {
    const all = [...form.querySelectorAll('[name=project]')];
    const on = all.filter((x) => x.checked).map((x) => x.value);
    return saveBriefing({ projects: on.length === all.length ? null : on });
  }
  if (['time', 'timeZone'].includes(ev.target.name)) return saveBriefing({ [ev.target.name]: ev.target.value });
  if (ev.target.name === 'newsEnabled') return saveNews({ enabled: ev.target.checked }, ev.target.checked ? 'News on. Tomorrow’s briefing now includes headlines.' : 'News off. No searches will be made.');
  if (ev.target.name === 'newsTopics') return saveNews({ topics: { [ev.target.dataset.project]: ev.target.value } }, 'Topics saved.');
});

// News changes what tomorrow's briefing says, so the preview is rebuilt after saving.
async function saveNews(patch, msg) {
  await saveBriefing({ news: patch }, msg);
  try { S.briefing.pv = await api('/api/briefing/preview'); if (S.briefing.tab === 'preview') paintBriefing(); } catch { /* the settings still saved */ }
}

document.addEventListener('submit', async (ev) => {
  if (ev.target.id === 'briefingForm') { ev.preventDefault(); return; }
  if (ev.target.id === 'addForm') {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const status = $('#addStatus');
    status.textContent = 'Looking for it with Git…';
    try {
      const r = await post('/api/projects', { name: f.get('name'), path: f.get('path') });
      await loadState();
      location.hash = `#/p/${r.id}/sources`;
    } catch (e) { status.textContent = e.message; }
    return;
  }
  if (ev.target.id !== 'srcForm') return;
  ev.preventDefault();
  const id = S.route.id;
  const ids = [...ev.target.querySelectorAll('input[name=c]:checked')].map((i) => i.value);
  const status = $('#srcStatus');
  if (!ids.length) { status.textContent = 'Choose at least one folder.'; return; }
  status.textContent = 'Indexing read-only… documents, Git state and agent sessions.';
  ev.target.querySelector('[type=submit]').disabled = true;
  try {
    const r = await post(`/api/projects/${id}/approve`, { candidateIds: ids, wait: true });
    status.textContent = `Indexed ${r.docCount} documents.`;
    delete S.capsules[id];
    await loadState();
    goProject(id);
  } catch (e) { status.textContent = e.message; ev.target.querySelector('[type=submit]').disabled = false; }
});

document.addEventListener('keydown', (ev) => {
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); return switcher.hidden ? openSwitcher() : closeSwitcher(); }
  if (!switcher.hidden) {
    const n = S.state.projects.length;
    if (ev.key === 'Escape') return closeSwitcher();
    if (ev.key === 'ArrowDown') { ev.preventDefault(); S.swIndex = (S.swIndex + 1) % n; return paintSwitcher(); }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); S.swIndex = (S.swIndex - 1 + n) % n; return paintSwitcher(); }
    if (ev.key === 'Enter') { ev.preventDefault(); return chooseSwitcher(S.swIndex); }
    if (/^[1-9]$/.test(ev.key) && !S.swQuery) return chooseSwitcher(Number(ev.key) - 1);
    if (ev.key === 'Backspace' && S.swQuery) { ev.preventDefault(); S.swQuery = S.swQuery.slice(0, -1); return paintSwitcher(); }
    const printable = ev.key.length === 1 && !ev.metaKey && !ev.ctrlKey && !ev.altKey;
    if (printable && (ev.key !== ' ' || S.swQuery)) { ev.preventDefault(); return typeInSwitcher(ev.key); }
    return;
  }
  if (ev.key === 'Escape' && drawer.classList.contains('open')) return closeDrawer();
  if (ev.key === 'Enter' && ev.target.matches('[data-src][tabindex], [data-jump-line][tabindex], [data-bhistory][tabindex]')) ev.target.click();
});

$('#switchBtn').addEventListener('click', openSwitcher);
bindTabs();

function focusSentence(el) {
  const story = el?.closest('.story');
  if (!story) return;
  story.classList.add('has-focus');
  for (const x of story.querySelectorAll('.s.is-focus')) x.classList.remove('is-focus');
  el.classList.add('is-focus');
  const cap = story.querySelector('.story-why');
  if (cap && el.dataset.why) cap.textContent = el.dataset.why;
}
function blurStory(story) {
  if (!story) return;
  story.classList.remove('has-focus');
  for (const x of story.querySelectorAll('.s.is-focus')) x.classList.remove('is-focus');
  const cap = story.querySelector('.story-why');
  if (cap) cap.textContent = cap.dataset.default || '';
}
document.addEventListener('pointerover', (ev) => { const s = ev.target.closest?.('.s'); if (s) focusSentence(s); });
document.addEventListener('pointerout', (ev) => {
  const s = ev.target.closest?.('.s');
  if (s && !s.contains(ev.relatedTarget)) blurStory(s.closest('.story'));
});
document.addEventListener('focusin', (ev) => { if (ev.target.matches?.('.s')) focusSentence(ev.target); });
document.addEventListener('focusout', (ev) => { if (ev.target.matches?.('.s')) blurStory(ev.target.closest('.story')); });

let scrollTimer;
window.addEventListener('scroll', () => {
  if (S.route.name !== 'project' || !S.current) return;
  clearTimeout(scrollTimer);
  const id = S.current;
  scrollTimer = setTimeout(() => {
    if (S.capsules[id]) S.capsules[id].workspace = { ...(S.capsules[id].workspace || {}), scroll: window.scrollY };
    post(`/api/projects/${id}/workspace`, { scroll: window.scrollY }).catch(() => {});
  }, 600);
}, { passive: true });

window.addEventListener('hashchange', onRoute);

// ---------- boot ----------

(async function boot() {
  try {
    await loadState();
    S.lastNote = Math.max(0, ...S.state.notifications.map((n) => n.id));
    // Warm every connected project's capsule so switching renders instantly.
    await Promise.all(S.state.projects.filter((p) => p.connected).map((p) => loadCapsule(p.id).catch(() => null)));
    if (!location.hash && S.state.ui?.active && project(S.state.ui.active)?.connected) location.hash = `#/p/${S.state.ui.active}`;
  } catch { /* render will show the error state */ }
  onRoute();
  setTimeout(pollNotes, 4000);
  setInterval(() => { if (S.route.name === 'portfolio') renderPortfolio(); else loadState().catch(() => {}); }, 30000);
})();
