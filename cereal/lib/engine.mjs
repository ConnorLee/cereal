import fs from 'node:fs/promises';
import path from 'node:path';
import { discoverProject, candidateId } from './discover.mjs';
import { indexProject } from './indexer.mjs';
import { scanAgents, attribute } from './agents.mjs';
import { buildCapsule, slimSession } from './capsule.mjs';
import { repoIdentity, listWorktrees, lastCommit, commitExists, trackedFiles, blob } from './git.mjs';
import { IMAGE_TYPES, imageSize } from './images.mjs';
import { isInside, expandHome } from './paths.mjs';
import { makeDefinition, normalizeOne, saveDefinitions } from './projects.mjs';
import { buildDispatch, buildLede } from './edition.mjs';

export class Engine {
  constructor(store, defs) {
    this.store = store;
    this.defs = defs;
    this.byId = Object.fromEntries(defs.map((d) => [d.id, d]));
    this.indexing = new Map();
    this.capsules = new Map();
    this.agentScan = null;
    this.unresolved = [];
    this.runtimes = null;
    this.baselined = false;
    this.startedAt = Date.now();
  }

  // Add a project from the app itself: a name and one folder the user chose. Saved to projects.json.
  async addProject(name, folder) {
    if (!String(name || '').trim()) throw Object.assign(new Error('Give the project a name.'), { status: 400 });
    const problem = await fs.readdir(folder).then(() => null, (e) => e.code);
    if (problem === 'ENOENT') throw Object.assign(new Error('That folder doesn’t exist.'), { status: 400 });
    if (problem) throw Object.assign(new Error('Cereal can’t read that folder. macOS may be blocking it.'), { status: 400 });
    const def = normalizeOne(makeDefinition(name, folder, this.defs));
    this.defs.push(def);
    this.byId[def.id] = def;
    const saved = saveDefinitions(this.defs);
    await this.discover(def.id);
    await this.addFolder(def.id, folder);
    return { id: def.id, saved };
  }

  def(id) {
    const d = this.byId[id];
    if (!d) throw Object.assign(new Error(`Unknown project ${id}`), { status: 404 });
    return d;
  }

  // ---------- Discovery & approval ----------

  async discover(id) {
    const p = this.store.project(id);
    const found = await discoverProject(this.def(id), this.defs.filter((d) => d.id !== id));
    // Folders the user added by hand stay in the list across re-discovery.
    const manual = (p.discovery?.candidates || []).filter((c) => c.manual && !found.candidates.some((f) => f.id === c.id));
    found.candidates.push(...manual);
    for (const c of found.candidates) c.approved = p.sources.some((s) => s.id === c.id);
    p.discovery = found;
    this.store.save();
    return found;
  }

  async addFolder(id, folder) {
    const p = this.store.project(id);
    const st = await fs.stat(folder).catch(() => null);
    if (!st?.isDirectory()) throw Object.assign(new Error('Not a readable folder'), { status: 400 });
    const ident = await repoIdentity(folder);
    let cand;
    if (ident && ident.toplevel === folder) {
      const trees = await listWorktrees(folder);
      const withLast = await Promise.all(trees.map(async (t) => ({ ...t, last: t.prunable ? null : await lastCommit(t.path) })));
      cand = { id: candidateId(ident.commonDir), kind: 'repository', path: trees[0]?.path || folder, commonDir: ident.commonDir, label: path.basename(folder), evidence: [`Selected by you`, `${trees.length} checkout(s) share this repository`], worktrees: withLast.map((t) => ({ path: t.path, branch: t.branch, prunable: t.prunable, locked: t.locked, last: t.last })), manual: true, recommended: true, note: 'Added from the folder picker.' };
    } else {
      cand = { id: candidateId(folder), kind: 'documents', path: folder, label: path.basename(folder), evidence: ['Selected by you'], manual: true, recommended: true, note: 'Added from the folder picker.' };
    }
    p.discovery ||= { projectId: id, candidates: [], unrelated: [] };
    p.discovery.candidates = p.discovery.candidates.filter((c) => c.id !== cand.id).concat(cand);
    this.store.save();
    return cand;
  }

