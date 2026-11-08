// Delivering the morning briefing: settings, time zones, one send per morning, retries, unsubscribe.
//
// State lives in its own file (briefing.json) next to Cereal's data, guarded by a lock file, so the app and
// the background scheduler (a launchd agent) can both run without ever sending the same morning twice.
// A delivery window is one reader's local calendar day: the first process to claim it sends; nobody else can.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataDir } from './paths.mjs';
import { buildBriefing } from './briefing.mjs';
import { renderBriefingEmail } from './briefing-email.mjs';
import { gatherNews, suggestTopics, cleanTopic } from './news.mjs';

const MIN = 6e4;
export const RETRY_MINUTES = [5, 15, 45];
const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;
const STALE_SENDING = 15 * MIN; // a send that never reported back: outcome unknown, so it is not repeated
const CATCH_UP_HOURS = 6; // asleep at 8:00? The briefing still goes out until 14:00, then waits for tomorrow.
const USER = 'local'; // Cereal is single-user and local; the key still names the reader for a hosted future.

export function defaultSettings(tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC') {
  return { enabled: false, email: '', verified: false, time: '08:00', timeZone: tz, cadence: 'daily', projects: null, detail: 'full', paused: false, unsubscribed: false, news: { enabled: false, topics: {} } };
}

// ---------- time zones ----------

/** Wall-clock parts of an instant in a time zone. */
export function zonedParts(date, timeZone) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute, weekday: p.weekday, date: `${p.year}-${p.month}-${p.day}` };
}

/**
 * The instant at which a wall-clock time happens in a time zone. Daylight saving is handled by asking the
 * zone what offset applies around that moment. A time that doesn't exist (the spring-forward gap) moves
 * forward by the gap; a time that happens twice (fall back) uses the first occurrence.
 */
export function zonedToUtc({ y, m, d, hh, mm }, timeZone) {
  const want = Date.UTC(y, m - 1, d, hh, mm);
  const offsetAt = (t) => { const p = zonedParts(new Date(t), timeZone); return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm) - Math.floor(t / MIN) * MIN; };
  const candidates = [...new Set([offsetAt(want - 12 * 36e5), offsetAt(want), offsetAt(want + 12 * 36e5)])].map((o) => want - o).sort((a, b) => a - b);
  for (const t of candidates) { const p = zonedParts(new Date(t), timeZone); if (p.y === y && p.m === m && p.d === d && p.hh === hh && p.mm === mm) return new Date(t); }
  return new Date(want - offsetAt(want - 12 * 36e5)); // in the gap: the clock jumped past it
}

