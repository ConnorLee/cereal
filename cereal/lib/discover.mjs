import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { expandHome, tildify } from './paths.mjs';
import { repoIdentity, listWorktrees, lastCommit, branchCount } from './git.mjs';
import { isIgnoredDir, isSecretPath } from './safety.mjs';

export const candidateId = (p) => crypto.createHash('sha1').update(p).digest('hex').slice(0, 12);

async function isDir(p) {
  try { return (await fs.stat(p)).isDirectory(); } catch { return false; }
}

async function findMarker(root, markers) {
  for (const m of markers) {
    if (!m.includes('*')) {
      if (await fs.stat(path.join(root, m)).then(() => true, () => false)) return m;
      continue;
    }
    // Shallow glob: look up to two levels for a matching name (e.g. *.xcodeproj).
    const re = new RegExp('^' + m.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
    const stack = [[root, 0]];
    while (stack.length) {
      const [dir, depth] = stack.pop();
      let entries = [];
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (re.test(e.name)) return path.relative(root, path.join(dir, e.name));
        if (e.isDirectory() && depth < 2 && !isIgnoredDir(e.name)) stack.push([path.join(dir, e.name), depth + 1]);
      }
    }
  }
  return null;
}

async function countDocs(root) {
  let docs = 0, refs = 0;
  const stack = [[root, 0]];
  while (stack.length && docs + refs < 2000) {
    const [dir, depth] = stack.pop();
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 3 && !isIgnoredDir(e.name)) stack.push([p, depth + 1]); continue; }
      if (isSecretPath(p)) continue;
      if (/\.(md|mdx|txt)$/i.test(e.name)) docs++;
      else if (/\.(pdf|pages|key|fig|png|jpe?g|mov|mp4)$/i.test(e.name)) refs++;
    }
  }
  return { docs, refs };
}

/**
 * Discover candidate sources for a project. Groups every Git checkout by its common git
 * directory so that 29 worktrees of one repository show up as one repository, not 29 projects.
 */
