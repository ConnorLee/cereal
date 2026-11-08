// News for the morning briefing: recent headlines about what each project is building.
//
// Each project has a few short topics ("anonymous video calls", "habit tracking"). Cereal searches public news
// for them: Google News (RSS) and Hacker News (Algolia). Only those topic words are sent; nothing from the
// project itself. A headline is kept only if it contains every word of one of the topics, so each item can say
// exactly why it is there. Nothing is written by a model, and an item already shown in an earlier briefing is
// not shown again. News is off until the reader turns it on.
import { containsSecret } from './safety.mjs';

const DAY = 864e5;
const STOP = new Set('a an and the of for to in on with by at from your you our we it its is are be as or into about that this these those new one per via all any more most first own up out run runs made make makes using use used get builds build building simple quiet small'.split(' '));
const words = (t) => String(t || '').toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9+#]+/).filter(Boolean);
const keyWords = (t) => words(t).filter((w) => w.length > 2 && !STOP.has(w));

/** A topic the reader may send to a news search: short, plain words, no paths or secrets. */
export function cleanTopic(t) {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim();
  if (!s || s.length > 60 || containsSecret(s) || /[/\\@:]|https?|\.\w{2,4}$/.test(s)) return '';
  return keyWords(s).length ? s : '';
}

/**
 * Suggested topics for a project, from what the reader already wrote about it: news topics named in
 * projects.json, else its tagline and description. Suggestions are shown for the reader to accept or edit.
 */
// Words that describe a repository rather than a product, and strings that look like IDs, never make a topic.
const REPO_WORDS = new Set('main master branch branches readme repo repos repository project projects docs doc src lib code todo wip readme.md swift xcode github git version v1 v2 test tests demo'.split(' '));
const plausible = (w) => !/\d/.test(w) && w.length <= 16 && (w.match(/[aeiouy]/g) || []).length / w.length >= 0.2 && !REPO_WORDS.has(w);

export function suggestTopics({ def = {}, capsule = {} } = {}) {
  if (Array.isArray(def.news) && def.news.length) return def.news.map(cleanTopic).filter(Boolean).slice(0, 4);
  // Paths, links and handles are dropped before reading.
  const desc = String(capsule.description?.text || '').split(/(?<=[.!?])\s/)[0];
  // A tagline is the reader's own summary; the description is used only when there is none.
  const text = (def.tagline || capsule.tagline || desc || '').replace(/\S*[/\\~@_]\S*|https?:\S+|\S+\.(md|com|io|app|dev)\b/gi, ' ');
  const out = [];
  for (const clause of text.split(/[.,;:—–()]|\bfor\b|\bwith\b|\band\b/i)) {
    const ws = keyWords(clause).filter(plausible);
    if (!ws.length) continue;
    const phrase = ws.slice(-3).join(' ');
    if (phrase.length < 4) continue;
    if (!out.includes(phrase)) out.push(phrase);
    if (out.length >= 3) break;
  }
  // One-word topics ("music") catch everything; keep them only when nothing more specific was found.
  const clean = out.map(cleanTopic).filter(Boolean);
  const specific = clean.filter((t) => keyWords(t).length > 1);
  return specific.length ? specific : clean;
}

// ---------- sources ----------

const decode = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&').trim();
const tag = (xml, name) => decode((new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml) || [])[1]);

/** Google News RSS items: title (without the trailing " - Source"), link, date, source. */
export function parseGoogleNews(xml) {
  return [...String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const source = tag(it, 'source');
    let title = tag(it, 'title');
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const at = Date.parse(tag(it, 'pubDate'));
    return { title, url: tag(it, 'link'), source: source || 'Google News', at: Number.isNaN(at) ? null : new Date(at).toISOString(), via: 'google' };
  }).filter((x) => x.title && /^https?:\/\//.test(x.url));
}

/** Hacker News stories from the Algolia search API. */
export function parseHackerNews(json) {
  return (json?.hits || []).filter((h) => h.title).map((h) => ({
    title: h.title,
    url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    source: h.url ? `${new URL(h.url).hostname.replace(/^www\./, '')} via Hacker News` : 'Hacker News',
    at: h.created_at || null,
    via: 'hn',
  }));
}

export const searchUrls = (topic, now = Date.now()) => ({
  google: `https://news.google.com/rss/search?q=${encodeURIComponent(`${topic} when:7d`)}&hl=en-US&gl=US&ceid=US:en`,
  hn: `https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=20&query=${encodeURIComponent(topic)}&numericFilters=${encodeURIComponent(`created_at_i>${Math.floor((now - 7 * DAY) / 1000)}`)}`,
});