  approve(id, candidateIds) {
    const p = this.store.project(id);
    const cands = (p.discovery?.candidates || []).filter((c) => candidateIds.includes(c.id));
    p.sources = cands.map((c) => ({ id: c.id, kind: c.kind, path: c.path, label: c.label, commonDir: c.commonDir, worktrees: c.worktrees, canonical: !!c.canonical, approvedAt: new Date().toISOString() }));
    for (const c of p.discovery?.candidates || []) c.approved = candidateIds.includes(c.id);
    this.store.save({ now: true });
    return this.index(id);
  }

  // ---------- Indexing ----------

  index(id) {
    if (this.indexing.has(id)) return this.indexing.get(id);
    const job = (async () => {
      const p = this.store.project(id);
      // Refresh worktree lists so new checkouts are picked up.
      for (const s of p.sources) {
        if (s.kind !== 'repository') continue;
        const trees = await listWorktrees(s.path);
        if (trees.length) {
          const prev = new Map((s.worktrees || []).map((w) => [w.path, w]));
          s.worktrees = trees.filter((t) => !t.bare).map((t) => ({ path: t.path, branch: t.branch, prunable: t.prunable, locked: t.locked, last: prev.get(t.path)?.last || null }));
        }
      }
      const idx = await indexProject(p);
      // When a source can't be read, its contents are dropped: a cache must never outlive revoked access.
      // Only history is kept — how much was indexed and when — so the project reads "blocked", not "empty".
      const prev = p.index;
      for (const u of idx.unavailable) {
        const before = prev?.unavailable?.find((x) => x.sourceId === u.sourceId)?.retained;
        const docs = (prev?.docs || []).filter((d) => d.sourceId === u.sourceId).length;
        const repos = (prev?.repos || []).filter((r) => r.sourceId === u.sourceId).length;
        u.retained = docs || repos ? { docs, repos, indexedAt: prev.indexedAt } : before || null;
      }
      idx.icon = await findIcon(p, idx);
      idx.wordmark = await findWordmark(idx);
      // A cover you chose stays until a newer product shot is committed; then the header follows the product again.
      const pinned = await pinnedCover(this.def(id));
      if (pinned && (!idx.hero || Date.parse(idx.hero.at) <= Date.parse(pinned.at))) idx.hero = pinned;
      const changed = p.index?.revision !== idx.revision;
      p.index = idx;
      p.heads = headsOf(idx);
      this.capsules.delete(id);
      this.store.save();
      if (this.agentScan) this.#attributeAll();
      return { revision: idx.revision, changed, docCount: idx.docs.length };
    })().finally(() => this.indexing.delete(id));
    this.indexing.set(id, job);
    return job;
  }

  // ---------- Agents ----------

  async refreshAgents() {
    const scan = await scanAgents(this.store.agentCache);
    this.store.agentCache = scan.cache;
    this.agentScan = scan;
    this.runtimes = { ...scan.runtimes, errors: scan.errors.length, scannedAt: scan.scannedAt };
    await this.#attributeAll();
    this.store.save();
    return this.runtimes;
  }

  projectRoots() {
    const roots = {};
    for (const d of this.defs) {
      const p = this.store.project(d.id);
      roots[d.id] = p.sources.flatMap((s) => (s.kind === 'repository' ? (s.worktrees || []).map((w) => w.path).concat(s.path) : [s.path]));
    }
    return roots;
  }

