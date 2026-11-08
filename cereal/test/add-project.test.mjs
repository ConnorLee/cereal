import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, makeRepo } from './helpers.mjs';

// Adding a project from the empty state: one name, one folder, no config file editing.
const root = tmpDir('add');
const repo = makeRepo(root, 'field-notes');
process.env.CEREAL_DATA_DIR = path.join(root, 'data');
process.env.CEREAL_CLAUDE_DIR = path.join(root, 'no-claude');
process.env.CEREAL_CODEX_DIR = path.join(root, 'no-codex');
delete process.env.CEREAL_PROJECTS_JSON;

const { Store } = await import('../lib/store.mjs');
const { Engine } = await import('../lib/engine.mjs');
const { projectDefs, projectsFile } = await import('../lib/projects.mjs');

test('a project added in the app is discovered, saved, and survives a restart', async () => {
  const store = new Store(process.env.CEREAL_DATA_DIR);
  const engine = new Engine(store, projectDefs());
  assert.equal(engine.defs.length, 0, 'starts on the blank slate');

  const { id, saved } = await engine.addProject('Field Notes', repo);
  assert.equal(id, 'field-notes');
  assert.ok(saved);
  const disc = store.project(id).discovery;
  const cand = disc.candidates.find((c) => c.path === repo);
  assert.ok(cand, 'the chosen folder is offered for approval');
  assert.equal(cand.kind, 'repository');
  assert.equal(store.project(id).sources.length, 0, 'nothing is read before approval');

  await assert.rejects(engine.addProject('', repo), /name/);
  await assert.rejects(engine.addProject('Ghost', path.join(root, 'missing')), /doesn’t exist/);

  const again = await engine.addProject('Field Notes', repo);
  assert.equal(again.id, 'field-notes-2', 'names never collide');

  const reloaded = projectDefs();
  assert.deepEqual(reloaded.map((d) => d.id), ['field-notes', 'field-notes-2']);
  assert.ok(reloaded[0].keyword.test('field-notes'), 'the saved keyword still matches the folder name');
  assert.ok(fs.readFileSync(projectsFile(), 'utf8').includes('"Field Notes"'));
});
