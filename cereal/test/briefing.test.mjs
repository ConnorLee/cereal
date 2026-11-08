import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from './helpers.mjs';
import { buildBriefing, snapshotOf, safeText } from '../lib/briefing.mjs';
import { renderBriefingEmail } from '../lib/briefing-email.mjs';
import { parseDocDate } from '../lib/indexer.mjs';
import { BriefingStore, zonedToUtc, zonedParts, nextDelivery, dueWindow, windowKey, applySettings, defaultSettings, linkToken, checkToken, deliver, mailerFromEnv, confirmVerification, startVerification } from '../lib/briefing-delivery.mjs';

const NOW = Date.parse('2026-11-09T13:00:00Z'); // 8:00 in New York
const h = (n) => new Date(NOW - n * 36e5).toISOString();

function project({ id = 'orbit', name = 'Orbit', commits = [], sessions = [], decisions = [], questions = [], attention = [], blocked = [], docs = [], leftOff } = {}) {
  return {
    def: { id, name, tagline: 'A test project', brand: { accent: '#3F7D5B' } },
    capsule: { decisions, questions, attention, blocked, resume: [{ label: 'Open the handoff', target: { type: 'doc', docId: 'd1', line: 1 } }], leftOff: leftOff || (commits[0] ? [{ text: `Last commit: ${commits[0].subject}`, at: commits[0].date, kind: 'git', sources: [{ type: 'commit', sha: commits[0].sha }] }] : []) },
    index: { repos: [{ path: '/Users/sam/Code/orbit', commits, branches: [], worktrees: [] }], docs },
    sessions,
  };
}
const commit = (sha, subject, hoursAgo) => ({ sha, short: sha.slice(0, 7), subject, date: h(hoursAgo), author: 'Sam' });

test('what changed comes from real developments, and agent claims stay claims', () => {
  const p = project({
    commits: [commit('a1', 'Cache offline map tiles', 3), commit('a0', 'Start Orbit', 400)],
    sessions: [
      { id: 's1', tool: 'claude-code', title: 'Offline tile cache', status: 'idle', lastAt: h(2), test: { status: 'passed', summary: '18 passed' }, latest: { text: 'Done. Key was in /Users/sam/Code/orbit/.env' } },
      { id: 's2', tool: 'codex', title: 'Android pairing', status: 'running', lastAt: h(1) },
    ],
    attention: [{ sessionId: 's1', text: 'Offline tile cache is ready for review', at: h(2), sources: [{ type: 'session', id: 's1' }] }],
  });
  const b = buildBriefing({ projects: [p], now: NOW, timeZone: 'America/New_York' });
  const s = b.projects[0];
  assert.equal(s.changed.find((c) => /Offline tile cache/.test(c.text)).status, 'claimed', 'an agent saying its tests pass is a claim, not a verified result');
  assert.equal(s.changed.find((c) => /landed/.test(c.text)).status, 'verified');
  assert.match(s.changed.find((c) => /landed/.test(c.text)).text, /“Cache offline map tiles” landed/);
  assert.equal(s.changed.find((c) => /Android/.test(c.text)).status, 'progress');
  assert.ok(!s.changed.some((c) => /Start Orbit/.test(c.text)), 'old commits are not news');
  assert.equal(s.next.kind, 'review');
  assert.equal(b.focus.projectId, 'orbit');
  assert.match(b.overview, /^Orbit moved since yesterday\./);
  assert.equal(b.dateLabel, 'Monday, November 9');
});

test('a quiet night is reported as quiet, with nothing manufactured', () => {
  const p = project({ commits: [commit('a1', 'Cache offline map tiles', 30)] });
  const first = buildBriefing({ projects: [p], now: NOW });
  const again = buildBriefing({ projects: [p], previous: { snapshot: first.snapshot, deliveredAt: h(1) }, now: NOW + 36e5 });
  assert.equal(again.nothingHappened, true);
  assert.match(again.overview, /^A quiet night\. Nothing moved since your last briefing/);
  assert.equal(again.headline, 'Good morning. A quiet one today.');
  assert.deepEqual(again.projects[0].changed, []);
  assert.equal(again.attention.length, 0);
});

test('changes are measured against the last delivered briefing, not the clock', () => {
  const before = project({ commits: [commit('a1', 'One', 50)], decisions: [{ key: 'D02', text: 'D02 — Sync later', unresolved: true, sources: [] }] });
  const prev = buildBriefing({ projects: [before], now: NOW - 48 * 36e5 });
  const after = project({ commits: [commit('a2', 'Two', 40), commit('a1', 'One', 50)], decisions: [{ key: 'D02', text: 'D02 — Sync later', unresolved: false, sources: [] }] });
  const b = buildBriefing({ projects: [after], previous: { snapshot: prev.snapshot, deliveredAt: h(48) }, now: NOW });
  const texts = b.projects[0].changed.map((c) => c.text);
  assert.ok(texts.some((t) => /“Two” landed/.test(t)), 'a commit made 40 hours ago is still news if it is new since the last briefing');
  assert.ok(texts.some((t) => /D02, sync later, is no longer open/.test(t)));
});

