import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, sh, makeRepo } from './helpers.mjs';
import { isSecretPath, containsSecret } from '../lib/safety.mjs';
import { extractSignals, indexProject } from '../lib/indexer.mjs';
import { discoverProject } from '../lib/discover.mjs';
import { attribute, summarizeClaude } from '../lib/agents.mjs';
import { buildCapsule } from '../lib/capsule.mjs';

test('secret files and secret content are refused', () => {
  for (const p of ['/x/.env', '/x/.env.local', '/x/a/.env.production/x.md', '/x/key.pem', '/x/AuthKey.p8', '/x/credentials.json', '/x/GoogleService-Info.plist', '/x/dist.mobileprovision']) assert.ok(isSecretPath(p), p);
  for (const p of ['/x/README.md', '/x/docs/PRODUCT_DECISIONS.md']) assert.ok(!isSecretPath(p), p);
  assert.ok(containsSecret('token: sk-ant-abcdefghijklmnopqrstuvwxyz012345'));
  assert.ok(containsSecret('-----BEGIN PRIVATE KEY-----'));
  assert.ok(!containsSecret('A normal design document.'));
});

test('decision records and open questions keep their line numbers', () => {
  const md = '# Orbit decisions\n\n## D01 — Offline is the default\n\n- **Date/status:** 21 October 2026; confirmed.\n\n**ORB-DEC-005**, 7 November 2026: **approved**, for Build 49.\n\n## Open questions\n';
  const s = extractSignals(md);
  assert.equal(s.title, 'Orbit decisions');
  assert.deepEqual(s.decisions.map((d) => [d.key, d.line]), [['D01', 3], ['ORB-DEC-005', 7]]);
  assert.match(s.decisions[0].status, /confirmed/);
  assert.equal(s.decisions[1].status, 'approved');
  assert.equal(s.questions[0].line, 9);
});

test('discovery groups worktrees by repository and finds the canonical source', async () => {
  const root = tmpDir('disc');
  makeRepo(root, 'orbit');
  fs.mkdirSync(path.join(root, 'orbit-notes'));
  fs.writeFileSync(path.join(root, 'orbit-notes', 'plan.md'), '# Plan\n');
  fs.mkdirSync(path.join(root, 'unrelated'));
  sh(root, 'init', '-q', path.join(root, 'unrelated'));
  const d = await discoverProject({ id: 'orbit', name: 'Orbit', keyword: /orbit/i, seeds: [root], markers: ['README.md'] });
  const repos = d.candidates.filter((c) => c.kind === 'repository');
  assert.equal(repos.length, 1, 'main checkout and its worktree are one repository');
  assert.equal(repos[0].worktrees.length, 2);
  assert.ok(repos[0].canonical && repos[0].recommended);
  assert.ok(d.candidates.some((c) => c.kind === 'documents' && c.label === 'orbit-notes'));
  assert.ok(d.unrelated.some((u) => u.path.endsWith('unrelated')));
});

test('a repository that merely shares a marker file is not pulled into another project', async () => {
  const root = tmpDir('iso');
  makeRepo(root, 'alpha');
  makeRepo(root, 'beta');
  const d = await discoverProject({ id: 'beta', name: 'Beta', keyword: /beta/i, seeds: [root], markers: ['README.md'] });
  const repos = d.candidates.filter((c) => c.kind === 'repository');
  assert.deepEqual(repos.map((r) => r.label), ['beta']);
  assert.ok(d.unrelated.some((u) => u.path.endsWith('/alpha')));
});

test('indexing reads docs, skips secrets, and never modifies the repository', async () => {
  const root = tmpDir('idx');
  const repo = makeRepo(root, 'orbit');
  fs.appendFileSync(path.join(repo, 'README.md'), '\nUncommitted edit.\n'); // a dirty worktree must stay dirty, untouched
  const gitDir = path.join(repo, '.git');
  const before = { status: sh(repo, 'status', '--porcelain'), head: sh(repo, 'rev-parse', 'HEAD'), index: fs.statSync(path.join(gitDir, 'index')).mtimeMs, readme: fs.statSync(path.join(repo, 'README.md')).mtimeMs };
  const d = await discoverProject({ id: 'orbit', name: 'Orbit', keyword: /orbit/i, seeds: [root], markers: ['README.md'] });
  const source = d.candidates.find((c) => c.kind === 'repository');
  const idx = await indexProject({ sources: [{ ...source }] });
  const rels = idx.docs.map((x) => x.rel).sort();
  assert.deepEqual(rels, ['README.md', 'docs/HANDOFF.md', 'docs/PRODUCT_DECISIONS.md']);
  assert.ok(idx.log.secretsSkipped >= 1, 'leaked.md skipped for secret content');
  assert.ok(!JSON.stringify(idx).includes('sk-ant-'), 'no secret text in the index');
  assert.equal(idx.repos[0].worktrees.length, 2);
  assert.equal(idx.repos[0].worktrees.find((w) => w.path === repo).dirty, 1);
  assert.equal(sh(repo, 'status', '--porcelain'), before.status);
  assert.equal(sh(repo, 'rev-parse', 'HEAD'), before.head);
  assert.equal(fs.statSync(path.join(gitDir, 'index')).mtimeMs, before.index, 'git index not rewritten');
  assert.equal(fs.statSync(path.join(repo, 'README.md')).mtimeMs, before.readme);
});

