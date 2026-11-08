import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, makeRepo } from './helpers.mjs';

// End-to-end through the engine with fixture agent stores: approve, index, switch, notify, restart.
const root = tmpDir('engine');
const repo = makeRepo(root, 'orbit');
const claudeDir = path.join(root, 'claude-projects');
fs.mkdirSync(path.join(claudeDir, 'orbit'), { recursive: true });
process.env.CEREAL_CLAUDE_DIR = claudeDir;
process.env.CEREAL_CODEX_DIR = path.join(root, 'codex-sessions-missing');

const { Store } = await import('../lib/store.mjs');
const { Engine } = await import('../lib/engine.mjs');
const defs = [
  { id: 'orbit', name: 'Orbit', tagline: 't', keyword: /orbit/i, seeds: [root], markers: ['README.md'], brand: {} },
  { id: 'other', name: 'Other', tagline: 't', keyword: /zzz-none/i, seeds: [], markers: [], brand: {} },
];

function writeSession(id, cwd, text, minutesAgo = 10) {
  const at = new Date(Date.now() - minutesAgo * 60000).toISOString();
  const lines = [
    { type: 'user', sessionId: id, cwd, timestamp: at, message: { content: `Task ${id}` } },
    { type: 'assistant', sessionId: id, timestamp: at, message: { content: [{ type: 'text', text }] } },
  ];
  fs.writeFileSync(path.join(claudeDir, 'orbit', `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

test('approve → index → capsule → agent notification → restart', async () => {
  const dataDir = path.join(root, 'data');
  writeSession('old-session', repo, 'Earlier work.', 60);
  let store = new Store(dataDir);
  let engine = new Engine(store, defs);

  const disc = await engine.discover('orbit');
  const canonical = disc.candidates.find((c) => c.canonical);
  await engine.approve('orbit', [canonical.id]);
  await engine.refreshAgents();

  let cap = engine.enter('orbit');
  assert.ok(cap.connected);
  assert.equal(cap.agents.total, 1, 'existing session linked by cwd');
  assert.equal(cap.agents.recent[0].attribution.confidence, 'verified-path');
  assert.equal(store.data.notifications.length, 0, 'history is not news');
  assert.ok(cap.decisions.some((d) => d.key === 'D01' && d.kind === 'human'));

  // Isolation: the other project sees none of Orbit's context.
  const other = engine.capsule('other');
  assert.equal(other.agents.total, 0);
  assert.equal(other.decisions.length, 0);

  // Leave Orbit with some workspace state, as if switching to another project.
  const focus = { label: 'docs/HANDOFF.md', source: { type: 'doc', docId: cap.docs.handoff[0].id, path: cap.docs.handoff[0].path, line: 3, label: 'docs/HANDOFF.md:3' } };
  engine.saveWorkspace('orbit', { tab: 'git', focus, drawer: focus.source, scroll: 420 }, { leave: true });
  engine.enter('other');

  // An Orbit agent finishes while we're elsewhere.
  await new Promise((r) => setTimeout(r, 10));
  writeSession('new-session', path.join(root, 'orbit-feature'), 'Done: switcher shipped.', 0);
  await engine.refreshAgents();
  const note = store.data.notifications.at(-1);
  assert.ok(note, 'notification raised');
  assert.equal(note.projectId, 'orbit');
  assert.equal(note.target.id, 'new-session');
  assert.ok(engine.capsule('orbit').counts.changes >= 1, 'switcher shows the change since leaving');
  store.flush();

  // Restart: a fresh process restores everything from disk.
  store = new Store(dataDir);
  engine = new Engine(store, defs);
  const p = store.project('orbit');
  assert.equal(p.sources.length, 1);
  assert.equal(p.workspace.tab, 'git');
  assert.equal(p.workspace.scroll, 420);
  assert.equal(p.workspace.drawer.label, 'docs/HANDOFF.md:3');
  cap = engine.capsule('orbit');
  assert.ok(cap.leftOff.some((f) => f.kind === 'you' && /HANDOFF/.test(f.text)), 'where you left off survives restart');
  assert.ok(store.data.notifications.some((n) => n.target?.id === 'new-session'));
});
