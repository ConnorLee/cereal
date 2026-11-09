import { NOT_PROSE, isTiming } from './edition.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import * as G from './git.mjs';
import { isIgnoredDir, isIndexableDoc, isSecretPath, containsSecret, REFERENCE_FILE } from './safety.mjs';
import { heroFromRepo, heroFromReferences } from './hero.mjs';

const MAX_DOC_BYTES = 400 * 1024;
const MAX_DOCS_PER_SOURCE = 360;

export function categorize(rel) {
  const s = rel.toLowerCase();
  const base = path.basename(s);
  if (/handoff|pause_handoff|session[-_]?notes/.test(s)) return 'handoff';
  if (/decision|\badr\b|dec-\d|design_memory/.test(s)) return 'decision';
  if (/^(readme|agents|claude|agent_workflow|skills|warp)\.md$/.test(base) || /contributing/.test(base)) return 'instructions';
  if (/release|testflight|app-store|build[_-]?\d|changelog|runbook|qualification/.test(s)) return 'release';
  if (/test|validation|qa\b|\/qa\/|smoke|audit|evidence/.test(s)) return 'verification';
  if (/architect|backend|boundary|migration|persistence|protocol|api\/|technical|infra|perf/.test(s)) return 'architecture';
  if (/design|typograph|brand|figma|visual|motion|ui\b|interaction/.test(s)) return 'design';
  if (/product|vision|strategy|roadmap|north[_ ]?star|plan|context|principles|gtm|market/.test(s)) return 'product';
  return 'notes';
}

const STATUS = /\b(approved|rejected|superseded|proposed|unresolved|deferred|accepted|confirmed|pending)\b/i;
const clean = (s) => s.replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim();