const addDays = ({ y, m, d }, n) => { const t = new Date(Date.UTC(y, m - 1, d + n)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
const weekdayOf = ({ y, m, d }) => new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sunday
const allowed = (s, day) => s.cadence !== 'weekdays' || ![0, 6].includes(weekdayOf(day));

/** When the next briefing goes out, as an instant. Null when delivery is off. */
export function nextDelivery(s, now = new Date()) {
  if (!s.enabled || s.paused || s.unsubscribed || !s.verified) return null;
  const [hh, mm] = s.time.split(':').map(Number);
  const today = zonedParts(now, s.timeZone);
  for (let i = 0; i < 9; i++) {
    const day = addDays(today, i);
    if (!allowed(s, day)) continue;
    const at = zonedToUtc({ ...day, hh, mm }, s.timeZone);
    if (at > now) return at;
  }
  return null;
}

/** The delivery window an instant falls in: the reader's local calendar day. */
export const windowKey = (s, now = new Date()) => `${USER}:${zonedParts(now, s.timeZone).date}`;

/** Is a briefing due right now, and for which window? */
export function dueWindow(s, now = new Date()) {
  if (!s.enabled || s.paused || s.unsubscribed || !s.verified || !s.email) return null;
  const today = zonedParts(now, s.timeZone);
  if (!allowed(s, today)) return null;
  const [hh, mm] = s.time.split(':').map(Number);
  const at = zonedToUtc({ ...today, hh, mm }, s.timeZone);
  if (now < at || now - at > CATCH_UP_HOURS * 36e5) return null;
  return { key: windowKey(s, now), scheduledFor: at.toISOString() };
}

// ---------- validation ----------

export function validTimeZone(tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } }
export const validEmail = (e) => /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[a-z]{2,}$/i.test(String(e || ''));

export function applySettings(current, patch, { projectIds = [] } = {}) {
  const s = { ...current };
  const bad = (msg) => { throw Object.assign(new Error(msg), { status: 400 }); };
  if ('time' in patch) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(patch.time)) bad('Choose a time like 08:00.'); s.time = patch.time; }
  if ('timeZone' in patch) { if (!validTimeZone(patch.timeZone)) bad('That time zone isn’t recognised.'); s.timeZone = patch.timeZone; }
  if ('cadence' in patch) { if (!['daily', 'weekdays'].includes(patch.cadence)) bad('Choose every day or weekdays.'); s.cadence = patch.cadence; }
  if ('detail' in patch) { if (!['full', 'minimal'].includes(patch.detail)) bad('Choose how much detail to include.'); s.detail = patch.detail; }
  if ('projects' in patch) {
    if (patch.projects !== null && (!Array.isArray(patch.projects) || patch.projects.some((id) => !projectIds.includes(id)))) bad('Choose projects from your list.');
    s.projects = patch.projects;
  }
  if ('news' in patch) {
    const n = { enabled: false, topics: {}, ...(s.news || {}) };
    if ('enabled' in patch.news) n.enabled = !!patch.news.enabled;
    if (patch.news.topics) {
      n.topics = { ...n.topics };
      for (const [id, list] of Object.entries(patch.news.topics)) {
        if (!projectIds.includes(id)) bad('Choose projects from your list.');
        const raw = (Array.isArray(list) ? list : String(list || '').split(',')).map((t) => String(t).trim()).filter(Boolean);
        if (raw.length > 4) bad('Up to four news topics per project.');
        const clean = raw.map(cleanTopic);
        if (clean.some((t) => !t)) bad('News topics are short plain words, like “anonymous video calls”, without links or paths.');
        n.topics[id] = clean;
      }
    }
    s.news = n;
  }
  if ('paused' in patch) s.paused = !!patch.paused;
  if ('enabled' in patch) {
    if (patch.enabled && !(s.verified && s.email)) bad('Verify your email address before turning the briefing on.');
    s.enabled = !!patch.enabled;
    if (s.enabled) s.unsubscribed = false;
  }
  return s;
}

// ---------- tokens for pause and unsubscribe links ----------

export const linkToken = (secret, purpose) => crypto.createHmac('sha256', secret).update(`${USER}:${purpose}`).digest('base64url').slice(0, 32);
export function checkToken(secret, purpose, token) {
  const want = Buffer.from(linkToken(secret, purpose));
  const got = Buffer.from(String(token || ''));
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// ---------- the briefing's own state file ----------

export class BriefingStore {
  constructor(dir = dataDir()) {
    this.dir = dir;
    this.file = path.join(dir, 'briefing.json');
    this.lock = path.join(dir, 'briefing.lock');
    fs.mkdirSync(dir, { recursive: true });
  }

  read() {
    let d;
    try { d = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { d = {}; }
    d.settings = { ...defaultSettings(), ...(d.settings || {}) };
    d.deliveries ||= {};
    d.history ||= [];
    d.secret ||= crypto.randomBytes(32).toString('hex');
    return d;
  }

  /** Read, change and write under a lock that both the app and the background scheduler respect. */
  update(fn) {
    const deadline = Date.now() + 5000;
    for (;;) {
      try { fs.closeSync(fs.openSync(this.lock, 'wx')); break; } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        try { if (Date.now() - fs.statSync(this.lock).mtimeMs > 30000) { fs.rmSync(this.lock, { force: true }); continue; } } catch { continue; }
        if (Date.now() > deadline) throw new Error('Briefing state is busy; try again.');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      }
    }
    try {
      const d = this.read();
      const out = fn(d);
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(d));
      fs.renameSync(tmp, this.file);
      return out;
    } finally {
      fs.rmSync(this.lock, { force: true });
    }
  }

  /** Claim a delivery window. Returns the attempt number, or null if it was sent, is being sent, or must wait. */
  claim(key, now = Date.now()) {
    return this.update((d) => {
      const r = d.deliveries[key];
      if (r) {
        if (r.status === 'sent' || r.status === 'unknown') return null;
        if (r.status === 'sending') {
          if (now - Date.parse(r.startedAt) > STALE_SENDING) { r.status = 'unknown'; r.lastError = 'The send never reported back, so it was not repeated.'; }
          return null;
        }
        if (r.status === 'failed' && (r.attempts >= MAX_ATTEMPTS || now < Date.parse(r.nextAttemptAt || 0))) return null;
      }
      const attempts = (r?.attempts || 0) + 1;
      d.deliveries[key] = { ...(r || {}), status: 'sending', attempts, startedAt: new Date(now).toISOString() };
      return attempts;
    });
  }

  complete(key, { ok, error, messageId, briefingId }, now = Date.now()) {
    return this.update((d) => {
      const r = d.deliveries[key] || { attempts: 1 };
      if (ok) Object.assign(r, { status: 'sent', sentAt: new Date(now).toISOString(), messageId, briefingId, lastError: null, nextAttemptAt: null });
      else {
        const wait = RETRY_MINUTES[r.attempts - 1];
        Object.assign(r, { status: 'failed', lastError: String(error || 'Send failed').slice(0, 300), nextAttemptAt: wait ? new Date(now + wait * MIN).toISOString() : null });
      }
      d.deliveries[key] = r;
      // Keep two months of windows; older ones can never be claimed again anyway.
      for (const k of Object.keys(d.deliveries).sort().slice(0, -62)) delete d.deliveries[k];
      return r;
    });
  }
}

