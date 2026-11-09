// Projects to suggest when someone starts out: where their agents worked recently, and the Git repositories
// in their usual code folders. Only folder names and Git metadata are looked at; nothing is indexed until the
// person picks a suggestion. Folders macOS protects (Documents, Desktop, iCloud…) are never touched here, so
// suggesting never triggers a privacy prompt; macOS asks once when the person adds one.
import fs from 'node:fs/promises';
import path from 'node:path';
import { HOME, isInside } from './paths.mjs';
import { repoIdentity, listWorktrees, lastCommit } from './git.mjs';
import { isIgnoredDir } from './safety.mjs';
import { candidateId } from './discover.mjs';

const DAY = 864e5;
export const CODE_FOLDERS = ['Developer', 'Code', 'code', 'Projects', 'projects', 'src', 'GitHub', 'github', 'repos', 'Repositories', 'dev', 'Dev', 'workspace', 'Workspace', 'Sites', 'git', 'work'];
const PROTECTED = ['Documents', 'Desktop', 'Downloads', 'Library/Mobile Documents', 'Library/CloudStorage', 'Pictures', 'Movies', 'Music'].map((d) => path.join(HOME, d));

export const isProtected = (p) => PROTECTED.some((d) => isInside(p, d)) || p.startsWith('/Volumes/');
// Places agents run that aren't anyone's project: home itself, anywhere outside it (temp folders, the system), app data.
const notAProject = (p) => !p || !path.isAbsolute(p) || p === HOME || (!isInside(p, HOME) && !p.startsWith('/Volumes/'))
  || (isInside(p, path.join(HOME, 'Library')) && !isProtected(p));
// Hidden folders (~/.config, ~/.claude) aren't projects, though a worktree kept in one belongs to its repository.
const hidden = (p) => path.relative(HOME, p).split(path.sep).some((seg) => seg.startsWith('.'));
// Scratch folders tools make per chat or run (Codex's ~/Documents/Codex/2026-11-07/…, workspace-<uuid>/) aren't projects.
const scratch = (p) => /(^|\/)(\d{4}-\d{2}-\d{2}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|workspace-[0-9a-f-]{8,})(\/|$)/i.test(p);
// A plain folder (not a repository) as a suggestion. macOS folders ignore case, so ~/Desktop/AP3 and ~/Desktop/ap3 are one.
const folderSuggestion = (p, extra = {}) => ({ id: candidateId(p.toLowerCase()), commonDir: null, path: p, kind: 'folder', name: prettyName(p), lastCommit: null, ...extra });
export const prettyName = (p) => path.basename(p).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim() || p;

async function isDir(p) { try { return (await fs.stat(p)).isDirectory(); } catch { return false; } }

async function pool(items, n, fn) {
  const out = [];
  const queue = items.map((x, i) => [x, i]);
  await Promise.all(Array.from({ length: n }, async () => { while (queue.length) { const [x, i] = queue.shift(); out[i] = await fn(x); } }));
  return out;
}

// A Git repository as a suggestion: grouped by its common Git directory, shown at its main checkout.
async function repoAt(dir) {
  const id = await repoIdentity(dir);
  if (!id) return null;
  const trees = (await listWorktrees(id.toplevel)).filter((t) => !t.bare && !t.prunable);
  const main = trees[0]?.path && (await isDir(trees[0].path)) ? trees[0].path : id.toplevel;
  const last = await lastCommit(main);
  return { id: candidateId(id.commonDir), commonDir: id.commonDir, path: main, kind: 'repository', name: prettyName(main), checkouts: trees.length || 1, lastCommit: last ? { date: last.date, subject: last.subject } : null };
}

// Repositories directly inside a folder, and one level further for folders that group them (e.g. ~/Code/acme/*).
export async function reposInside(folder, { limit = 60 } = {}) {
  const found = new Map();
  const visit = async (dir, depth) => {
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    const kids = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && !isIgnoredDir(e.name)).slice(0, 200).map((e) => path.join(dir, e.name));
    const repos = await pool(kids, 8, async (k) => {
      const id = await repoIdentity(k);
      if (id && id.toplevel === k) return repoAt(k);
      if (!id && depth < 1) await visit(k, depth + 1);
      return null;
    });
    for (const r of repos) if (r && !found.has(r.id)) found.set(r.id, r);
  };
  await visit(folder, 0);
  return [...found.values()].sort((a, b) => String(b.lastCommit?.date || '').localeCompare(String(a.lastCommit?.date || ''))).slice(0, limit);
}