  async #attributeAll() {
    if (!this.agentScan) return;
    const roots = this.projectRoots();
    const per = Object.fromEntries(this.defs.map((d) => [d.id, []]));
    const unresolved = [];
    for (const s of this.agentScan.sessions) {
      const a = attribute(s, roots);
      const withA = { ...s, attribution: a };
      if (a.projectId) per[a.projectId].push(withA);
      else if (a.basis === 'ambiguous') unresolved.push(slimSession(withA));
    }
    for (const d of this.defs) {
      const p = this.store.project(d.id);
      const repoDirs = p.sources.filter((s) => s.kind === 'repository').map((s) => s.path);
      p.known ||= {};
      p.known.verified ||= {};
      // Cross-check every commit an agent claims against Git: first the project's approved repositories,
      // then the repositories the session itself touched (read-only `git cat-file`).
      for (const s of per[d.id]) {
        for (const c of s.commits || []) {
          let v = p.known.verified[c.sha];
          if (v === undefined || typeof v === 'boolean') {
            v = { ok: false, repo: null, outside: false };
            for (const r of repoDirs) if (await commitExists(r, c.sha)) { v = { ok: true, repo: r, outside: false }; break; }
            if (!v.ok) {
              for (const r of await reposTouched(s)) if (await commitExists(r, c.sha)) { v = { ok: true, repo: r, outside: true }; break; }
            }
            p.known.verified[c.sha] = v;
          }
          c.verified = v.ok;
          c.repo = v.repo;
          c.outside = v.outside;
        }
      }
      const prevAgents = new Map((p.agents || []).map((s) => [s.id, s]));
      p.agents = per[d.id].map(slimSession).sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)));
      this.capsules.delete(d.id);
      if (this.baselined) this.#notifyAgents(d, prevAgents, p.agents);
    }
    this.unresolved = unresolved.sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt))).slice(0, 20);
    this.baselined = true;
  }

  #notifyAgents(def, prev, next) {
    const approvedAt = Math.max(...this.store.project(def.id).sources.map((s) => Date.parse(s.approvedAt) || 0), 0);
    const threshold = Math.max(this.startedAt, approvedAt);
    for (const s of next) {
      const before = prev.get(s.id);
      if (s.status === 'running') continue;
      if (before && before.lastAt === s.lastAt && before.status === s.status) continue;
      // Sessions that already existed when Cereal started (or when this project was approved) are history, not news.
      if (!before && Date.parse(s.lastAt) < threshold) continue;
      if (Date.parse(s.lastAt) < threshold) continue;
      this.notify({
        projectId: def.id, kind: 'agent', sessionId: s.id, tool: s.tool,
        title: `${def.name}: ${s.tool === 'codex' ? 'Codex' : 'Claude Code'} finished`,
        text: s.title || 'Agent session updated',
        detail: s.latest?.text || '',
        target: { type: 'session', tool: s.tool, id: s.id, label: s.title },
      });
    }
  }

  notify(n) {
    const list = this.store.data.notifications;
    // Collapse repeats for the same session within ten minutes.
    const dup = list.find((x) => x.sessionId && x.sessionId === n.sessionId && Date.now() - Date.parse(x.at) < 10 * 60 * 1000);
    if (dup) return dup;
    const item = { id: (list.at(-1)?.id || 0) + 1, at: new Date().toISOString(), ...n };
    list.push(item);
    if (list.length > 100) list.splice(0, list.length - 100);
    this.store.save();
    return item;
  }

  // ---------- Git change detection ----------

  async checkGitHeads() {
    for (const d of this.defs) {
      const p = this.store.project(d.id);
      if (!p.index || this.indexing.has(d.id)) continue;
      const now = {};
      for (const s of p.sources.filter((x) => x.kind === 'repository')) {
        for (const t of await listWorktrees(s.path)) if (t.head) now[t.path] = t.head;
      }
      const before = p.heads || {};
      const moved = Object.keys(now).filter((k) => before[k] && before[k] !== now[k]);
      const added = Object.keys(now).filter((k) => !before[k]);
      if (!moved.length && !added.length) continue;
      await this.index(d.id);
      for (const wt of moved.slice(0, 3)) {
        const c = await lastCommit(wt);
        if (c) this.notify({ projectId: d.id, kind: 'commit', title: `${d.name}: new commit in ${path.basename(wt)}`, text: c.subject, detail: `${c.short} · ${c.author}`, target: { type: 'commit', repo: p.sources.find((s) => s.kind === 'repository')?.path, sha: c.sha, label: `${c.short} · ${c.subject}` } });
      }
    }
  }

  // ---------- Capsules & visits ----------

  capsule(id) {
    const def = this.def(id);
    const p = this.store.project(id);
    // While you're in a project, changes count from your previous visit; once you leave, from when you left.
    const since = this.store.data.ui.active === id ? p.viewSince : p.lastVisitAt;
    const key = [p.index?.revision, (p.agents || []).map((a) => a.id + a.lastAt).join(), since, p.workspace?.updatedAt].join('|');
    const hit = this.capsules.get(id);
    if (hit?.key === key) return hit.capsule;
    const capsule = buildCapsule({ def, project: { ...p, lastVisitAt: since ?? null }, index: p.index, sessions: p.agents || [] });
    capsule.connected = p.sources.length > 0;
    capsule.indexing = this.indexing.has(id);
    capsule.hasIcon = !!p.index?.icon;
    capsule.iconUrl = this.iconUrl(id);
    capsule.wordmarkUrl = p.index?.wordmark ? `/api/projects/${id}/wordmark?v=${p.index.revision}` : null;
    capsule.hero = this.heroView(id);
    capsule.lastVisitAt = p.lastVisitAt;
    this.capsules.set(id, { key, capsule });
    return capsule;
  }

  enter(id) {
    const p = this.store.project(id);
    // "Changes since your last visit" are measured from the previous visit, not from now.
    p.viewSince = p.lastVisitAt;
    p.lastVisitAt = new Date().toISOString();
    p.visits = (p.visits || []).concat(p.lastVisitAt).slice(-50);
    this.store.data.ui.active = id;
    this.store.save();
    return this.capsule(id);
  }

  saveWorkspace(id, state, { leave = false } = {}) {
    const p = this.store.project(id);
    const clean = Object.fromEntries(Object.entries(state).filter(([, v]) => v !== undefined));
    p.workspace = { ...(p.workspace || {}), ...clean, updatedAt: new Date().toISOString() };
    // Leaving a project closes the visit: next time, "what's changed" starts from here.
    if (leave) {
      p.lastVisitAt = p.workspace.updatedAt;
      if (this.store.data.ui.active === id) this.store.data.ui.active = null;
      this.capsules.delete(id);
    }
    this.store.save();
    return p.workspace;
  }

  portfolio() {
    return this.defs.map((d) => {
      const c = this.capsule(d.id);
      return {
        id: d.id, name: d.name, tagline: d.tagline, brand: d.brand, connected: c.connected, indexing: c.indexing, hasIcon: c.hasIcon, iconUrl: c.iconUrl, wordmarkUrl: c.wordmarkUrl, hero: c.hero,
        state: c.state, lastVisitAt: c.lastVisitAt, description: c.description,
        leftOff: c.leftOff.slice(0, 2), decisions: c.decisions.slice(0, 3), questions: c.questions.slice(0, 2),
        agents: { active: c.agents.active.slice(0, 3), recent: c.agents.recent.slice(0, 3), total: c.agents.total },
        attention: c.attention.slice(0, 6), counts: c.counts,
        needs: { reviews: c.attention.filter((a) => a.sessionId).length, risks: c.attention.filter((a) => a.severity === 'high').length, total: c.attention.length },
        pickUp: c.resume[0] || null, blocked: c.blocked,
        workspace: c.workspace,
        git: c.git.map((g) => ({ path: g.path, branchTotal: g.branchTotal, worktrees: g.worktrees.length })),
      };
    });
  }

  // ---------- Safe lookups for the source viewer ----------

  // What Cereal keeps about a project, by kind — counts and dates, never contents.
  retained(id) {
    const p = this.store.project(id);
    const idx = p.index || {};
    return {
      dataFile: this.store.file,
      approvedFolders: p.sources.map((s) => ({ path: s.path, kind: s.kind })),
      indexedAt: idx.indexedAt || null,
      readable: { documents: (idx.docs || []).length, repositories: (idx.repos || []).length, designFiles: (idx.references || []).length },
      blocked: (idx.unavailable || []).map((u) => ({ path: u.path, code: u.code, retained: u.retained || null })),
      agentSessions: (p.agents || []).length,
      notifications: this.store.data.notifications.filter((n) => n.projectId === id).length,
      workspace: { tab: p.workspace?.tab || null, hasOpenItem: !!p.workspace?.focus, lastVisitAt: p.lastVisitAt },
    };
  }

  // Forget everything Cereal derived from a project. Folder approvals stay, so re-indexing is one click.
  forget(id) {
    const p = this.store.project(id);
    p.index = null;
    p.discovery = null; // rebuilt from Git the next time the Sources screen opens
    p.sources = p.sources.map((s) => ({ ...s, worktrees: (s.worktrees || []).map((w) => ({ path: w.path, branch: w.branch, prunable: w.prunable, locked: w.locked, last: null })) }));
    p.heads = {};
    p.known = {};
    p.agents = [];
    p.workspace = {};
    p.visits = [];
    p.lastVisitAt = null;
    p.viewSince = null;
    this.store.data.notifications = this.store.data.notifications.filter((n) => n.projectId !== id);
    this.capsules.delete(id);
    this.store.save({ now: true });
    return this.retained(id);
  }

  // The morning edition across every connected project.
  edition(now = Date.now()) {
    const dispatches = this.defs.filter((d) => this.store.project(d.id).sources.length).map((d) => {
      const cap = this.capsule(d.id);
      return { ...buildDispatch({ def: d, capsule: cap, index: this.store.project(d.id).index, now }), name: d.name, brand: d.brand, iconUrl: cap.iconUrl, wordmarkUrl: cap.wordmarkUrl };
    });
    dispatches.sort((a, b) => b.moved - a.moved);
    return { ...buildLede(dispatches, new Date(now)), dispatches };
  }

  // ---------- Brand imagery: app icon or logo, and the header image ----------

  iconUrl(id) {
    const icon = this.store.project(id).index?.icon;
    return icon ? `/api/projects/${id}/icon?v=${encodeURIComponent(path.basename(icon))}-${this.store.project(id).index.revision}` : null;
  }

  heroView(id) {
    const hero = this.store.project(id).index?.hero;
    if (!hero) return null;
    return {
      layout: hero.layout, at: hero.at, subject: hero.subject, pinned: !!hero.pinned,
      images: hero.images.map((img, i) => ({ url: `/api/projects/${id}/hero/${i}?v=${(img.sha || '').slice(0, 10) || encodeURIComponent(path.basename(img.file || ''))}`, w: img.w, h: img.h })),
    };
  }

  async heroBytes(id, i) {
    const p = this.store.project(id);
    const hero = p.index?.hero;
    const img = hero?.images?.[Number(i)];
    if (!img) return null;
    let buf = null;
    if (img.pinned && img.file === expandHome(this.def(id).cover?.file || '')) buf = await fs.readFile(img.file).catch(() => null);
    else if (img.sha && this.ownsRepo(id, hero.repo)) buf = await blob(hero.repo, img.sha, img.path);
    else if (img.file && this.ownsPath(id, img.file)) buf = await fs.readFile(img.file).catch(() => null);
    return buf ? { buf, type: IMAGE_TYPES[img.ext] || 'application/octet-stream' } : null;
  }

  async wordmarkBytes(id) {
    const file = this.store.project(id).index?.wordmark;
    if (!file || !this.ownsPath(id, file)) return null;
    const buf = await fs.readFile(file).catch(() => null);
    return buf ? { buf, type: IMAGE_TYPES[path.extname(file).slice(1).toLowerCase()] || 'image/png' } : null;
  }

  async iconBytes(id) {
    const icon = this.store.project(id).index?.icon;
    if (!icon || !this.ownsPath(id, icon)) return null;
    const buf = await fs.readFile(icon).catch(() => null);
    return buf ? { buf, type: IMAGE_TYPES[path.extname(icon).slice(1).toLowerCase()] || 'image/png' } : null;
  }

  docById(id, docId) {
    const p = this.store.project(id);
    return (p.index?.docs || []).find((d) => d.id === docId) || null;
  }

  sessionById(id, sessionId) {
    return (this.store.project(id).agents || []).find((s) => s.id === sessionId) || null;
  }

  ownsPath(id, target) {
    const roots = this.projectRoots()[id] || [];
    return roots.some((r) => isInside(target, r));
  }

  ownsRepo(id, repo) {
    return this.store.project(id).sources.some((s) => s.kind === 'repository' && s.path === repo);
  }
}

