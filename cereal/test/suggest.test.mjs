import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpDir, makeRepo } from './helpers.mjs';

// Starting out: suggestions from where agents worked and the usual code folders, a folder of repositories
// offered one project each, and several projects added at once. HOME is a fixture so nothing real is read.
const home = tmpDir('home');
process.env.HOME = home;
process.env.CEREAL_DATA_DIR = path.join(home, 'Library', 'Application Support', 'Cereal');
process.env.CEREAL_CLAUDE_DIR = path.join(home, 'no-claude');
process.env.CEREAL_CODEX_DIR = path.join(home, 'no-codex');
delete process.env.CEREAL_PROJECTS_JSON;

const code = path.join(home, 'Code');
fs.mkdirSync(code, { recursive: true });
const orbit = makeRepo(code, 'orbit'); // has a linked worktree at ~/Code/orbit-feature
const kite = makeRepo(code, 'paper-kite');
fs.mkdirSync(path.join(code, 'acme'));
const nested = makeRepo(path.join(code, 'acme'), 'dashboard'); // one level down: ~/Code/acme/dashboard
const stale = makeRepo(code, 'old-thing');
const old = '2025-01-01T00:00:00Z';
execFileSync('git', ['-C', stale, 'commit', '-q', '--amend', '--no-edit', '--date', old], { env: { ...process.env, GIT_COMMITTER_DATE: old, GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@example.com' } });
fs.mkdirSync(path.join(home, 'notes'));
fs.mkdirSync(path.join(home, 'Documents', 'Codex', '2026-11-07', 'scratch-chat'), { recursive: true });
fs.mkdirSync(path.join(home, '.config', 'tool'), { recursive: true });

const { suggestProjects, reposInside } = await import('../lib/suggest.mjs');
const now = new Date().toISOString();
const session = (cwd, tool = 'claude-code', lastAt = now) => ({ cwd, tool, lastAt });

test('agent sessions become one suggestion per repository, shown at its main checkout', async () => {
  const list = await suggestProjects({
    folders: [],
    sessions: [
      session(orbit), session(path.join(code, 'orbit-feature')), session(path.join(orbit, 'docs'), 'codex'),
      session(path.join(home, 'notes')),
      session(home), session('/tmp/build'), session(path.join(home, '.config', 'tool')),
      session(path.join(home, 'Documents', 'Codex', '2026-11-07', 'scratch-chat'), 'codex'),
      session(path.join(home, 'Documents', 'Field Notes')),
    ],
  });
  const byName = Object.fromEntries(list.map((s) => [s.name, s]));
  assert.deepEqual(Object.keys(byName).sort(), ['Field Notes', 'Notes', 'Orbit']);
  assert.equal(byName.Orbit.path, orbit, 'a worktree session counts toward the main checkout');
  assert.deepEqual(byName.Orbit.sessions, { claude: 2, codex: 1 });
  assert.equal(byName.Orbit.kind, 'repository');
  assert.equal(byName.Orbit.checkouts, 2);
  assert.equal(byName.Notes.kind, 'folder');
  // A protected folder is suggested from its path alone (it doesn't even exist here): nothing was looked at.
  assert.equal(byName['Field Notes'].protectedFolder, true);
  assert.ok(list.every((s) => s.suggested), 'worked on this week, so all are pre-ticked');
});

test('code folders add recent repositories, one level deep, and skip what is taken or long quiet', async () => {
  const list = await suggestProjects({ folders: ['Code', 'code', 'Missing'], sessions: [], taken: { paths: [kite], commonDirs: [] } });
  const paths = list.map((s) => s.path).sort();
  assert.deepEqual(paths, [nested, orbit].sort());
  assert.ok(!paths.includes(stale));
  const inside = await reposInside(code);
  assert.deepEqual(inside.map((r) => r.name).sort(), ['Dashboard', 'Old Thing', 'Orbit', 'Paper Kite'], 'inside a folder, quiet ones count too');
});

test('a folder of repositories is offered one project each, or kept together; several add at once', async () => {
  const { Store } = await import('../lib/store.mjs');
  const { Engine } = await import('../lib/engine.mjs');
  const { projectDefs } = await import('../lib/projects.mjs');
  const engine = new Engine(new Store(process.env.CEREAL_DATA_DIR), projectDefs());

  const split = await engine.splitFolder(code);
  assert.equal(split.split, true);
  assert.deepEqual(split.repos.map((r) => r.name).sort(), ['Dashboard', 'Old Thing', 'Orbit', 'Paper Kite']);
  assert.equal(await engine.splitFolder(orbit), null, 'a repository is one project');
  assert.equal(await engine.splitFolder(path.join(home, 'notes')), null, 'so is a folder with no repositories');

  const { added, failed } = await engine.addProjects([{ path: orbit, name: 'Orbit' }, { path: kite, name: 'Paper Kite' }, { path: path.join(home, 'gone'), name: 'Gone' }]);
  assert.deepEqual(added.map((a) => a.id), ['orbit', 'paper-kite']);
  assert.deepEqual(failed.map((f) => f.name), ['Gone'], 'one bad folder doesn’t stop the rest');
  await Promise.all([...engine.indexing.values()]);
  const src = engine.store.project('orbit').sources;
  assert.deepEqual(src.map((s) => s.path), [orbit], 'ticking a suggestion approves exactly that repository');
  assert.ok(engine.store.project('orbit').index, 'and indexes it');

  const again = await engine.splitFolder(code);
  assert.deepEqual(again.repos.filter((r) => r.taken).map((r) => r.name).sort(), ['Orbit', 'Paper Kite'], 'added ones show as taken');
  const left = await engine.suggestions();
  assert.ok(!left.some((s) => s.path === orbit || s.path === kite), 'and are no longer suggested');

  // Kept together: the folder's repositories belong to the project; the folder itself isn't read twice.
  const { id } = await engine.addProject('Acme', path.join(code, 'acme'));
  const cands = engine.store.project(id).discovery.candidates;
  assert.ok(cands.find((c) => c.path === nested)?.recommended, 'the repository inside is ticked');
  assert.equal(cands.find((c) => c.kind === 'documents')?.recommended, false);
  assert.equal(engine.store.project(id).discovery.unrelated.length, 0);
});