// ---------- sending ----------

function mime({ from, to, subject, html, text, headers = {} }) {
  const b = `cereal-${crypto.randomBytes(8).toString('hex')}`;
  const enc = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  const h = { From: from, To: to, Subject: `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`, Date: new Date().toUTCString(), 'MIME-Version': '1.0', 'Content-Type': `multipart/alternative; boundary="${b}"`, ...headers };
  return `${Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n--${b}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${enc(text)}\r\n--${b}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${enc(html)}\r\n--${b}--\r\n`;
}

/**
 * Where email goes. With no provider configured, messages are written to a local outbox folder and
 * never leave the Mac. With CEREAL_MAIL_PROVIDER=resend, RESEND_API_KEY and CEREAL_MAIL_FROM (an address on a
 * domain verified with SPF and DKIM at Resend), Cereal sends through Resend's API.
 */
function resendMailer(key, from) {
  return {
    name: 'resend', label: 'Resend', external: true, from,
    async send({ to, subject, html, text, headers, idempotencyKey }) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) },
        body: JSON.stringify({ from, to: [to], subject, html, text, headers }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || `Resend error ${r.status}`);
      return { id: j.id };
    },
  };
}

export function mailerFromEnv(env = process.env, dir = dataDir()) {
  if (env.CEREAL_MAIL_PROVIDER === 'resend' && env.RESEND_API_KEY && env.CEREAL_MAIL_FROM) {
    return { ...resendMailer(env.RESEND_API_KEY, env.CEREAL_MAIL_FROM), managedBy: 'env' };
  }
  const outbox = path.join(dir, 'outbox');
  return {
    name: 'outbox', label: 'the local outbox (no email provider is set up, so nothing leaves this Mac)', external: false, from: 'Cereal <briefing@cereal.local>', outbox,
    async send({ to, subject, html, text, headers }) {
      fs.mkdirSync(outbox, { recursive: true });
      const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
      fs.writeFileSync(path.join(outbox, `${id}.eml`), mime({ from: this.from, to, subject, html, text, headers }));
      fs.writeFileSync(path.join(outbox, `${id}.html`), html);
      return { id, path: path.join(outbox, `${id}.eml`) };
    },
  };
}

// ---------- email provider, set up in the app ----------
// A Resend key saved here is used when no CEREAL_MAIL_* environment variables are set. It lives in
// mail.json, readable only by the user (0600), never inside the briefing data or an email.
const MAIL_FILE = 'mail.json';

export const maskKey = (k) => `re_••••${String(k || '').slice(-4)}`;

export function readMailConfig(dir = dataDir()) {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(dir, MAIL_FILE), 'utf8'));
    if (c?.provider !== 'resend' || !c.key || !c.from) return null;
    return c;
  } catch { return null; }
}

export function saveMailConfig(dir = dataDir(), { key, from } = {}) {
  const k = String(key || '').trim();
  const f = String(from || '').trim();
  // Accept "Cereal <briefing@yourdomain.com>" as well as a bare address.
  const addr = (f.match(/<([^>]+)>/)?.[1] || f).trim();
  if (!/^re_[A-Za-z0-9_-]{8,}$/.test(k)) throw Object.assign(new Error('That doesn’t look like a Resend API key (they start with re_).'), { status: 400 });
  if (!validEmail(addr)) throw Object.assign(new Error('That doesn’t look like a sending address.'), { status: 400 });
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, MAIL_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, provider: 'resend', key: k, from: f, savedAt: new Date().toISOString() }), { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
  return { provider: 'resend', from: f, keyHint: maskKey(k) };
}

