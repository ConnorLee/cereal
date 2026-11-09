import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from './helpers.mjs';

// projects.json lives in a shared folder, so Cereal has to survive whatever it finds there.
const root = tmpDir('projects-file');
process.env.CEREAL_DATA_DIR = path.join(root, 'data');
delete process.env.CEREAL_PROJECTS_JSON;
fs.mkdirSync(process.env.CEREAL_DATA_DIR, { recursive: true });

const { projectDefs, projectsFile, saveDefinitions } = await import('../lib/projects.mjs');
const write = (v) => fs.writeFileSync(projectsFile(), typeof v === 'string' ? v : JSON.stringify(v));

test('a list written by the native prototype keeps its names, folders and colours', () => {
  write([
    { id: 'halo', identity: { name: 'Halo', colorHex: '#D29A2C' }, locations: [{ name: 'habit halo', kind: 'folder', path: '/x/habit halo' }, { path: '/x/halo-reports' }], seenAt: 1794167303.8 },
    { id: 'casset', identity: { name: 'Casset', colorHex: '#E0503A' }, locations: [{ kind: 'repo', path: '/x/casset' }] },
  ]);
  const [halo, casset] = projectDefs();
  assert.equal(halo.name, 'Halo');
  assert.deepEqual(halo.seeds, ['/x/habit halo', '/x/halo-reports']);
  assert.equal(halo.brand.accent, '#D29A2C');
  assert.ok(halo.keyword.test('halo'));
  assert.equal(casset.name, 'Casset');
  assert.equal(casset.brand.accent, '#E0503A');
});

test('saving converts the list to Cereal’s own format without losing anything', () => {
  write([{ id: 'halo', identity: { name: 'Halo', colorHex: '#D29A2C' }, locations: [{ path: '/x/habit halo' }] }]);
  saveDefinitions(projectDefs());
  const saved = JSON.parse(fs.readFileSync(projectsFile(), 'utf8'));
  assert.equal(saved[0].name, 'Halo');
  assert.deepEqual(saved[0].seeds, ['/x/habit halo']);
  assert.equal(saved[0].brand.accent, '#D29A2C');
  assert.equal(projectDefs()[0].name, 'Halo');
});

test('broken entries are skipped and a bad keyword never stops Cereal', () => {
  write([null, 'nope', { name: 'No id' }, { id: 'ok', name: 'Ok (beta', keyword: '(' }, { id: 'bare' }]);
  const defs = projectDefs();
  assert.deepEqual(defs.map((d) => d.id), ['ok', 'bare']);
  assert.ok(defs[0].keyword.test('ok (beta'));
  assert.equal(defs[1].name, 'bare', 'falls back to the id rather than "undefined"');
});

test('a file that isn’t a list, or isn’t JSON, reads as no projects', () => {
  write({ projects: [] });
  assert.deepEqual(projectDefs(), []);
  write('{ not json');
  assert.deepEqual(projectDefs(), []);
});