/**
 * Suggestions for a new user. `sessions` are the agent sessions Cereal already read (cwd, tool, lastAt);
 * `taken` lists folders and Git directories that already belong to a project, so they aren't offered again.
 */
export async function suggestProjects({ sessions = [], taken = { paths: [], commonDirs: [] }, folders = CODE_FOLDERS, now = Date.now(), limit = 12 } = {}) {
  const byKey = new Map();
  const isTaken = (s) => taken.commonDirs.includes(s.commonDir) || taken.paths.some((p) => p === s.path || isInside(s.path, p));
  const merge = (s, from) => {
    const prev = byKey.get(s.id);
    if (!prev) { byKey.set(s.id, { ...s, sessions: { claude: 0, codex: 0 }, lastSessionAt: null, ...from }); return; }
    for (const k of ['claude', 'codex']) prev.sessions[k] += from.sessions?.[k] || 0;
    if (from.lastSessionAt && (!prev.lastSessionAt || from.lastSessionAt > prev.lastSessionAt)) prev.lastSessionAt = from.lastSessionAt;
  };

  // 1. Where agents ran. Many sessions share a folder, so each folder is looked at once.
  const cwds = new Map();
  for (const s of sessions) {
    const cwd = s.cwd && path.resolve(s.cwd);
    if (!cwd || notAProject(cwd)) continue;
    const c = cwds.get(cwd) || { claude: 0, codex: 0, lastAt: '' };
    c[s.tool === 'codex' ? 'codex' : 'claude'] += 1;
    if (String(s.lastAt) > c.lastAt) c.lastAt = String(s.lastAt);
    cwds.set(cwd, c);
  }
  await pool([...cwds], 8, async ([cwd, c]) => {
    const from = { sessions: { claude: c.claude, codex: c.codex }, lastSessionAt: c.lastAt || null };
    if (isProtected(cwd)) {
      // Not looked at: suggesting must not set off a macOS privacy prompt. Named from its path instead.
      if (!scratch(cwd)) merge(folderSuggestion(cwd, { protectedFolder: true }), from);
      return;
    }
    if (!(await isDir(cwd))) return;
    const repo = await repoAt(cwd);
    if (repo && !hidden(repo.path) && !notAProject(repo.path)) merge(repo, from);
    else if (!repo && !hidden(cwd) && !scratch(cwd)) merge(folderSuggestion(cwd), from);
  });
  // A folder an agent ran in that sits inside another suggestion is part of it.
  for (const [k, s] of byKey) if (!s.commonDir && [...byKey.values()].some((o) => o !== s && isInside(s.path, o.path))) byKey.delete(k);

  // 2. Repositories in the usual code folders (each folder once, even where names differ only in case).
  const seen = new Set();
  for (const f of folders) {
    const dir = path.join(HOME, f);
    let real;
    try { real = await fs.realpath(dir); } catch { continue; }
    if (seen.has(real.toLowerCase()) || !(await isDir(real))) continue;
    seen.add(real.toLowerCase());
    for (const r of await reposInside(real)) merge(r, {});
  }

  const activity = (s) => Math.max(Date.parse(s.lastSessionAt) || 0, Date.parse(s.lastCommit?.date) || 0);
  const list = [...byKey.values()].filter((s) => !isTaken(s) && activity(s) > now - 90 * DAY)
    .sort((a, b) => activity(b) - activity(a)).slice(0, limit);
  // Pre-select what was clearly worked on this week, at most five.
  let picked = 0;
  for (const s of list) s.suggested = activity(s) > now - 7 * DAY && (s.sessions.claude + s.sessions.codex > 0 || !!s.lastCommit) && picked++ < 5;
  return list;
}