export function clearMailConfig(dir = dataDir()) {
  fs.rmSync(path.join(dir, MAIL_FILE), { force: true });
}

/** The mailer Cereal should use: environment variables, then the key saved in the app, then the outbox. */
export function mailerFor(env = process.env, dir = dataDir()) {
  const fromEnv = mailerFromEnv(env, dir);
  if (fromEnv.external) return fromEnv;
  const saved = readMailConfig(dir);
  if (saved) return { ...resendMailer(saved.key, saved.from), managedBy: 'app', keyHint: maskKey(saved.key) };
  return fromEnv;
}

/** The projects a briefing covers: the reader's selection, among projects with approved folders. */
export function briefingInputs(engine, settings) {
  return engine.defs
    .filter((d) => engine.store.project(d.id).sources.length && (!settings.projects || settings.projects.includes(d.id)))
    .map((d) => ({ def: d, capsule: engine.capsule(d.id), index: engine.store.project(d.id).index, sessions: engine.store.project(d.id).agents || [] }));
}

/** The topics each briefed project searches for: the reader's own, else suggestions from its description. */
export const newsTopics = (settings, input) => settings.news?.topics?.[input.def.id] ?? suggestTopics(input);

/**
 * Headlines for the briefing, when the reader turned news on. Only topic words leave the Mac. Searches are cached
 * for the day in briefing.json, and headlines from earlier briefings are skipped.
 */
export async function briefingNews({ bstore, data, inputs, fetch: fetchImpl = fetch, now = Date.now() }) {
  const s = data.settings;
  if (!s.news?.enabled || !inputs.length) return null;
  const previous = [...data.history].reverse().find((h) => h.kind === 'scheduled' && h.status === 'sent');
  const seen = Object.fromEntries(inputs.map((p) => [p.def.id, previous?.snapshot?.[p.def.id]?.newsSeen || []]));
  const cache = { ...(data.newsCache || {}) };
  const news = await gatherNews(inputs.map((p) => ({ id: p.def.id, topics: newsTopics(s, p) })), { fetch: fetchImpl, now, cache, seen });
  bstore?.update((d) => { d.newsCache = cache; });
  return news;
}

/** Build and render a briefing, recording the opaque links it uses so no paths ride along in URLs. */
export function composeBriefing({ engine, data, appUrl, provider, now = Date.now(), inputs, news = null }) {
  const s = data.settings;
  const id = crypto.randomBytes(6).toString('hex');
  const linkTable = {};
  const link = (projectId, src) => { const n = Object.keys(linkTable).length + 1; linkTable[n] = { projectId, src }; return `${appUrl}/#/briefing/open/${id}/${n}`; };
  const previous = [...data.history].reverse().find((h) => h.kind === 'scheduled' && h.status === 'sent') || null;
  const briefing = buildBriefing({ projects: inputs || briefingInputs(engine, s), previous: previous && { snapshot: previous.snapshot, deliveredAt: previous.sentAt }, now, timeZone: s.timeZone, detail: s.detail, link, news });
  const links = { app: appUrl, manage: `${appUrl}/#/briefing`, pause: `${appUrl}/api/briefing/pause?token=${linkToken(data.secret, 'pause')}`, unsubscribe: `${appUrl}/api/briefing/unsubscribe?token=${linkToken(data.secret, 'unsubscribe')}` };
  const email = renderBriefingEmail(briefing, { links, provider });
  return { id, briefing, email, links, linkTable };
}

/**
 * Send one briefing. kind 'scheduled' honours the delivery window (one per morning, retries with backoff);
 * kind 'test' sends now and never counts as the morning's delivery.
 */