async function getText(fetchImpl, url, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { signal: ctl.signal, headers: { 'user-agent': 'Cereal morning briefing (local app)', accept: '*/*' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(timer); }
}

/** Search both sources for one topic. Failures come back as errors, never as invented items. */
export async function searchTopic(topic, { fetch: fetchImpl = fetch, now = Date.now(), timeoutMs = 6000 } = {}) {
  const urls = searchUrls(topic, now);
  const [g, h] = await Promise.allSettled([getText(fetchImpl, urls.google, timeoutMs), getText(fetchImpl, urls.hn, timeoutMs)]);
  const items = [];
  const errors = [];
  if (g.status === 'fulfilled') items.push(...parseGoogleNews(g.value)); else errors.push(`Google News: ${g.reason?.message || g.reason}`);
  if (h.status === 'fulfilled') { try { items.push(...parseHackerNews(JSON.parse(h.value))); } catch (e) { errors.push(`Hacker News: ${e.message}`); } } else errors.push(`Hacker News: ${h.reason?.message || h.reason}`);
  return { items, errors };
}

// ---------- relevance ----------

const norm = (t) => words(t).join(' ');
const stem = (w) => w.replace(/(ing|ers|er|es|s)$/, '');
/**
 * The topic a headline is about: every key word of the topic appears in the title, close together (at most one
 * other word between each), so "smart lighting" matches "smart lights" but not "smart packaging film lights up".
 * Plurals and -ing forms count. The most specific matching topic wins.
 */
export function matchTopic(title, topics) {
  const t = words(title).map(stem);
  const fits = (topic) => {
    const k = keyWords(topic).map(stem);
    if (!k.length) return false;
    for (let i = 0; i < t.length; i++) {
      if (t[i] !== k[0] && !k.includes(t[i])) continue;
      const window = t.slice(i, i + k.length * 2 - 1);
      if (k.every((w) => window.includes(w))) return true;
    }
    return false;
  };
  return [...topics].sort((x, y) => keyWords(y).length - keyWords(x).length).find(fits) || null;
}

// Product news reads like this; it is what a builder most wants to know about.
const PRODUCT = /\b(launch(es|ed)?|unveil(s|ed)?|announc(es|ed)|introduc(es|ed)|releas(es|ed)|ships?|shipped|rolls? out|rolled out|adds?|added|debuts?|acquir(es|ed)|raises?|raised|open-?sources?|beta|now available)\b/i;
/** How much a headline is worth a builder's morning: a more specific topic, product news, freshness. */
const score = (it, now) => keyWords(it.topic).length * 2 + (PRODUCT.test(it.title) ? 3 : 0) + (it.via === 'hn' ? 1 : 0) - (it.at ? Math.max(0, (now - Date.parse(it.at)) / DAY) * 0.4 : 1);

/** Keep recent, on-topic, not-yet-seen headlines, best first, one per story. */
export function rankNews(items, topics, { now = Date.now(), seen = [], limit = 3, maxAgeDays = 7 } = {}) {
  const seenSet = new Set(seen);
  const stories = new Map(); // one entry per story, however many outlets carried it
  for (const it of items) {
    const topic = matchTopic(it.title, topics);
    if (!topic) continue;
    const age = it.at ? (now - Date.parse(it.at)) / DAY : null;
    if (age != null && (age > maxAgeDays || age < -1)) continue;
    const key = norm(it.title).slice(0, 80);
    const story = stories.get(key) || { pick: null, urls: [] };
    story.urls.push(it.url);
    // The same story from both sources: prefer the original publisher over the aggregator.
    if (!story.pick || (story.pick.via === 'hn' && it.via === 'google')) story.pick = { ...it, topic, key };
    stories.set(key, story);
  }
  // A story shown in an earlier briefing stays out, whichever outlet's link was shown.
  return [...stories.values()].filter((st) => !seenSet.has(`t:${st.pick.key}`) && !st.urls.some((u) => seenSet.has(u))).map((st) => st.pick)
    .sort((x, y) => score(y, now) - score(x, now) || String(y.at || '').localeCompare(String(x.at || ''))).slice(0, limit);
}

export const seenKeys = (n) => [n.url, `t:${norm(n.title).slice(0, 80)}`];

/**
 * News for each project: [{ id, topics }] → { [id]: { items, topics, errors } }. Searches are cached for the
 * day in `cache` (a plain object the caller persists), so a test send and the morning send search once.
 */
export async function gatherNews(projects, { fetch: fetchImpl = fetch, now = Date.now(), cache = {}, seen = {}, limit = 3 } = {}) {
  const day = new Date(now).toISOString().slice(0, 10);
  const out = {};
  for (const p of projects) {
    const topics = (p.topics || []).map(cleanTopic).filter(Boolean).slice(0, 4);
    if (!topics.length) { out[p.id] = { items: [], topics, errors: [] }; continue; }
    const all = [];
    const errors = [];
    for (const topic of topics) {
      const key = `${day}|${topic.toLowerCase()}`;
      let hit = cache[key];
      if (!hit) { hit = await searchTopic(topic, { fetch: fetchImpl, now }); if (!hit.errors.length || hit.items.length) cache[key] = hit; }
      all.push(...hit.items);
      errors.push(...hit.errors.map((e) => `${topic} — ${e}`));
    }
    out[p.id] = { items: rankNews(all, topics, { now, seen: seen[p.id] || [], limit }), topics, errors };
  }
  for (const k of Object.keys(cache)) if (!k.startsWith(day)) delete cache[k];
  return out;
}
