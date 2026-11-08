import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, makeRepo } from './helpers.mjs';

// Revoking access to a folder must hide what Cereal had indexed from it, not just mark it stale.
const root = tmpDir('privacy');
makeRepo(root, 'orbit');
const notes = path.join(root, 'orbit-notes');
fs.mkdirSync(notes);
fs.writeFileSync(path.join(notes, 'ROADMAP.md'), '# Secret roadmap title\n\nLaunch the moon base in spring.\n');
process.env.CEREAL_CLAUDE_DIR = path.join(root, 'no-claude');
process.env.CEREAL_CODEX_DIR = path.join(root, 'no-codex');

const { Store } = await import('../lib/store.mjs');
const { Engine } = await import('../lib/engine.mjs');
const defs = [{ id: 'orbit', name: 'Orbit', tagline: 't', keyword: /orbit/i, seeds: [root], markers: ['README.md'], brand: {} }];

test('a blocked folder keeps only counts, and forget removes derived context', async (t) => {
  const store = new Store(path.join(root, 'data'));
  const engine = new Engine(store, defs);
  const disc = await engine.discover('orbit');
  await engine.approve('orbit', disc.candidates.map((c) => c.id));
  assert.ok(store.project('orbit').index.docs.some((d) => d.title === 'Secret roadmap title'));

  fs.chmodSync(notes, 0o000);
  t.after(() => fs.chmodSync(notes, 0o755));
  await engine.index('orbit');

  const idx = store.project('orbit').index;
  const blocked = idx.unavailable.find((u) => u.path === notes);
  assert.equal(blocked.code, 'blocked');
  assert.deepEqual({ docs: blocked.retained.docs, repos: blocked.retained.repos }, { docs: 1, repos: 0 });
  const cap = engine.capsule('orbit');
  const everything = JSON.stringify([idx, cap]);
  assert.ok(!everything.includes('Secret roadmap title'), 'title from the blocked folder is gone');
  assert.ok(!everything.includes('moon base'), 'excerpt from the blocked folder is gone');
  assert.ok(idx.docs.some((d) => d.rel === 'README.md'), 'readable sources are still indexed');
  assert.equal(cap.blocked[0].retained.docs, 1, 'the UI can say how much was indexed before');

  // Blocked again on the next pass: the history survives, the contents do not come back.
  await engine.index('orbit');
  assert.equal(store.project('orbit').index.unavailable.find((u) => u.path === notes).retained.docs, 1);

  const kept = engine.retained('orbit');
  assert.equal(kept.blocked[0].retained.docs, 1);
  assert.ok(kept.readable.documents >= 1);

  const after = engine.forget('orbit');
  assert.equal(after.readable.documents, 0);
  assert.equal(after.blocked.length, 0);
  assert.equal(store.project('orbit').sources.length, 2, 'folder approvals stay');
  store.flush();
  assert.ok(!fs.readFileSync(store.file, 'utf8').includes('README.md'), 'nothing derived remains on disk');
});