test('failures, deadlines and stalled projects reach Needs your attention; the focus picks the most urgent', () => {
  const failing = project({ id: 'a', name: 'Alpha', sessions: [{ id: 'f', tool: 'codex', title: 'Payments', status: 'idle', lastAt: h(5), test: { status: 'failed', summary: '2 failed', at: h(5) } }] });
  const dated = project({ id: 'b', name: 'Beta', docs: [{ id: 'r', title: 'Release', deadlines: [{ text: 'Ship date: TestFlight to the field team', date: '2026-11-10', line: 3 }] }] });
  const stalled = project({ id: 'c', name: 'Gamma', commits: [commit('c1', 'Old work', 24 * 20)], decisions: [{ key: 'D01', text: 'D01 — Pricing', unresolved: true, at: h(24 * 20), sources: [] }] });
  const b = buildBriefing({ projects: [failing, dated, stalled], now: NOW });
  const kinds = b.attention.map((a) => a.kind);
  assert.ok(kinds.includes('failed') && kinds.includes('deadline') && kinds.includes('stalled'), kinds.join());
  assert.equal(b.attention[0].kind, 'failed');
  assert.equal(b.focus.projectId, 'a');
  assert.match(b.projects[1].next.text, /tomorrow/);
  assert.match(b.projects[2].next.text, /Decide D01, pricing/);
});

