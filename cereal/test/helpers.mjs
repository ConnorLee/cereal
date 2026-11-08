import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function tmpDir(name) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `cereal-${name}-`)));
}

export function sh(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@example.com' } }).toString().trim();
}

/** A small "project": a repo with docs, a secret, a linked worktree, and a decision record. */
export function makeRepo(root, name = 'orbit') {
  const repo = path.join(root, name);
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
  sh(root, 'init', '-q', '-b', 'main', repo);
  fs.writeFileSync(path.join(repo, 'README.md'), `# ${name}\n\nA test project for Cereal.\n`);
  fs.writeFileSync(path.join(repo, 'docs', 'PRODUCT_DECISIONS.md'), '# Decisions\n\n## D01 — Keep it local\n\n- **Date/status:** 1 Nov 2026; confirmed.\n\n## D02 — Sync later\n\n- **Date/status:** unresolved; needs reconciliation.\n');
  fs.writeFileSync(path.join(repo, 'docs', 'HANDOFF.md'), '# Handoff\n\n## Open questions\n\n- Unresolved: which sync engine?\n');
  fs.writeFileSync(path.join(repo, '.env'), 'API_KEY=sk-ant-abcdefghijklmnopqrstuvwxyz0123456789\n');
  fs.writeFileSync(path.join(repo, 'docs', 'leaked.md'), '# Notes\n\nkey sk-ant-abcdefghijklmnopqrstuvwxyz0123456789\n');
  sh(repo, 'add', '-A');
  sh(repo, 'commit', '-q', '-m', 'Initial commit');
  sh(repo, 'worktree', 'add', '-q', '-b', 'feature/one', path.join(root, `${name}-feature`));
  return repo;
}