// Pull decision records and open questions out of a markdown document, keeping line numbers as provenance.
export function extractSignals(text) {
  const lines = text.split('\n');
  const headings = [];
  const decisions = [];
  const questions = [];
  let title = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = /^(#{1,4})\s+(.+)$/.exec(line);
    if (h) {
      const t = clean(h[2]);
      if (!title && h[1].length === 1) title = t;
      if (headings.length < 14 && h[1].length <= 3) headings.push({ text: t, line: i + 1 });
      const d = /^(D\d{1,3}|ADR[- ]?\d+|[A-Z]{2,8}-DEC-\d+|DEC-\d+)\s*[—–:-]\s*(.+)$/.exec(t);
      if (d) {
        const after = lines.slice(i + 1, i + 6);
        const stop = after.findIndex((l) => /^#{1,4}\s/.test(l));
        const window = (stop === -1 ? after : after.slice(0, stop)).join(' ');
        const statusLine = after.map((l) => /date\/status:?\**\s*(.+)/i.exec(l)).find(Boolean);
        decisions.push({ key: d[1], title: d[2], status: clean(statusLine ? statusLine[1] : (STATUS.exec(window)?.[0] || '')).slice(0, 220), line: i + 1 });
      }
      if (/open question|unresolved|outstanding|blocker|next steps|todo/i.test(t) && t.length >= 12 && !/^todo\b[\s\d:.-]*$/i.test(t)) questions.push({ text: t, line: i + 1 });
      continue;
    }
    const b = /^\*\*([A-Z]{2,8}-DEC-\d+)\*\*\s*[,—–:-]?\s*(.+)$/.exec(line.trim());
    if (b) {
      const rest = clean(b[2]);
      decisions.push({ key: b[1], title: rest.slice(0, 200), status: (STATUS.exec(rest)?.[0] || '').toLowerCase(), line: i + 1 });
      continue;
    }
    if (questions.length < 12 && /^\s*[-*]\s+(\*\*)?(open question|unresolved|todo|blocked)\b/i.test(line)) {
      questions.push({ text: clean(line.replace(/^\s*[-*]\s+/, '')).slice(0, 200), line: i + 1 });
    }
  }
  const firstPara = lines.find((l) => l.trim() && !/^\s*(#|\||!\[|<|\[!\[|---|```)/.test(l));
  const excerpt = firstPara ? clean(firstPara.replace(/^\s*(>\s*)+/, '').replace(/^[-*]\s+/, '')).replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').slice(0, 320) : '';
  // Market notes for the morning edition: sizing (TAM/SAM/SOM, market size) and timing ("why now").
  const market = [];
  for (let i = 0; i < lines.length && market.length < 4; i++) {
    const raw = lines[i];
    // Tables, code and file references are working notes, not things the doc says about the market.
    if (/^\s*(```|    |\t)/.test(raw) || NOT_PROSE.test(raw)) continue;
    const t = clean(raw.replace(/^\s*(>\s*)+/, '').replace(/^\s*(#{1,6}|[-*]|\d+\.)\s+/, ''));
    if (t.length < 24 || t.length > 400) continue;
    const kind = isTiming(t) ? 'whynow'
      : /\b(TAM|SAM|SOM)\b|total addressable|addressable market|market size|market sizing|market opportunity|\bcompetitors?\b|\bincumbents?\b/i.test(t) ? 'market' : null;
    if (kind) market.push({ text: t.slice(0, 260), line: i + 1, kind });
  }
  // Dated commitments for the morning briefing: a deadline, due, ship or launch line with a real date in it.
  const deadlines = [];
  for (let i = 0; i < lines.length && deadlines.length < 6; i++) {
    const t = clean(lines[i].replace(/^\s*(#{1,6}|[-*]|\d+\.)\s+/, ''));
    if (t.length > 300 || !/\b(deadline|due( date| by| on)?|ship(s|ping)?( date| on| by)?|launch(es|ing)?( date| on)?|release date|target date|goes out|freeze)\b/i.test(t)) continue;
    const date = parseDocDate(t);
    if (date) deadlines.push({ text: t.replace(/\*\*/g, '').slice(0, 200), date, line: i + 1 });
  }
  return { title, headings, decisions, questions, excerpt, market, deadlines };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** A calendar date written in a document (2026-11-12, 12 November 2026, November 12, 2026) as YYYY-MM-DD. Year required. */
export function parseDocDate(t) {
  const pad = (n) => String(n).padStart(2, '0');
  let m = /\b(20\d\d)-(\d\d)-(\d\d)\b/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(20\d\d)\b/i.exec(t);
  if (m) return `${m[3]}-${pad(MONTHS.indexOf(m[2].toLowerCase()) + 1)}-${pad(m[1])}`;
  m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(st|nd|rd|th)?,?\s+(20\d\d)\b/i.exec(t);
  if (m) return `${m[4]}-${pad(MONTHS.indexOf(m[1].toLowerCase()) + 1)}-${pad(m[2])}`;
  return null;
}

async function readDoc(abs) {
  if (isSecretPath(abs)) return { skipped: 'secret-name' };
  let st;
  try { st = await fs.stat(abs); } catch { return { skipped: 'missing' }; }
  if (!st.isFile()) return { skipped: 'not-file' };
  if (st.size > MAX_DOC_BYTES) return { skipped: 'too-large', st };
  const text = await fs.readFile(abs, 'utf8');
  if (containsSecret(text)) return { skipped: 'secret-content' };
  return { text, st };
}

function docRecord({ abs, rel, sourceId, checkout, branch, text, st }) {
  const sig = extractSignals(text);
  return {
    id: crypto.createHash('sha1').update(abs).digest('hex').slice(0, 14),
    sourceId, path: abs, rel, checkout, branch,
    title: sig.title || path.basename(rel).replace(/\.(md|mdx|txt)$/i, '').replace(/[_-]+/g, ' '),
    category: categorize(rel), mtime: st.mtime.toISOString(), size: st.size,
    hash: crypto.createHash('sha1').update(text).digest('hex').slice(0, 12),
    headings: sig.headings, decisions: sig.decisions, questions: sig.questions, excerpt: sig.excerpt, market: sig.market, deadlines: sig.deadlines,
  };
}

const PRIORITY = { decision: 0, handoff: 1, instructions: 2, product: 3, release: 4, architecture: 5, design: 6, verification: 7, notes: 8 };

async function indexRepository(source, log) {
  const live = (source.worktrees || []).filter((w) => !w.prunable);
  // Git state for every checkout: branch, head, uncommitted count. Read-only (see git.mjs).
  const worktrees = [];
  const queue = [...live];
  const workers = Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const w = queue.shift();
      const [last, dirty] = await Promise.all([G.lastCommit(w.path), G.dirtyCount(w.path)]);
      worktrees.push({ path: w.path, branch: w.branch, last, dirty, locked: w.locked });
    }
  });
  await Promise.all(workers);
  for (const w of source.worktrees || []) if (w.prunable) worktrees.push({ path: w.path, branch: w.branch, last: null, dirty: null, prunable: true });
  worktrees.sort((a, b) => String(b.last?.date || '').localeCompare(String(a.last?.date || '')));

  const main = source.path;
  const [branches, commits, branchTotal] = await Promise.all([G.recentBranches(main, 14), G.recentCommits(main), G.branchCount(main)]);

  // Documents: the most recently active checkout is the freshest picture of the project;
  // the main checkout fills in anything it lacks; other active checkouts contribute docs they changed this week.
  const focus = worktrees.find((w) => w.last && !w.prunable) || { path: main, branch: null };
  const docs = new Map();
  const addFrom = async (checkout, branch, rels) => {
    for (const rel of rels) {
      if (docs.size >= MAX_DOCS_PER_SOURCE) return;
      if (!isIndexableDoc(rel) || docs.has(rel)) continue;
      const abs = path.join(checkout, rel);
      const r = await readDoc(abs);
      if (r.skipped) { if (r.skipped.startsWith('secret')) log.secretsSkipped++; continue; }
      docs.set(rel, docRecord({ abs, rel, sourceId: source.id, checkout, branch, text: r.text, st: r.st }));
    }
  };
  const byPriority = (rels) => rels.filter(isIndexableDoc).sort((a, b) => PRIORITY[categorize(a)] - PRIORITY[categorize(b)] || a.split('/').length - b.split('/').length);
  const recentByCheckout = await Promise.all(worktrees.filter((w) => w.last && Date.now() - Date.parse(w.last.date) < 7 * 864e5).slice(0, 10)
    .map(async (w) => ({ w, rels: await G.docsChangedRecently(w.path) })));
  for (const { w, rels } of recentByCheckout) await addFrom(w.path, w.branch, rels.filter((r) => !docs.has(r)));
  await addFrom(focus.path, focus.branch, byPriority(await G.trackedFiles(focus.path)));
  if (focus.path !== main) await addFrom(main, worktrees.find((w) => w.path === main)?.branch, byPriority(await G.trackedFiles(main)));

  return {
    git: { sourceId: source.id, path: main, commonDir: source.commonDir, branchTotal, branches, commits, worktrees, focus: focus.path },
    docs: [...docs.values()],
  };
}

async function indexFolder(source, log) {
  const docs = [];
  const references = [];
  const stack = [[source.path, 0]];
  while (stack.length && docs.length < MAX_DOCS_PER_SOURCE) {
    const [dir, depth] = stack.pop();
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 4 && !isIgnoredDir(e.name)) stack.push([abs, depth + 1]); continue; }
      if (!e.isFile()) continue;
      const rel = path.relative(source.path, abs);
      if (isSecretPath(abs)) { log.secretsSkipped++; continue; }
      if (isIndexableDoc(rel)) {
        const r = await readDoc(abs);
        if (r.skipped) { if (r.skipped.startsWith('secret')) log.secretsSkipped++; continue; }
        docs.push(docRecord({ abs, rel, sourceId: source.id, checkout: source.path, branch: null, text: r.text, st: r.st }));
      } else if (REFERENCE_FILE.test(e.name) && references.length < 200) {
        // Binary references are listed (name, type, date) but never opened.
        const st = await fs.stat(abs).catch(() => null);
        if (st) references.push({ id: crypto.createHash('sha1').update(abs).digest('hex').slice(0, 14), sourceId: source.id, path: abs, rel, kind: path.extname(e.name).slice(1).toLowerCase(), category: categorize(rel), mtime: st.mtime.toISOString(), size: st.size });
      }
    }
  }
  return { docs, references };
}

/**
 * Can this folder actually be read? `access()` can pass while macOS privacy controls (TCC) still
 * refuse to list ~/Documents or ~/Desktop, which would otherwise look like an empty project.
 */
export async function sourceProblem(dir) {
  try {
    await fs.readdir(dir);
    return null;
  } catch (e) {
    if (e.code === 'ENOENT') return { code: 'missing', reason: 'This folder no longer exists.' };
    if (e.code === 'EPERM' || e.code === 'EACCES') return { code: 'blocked', reason: 'macOS is blocking Cereal from reading this folder.' };
    return { code: 'unreadable', reason: `Cereal couldn’t read this folder (${e.code || e.message}).` };
  }
}

/** Index every approved source of one project. Never writes anywhere but the returned object. */
export async function indexProject(project) {
  const log = { secretsSkipped: 0, startedAt: new Date().toISOString() };
  const out = { repos: [], docs: [], references: [], unavailable: [] };
  for (const source of project.sources || []) {
    const problem = await sourceProblem(source.path);
    if (problem) {
      out.unavailable.push({ sourceId: source.id, path: source.path, ...problem });
      continue;
    }
    if (source.kind === 'repository') {
      const r = await indexRepository(source, log);
      out.repos.push(r.git);
      out.docs.push(...r.docs);
    } else {
      const r = await indexFolder(source, log);
      out.docs.push(...r.docs);
      out.references.push(...r.references);
    }
  }
  // Header image: the latest product shot committed to any readable repository, else the newest folder image.
  const heroes = (await Promise.all(out.repos.map((r) => heroFromRepo(r.path, r.sourceId).catch(() => null)))).filter(Boolean);
  out.hero = heroes.sort((a, b) => b.at.localeCompare(a.at))[0] || (await heroFromReferences(out.references).catch(() => null));
  const revision = crypto.createHash('sha1').update(JSON.stringify([
    out.repos.map((r) => r.worktrees.map((w) => [w.path, w.last?.sha, w.dirty])),
    out.docs.map((d) => [d.path, d.hash]),
    out.hero?.images.map((i) => i.sha || i.file),
  ])).digest('hex').slice(0, 12);
  return { ...out, revision, indexedAt: new Date().toISOString(), log: { ...log, finishedAt: new Date().toISOString(), docCount: out.docs.length } };
}