export async function discoverProject(def, others = []) {
  const gitDirs = new Map();   // commonDir -> { seenPaths:Set }
  const folders = [];          // non-git folders whose name matches the project
  const unrelated = [];
  const blocked = [];
  const explicit = new Set();

  for (const seedRaw of def.seeds) {
    if (!(await isDir(expandHome(seedRaw)))) continue;
    // Compare real paths: Git reports resolved top-levels (e.g. /private/var for /var).
    const seed = await fs.realpath(expandHome(seedRaw));
    // macOS privacy controls can hide ~/Documents and ~/Desktop; say so instead of finding nothing.
    try { await fs.readdir(seed); } catch (e) { if (e.code === 'EPERM' || e.code === 'EACCES') blocked.push(seed); continue; }
    const id = await repoIdentity(seed);
    if (id && id.toplevel === seed) {
      if (!gitDirs.has(id.commonDir)) gitDirs.set(id.commonDir, { seenPaths: new Set() });
      gitDirs.get(id.commonDir).seenPaths.add(seed);
      // Separate repositories nested inside a project folder (e.g. a website kept beside an old app).
      let kids = [];
      try { kids = await fs.readdir(seed, { withFileTypes: true }); } catch { /* unreadable */ }
      for (const e of kids) {
        if (!e.isDirectory() || e.name.startsWith('.') || isIgnoredDir(e.name)) continue;
        const child = path.join(seed, e.name);
        const cid = await repoIdentity(child);
        if (cid && cid.toplevel === child && cid.commonDir !== id.commonDir) {
          if (!gitDirs.has(cid.commonDir)) gitDirs.set(cid.commonDir, { seenPaths: new Set(), parentMatch: def.keyword.test(path.basename(seed)) });
          gitDirs.get(cid.commonDir).seenPaths.add(child);
        }
      }
      continue;
    }
    // A seeded folder inside a repository (e.g. an untracked "Design Docs" folder) is still a document source.
    if (def.keyword.test(path.basename(seed))) { folders.push(seed); explicit.add(seed); }
    if (id) continue;
    let entries = [];
    try { entries = await fs.readdir(seed, { withFileTypes: true }); } catch { continue; }
    // A folder named for the project (one you chose to keep several repositories together) owns the repositories
    // in it. A broad folder like ~/Code doesn't: there a repository still has to match the project's name.
    const seedMatch = def.keyword.test(path.basename(seed));
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || isIgnoredDir(e.name)) continue;
      const child = path.join(seed, e.name);
      const cid = await repoIdentity(child);
      if (cid && cid.toplevel === child) {
        if (!gitDirs.has(cid.commonDir)) gitDirs.set(cid.commonDir, { seenPaths: new Set() });
        if (seedMatch) Object.assign(gitDirs.get(cid.commonDir), { parentMatch: true, inSeed: true });
        gitDirs.get(cid.commonDir).seenPaths.add(child);
      } else if (!cid && def.keyword.test(e.name)) {
        folders.push(child);
      }
    }
  }

  const candidates = [];
  for (const [commonDir, info] of gitDirs) {
    const anyPath = [...info.seenPaths][0];
    const trees = (await listWorktrees(anyPath)).filter((t) => !t.bare);
    const main = trees[0]?.path || path.dirname(commonDir);
    const names = trees.map((t) => path.basename(t.path)).concat(path.basename(main));
    const nameMatch = names.some((n) => def.keyword.test(n)) || !!info.parentMatch;
    const marker = await findMarker(main, def.markers);
    const commits = await Promise.all(trees.map(async (t) => ({ ...t, last: t.prunable ? null : await lastCommit(t.path) })));
    const latest = commits.filter((c) => c.last).sort((a, b) => b.last.date.localeCompare(a.last.date))[0];
    const evidence = [
      `Git common directory ${tildify(commonDir)}`,
      `${trees.length} checkout${trees.length === 1 ? '' : 's'} share this repository (${trees.filter((t) => t.prunable).length} prunable)`,
      `${await branchCount(main)} local branches`,
    ];
    if (marker) evidence.push(`Contains ${marker}`);
    if (info.parentMatch) evidence.push(`${info.inSeed ? 'Inside' : 'Nested inside'} ${tildify(path.dirname(main))}`);
    if (latest) evidence.push(`Latest commit ${latest.last.short} on ${latest.branch || 'detached HEAD'} — ${latest.last.date.slice(0, 10)}`);
    const record = {
      id: candidateId(commonDir), kind: 'repository', path: main, commonDir,
      label: path.basename(main), nameMatch, marker, evidence,
      worktrees: commits.map((c) => ({ path: c.path, branch: c.branch, prunable: c.prunable, locked: c.locked, last: c.last })),
      lastActivity: latest?.last?.date || null, inSeed: !!info.inSeed,
    };
    // A marker file alone (README, package.json, an .xcodeproj) is not evidence of *this* project — it only ranks candidates.
    if (!nameMatch) { unrelated.push({ path: main, reason: `Repository name does not match ${def.name}${marker ? ` (contains ${marker}, but that alone is not evidence)` : ''}` }); continue; }
    candidates.push(record);
  }

  // Canonical source = the repository with the strongest evidence: project marker, then most checkouts, then recency.
  const repos = candidates.filter((c) => c.kind === 'repository');
  repos.sort((a, b) => (!!b.marker - !!a.marker) || (b.worktrees.length - a.worktrees.length) || String(b.lastActivity).localeCompare(String(a.lastActivity)));
  repos.forEach((r, i) => {
    r.canonical = i === 0;
    r.recommended = i === 0;
    const ageDays = r.lastActivity ? (Date.now() - Date.parse(r.lastActivity)) / 86400000 : Infinity;
    if (r.inSeed) r.recommended = true;
    if (i === 0) r.note = 'Canonical source: strongest Git evidence for this project.';
    else if (r.inSeed) r.note = 'Inside the folder you chose for this project.';
    else if (ageDays > 90) r.note = `Separate repository, inactive for ${Math.round(ageDays)} days. Likely an archived implementation; review before approving.`;
    else r.note = 'Separate repository with a matching name. Approve only if it belongs to this project.';
  });

  const inWorktree = (p) => repos.some((r) => r.worktrees.some((w) => p === w.path || p.startsWith(w.path + '/')));
  for (const f of [...new Set(folders)]) {
    if (inWorktree(f) && !explicit.has(f)) continue;
    const counts = await countDocs(f);
    let st; try { st = await fs.stat(f); } catch { continue; }
    const otherProject = others.some((o) => o.keyword.test(path.basename(f)));
    candidates.push({
      id: candidateId(f), kind: 'documents', path: f, label: path.basename(f),
      evidence: [`Folder (not a Git repository)`, `${counts.docs} text documents, ${counts.refs} design/reference files`],
      recommended: !otherProject && counts.docs + counts.refs > 0 && counts.docs + counts.refs < 1500,
      note: otherProject ? 'Mentions more than one project. Left unchecked so contexts stay isolated.' : 'Working documents folder.',
      lastActivity: st.mtime.toISOString(),
    });
  }

  return { projectId: def.id, discoveredAt: new Date().toISOString(), candidates, unrelated, blocked };
}
