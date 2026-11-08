// The morning briefing: one read across every project you chose, built from the same indexed facts
// as the rest of Cereal. It compares today's state with the snapshot kept from the last briefing that
// was delivered, so "what happened" means what is new to you, not what is new on disk.
//
// Every sentence is deterministic and comes from a sourced fact. Agent claims stay labelled as claims.
// What leaves the Mac in an email is limited on purpose: titles and short phrases, never file contents,
// document excerpts, agent conversations, paths, or anything that looks like a secret.
import { containsSecret } from './safety.mjs';
import { seenKeys } from './news.mjs';

const DAY = 864e5;
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = (n) => WORDS[n] || String(n);
const Word = (n) => { const w = word(n); return w[0].toUpperCase() + w.slice(1); };
const toolName = (s) => (s?.tool === 'codex' ? 'Codex' : 'Claude');
const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const lowerFirst = (t) => String(t || '').replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase());

/** Text that may leave the Mac: short, no secrets, no absolute paths. Returns '' when it is not safe. */
export function safeText(t, max = 120) {
  let s = String(t ?? '').replace(/\s+/g, ' ').trim();
  if (!s || containsSecret(s)) return '';
  s = s.replace(/(?:~(?=\/)|\/Users\/[^/\s]+|\/home\/[^/\s]+|[A-Z]:\\Users\\[^\\\s]+)(?:[/\\][^\s,;:)"”]*)?/g, '').replace(/\s{2,}/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : s;
}

function ago(iso, now) {
  const h = Math.round((now - Date.parse(iso)) / 36e5);
  if (h < 1) return 'within the hour';
  if (h < 24) return `${word(h)} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${word(d)} days ago`;
}

/** What Cereal remembers about a project at briefing time, to compare against tomorrow. */
export function snapshotOf({ capsule, index, sessions = [] }) {
  const commits = (index?.repos || []).flatMap((r) => r.commits.map((c) => c.sha)).slice(0, 200);
  const open = [...(capsule.decisions || []).filter((d) => d.unresolved).map((d) => d.key || d.id), ...(capsule.questions || []).map((q) => q.id)];
  return {
    commits,
    sessions: Object.fromEntries(sessions.map((s) => [s.id, { lastAt: s.lastAt, status: s.status, test: s.test?.status || null }])),
    open: [...new Set(open)],
    blocked: (capsule.blocked || []).filter((b) => b.code === 'blocked').length,
    docs: Object.fromEntries((index?.docs || []).map((d) => [d.id, d.hash])),
  };
}

function lastActivity({ index, sessions }) {
  const dates = [...(index?.repos || []).flatMap((r) => r.commits.map((c) => c.date)), ...sessions.map((s) => s.lastAt)].filter(Boolean).sort();
  return dates.at(-1) || null;
}

/**
 * One project's section. `prev` is its snapshot from the last delivered briefing (or null for the first one,
 * which then looks back one day). `detail: 'minimal'` keeps names of commits, sessions and decisions out.
 */
export function projectSection({ def, capsule, index, sessions = [], prev, now, detail = 'full', link }) {
  const minimal = detail === 'minimal';
  const quote = (t, generic = '') => (minimal ? generic : (safeText(t, 80) ? `“${safeText(t, 80)}”` : generic));
  const since = now - DAY;
  const commits = (index?.repos || []).flatMap((r) => r.commits.map((c) => ({ ...c, repo: r.path }))).sort((a, b) => b.date.localeCompare(a.date));
  const isNewCommit = (c) => (prev ? !prev.commits.includes(c.sha) : Date.parse(c.date) > since);
  const newCommits = commits.filter(isNewCommit);
  const seen = (s) => prev?.sessions?.[s.id];
  const isNewSession = (s) => (prev ? !seen(s) || seen(s).lastAt !== s.lastAt || seen(s).status !== s.status : Date.parse(s.lastAt) > since);
  const live = sessions.filter((s) => !s.subagent);
  const finished = live.filter((s) => s.status !== 'running' && isNewSession(s)).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  const running = live.filter((s) => s.status === 'running');
  const openNow = new Set([...(capsule.decisions || []).filter((d) => d.unresolved).map((d) => d.key || d.id), ...(capsule.questions || []).map((q) => q.id)]);
  const resolved = prev ? prev.open.filter((k) => !openNow.has(k) && (capsule.decisions || []).some((d) => (d.key || d.id) === k)) : [];
  const docsChanged = prev ? (index?.docs || []).filter((d) => prev.docs?.[d.id] && prev.docs[d.id] !== d.hash) : [];
  const blockedNow = (capsule.blocked || []).filter((b) => b.code === 'blocked').length;

  // What changed: genuine developments only, each marked as verified, claimed or unfinished.
  const changed = [];
  for (const s of finished.slice(0, 3)) {
    const name = quote(s.title, 'a task');
    const verifiedCommit = (s.commits || []).some((c) => c.verified);
    if (s.status === 'error') changed.push({ text: `${toolName(s)} stopped with an error on ${name}.`, status: 'failed', lead: `${toolName(s)} stopped with an error`, src: { type: 'session', tool: s.tool, id: s.id } });
    else if (s.test?.status === 'failed') changed.push({ text: `${toolName(s)} finished ${name}, but reports failing tests.`, status: 'failed', lead: `${toolName(s)} finished ${name} with failing tests`, src: { type: 'session', tool: s.tool, id: s.id } });
    else if (s.test?.status === 'passed') changed.push({ text: `${toolName(s)} finished ${name} and reports its tests passing.${verifiedCommit ? ' Its commit is in Git.' : ' Nobody has reviewed it yet.'}`, status: verifiedCommit ? 'verified' : 'claimed', lead: `${toolName(s)} finished ${name}`, src: { type: 'session', tool: s.tool, id: s.id } });
    else changed.push({ text: `${toolName(s)} says it finished ${name}. It reported no tests.`, status: 'unverified', lead: `${toolName(s)} says it finished ${name}`, src: { type: 'session', tool: s.tool, id: s.id } });
  }
  if (newCommits.length) {
    const [a, b] = newCommits;
    const text = newCommits.length === 1
      ? `${quote(a.subject, 'One commit')} landed${minimal ? '' : ` ${ago(a.date, now)}`}.`
      : `${Word(newCommits.length)} commits landed${[a, b].map((c) => c && quote(c.subject)).filter(Boolean).length ? `, including ${[a, b].map((c) => c && quote(c.subject)).filter(Boolean).join(' and ')}` : ''}.`;
    changed.push({ text, status: 'verified', lead: newCommits.length === 1 ? `${quote(a.subject, 'a commit')} landed` : `${word(newCommits.length)} commits landed`, src: { type: 'commit', repo: a.repo, sha: a.sha } });
  }
  for (const k of resolved.slice(0, 2)) {
    const d = (capsule.decisions || []).find((x) => (x.key || x.id) === k);
    changed.push({ text: `${minimal ? 'A decision' : `${d.key || 'A decision'}, ${lowerFirst(safeText(d.text.replace(/^[A-Z]{1,8}[-\d]*\d+\s*[—–-]\s*/, ''), 60))},`} is no longer open.`, status: 'verified', lead: `${d.key || 'a decision'} was settled`, src: d.sources?.[0] });
  }
  if (prev?.blocked && !blockedNow) changed.push({ text: 'Cereal can read all of its folders again.', status: 'verified', lead: 'its folders are readable again' });
  if (docsChanged.length) changed.push({ text: docsChanged.length === 1 ? `${quote(docsChanged[0].title, 'A document')} was updated.` : `${Word(docsChanged.length)} documents were updated${minimal ? '' : `, including ${quote(docsChanged[0].title)}`}.`, status: 'doc', lead: `${word(docsChanged.length)} document${docsChanged.length === 1 ? ' was' : 's were'} updated`, src: docsChanged[0] && { type: 'doc', docId: docsChanged[0].id, line: 1 } });
  for (const s of running.slice(0, 2)) changed.push({ text: `${toolName(s)} is still working on ${quote(s.title, 'a task')}.`, status: 'progress', lead: `${toolName(s)} is still working`, src: { type: 'session', tool: s.tool, id: s.id } });

  // Where you left off: the last meaningful point in the work.
  const lf = capsule.leftOff?.[0];
  let leftOff = null;
  if (lf) {
    const t = lf.text;
    const text = /^Last commit: /.test(t) ? `Your last commit was ${quote(t.slice(13), 'a commit')}, ${ago(lf.at, now)}.`
      : /^(Claude Code|Codex) worked on /.test(t) ? `${t.startsWith('Codex') ? 'Codex' : 'Claude'} last worked on ${quote(t.replace(/^(Claude Code|Codex) worked on /, ''), 'a task')}, ${ago(lf.at, now)}.`
      : /^You were reading /.test(t) ? `You were reading ${quote(t.slice(17).split(',')[0], 'a document')}.`
      : /uncommitted file/.test(t) ? `${safeText(t.replace(/ in .*$/, ''), 80)} are still uncommitted.`
      : `${safeText(t, 100)}.`;
    leftOff = { text, src: lf.sources?.[0] };
  }

  // Your next move: one recommendation, from the most urgent thing that is genuinely waiting on you.
  const quiet = lastActivity({ index, sessions });
  const quietDays = quiet ? Math.round((now - Date.parse(quiet)) / DAY) : null;
  const deadlines = upcomingDeadlines(index, now);
  const failed = live.find((s) => s.test?.status === 'failed' && now - Date.parse(s.test.at || s.lastAt) < 7 * DAY);
  const errored = live.find((s) => s.status === 'error' && now - Date.parse(s.lastAt) < 3 * DAY);
  const review = (capsule.attention || []).find((a) => a.sessionId);
  const reviewSession = review && live.find((s) => s.id === review.sessionId);
  const unverified = (capsule.attention || []).find((a) => /not in any repository/.test(a.text));
  const decision = (capsule.decisions || []).find((d) => d.unresolved);
  const dirty = (capsule.attention || []).find((a) => /^Uncommitted work/.test(a.text));
  const resume = capsule.resume?.[0];
  const moves = [];
  if (failed) moves.push({ kind: 'failed', score: 100, text: `Find out why ${quote(failed.title, 'the latest agent task')} failed its tests.`, why: `${toolName(failed)} reported the failure ${ago(failed.test.at || failed.lastAt, now)}, and anything built on it inherits the problem.`, src: { type: 'session', tool: failed.tool, id: failed.id } });
  if (errored) moves.push({ kind: 'failed', score: 95, text: `See where ${toolName(errored)} got stuck on ${quote(errored.title, 'its task')}.`, why: `It stopped with an error ${ago(errored.lastAt, now)} and couldn’t finish.`, src: { type: 'session', tool: errored.tool, id: errored.id } });
  for (const d of deadlines.slice(0, 1)) moves.push({ kind: 'deadline', score: d.days < 0 ? 97 : d.days <= 1 ? 92 : d.days <= 3 ? 70 : 50, text: d.days < 0 ? `Decide what happens now that ${quote(d.text, 'a deadline')} has passed.` : `Prepare for ${quote(d.text, 'the next deadline')}, due ${d.when}.`, why: d.days < 0 ? `It was due ${d.when}.` : `It’s due ${d.when}, according to ${minimal ? 'a project document' : quote(d.doc, 'a project document')}.`, src: d.src });
  if (unverified) moves.push({ kind: 'unverified', score: 90, text: 'Check a commit an agent reported that Git can’t find.', why: 'It may never have landed, or it lives on another machine.', src: unverified.sources?.[0] });
  const soon = deadlines.find((d) => d.days >= 0 && d.days <= 3);
  if (review) moves.push({ kind: 'review', score: 80, text: `Review ${quote(reviewSession?.title || review.text.replace(/ is ready for review$/, ''), 'the latest agent work')}.`, why: `${toolName(reviewSession)} finished it ${ago(review.at, now)}${reviewSession?.test?.status === 'passed' ? ' and reports its tests passing' : reviewSession?.test ? '' : ', with no tests reported'}. It’s waiting only on you.${soon ? ` ${quote(soon.text, 'A deadline')} is due ${soon.when}.` : ''}`, src: review.sources?.[0] });
  if (decision) {
    const age = decision.at ? Math.floor((now - Date.parse(decision.at)) / DAY) : 0;
    moves.push({ kind: 'decision', score: 60 + (age > 7 ? 10 : 0), text: minimal ? 'Make the open decision in this project.' : `Decide ${decision.key || 'the open question'}, ${lowerFirst(safeText(decision.text.replace(/^[A-Z]{1,8}[-\d]*\d+\s*[—–-]\s*/, ''), 60))}.`, why: `It’s still marked unresolved${age > 1 ? `, and has been for ${word(age)} days` : ''}.`, src: decision.sources?.[0] });
  }
  if (running[0]) moves.push({ kind: 'running', score: 30, text: `Let ${toolName(running[0])} finish ${quote(running[0].title, 'its task')}, then review it.`, why: 'It was still working when this briefing was written.', src: { type: 'session', tool: running[0].tool, id: running[0].id } });
  if (dirty) moves.push({ kind: 'dirty', score: 20, text: 'Commit or park the uncommitted work.', why: 'Uncommitted changes are easy to lose when you switch projects.', src: dirty.sources?.[0] });
  if (quietDays != null && quietDays >= 10) moves.push({ kind: 'stalled', score: 25, text: `Decide whether ${def.name} is paused or needs a next step.`, why: `Nothing has moved in ${word(quietDays)} days.`, src: null });
  if (resume) moves.push({ kind: 'resume', score: 10, text: minimal ? 'Pick up where you left off.' : `Pick up where you left off: ${lowerFirst(safeText(resume.label, 60))}.`, why: 'It’s where you stopped last time.', src: resume.target });
  moves.sort((a, b) => b.score - a.score);

  // Needs your attention: only things a person must act on.
  const attention = [];
  if (failed) attention.push({ kind: 'failed', text: `${quote(failed.title, 'An agent task')} failed its tests.`, src: { type: 'session', tool: failed.tool, id: failed.id } });
  if (errored) attention.push({ kind: 'failed', text: `${toolName(errored)} couldn’t finish ${quote(errored.title, 'a task')}.`, src: { type: 'session', tool: errored.tool, id: errored.id } });
  const reviews = (capsule.attention || []).filter((a) => a.sessionId);
  const titleOf = (r) => live.find((x) => x.id === r.sessionId)?.title || r.text.replace(/ is ready for review$/, '');
  if (reviews.length === 1) attention.push({ kind: 'review', text: `${quote(titleOf(reviews[0]), 'Agent work')} is waiting for your review.`, src: reviews[0].sources?.[0] });
  else if (reviews.length > 1) attention.push({ kind: 'review', text: `${Word(reviews.length)} agent results are waiting for your review${minimal ? '' : `, newest first: ${list(reviews.slice(0, 3).map((r) => quote(titleOf(r))).filter(Boolean))}`}.`, src: reviews[0].sources?.[0] });
  if (unverified) attention.push({ kind: 'failed', text: 'An agent reported a commit that Git can’t find.', src: unverified.sources?.[0] });
  for (const d of (capsule.decisions || []).filter((x) => x.unresolved).slice(0, 2)) attention.push({ kind: 'decision', text: minimal ? 'A decision is still unresolved.' : `${d.key || 'A decision'}, ${lowerFirst(safeText(d.text.replace(/^[A-Z]{1,8}[-\d]*\d+\s*[—–-]\s*/, ''), 60))}, is unresolved.`, src: d.sources?.[0] });
  for (const d of deadlines.filter((x) => x.days <= 3)) attention.push({ kind: 'deadline', text: d.days < 0 ? `${quote(d.text, 'A deadline')} was due ${d.when}.` : `${quote(d.text, 'A deadline')} is due ${d.when}.`, src: d.src });
  if (blockedNow) attention.push({ kind: 'blocked', text: `macOS is hiding ${word(blockedNow)} of ${def.name}’s folders from Cereal.`, src: { type: 'retained' } });
  if (quietDays != null && quietDays >= 14 && (decision || review)) attention.push({ kind: 'stalled', text: `${def.name} hasn’t moved in ${word(quietDays)} days, with work still open.`, src: null });

  const linkFor = (src) => (src && link ? link(def.id, src) : null);
  return {
    id: def.id,
    name: def.name,
    tagline: safeText(def.tagline || capsule.tagline || '', 90),
    brand: { accent: def.brand?.accent || '#6E5FE8', surface: def.brand?.surface, ink: def.brand?.ink, mode: def.brand?.mode },
    moved: changed.some((c) => c.status !== 'progress'),
    quietDays,
    changed: changed.slice(0, 4).map((c) => ({ ...c, href: linkFor(c.src) })),
    leftOff: leftOff && { ...leftOff, href: linkFor(leftOff.src) },
    next: moves[0] ? { ...moves[0], href: linkFor(moves[0].src) } : null,
    attention: attention.map((a) => ({ ...a, projectId: def.id, projectName: def.name, accent: def.brand?.accent, href: linkFor(a.src) })),
  };
}

function upcomingDeadlines(index, now) {
  const out = [];
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  for (const d of index?.docs || []) for (const x of d.deadlines || []) {
    const due = new Date(`${x.date}T00:00:00`);
    const days = Math.round((due - today) / DAY);
    if (days < -3 || days > 7) continue;
    const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days === -1 ? 'yesterday' : days < 0 ? `${word(-days)} days ago` : `in ${word(days)} days`;
    const what = x.text.replace(/^[^:]{1,24}:\s*/, '').replace(/\b(20\d\d-\d\d-\d\d|\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+20\d\d|[A-Za-z]{3,9}\.?\s+\d{1,2}(st|nd|rd|th)?,?\s+20\d\d)\b/, '').replace(/^[\s,;:—–-]+|[\s,;:—–.-]+$/g, '').replace(/^\w/, (c) => c.toUpperCase()) || 'A deadline';
    out.push({ text: what, date: x.date, days, when, doc: d.title, src: { type: 'doc', docId: d.id, line: x.line } });
  }
  return out.sort((a, b) => a.days - b.days);
}

/**
 * The whole briefing. `projects` are [{ def, capsule, index, sessions }] for the projects the reader selected.
 * `previous` is the last delivered briefing record ({ snapshot, deliveredAt }) or null.
 */
/** Headlines for one project, as the email shows them: short title, source, when, and the topic it matched. */
function newsFor(found, now) {
  return (found?.items || []).map((n) => ({ title: safeText(n.title, 140), url: n.url, source: safeText(n.source, 60), when: n.at ? ago(n.at, now) : '', topic: n.topic })).filter((n) => n.title && /^https?:\/\//.test(n.url));
}

export function buildBriefing({ projects, previous = null, now = Date.now(), timeZone = 'UTC', detail = 'full', link = null, news = null }) {
  const sections = projects.map((p) => ({ ...projectSection({ ...p, prev: previous?.snapshot?.[p.def.id] || null, now, detail, link }), news: news ? newsFor(news[p.def.id], now) : [] }));
  const moved = sections.filter((s) => s.moved);
  const quiet = sections.filter((s) => !s.moved);
  const attention = sections.flatMap((s) => s.attention);
  const order = { failed: 0, deadline: 1, review: 2, decision: 3, blocked: 4, stalled: 5 };
  attention.sort((a, b) => order[a.kind] - order[b.kind]);

  // The overview: an editorial paragraph made of real developments. A quiet night is reported as one.
  const sinceWhat = previous ? 'since your last briefing' : 'since yesterday';
  const lines = [];
  if (!moved.length) lines.push(`A quiet night. Nothing moved ${sinceWhat}, so here’s where you left off.`);
  else {
    lines.push(`${moved.length === sections.length && sections.length > 1 ? 'Everything moved' : `${list(moved.map((s) => s.name))} moved`} ${sinceWhat}.`);
    for (const s of moved.slice(0, 2)) { const lead = s.changed.find((c) => c.status !== 'progress')?.lead; if (lead) lines.push(`In ${s.name}, ${lead}.`); }
  }
  const longQuiet = quiet.filter((s) => s.quietDays != null && s.quietDays >= 7);
  if (longQuiet.length) lines.push(`${list(longQuiet.map((s) => s.name))} ${longQuiet.length === 1 ? 'has' : 'have'} been quiet for ${longQuiet.length === 1 ? `${word(longQuiet[0].quietDays)} days` : 'a week or more'}.`);
  const shown = attention.slice(0, 6);
  if (shown.length) lines.push(`${Word(shown.length)} thing${shown.length === 1 ? '' : 's'} need${shown.length === 1 ? 's' : ''} you today.`);

  // One thing to focus on: the highest-ranked next move across projects.
  const focusFrom = sections.filter((s) => s.next).sort((a, b) => b.next.score - a.next.score)[0];
  const focus = focusFrom ? { projectId: focusFrom.id, projectName: focusFrom.name, accent: focusFrom.brand.accent, text: focusFrom.next.text, why: focusFrom.next.why, href: focusFrom.next.href } : null;

  const date = new Date(now);
  const dateLabel = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone }).format(date);
  return {
    version: 1,
    generatedAt: date.toISOString(),
    timeZone,
    dateLabel,
    since: previous?.deliveredAt || new Date(now - DAY).toISOString(),
    headline: moved.length ? 'Good morning. Here’s what moved.' : 'Good morning. A quiet one today.',
    overview: lines.join(' '),
    nothingHappened: !moved.length,
    projects: sections,
    attention: shown,
    moreAttention: attention.length - shown.length,
    focus,
    detail,
    // Headlines already shown are remembered so tomorrow's briefing brings new ones.
    snapshot: Object.fromEntries(projects.map((p) => [p.def.id, { ...snapshotOf(p), newsSeen: [...new Set([...(sections.find((s) => s.id === p.def.id)?.news || []).flatMap(seenKeys), ...(previous?.snapshot?.[p.def.id]?.newsSeen || [])])].slice(0, 120) }])),
    newsCount: sections.reduce((n, s) => n + s.news.length, 0),
  };
}

/** Subject and preview text for the email. */
export function subjectFor(b) {
  const moved = b.projects.filter((p) => p.moved).map((p) => p.name);
  const subject = moved.length ? `${list(moved)} moved overnight` : 'A quiet night across your projects';
  return { subject, preheader: b.focus ? `Today: ${b.focus.text}` : b.overview };
}
