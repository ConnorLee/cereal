import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, makeRepo, sh } from './helpers.mjs';
import { extractSignals } from '../lib/indexer.mjs';

test('market and why-now lines are picked out of documents, with their line numbers', () => {
  const md = '# Market\n\nSome intro.\n\n- TAM: roughly 2 million field researchers worldwide.\n- Why now: tablets finally work offline in the field.\n- Unrelated note.\n';
  const s = extractSignals(md);
  assert.deepEqual(s.market.map((m) => [m.kind, m.line]), [['market', 5], ['whynow', 6]]);
  assert.match(s.market[0].text, /^TAM: roughly 2 million/);
});

test('the morning edition reports what moved, from sourced facts only', async () => {
  const root = tmpDir('edition');
  const repo = makeRepo(root, 'orbit');
  fs.writeFileSync(path.join(repo, 'docs', 'MARKET.md'), '# Market\n\n- Total addressable market: 40,000 small venues in Europe.\n- Why now: cheap smart bulbs reached every venue.\n');
  sh(repo, 'add', '-A');
  sh(repo, 'commit', '-q', '-m', 'Add market notes');
  const claude = path.join(root, 'claude', 'orbit');
  fs.mkdirSync(claude, { recursive: true });
  const at = new Date(Date.now() - 3600e3).toISOString();
  fs.writeFileSync(path.join(claude, 's1.jsonl'), [
    { type: 'user', sessionId: 's1', cwd: repo, timestamp: at, message: { content: 'Polish the scene editor' } },
    { type: 'user', sessionId: 's1', timestamp: at, message: { content: [{ type: 'tool_result', content: '# pass 7\n# fail 0' }] } },
    { type: 'assistant', sessionId: 's1', timestamp: at, message: { content: [{ type: 'text', text: 'Scene editor polished; tests pass.' }] } },
    { type: 'custom-title', customTitle: 'Scene editor polish' },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n');
  process.env.CEREAL_CLAUDE_DIR = path.join(root, 'claude');
  process.env.CEREAL_CODEX_DIR = path.join(root, 'none');
  const { Store } = await import('../lib/store.mjs');
  const { Engine } = await import('../lib/engine.mjs');
  const engine = new Engine(new Store(path.join(root, 'data')), [
    { id: 'orbit', name: 'Orbit', tagline: '', keyword: /orbit/i, seeds: [root], markers: ['README.md'], brand: { accent: '#3F7D5B' } },
    { id: 'quiet', name: 'Quiet', tagline: '', keyword: /zzz/i, seeds: [], markers: [], brand: {} },
  ]);
  const disc = await engine.discover('orbit');
  await engine.approve('orbit', [disc.candidates.find((c) => c.canonical).id]);
  await engine.refreshAgents();

  const ed = engine.edition();
  assert.equal(ed.dispatches.length, 1, 'only connected projects get a dispatch');
  const d = ed.dispatches[0];
  assert.equal(d.headline.text, 'Claude finished “Scene editor polish”, tests passing');
  assert.equal(d.headline.src.type, 'session');
  assert.match(d.deck, /commit.*since yesterday/);
  assert.deepEqual(d.market.map((m) => m.kind), ['market', 'whynow']);
  assert.equal(d.market[0].src.label, 'docs/MARKET.md:3');
  assert.ok(d.product.some((p) => p.text === 'Add market notes' && p.kind === 'git'));
  assert.ok(d.process.some((p) => /D01/.test(p.text)), 'decisions explain how it got here');
  assert.equal(ed.text, 'Everything moved overnight: Orbit.');
});