export async function deliver({ engine, bstore, mailer, appUrl, kind = 'scheduled', now = new Date(), inputs, fetch: fetchImpl = fetch }) {
  let data = bstore.read();
  const s = data.settings;
  let key = null;
  if (kind === 'scheduled') {
    const due = dueWindow(s, now);
    if (!due) return { skipped: 'not-due' };
    if (!bstore.claim(due.key, now.getTime())) return { skipped: 'already-handled', key: due.key };
    key = due.key;
    data = bstore.read();
  } else if (!s.verified || !s.email) {
    throw Object.assign(new Error('Verify your email address first.'), { status: 400 });
  }
  const projects = inputs || briefingInputs(engine, s);
  const news = await briefingNews({ bstore, data, inputs: projects, fetch: fetchImpl, now: now.getTime() }).catch(() => null);
  const { id, briefing, email, links, linkTable } = composeBriefing({ engine, data, appUrl, provider: mailer.label, now: now.getTime(), inputs: projects, news });
  const headers = { 'X-Cereal-Briefing': id };
  if (/^https:/.test(links.unsubscribe)) Object.assign(headers, { 'List-Unsubscribe': `<${links.unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
  let result;
  try {
    const r = await mailer.send({ to: s.email, subject: kind === 'test' ? `[Test] ${email.subject}` : email.subject, html: email.html, text: email.text, headers, idempotencyKey: key ? `cereal-${key}` : undefined });
    result = { ok: true, messageId: r.id, path: r.path };
  } catch (e) {
    result = { ok: false, error: e.message };
  }
  if (key) bstore.complete(key, { ...result, briefingId: id }, now.getTime());
  bstore.update((d) => {
    d.history.push({ id, kind, key, subject: email.subject, sentAt: now.toISOString(), status: result.ok ? 'sent' : 'failed', error: result.error || null, provider: mailer.name, html: email.html, linkTable, snapshot: kind === 'scheduled' && result.ok ? briefing.snapshot : undefined, projects: briefing.projects.map((p) => p.id) });
    d.history = d.history.slice(-30);
  });
  return { ...result, id, key, kind, subject: email.subject, provider: mailer.name };
}

/** Email verification: a six-digit code, valid for fifteen minutes, five tries. */
export async function startVerification({ bstore, mailer, email }) {
  if (!validEmail(email)) throw Object.assign(new Error('That doesn’t look like an email address.'), { status: 400 });
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  const salt = crypto.randomBytes(8).toString('hex');
  bstore.update((d) => { d.verification = { email, salt, hash: crypto.createHash('sha256').update(salt + code).digest('hex'), expiresAt: new Date(Date.now() + 15 * MIN).toISOString(), tries: 0 }; });
  const html = `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:17px;line-height:26px;color:#17161B;padding:24px"><p style="font-size:22px;font-weight:600;margin:0 0 12px">cereal<span style="color:#6E5FE8">.</span></p><p>Your code is <b style="font-size:24px;letter-spacing:4px">${code}</b></p><p style="color:#8B8993;font-size:14px">Enter it in Cereal to confirm this address for your morning briefing. It expires in 15 minutes. If you didn’t ask for this, ignore it.</p></div>`;
  const r = await mailer.send({ to: email, subject: `${code} is your Cereal code`, html, text: `Your Cereal code is ${code}. It expires in 15 minutes.` });
  // With the outbox there is no inbox to read the code from, so the app shows it on this Mac.
  return { sent: true, provider: mailer.name, path: r.path || null, ...(mailer.external ? {} : { code }) };
}

export function confirmVerification({ bstore, code }) {
  return bstore.update((d) => {
    const v = d.verification;
    const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
    if (!v || Date.now() > Date.parse(v.expiresAt)) throw bad('That code has expired. Send a new one.');
    if (v.tries >= 5) throw bad('Too many tries. Send a new code.');
    v.tries++;
    const got = crypto.createHash('sha256').update(v.salt + String(code || '').trim()).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(got), Buffer.from(v.hash))) throw bad('That code doesn’t match.');
    d.settings = { ...d.settings, email: v.email, verified: true };
    delete d.verification;
    return d.settings;
  });
}

/** What the settings screen needs to know, without the secret or past HTML. */
export function briefingStatus(data, { mailer, now = new Date() }) {
  const s = data.settings;
  const last = [...data.history].reverse().find((h) => h.kind === 'scheduled');
  const lastDelivery = last ? data.deliveries[last.key] || null : null;
  return {
    settings: s,
    next: nextDelivery(s, now)?.toISOString() || null,
    last: last ? { id: last.id, at: last.sentAt, status: last.status, error: last.error, subject: last.subject, attempts: lastDelivery?.attempts || 1 } : null,
    pendingVerification: data.verification ? { email: data.verification.email, expiresAt: data.verification.expiresAt } : null,
    provider: { name: mailer.name, label: mailer.label, external: mailer.external, outbox: mailer.outbox || null, from: mailer.from, managedBy: mailer.managedBy || null, keyHint: mailer.keyHint || null },
    history: [...data.history].reverse().map((h) => ({ id: h.id, kind: h.kind, subject: h.subject, at: h.sentAt, status: h.status, projects: h.projects })),
  };
}