const repoCache = new Map();
async function reposTouched(session) {
  const dirs = new Set();
  for (const ref of [session.cwd, ...(session.pathRefs || [])].filter(Boolean)) {
    let dir = ref;
    for (let i = 0; i < 6 && dir && dir !== '/'; i++) {
      const st = await fs.stat(dir).catch(() => null);
      if (st?.isDirectory()) break;
      dir = path.dirname(dir);
    }
    if (dir) dirs.add(dir);
    if (dirs.size > 24) break;
  }
  const tops = new Set();
  for (const dir of dirs) {
    if (!repoCache.has(dir)) repoCache.set(dir, (await repoIdentity(dir))?.toplevel || null);
    const top = repoCache.get(dir);
    if (top) tops.add(top);
  }
  return [...tops].slice(0, 8);
}

function headsOf(idx) {
  const heads = {};
  for (const r of idx.repos) for (const w of r.worktrees) if (w.last?.sha) heads[w.path] = w.last.sha;
  return heads;
}

async function findIcon(p, idx) {
  const repo = idx.repos[0];
  if (!repo) return null;
  const files = await trackedFiles(repo.focus || repo.path);
  // The real app icon first, then a square brand mark or logo, then a web icon. Never a placeholder.
  const ok = (f) => !/placeholder|dark|tinted|mono|white|black|node_modules|\/(dist|build|out)\//i.test(f);
  const pick = files.find((f) => /AppIcon\.appiconset\/[^/]*\.png$/i.test(f) && ok(f))
    || files.find((f) => /(^|\/)(app[-_]?icon|icon[-_]?(1024|512|256)|apple-touch-icon)[^/]*\.(png|svg)$/i.test(f) && ok(f))
    || files.find((f) => /(^|\/)(brand|branding|logo|logos|assets)\/.*(mark|logo|icon)[^/]*\.(svg|png)$/i.test(f) && ok(f))
    || files.find((f) => /(^|\/)(logo|mark|icon|favicon)[^/]*\.(svg|png)$/i.test(f) && ok(f) && !/\.ico$/i.test(f));
  return pick ? path.join(repo.focus || repo.path, pick) : null;
}

