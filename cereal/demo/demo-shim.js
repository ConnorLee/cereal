// Cereal demo: answers the app's /api calls from sample data built by scripts/build-demo.mjs.
// Your place in each project is kept in this browser's localStorage, so switching and restoring work as in the real app.
(function () {
  const raw = window.CEREAL_DEMO;
  // Sample timestamps were captured at build time; shift them so "2h ago" stays true whenever the demo is opened.
  const shift = Date.now() - raw.builtAt;
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
  const moved = (v) => (typeof v === 'string' && ISO.test(v) ? new Date(Date.parse(v) + shift).toISOString() : v);
  const walk = (o) => {
    if (Array.isArray(o)) return o.map(walk);
    if (o && typeof o === 'object') { const r = {}; for (const k in o) r[k] = walk(o[k]); return r; }
    return moved(o);
  };
  const D = walk(raw);
  const KEY = 'cereal-demo-v1';
  const saved = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const S = Object.assign({ ws: {}, last: {}, visited: [], phase: 'before', firedAt: null, active: null }, saved());
  // Morning briefing settings live in this browser too. The demo never sends email.
  const DB = D.briefing;
  S.brief = Object.assign({ settings: { enabled: false, email: '', verified: false, time: '08:00', timeZone: DB.timeZone, cadence: 'daily', projects: null, detail: 'full', paused: false, unsubscribed: false, news: { enabled: true, topics: {} } }, pending: null, tests: [] }, S.brief || {});
  S.brief.settings.news ||= { enabled: true, topics: {} };
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* private mode */ } };
  const now = () => new Date().toISOString();
  const snap = () => D[S.phase];
  const note = () => (S.phase === 'after' && D.notification ? [{ ...D.notification, id: 1, at: S.firedAt }] : []);

  const withPlace = (id, c) => ({ ...c, workspace: S.ws[id] || {}, lastVisitAt: S.last[id] || null });
  const state = () => ({
    projects: snap().portfolio.map((p) => ({ ...p, workspace: S.ws[p.id] || {}, lastVisitAt: S.last[p.id] || null })),
    runtimes: { claude: { available: true, root: '~/.claude/projects', files: 4 }, codex: { available: true, root: '~/.codex/sessions', files: 2 }, scannedAt: now() },
    unresolved: snap().unresolved || [],
    notifications: note(),
    ui: { active: S.active },
    claude: false,
  });

  // A Northwind agent finishes once you've moved on to another project: the jump-back moment.
  function maybeFire() {
    if (S.phase !== 'before' || !D.notification) return;
    // Fire once you've looked at two projects and are now somewhere other than the one whose agent finishes.
    const elsewhere = S.active && S.active !== D.notification.projectId;
    if (S.visited.length >= 2 && elsewhere && Date.now() - (S.enteredAt || 0) > 4000) {
      S.phase = 'after'; S.firedAt = now(); persist();
    }
  }

  const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  const fail = (status, error) => new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } });
  const LOCAL_ONLY = 'In this demo the projects are samples. Run Cereal on your Mac to use your own folders.';
  const DEMO_CODE = '246810';
  function nextAt(s) {
    if (!s.enabled || s.paused || !s.verified) return null;
    const [hh, mm] = s.time.split(':').map(Number);
    const t = new Date(); t.setSeconds(0, 0); t.setHours(hh, mm);
    for (let i = 0; i < 8; i++) { if (t > new Date() && (s.cadence !== 'weekdays' || ![0, 6].includes(t.getDay()))) return t.toISOString(); t.setDate(t.getDate() + 1); }
    return null;
  }
  const briefingState = () => {
    const B = S.brief;
    const history = [...B.tests, ...DB.history.map((h) => ({ ...h, at: moved(h.at) }))].sort((a, b) => b.at.localeCompare(a.at));
    const last = history.find((h) => h.kind === 'scheduled');
    return {
      settings: B.settings, next: nextAt(B.settings),
      last: last ? { id: last.id, at: last.at, status: last.status, subject: last.subject } : null,
      pendingVerification: B.pending ? { email: B.pending, expiresAt: new Date(Date.now() + 9e5).toISOString() } : null,
      provider: { name: 'demo', label: 'the Cereal demo (nothing is sent)', external: false, outbox: 'a demo outbox in this browser' },
      history: history.map(({ html, ...h }) => h), projects: DB.projects.map((p) => ({ ...p, newsTopics: S.brief.settings.news.topics[p.id] || p.newsTopics })),
    };
  };
  const briefingPatch = (body) => {
    const s = { ...S.brief.settings };
    if ('enabled' in body) { if (body.enabled && !s.verified) return 'Verify your email address before turning the briefing on.'; s.enabled = !!body.enabled; if (s.enabled) s.unsubscribed = false; }
    for (const k of ['time', 'timeZone', 'cadence', 'detail', 'projects', 'paused']) if (k in body) s[k] = body[k];
    if (body.news) s.news = { ...s.news, ...('enabled' in body.news ? { enabled: !!body.news.enabled } : {}), topics: { ...s.news.topics, ...Object.fromEntries(Object.entries(body.news.topics || {}).map(([k, v]) => [k, String(v).split(',').map((t) => t.trim()).filter(Boolean).slice(0, 4)])) } };
    S.brief.settings = s; persist(); return null;
  };

  const routes = [
    ['GET', /^\/api\/state$/, () => ok(state())],
    ['GET', /^\/api\/edition$/, () => ok(D.edition)],
    ['POST', /^\/api\/projects\/([\w-]+)\/doc\/([\w-]+)\/summary$/, (m) => (D.docs[m[2]]?.summary ? ok(D.docs[m[2]].summary) : fail(404, 'This document isn’t available.'))],
    ['GET', /^\/api\/notifications$/, (_m, _b, url) => { maybeFire(); const after = Number(url.searchParams.get('after') || 0); return ok({ notifications: note().filter((n) => n.id > after), runtimes: state().runtimes }); }],
    ['POST', /^\/api\/refresh$/, () => ok({})],
    ['GET', /^\/api\/projects\/([\w-]+)\/capsule$/, (m) => ok(withPlace(m[1], snap().capsules[m[1]]))],
    ['POST', /^\/api\/projects\/([\w-]+)\/enter$/, (m) => {
      const id = m[1];
      const c = withPlace(id, snap().capsules[id]);
      S.active = id; S.enteredAt = Date.now();
      if (!S.visited.includes(id)) S.visited.push(id);
      persist();
      return ok(c);
    }],
    ['POST', /^\/api\/projects\/([\w-]+)\/workspace$/, (m, body) => {
      const id = m[1];
      const ws = { ...(S.ws[id] || {}) };
      for (const k of ['tab', 'focus', 'drawer', 'scroll']) if (body[k] !== undefined) ws[k] = body[k];
      ws.updatedAt = now();
      S.ws[id] = ws;
      if (body.leave) { S.last[id] = ws.updatedAt; if (S.active === id) S.active = null; }
      persist();
      return ok(ws);
    }],
    ['GET', /^\/api\/projects\/([\w-]+)\/doc\/([\w-]+)$/, (m) => (D.docs[m[2]] ? ok({ ...D.docs[m[2]], display: D.docs[m[2]].path }) : fail(404, 'This document isn’t available while macOS blocks its folder.'))],
    ['GET', /^\/api\/projects\/([\w-]+)\/session\/(.+)$/, (m) => { const s = D.sessions[m[1]]?.[decodeURIComponent(m[2])]; return s ? ok(s) : fail(404, 'Session is not linked to this project'); }],
    ['GET', /^\/api\/projects\/([\w-]+)\/commit\/(\w+)$/, (m, _b, url) => (D.commits[m[2]] != null ? ok({ sha: m[2], repo: url.searchParams.get('repo'), text: D.commits[m[2]] }) : fail(404, 'Commit not found'))],
    ['GET', /^\/api\/projects\/([\w-]+)\/discovery$/, (m) => ok({ ...D.discovery[m[1]], candidates: D.discovery[m[1]].candidates.map((c) => ({ ...c, approved: !!c.recommended })) })],
    ['POST', /^\/api\/projects\/([\w-]+)\/discover$/, (m) => ok(D.discovery[m[1]])],
    ['POST', /^\/api\/projects\/([\w-]+)\/approve$/, (m) => ok({ revision: snap().capsules[m[1]].revision, changed: false, docCount: snap().capsules[m[1]].counts.docs })],
    ['POST', /^\/api\/projects\/([\w-]+)\/reindex$/, () => ok({ changed: false })],
    ['GET', /^\/api\/projects\/([\w-]+)\/retained$/, (m) => ok(D.retained[m[1]])],
    ['GET', /^\/api\/projects\/([\w-]+)\/icon$/, () => fail(404, 'No icon')],
    ['POST', /^\/api\/projects\/([\w-]+)\/brief$/, () => ok({ available: false, reason: LOCAL_ONLY })],
    ['GET', /^\/api\/briefing$/, () => ok(briefingState())],
    ['GET', /^\/api\/briefing\/preview$/, () => ok(S.brief.settings.news.enabled || !DB.todayNoNews ? DB.today : DB.todayNoNews)],
    ['POST', /^\/api\/briefing\/settings$/, (_m, body) => { const err = briefingPatch(body); return err ? fail(400, err) : ok(briefingState()); }],
    ['POST', /^\/api\/briefing\/verify$/, (_m, body) => { if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(body.email || '')) return fail(400, 'That doesn’t look like an email address.'); S.brief.pending = body.email; persist(); return ok({ sent: true, provider: 'demo', demoCode: DEMO_CODE }); }],
    ['POST', /^\/api\/briefing\/verify\/confirm$/, (_m, body) => { if (String(body.code || '').trim() !== DEMO_CODE) return fail(400, 'That code doesn’t match. In the demo it is ' + DEMO_CODE + '.'); S.brief.settings = { ...S.brief.settings, email: S.brief.pending, verified: true }; S.brief.pending = null; persist(); return ok({ settings: S.brief.settings }); }],
    ['POST', /^\/api\/briefing\/test$/, () => { const id = 'test' + Date.now().toString(36); S.brief.tests = [{ id, kind: 'test', subject: DB.today.subject, at: now(), status: 'sent', projects: DB.projects.map((p) => p.id), html: DB.today.html, preheader: DB.today.preheader }, ...S.brief.tests].slice(0, 5); persist(); return ok({ ok: true, id, provider: 'outbox', subject: DB.today.subject }); }],
    ['GET', /^\/api\/briefing\/history\/(\w+)$/, (m) => { const h = [...S.brief.tests, ...DB.history].find((x) => x.id === m[1]); return h ? ok(h) : fail(404, 'That briefing is no longer kept.'); }],
    ['GET', /^\/api\/briefing\/open\/(\w+)\/(\d+)$/, (m) => { const hit = DB.links[m[1].startsWith('test') ? DB.today.id : m[1]]?.[m[2]]; return hit ? ok(hit) : fail(404, 'That link has expired.'); }],
    ['POST', /.*/, () => fail(400, LOCAL_ONLY)],
  ];

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (!url.pathname.startsWith('/api/') && !url.pathname.includes('/api/')) return realFetch(input, init);
    const pathname = url.pathname.slice(url.pathname.indexOf('/api/'));
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : {};
    for (const [m, re, fn] of routes) {
      const hit = method === m && re.exec(pathname);
      if (hit) return fn(hit, body, url);
    }
    return fail(404, 'Not found');
  };

  // One quiet line says what this is; everything else is the real interface.
  document.addEventListener('DOMContentLoaded', () => {
    const bar = document.createElement('div');
    bar.className = 'demo-bar';
    bar.innerHTML = 'You’re looking at Cereal with three sample projects. Open one, then switch to another and wait a moment. <button type="button" class="demo-reset">Start over</button> <a class="demo-get" href="./">Get Cereal for your Mac →</a>';
    document.body.prepend(bar);
    bar.querySelector('.demo-reset').addEventListener('click', () => { localStorage.removeItem(KEY); location.hash = '#/'; location.reload(); });
  });
})();
