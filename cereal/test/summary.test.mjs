import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outlineSummary } from '../lib/summary.mjs';

test('the structural summary uses the document’s own purpose, facts, sections and open items, with line numbers', () => {
  const md = [
    '# Tile cache',
    '',
    '**Purpose:** Keep this week’s plots on the iPad so cold start stays under two seconds.',
    '**Status:** Cache works; cold start is 2.4 s.',
    '- **Owner:** Field app team.',
    '',
    '## Limits',
    '',
    'A 750 MB cap for now.',
    '',
    '## D04 — Evict by plot, not by tile',
    '',
    '- **Date/status:** proposed.',
    '',
    '## Open questions',
    '',
    '- Unresolved: cap at 500 MB or 1 GB?',
  ].join('\n');
  const s = outlineSummary(md);
  assert.equal(s.mode, 'outline');
  assert.match(s.lead, /^Keep this week’s plots/);
  assert.deepEqual(s.facts.map((f) => [f.label, f.line]), [['Status', 4], ['Owner', 5]]);
  assert.deepEqual(s.sections.map((h) => h.line), [7, 11, 15]);
  assert.deepEqual(s.decisions.map((d) => [d.text.slice(0, 3), d.line]), [['D04', 11]]);
  assert.ok(s.questions.some((q) => q.line === 17));
  assert.equal(s.minutes, 1);
});

test('a document without labelled facts falls back to its first paragraph', () => {
  const s = outlineSummary('# Notes\n\nThe bridge drops after the first scene on Android.\n\nMore later.\n');
  assert.equal(s.lead, 'The bridge drops after the first scene on Android.');
  assert.deepEqual(s.facts, []);
});
