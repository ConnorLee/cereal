import { execFile } from 'node:child_process';
import path from 'node:path';

// Read-only git. GIT_OPTIONAL_LOCKS=0 stops `git status` from refreshing (writing) the index,
// so background indexing never touches a repository's files or metadata.
const ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' };

export function git(cwd, args, { timeout = 15000 } = {}) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, ...args], { env: ENV, timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? null : stdout.toString());
    });
  });
}

export async function repoIdentity(dir) {
  const out = await git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir', '--show-toplevel']);
  if (!out) return null;
  const [commonDir, toplevel] = out.trim().split('\n');
  return { commonDir: path.resolve(commonDir), toplevel };
}

export async function listWorktrees(dir) {
  const out = await git(dir, ['worktree', 'list', '--porcelain']);
  if (!out) return [];
  const trees = [];
  let cur = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) { cur = { path: line.slice(9), branch: null, head: null, detached: false, prunable: false, locked: false, bare: false }; trees.push(cur); }
    else if (!cur) continue;
    else if (line.startsWith('HEAD ')) cur.head = line.slice(5);
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (line === 'detached') cur.detached = true;
    else if (line.startsWith('prunable')) cur.prunable = true;
    else if (line.startsWith('locked')) cur.locked = true;
    else if (line === 'bare') cur.bare = true;
  }
  return trees;
}

const SEP = '\x1f';

export async function lastCommit(dir) {
  const out = await git(dir, ['log', '-1', `--format=%H${SEP}%h${SEP}%an${SEP}%cI${SEP}%s`]);
  if (!out || !out.trim()) return null;
  const [sha, short, author, date, subject] = out.trim().split(SEP);
  return { sha, short, author, date, subject };
}

export async function dirtyCount(dir) {
  const out = await git(dir, ['status', '--porcelain=v1', '--untracked-files=no'], { timeout: 20000 });
  if (out == null) return null;
  return out.split('\n').filter(Boolean).length;
}

export async function recentBranches(dir, count = 12) {
  const out = await git(dir, ['for-each-ref', '--sort=-committerdate', `--count=${count}`,
    `--format=%(refname:short)${SEP}%(objectname:short)${SEP}%(committerdate:iso-strict)${SEP}%(subject)`, 'refs/heads']);
  if (!out) return [];
  return out.trim().split('\n').filter(Boolean).map((l) => {
    const [name, short, date, subject] = l.split(SEP);
    return { name, short, date, subject };
  });
}

export async function branchCount(dir) {
  const out = await git(dir, ['for-each-ref', '--format=x', 'refs/heads']);
  return out ? out.split('\n').filter(Boolean).length : 0;
}

export async function recentCommits(dir, { since = '14 days ago', max = 80 } = {}) {
  const out = await git(dir, ['log', '--branches', `--since=${since}`, `-n`, String(max), '--date-order',
    `--format=%H${SEP}%h${SEP}%an${SEP}%cI${SEP}%s${SEP}%D`]);
  if (!out) return [];
  return out.trim().split('\n').filter(Boolean).map((l) => {
    const [sha, short, author, date, subject, refs] = l.split(SEP);
    return { sha, short, author, date, subject, refs: refs || '' };
  });
}

export async function commitExists(dir, sha) {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return false;
  const out = await git(dir, ['cat-file', '-t', sha]);
  return out != null && out.trim() === 'commit';
}

export async function showCommit(dir, sha) {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return null;
  return git(dir, ['show', '--stat', '--format=%H%n%an <%ae>%n%cI%n%n%B', sha]);
}

export async function docsChangedRecently(dir, since = '7 days ago') {
  const out = await git(dir, ['log', `--since=${since}`, '--name-only', '--format=', 'HEAD']);
  if (!out) return [];
  return [...new Set(out.split('\n').filter((f) => /\.(md|mdx|txt)$/i.test(f)))];
}

export async function trackedFiles(dir) {
  const out = await git(dir, ['ls-files'], { timeout: 20000 });
  return out ? out.split('\n').filter(Boolean) : [];
}

// Raw bytes from Git (for images). Read-only: `git cat-file` reads the object store, never a working tree.
export function gitBuffer(cwd, args, { timeout = 15000, max = 12 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, ...args], { env: ENV, timeout, maxBuffer: max, encoding: 'buffer' }, (err, stdout) => resolve(err ? null : stdout));
  });
}

export function blob(dir, sha, file) {
  if (!/^[0-9a-f]{7,40}$/i.test(sha) || file.includes('\n')) return Promise.resolve(null);
  return gitBuffer(dir, ['cat-file', 'blob', `${sha}:${file}`]);
}

/** Images added or changed in recent commits on any local branch, newest first. */
export async function recentImageCommits(dir, { since = '180 days ago', max = 600 } = {}) {
  const out = await git(dir, ['log', '--branches', `--since=${since}`, '-n', String(max), '--date-order', '--diff-filter=AM', '--no-renames', '--name-only',
    `--format=\x1e%H${SEP}%cI${SEP}%s`, '--', '*.png', '*.jpg', '*.jpeg', '*.webp', '*.svg', '*.PNG', '*.JPG'], { timeout: 30000 });
  if (!out) return [];
  const hits = [];
  for (const chunk of out.split('\x1e').slice(1)) {
    const [head, ...files] = chunk.split('\n');
    const [sha, date, subject] = head.split(SEP);
    for (const f of files.filter(Boolean)) hits.push({ sha, date, subject, path: f });
  }
  return hits;
}