// A wordmark or logotype file, if the project keeps one: wide, on a light background, not an inverse variant.
async function findWordmark(idx) {
  const repo = idx.repos[0];
  if (!repo) return null;
  const root = repo.focus || repo.path;
  const files = (await trackedFiles(root)).filter((f) => /(^|\/)[^/]*(wordmark|logotype|logo[-_ ]?type|lockup)[^/]*\.(svg|png)$/i.test(f)
    && !/white|inverse|reversed|dark|negative|mono|black|node_modules|\/(dist|build|out)\//i.test(f));
  for (const f of files.slice(0, 12)) {
    const abs = path.join(root, f);
    const buf = await fs.readFile(abs).catch(() => null);
    const size = buf && imageSize(buf, path.extname(f).slice(1));
    if (size && size.w / size.h >= 1.6) return abs;
  }
  return null;
}

async function pinnedCover(def) {
  if (!def.cover?.file) return null;
  const file = expandHome(def.cover.file);
  const buf = await fs.readFile(file).catch(() => null);
  const ext = path.extname(file).slice(1).toLowerCase();
  const size = buf && imageSize(buf, ext);
  if (!size) return null;
  const st = await fs.stat(file);
  return { layout: size.h / size.w > 1.3 ? 'devices' : 'cover', images: [{ file, w: size.w, h: size.h, ext, pinned: true }], at: def.cover.pinnedAt || st.mtime.toISOString(), subject: def.cover.caption || 'Your chosen cover', pinned: true };
}