test('missing sources degrade to an unavailable entry instead of failing', async () => {
  const idx = await indexProject({ sources: [{ id: 'gone', kind: 'documents', path: '/nonexistent/cereal-test' }] });
  assert.equal(idx.unavailable.length, 1);
  assert.equal(idx.docs.length, 0);
});

test('session attribution: cwd is path evidence, file paths are inference, splits stay unresolved', () => {
  const roots = { orbit: ['/w/orbit app', '/w/orbit-b46'], lumen: ['/u/lumen'] };
  assert.equal(attribute({ cwd: '/w/orbit-b46/OrbitNative' }, roots).confidence, 'verified-path');
  const inferred = attribute({ cwd: '/w', pathRefs: ['/w/orbit-b46/a.swift', '/w/orbit-b46/b.swift', '/w/orbit app/docs/x.md'] }, roots);
  assert.equal(inferred.projectId, 'orbit');
  assert.equal(inferred.confidence, 'inferred');
  const split = attribute({ cwd: '/w', pathRefs: ['/w/orbit-b46/a', '/u/lumen/b', '/u/lumen/c'] }, roots);
  assert.equal(split.projectId, null);
  assert.equal(split.confidence, 'unresolved');
  assert.equal(attribute({ cwd: '/elsewhere' }, roots).projectId, null);
});

test('Claude Code summaries extract task, edits, claimed commits and test results', () => {
  const t = '2026-11-07T10:00:00.000Z';
  const recs = [
    { type: 'user', sessionId: 's1', cwd: '/w/orbit-b46', gitBranch: 'fix/x', timestamp: t, message: { content: 'Fix the Sync UI tests' } },
    { type: 'assistant', timestamp: t, message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/w/orbit-b46/SyncTests.swift' } }] } },
    { type: 'user', timestamp: t, message: { content: [{ type: 'tool_result', content: 'Executed 42 tests, with 0 failures\n[fix/x 8b707bf] SyncUITests: launch the fixture\n 1 file changed' }] } },
    { type: 'assistant', timestamp: t, message: { content: [{ type: 'text', text: 'Tests pass and the fix is committed.' }] } },
    { type: 'custom-title', customTitle: 'Sync UI tests' },
  ];
  const s = summarizeClaude(recs, '/tmp/s1.jsonl');
  assert.equal(s.title, 'Sync UI tests');
  assert.equal(s.task, 'Fix the Sync UI tests');
  assert.deepEqual(s.filesChanged, ['/w/orbit-b46/SyncTests.swift']);
  assert.equal(s.commits[0].sha, '8b707bf');
  assert.equal(s.commits[0].subject, 'SyncUITests: launch the fixture');
  assert.equal(s.test.status, 'passed');
  assert.equal(s.status, 'idle');
  assert.equal(s.resume, 'claude --resume s1');
});

test('the capsule changes when verified sources change, and every fact cites a source', () => {
  const def = { id: 'orbit', name: 'Orbit', tagline: '', brand: {} };
  const now = Date.parse('2026-11-07T12:00:00Z');
  const repo = (commits) => ({ path: '/r', commonDir: '/r/.git', branchTotal: 1, focus: '/r', branches: [], commits, worktrees: [{ path: '/r', branch: 'main', last: commits[0], dirty: 0 }] });
  const c1 = { sha: 'a'.repeat(40), short: 'aaaaaaa', author: 'T', date: '2026-11-06T09:00:00Z', subject: 'Old work', refs: '' };
  const project = { sources: [], lastVisitAt: '2026-11-07T08:00:00Z', workspace: {} };
  const before = buildCapsule({ def, project, index: { repos: [repo([c1])], docs: [], revision: 'r1' }, now });
  assert.equal(before.changed.length, 0, 'nothing new since the last visit');
  const c2 = { ...c1, sha: 'b'.repeat(40), short: 'bbbbbbb', date: '2026-11-07T11:00:00Z', subject: 'Ship the switcher' };
  const after = buildCapsule({ def, project, index: { repos: [repo([c2, c1])], docs: [], revision: 'r2' }, now });
  assert.equal(after.changed.length, 1);
  assert.equal(after.changed[0].text, 'Ship the switcher');
  assert.equal(after.changed[0].kind, 'git');
  assert.equal(after.leftOff[0].sources[0].sha, c2.sha);
  for (const f of [...after.leftOff, ...after.changed, ...after.attention]) assert.ok(f.sources?.length, `fact has a source: ${f.text}`);
});

test('unverified agent commit claims surface as attention', () => {
  const def = { id: 'orbit', name: 'Orbit', tagline: '', brand: {} };
  const s = { tool: 'codex', id: 'c1', title: 'Release', status: 'idle', lastAt: '2026-11-07T11:00:00Z', commits: [{ sha: 'deadbeef', subject: 'Release build', verified: false }], attribution: { confidence: 'verified-path', basis: 'cwd' } };
  const cap = buildCapsule({ def, project: { sources: [], workspace: {} }, index: { repos: [], docs: [] }, sessions: [s], now: Date.parse('2026-11-07T12:00:00Z') });
  assert.ok(cap.attention.some((a) => a.severity === 'high' && /deadbee/.test(a.text)));
});
