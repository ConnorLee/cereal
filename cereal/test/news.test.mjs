import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from './helpers.mjs';
import { parseGoogleNews, parseHackerNews, matchTopic, rankNews, gatherNews, suggestTopics, cleanTopic, searchUrls } from '../lib/news.mjs';
import { buildBriefing } from '../lib/briefing.mjs';
import { renderBriefingEmail } from '../lib/briefing-email.mjs';
import { BriefingStore, defaultSettings, applySettings, deliver, mailerFromEnv } from '../lib/briefing-delivery.mjs';

const NOW = Date.parse('2026-11-09T13:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 864e5);
const rss = (items) => `<?xml version="1.0"?><rss><channel>${items.map(([title, source, at, url]) => `<item><title>${title} - ${source}</title><link>${url}</link><pubDate>${at.toUTCString()}</pubDate><source url="https://x">${source}</source></item>`).join('')}</channel></rss>`;
const GOOGLE = rss([
  ['Zoom launches anonymous video calls for support groups', 'The Verge', daysAgo(1), 'https://example.com/zoom-anon'],
  ['Zoom earnings beat expectations', 'Reuters', daysAgo(1), 'https://example.com/zoom-earnings'],
  ['Anonymous video calling apps surge &amp; regulators take note', 'Wired', daysAgo(3), 'https://example.com/anon-surge'],
  ['Anonymous video calls were a fad, says 2019 op-ed', 'Old Times', daysAgo(30), 'https://example.com/old'],
]);
const HN = JSON.stringify({ hits: [
  { objectID: '1', title: 'Zoom launches anonymous video calls for support groups', url: 'https://hn-dup.example/zoom', created_at: daysAgo(1).toISOString() },
  { objectID: '2', title: 'Show HN: A habit tracker that lives in your menu bar', url: null, created_at: daysAgo(2).toISOString() },
] });

function fakeFetch(log) {
  return async (url) => {
    log.push(url);
    const body = url.includes('news.google.com') ? GOOGLE : HN;
    return { ok: true, status: 200, text: async () => body };
  };
}

test('parses Google News RSS and Hacker News results', () => {
  const g = parseGoogleNews(GOOGLE);
  assert.equal(g[0].title, 'Zoom launches anonymous video calls for support groups', 'the trailing " - Source" is removed');
  assert.equal(g[0].source, 'The Verge');
  assert.equal(g[2].title, 'Anonymous video calling apps surge & regulators take note');
  const h = parseHackerNews(JSON.parse(HN));
  assert.equal(h[0].source, 'hn-dup.example via Hacker News');
  assert.equal(h[1].url, 'https://news.ycombinator.com/item?id=2');
});

test('a headline is kept only when it is about a topic, and says which one', () => {
  assert.equal(matchTopic('Zoom launches anonymous video calls for support groups', ['anonymous video calls']), 'anonymous video calls');
  assert.equal(matchTopic('Anonymous video calling apps surge', ['anonymous video calls']), 'anonymous video calls', 'calling counts for calls');
  assert.equal(matchTopic('Zoom earnings beat expectations', ['anonymous video calls']), null);
  const items = [...parseGoogleNews(GOOGLE), ...parseHackerNews(JSON.parse(HN))];
  const ranked = rankNews(items, ['anonymous video calls'], { now: NOW });
  assert.deepEqual(ranked.map((r) => r.url), ['https://example.com/zoom-anon', 'https://example.com/anon-surge'], 'off-topic and month-old stories are dropped; the same story from both sources appears once, from the publisher');
  assert.equal(rankNews(items, ['anonymous video calls'], { now: NOW, seen: ['https://example.com/zoom-anon'] }).length, 1, 'headlines from earlier briefings are not repeated');
});

test('only the topic words are sent, and each search is made once a day', async () => {
  const log = [];
  const cache = {};
  const out = await gatherNews([{ id: 'beacon', topics: ['anonymous video calls'] }], { fetch: fakeFetch(log), now: NOW, cache });
  assert.equal(out.beacon.items[0].title, 'Zoom launches anonymous video calls for support groups');
  assert.equal(log.length, 2);
  for (const u of log) {
    const q = new URL(u).searchParams.get('q') || new URL(u).searchParams.get('query');
    assert.match(q, /^anonymous video calls( when:7d)?$/, `nothing but the topic is sent: ${q}`);
  }
  await gatherNews([{ id: 'beacon', topics: ['anonymous video calls'] }], { fetch: fakeFetch(log), now: NOW + 3600e3, cache });
  assert.equal(log.length, 2, 'a second briefing the same day uses the cached search');
});

test('a failed search reports an error and invents nothing', async () => {
  const out = await gatherNews([{ id: 'p', topics: ['offline maps'] }], { fetch: async () => { throw new Error('offline'); }, now: NOW });
  assert.deepEqual(out.p.items, []);
  assert.equal(out.p.errors.length, 2);
});

test('topics are short plain words; suggestions come from the project’s own description', () => {
  assert.equal(cleanTopic('anonymous video calls'), 'anonymous video calls');
  assert.equal(cleanTopic('/Users/sam/Code/beacon'), '', 'paths are never sent');
  assert.equal(cleanTopic('sk-ant-abcdefghijklmnopqrstuvwxyz0123456789'), '', 'secrets are never sent');
  assert.equal(cleanTopic('https://example.com'), '');
  const s = suggestTopics({ def: { tagline: 'Offline-first field notes for botanists' } });
  assert.ok(s.length >= 1 && s.every((t) => t && t.length <= 60), JSON.stringify(s));
  assert.deepEqual(suggestTopics({ def: { news: ['anonymous video calls', '/etc/passwd'] } }), ['anonymous video calls'], 'topics named in projects.json win, still cleaned');
});

test('news settings are off by default and validated', () => {
  const s = defaultSettings('UTC');
  assert.equal(s.news.enabled, false);
  const on = applySettings(s, { news: { enabled: true, topics: { beacon: 'anonymous video calls, habit tracking' } } }, { projectIds: ['beacon'] });
  assert.deepEqual(on.news, { enabled: true, topics: { beacon: ['anonymous video calls', 'habit tracking'] } });
  assert.throws(() => applySettings(s, { news: { topics: { beacon: '~/Code/beacon' } } }, { projectIds: ['beacon'] }), /plain words/);
  assert.throws(() => applySettings(s, { news: { topics: { nope: 'x y' } } }, { projectIds: ['beacon'] }), /projects/);
  assert.throws(() => applySettings(s, { news: { topics: { beacon: 'a1 one, b1 two, c1 three, d1 four, e1 five' } } }, { projectIds: ['beacon'] }), /four/);
});

const project = (id = 'beacon', name = 'Beacon') => ({
  def: { id, name, tagline: 'Private video check-ins', brand: { accent: '#2F6F73' } },
  capsule: { decisions: [], questions: [], attention: [], blocked: [], resume: [], leftOff: [] },
  index: { repos: [{ path: '/x', commits: [], branches: [], worktrees: [] }], docs: [] },
  sessions: [],
});

test('the email shows each headline with its source, age, link and matched topic', () => {
  const news = { beacon: { items: [{ title: 'Zoom launches anonymous video calls for support groups', url: 'https://example.com/zoom-anon', source: 'The Verge', at: daysAgo(1).toISOString(), topic: 'anonymous video calls' }] } };
  const b = buildBriefing({ projects: [project()], now: NOW, news });
  assert.equal(b.projects[0].news.length, 1);
  assert.ok(b.snapshot.beacon.newsSeen.includes('https://example.com/zoom-anon'), 'remembered so it is not shown again');
  const { html, text } = renderBriefingEmail(b, { links: {} });
  assert.match(html, /In the news/);
  assert.match(html, /href="https:\/\/example\.com\/zoom-anon"/);
  assert.match(html, /The Verge · yesterday · about/);
  assert.match(text, /- Zoom launches anonymous video calls for support groups \(The Verge, yesterday; about anonymous video calls\) https:\/\/example\.com\/zoom-anon/);
  assert.match(html, /only those words were sent/);
  const none = renderBriefingEmail(buildBriefing({ projects: [project()], now: NOW }), { links: {} });
  assert.ok(!/In the news/.test(none.html), 'no section when news is off or nothing matched');
});

test('delivery searches only when news is on, then puts the headlines in the email', async () => {
  const dir = tmpDir('news-deliver');
  const bs = new BriefingStore(dir);
  bs.update((d) => { d.settings = { ...defaultSettings('America/New_York'), enabled: true, verified: true, email: 'sam@example.com' }; });
  const mailer = mailerFromEnv({}, dir);
  const log = [];
  const off = await deliver({ engine: null, bstore: bs, mailer, appUrl: 'http://127.0.0.1:4317', kind: 'test', inputs: [project()], fetch: fakeFetch(log), now: new Date(NOW) });
  assert.ok(off.ok);
  assert.equal(log.length, 0, 'news off: no searches at all');
  bs.update((d) => { d.settings.news = { enabled: true, topics: { beacon: ['anonymous video calls'] } }; });
  const on = await deliver({ engine: null, bstore: bs, mailer, appUrl: 'http://127.0.0.1:4317', kind: 'test', inputs: [project()], fetch: fakeFetch(log), now: new Date(NOW) });
  assert.ok(on.ok);
  assert.equal(log.length, 2);
  const html = fs.readFileSync(on.path.replace(/\.eml$/, '.html'), 'utf8');
  assert.match(html, /Zoom launches anonymous video calls for support groups/);
  assert.ok(bs.read().newsCache, 'the day’s searches are cached');
  assert.ok(searchUrls('x', NOW).hn.includes('created_at_i'));
  assert.ok(fs.existsSync(path.join(dir, 'briefing.json')));
});

test('topic words must sit close together, and product news ranks first', () => {
  assert.equal(matchTopic('Smart packaging film lights up under UV', ['smart lighting']), null, 'words too far apart');
  assert.equal(matchTopic('Philips Hue smart lights review', ['smart lighting']), 'smart lighting');
  assert.equal(matchTopic('Zoom launches anonymous video calls', ['video calls', 'anonymous video calls']), 'anonymous video calls', 'the most specific topic wins');
  const at = daysAgo(1).toISOString();
  const ranked = rankNews([
    { title: 'Celebrity enjoys video calls with family', url: 'https://e.com/a', source: 'A', at, via: 'google' },
    { title: 'Meta rolls out video calls with AI avatars', url: 'https://e.com/b', source: 'B', at, via: 'google' },
  ], ['video calls'], { now: NOW });
  assert.equal(ranked[0].url, 'https://e.com/b', 'a launch outranks gossip of the same age');
});

test('suggested topics skip paths, ID-like strings and repository words', () => {
  const s = suggestTopics({ def: { tagline: '' }, capsule: { description: { text: 'A sobriety support system. Built in ~/Code/xq-projects on main, id mpjxkfyicbn.' } } });
  assert.deepEqual(s, ['sobriety support system']);
});

test('every word of a topic counts, including “app”; one-word suggestions give way to specific ones', () => {
  assert.equal(matchTopic('Renewable fuels recovery signals strong quarter', ['recovery app']), null);
  assert.equal(matchTopic('Arkansas launches ReviveAR app to help residents find recovery resources', ['recovery app']), null, 'too far apart');
  assert.equal(matchTopic('New recovery app connects people to sponsors', ['recovery app']), 'recovery app');
  assert.deepEqual(suggestTopics({ def: { tagline: 'Audiovisual identity and release rituals for music' } }), ['audiovisual identity', 'release rituals']);
});