test('privacy: no paths, secrets, agent conversations or excerpts in the email; minimal detail drops names', () => {
  const p = project({
    commits: [commit('a1', 'Rotate key sk-ant-abcdefghijklmnopqrstuvwxyz0123456789', 2), commit('a2', 'Move config to /Users/sam/Code/orbit/config.json', 3)],
    sessions: [{ id: 's1', tool: 'claude-code', title: 'Fix login', status: 'idle', lastAt: h(1), test: null, latest: { text: 'PRIVATE CONVERSATION TEXT' } }],
    docs: [{ id: 'd', title: 'Handoff', excerpt: 'PRIVATE EXCERPT', deadlines: [] }],
    blocked: [{ code: 'blocked', path: '/Users/sam/Documents/Secret', retained: { docs: 4 } }],
  });
  const b = buildBriefing({ projects: [p], now: NOW });
  const { html, text } = renderBriefingEmail(b, { links: {} });
  for (const out of [html, text]) {
    assert.ok(!/sk-ant-/.test(out), 'secret-looking strings never appear');
    assert.ok(!/\/Users\//.test(out), 'absolute paths never appear');
    assert.ok(!/PRIVATE CONVERSATION|PRIVATE EXCERPT/.test(out), 'agent conversations and document excerpts never appear');
  }
  assert.match(text, /macOS is hiding one of Orbit’s folders/);
  const minimal = renderBriefingEmail(buildBriefing({ projects: [p], now: NOW, detail: 'minimal' }), { links: {} }).text;
  assert.ok(!/Fix login|Rotate|Move config/.test(minimal), 'minimal detail names no commits or sessions');
  assert.equal(safeText('see ~/Code/x and /Users/a/b.txt now'), 'see and now');
});

test('only the projects a reader selected are briefed', () => {
  const a = project({ id: 'a', name: 'Alpha', commits: [commit('x', 'Visible', 2)] });
  const b = buildBriefing({ projects: [a], now: NOW });
  assert.deepEqual(b.projects.map((p) => p.id), ['a']);
  assert.ok(!renderBriefingEmail(b).html.includes('Beta'));
});

test('the email is responsive, has dark mode, an Outlook wrapper and a complete text part', () => {
  const b = buildBriefing({ projects: [project({ commits: [commit('a1', 'Ship it', 2)] })], now: NOW });
  const { html, text, subject } = renderBriefingEmail(b, { links: { manage: 'http://x/#/briefing', pause: 'http://x/p', unsubscribe: 'http://x/u' } });
  assert.match(html, /@media \(max-width:620px\)/);
  assert.match(html, /prefers-color-scheme:dark/);
  assert.match(html, /<!--\[if mso\]>/);
  assert.match(html, /width="600"/);
  assert.match(html, /Made for people making things\./);
  for (const part of ['Good morning. Here’s what moved.', 'What changed', 'Where you left off', 'Your next move', 'ONE THING TO FOCUS ON TODAY', 'Unsubscribe: http://x/u']) assert.ok(text.includes(part), part);
  assert.equal(subject, 'Orbit moved overnight');
});

test('time zones: 8:00 local through both daylight-saving changes, half-hour zones and the spring gap', () => {
  assert.equal(zonedToUtc({ y: 2026, m: 3, d: 7, hh: 8, mm: 0 }, 'America/New_York').toISOString(), '2026-03-07T13:00:00.000Z');
  assert.equal(zonedToUtc({ y: 2026, m: 3, d: 9, hh: 8, mm: 0 }, 'America/New_York').toISOString(), '2026-03-09T12:00:00.000Z');
  assert.equal(zonedToUtc({ y: 2026, m: 11, d: 2, hh: 8, mm: 0 }, 'America/New_York').toISOString(), '2026-11-02T13:00:00.000Z');
  assert.equal(zonedToUtc({ y: 2026, m: 11, d: 9, hh: 8, mm: 0 }, 'Asia/Kolkata').toISOString(), '2026-11-09T02:30:00.000Z');
  assert.equal(zonedToUtc({ y: 2026, m: 3, d: 8, hh: 2, mm: 30 }, 'America/New_York').toISOString(), '2026-03-08T07:30:00.000Z', '02:30 does not exist that night; it becomes 03:30');
  assert.equal(zonedToUtc({ y: 2026, m: 11, d: 1, hh: 1, mm: 30 }, 'America/New_York').toISOString(), '2026-11-01T05:30:00.000Z', 'the first 01:30 when clocks fall back');
  const s = { ...defaultSettings('America/New_York'), enabled: true, verified: true, email: 'a@b.co' };
  assert.equal(nextDelivery(s, new Date('2026-03-07T14:00:00Z')).toISOString(), '2026-03-08T12:00:00.000Z', 'Sunday after the change: 8:00 EDT');
  const weekdays = { ...s, cadence: 'weekdays' };
  assert.equal(nextDelivery(weekdays, new Date('2026-11-06T14:00:00Z')).toISOString(), '2026-11-09T13:00:00.000Z', 'Friday after 8:00 skips to Monday');
  assert.equal(dueWindow(weekdays, new Date('2026-11-08T13:05:00Z')), null, 'no weekday briefing on Sunday');
  assert.equal(windowKey(s, new Date('2026-11-09T03:00:00Z')), 'local:2026-11-08', 'the window is the reader’s local day');
  assert.equal(zonedParts(new Date('2026-11-09T03:00:00Z'), 'America/New_York').hh, 22);
});

test('delivery windows: due from the set time, catches up after sleep, not in the evening', () => {
  const s = { ...defaultSettings('America/New_York'), enabled: true, verified: true, email: 'a@b.co' };
  assert.equal(dueWindow(s, new Date('2026-11-09T12:59:00Z')), null);
  assert.equal(dueWindow(s, new Date('2026-11-09T13:00:00Z')).key, 'local:2026-11-09');
  assert.equal(dueWindow(s, new Date('2026-11-09T16:30:00Z')).key, 'local:2026-11-09', 'the Mac woke at 11:30; still this morning’s briefing');
  assert.equal(dueWindow(s, new Date('2026-11-09T22:00:00Z')), null);
  assert.equal(dueWindow({ ...s, paused: true }, new Date('2026-11-09T13:00:00Z')), null);
  assert.equal(dueWindow({ ...s, verified: false }, new Date('2026-11-09T13:00:00Z')), null);
});

test('duplicates: a window is claimed once, retries back off, and an unconfirmed send is never repeated', () => {
  const bs = new BriefingStore(tmpDir('briefing-dup'));
  const t = Date.parse('2026-11-09T13:00:00Z');
  assert.equal(bs.claim('local:2026-11-09', t), 1);
  assert.equal(bs.claim('local:2026-11-09', t + 1000), null, 'a second claim while sending is refused');
  bs.complete('local:2026-11-09', { ok: false, error: 'timeout' }, t + 2000);
  assert.equal(bs.claim('local:2026-11-09', t + 60e3), null, 'retry waits for its backoff');
  assert.equal(bs.claim('local:2026-11-09', t + 6 * 60e3), 2, 'then retries');
  bs.complete('local:2026-11-09', { ok: true, messageId: 'm1' }, t + 7 * 60e3);
  assert.equal(bs.claim('local:2026-11-09', t + 30 * 60e3), null, 'a sent window is never sent again');
  assert.equal(bs.claim('local:2026-11-10', t + 864e5), 1);
  assert.equal(bs.claim('local:2026-11-10', t + 864e5 + 20 * 60e3), null);
  assert.equal(bs.read().deliveries['local:2026-11-10'].status, 'unknown', 'a send that never reported back is marked unknown, not resent');
});

test('scheduled delivery sends once per morning through the outbox and remembers what it said', async () => {
  const dir = tmpDir('briefing-send');
  const bs = new BriefingStore(dir);
  bs.update((d) => { d.settings = { ...defaultSettings('America/New_York'), enabled: true, verified: true, email: 'sam@example.com' }; });
  const mailer = mailerFromEnv({}, dir);
  const inputs = [project({ commits: [commit('a1', 'Ship it', 2)] })];
  const at = new Date('2026-11-09T13:02:00Z');
  const [one, two] = await Promise.all([
    deliver({ engine: null, bstore: bs, mailer, appUrl: 'http://127.0.0.1:4317', inputs, now: at }),
    deliver({ engine: null, bstore: bs, mailer, appUrl: 'http://127.0.0.1:4317', inputs, now: at }),
  ]);
  assert.equal([one, two].filter((r) => r.ok).length, 1, 'two schedulers at once still send one email');
  const files = fs.readdirSync(path.join(dir, 'outbox')).filter((f) => f.endsWith('.eml'));
  assert.equal(files.length, 1);
  const eml = fs.readFileSync(path.join(dir, 'outbox', files[0]), 'utf8');
  assert.match(eml, /^To: sam@example.com/m);
  assert.match(eml, /multipart\/alternative/);
  const d = bs.read();
  assert.equal(d.history.at(-1).status, 'sent');
  assert.ok(d.history.at(-1).snapshot.orbit.commits.includes('a1'));
  const later = await deliver({ engine: null, bstore: bs, mailer, appUrl: 'http://x', inputs, now: new Date('2026-11-09T15:00:00Z') });
  assert.equal(later.skipped, 'already-handled');
});

test('unsubscribe and pause links are signed; settings validate and opt-in needs a verified address', async () => {
  const secret = 'a'.repeat(64);
  const tok = linkToken(secret, 'unsubscribe');
  assert.ok(checkToken(secret, 'unsubscribe', tok));
  assert.ok(!checkToken(secret, 'unsubscribe', tok.slice(0, -1) + (tok.at(-1) === 'A' ? 'B' : 'A')), 'a tampered token is refused');
  assert.ok(!checkToken(secret, 'pause', tok), 'an unsubscribe token cannot pause, and vice versa');
  assert.ok(!checkToken('b'.repeat(64), 'unsubscribe', tok));
  const s = defaultSettings('UTC');
  assert.equal(s.enabled, false, 'off by default');
  assert.throws(() => applySettings(s, { enabled: true }), /Verify your email/);
  assert.throws(() => applySettings(s, { time: '25:00' }), /time/);
  assert.throws(() => applySettings(s, { timeZone: 'Mars/Olympus' }), /time zone/);
  assert.throws(() => applySettings(s, { projects: ['nope'] }, { projectIds: ['orbit'] }), /projects/);
  const unsub = { ...s, verified: true, email: 'a@b.co', enabled: false, unsubscribed: true };
  assert.equal(dueWindow(unsub, new Date('2026-11-09T08:00:00Z')), null);
  assert.equal(applySettings(unsub, { enabled: true }).unsubscribed, false, 'turning it back on is the only way to resubscribe');

  const dir = tmpDir('briefing-verify');
  const bs = new BriefingStore(dir);
  const sent = await startVerification({ bstore: bs, mailer: mailerFromEnv({}, dir), email: 'sam@example.com' });
  const textPart = fs.readFileSync(sent.path, 'utf8').split('base64\r\n\r\n')[1].split('\r\n--')[0].replace(/\r\n/g, '');
  const code = /Your Cereal code is (\d{6})/.exec(Buffer.from(textPart, 'base64').toString())[1];
  assert.throws(() => confirmVerification({ bstore: bs, code: '000000' === code ? '111111' : '000000' }), /doesn’t match/);
  assert.equal(confirmVerification({ bstore: bs, code }).verified, true);
});

test('deadlines are read from documents only when they carry a real date', () => {
  assert.equal(parseDocDate('Ship date: 12 November 2026'), '2026-11-12');
  assert.equal(parseDocDate('Due by Nov 3, 2026'), '2026-11-03');
  assert.equal(parseDocDate('Launch 2026-12-01'), '2026-12-01');
  assert.equal(parseDocDate('Ships next Monday'), null);
});

test('a snapshot remembers commits, sessions, open decisions and blocked folders', () => {
  const p = project({ commits: [commit('a1', 'x', 1)], sessions: [{ id: 's', lastAt: h(1), status: 'idle', test: { status: 'passed' } }], decisions: [{ key: 'D2', unresolved: true }], blocked: [{ code: 'blocked' }] });
  const snap = snapshotOf(p);
  assert.deepEqual(snap.commits, ['a1']);
  assert.equal(snap.sessions.s.test, 'passed');
  assert.deepEqual(snap.open, ['D2']);
  assert.equal(snap.blocked, 1);
});
