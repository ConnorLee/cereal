import path from 'node:path';
import crypto from 'node:crypto';

// A Context Capsule is assembled only from indexed evidence. Every fact carries its provenance
// (kind) and at least one source reference the UI can open. Nothing here is generated prose.
//   kind: 'git'   — verified from Git metadata
//         'agent' — reported by a Claude Code / Codex session (not independently verified)
//         'human' — a decision a person recorded in a project document
//         'doc'   — stated in an indexed document
//         'you'   — your own activity in Cereal
//         'inferred' — a relationship Cereal inferred (e.g. path-based session attribution)

const DAY = 864e5;
const short = (p) => path.basename(p || '');
const fid = (...parts) => crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 10);

const commitSrc = (repo, c) => ({ type: 'commit', repo: repo.path, sha: c.sha, label: `${c.short} · ${c.subject}`.slice(0, 90) });
const docSrc = (d, line) => ({ type: 'doc', docId: d.id, path: d.path, line: line || 1, label: `${d.rel}${line ? `:${line}` : ''}` });
const sessionSrc = (s) => ({ type: 'session', tool: s.tool, id: s.id, label: `${s.tool === 'codex' ? 'Codex' : 'Claude Code'} · ${s.title || s.id.slice(0, 8)}` });
const worktreeSrc = (w) => ({ type: 'worktree', path: w.path, label: `${short(w.path)} · ${w.branch || 'detached'}` });

function sessionKind(s) {
  return s.attribution?.confidence === 'inferred' ? 'inferred' : 'agent';
}

export function buildCapsule({ def, project, index, sessions = [], now = Date.now() }) {
  const lastVisit = project.lastVisitAt ? Date.parse(project.lastVisitAt) : null;
  const since = lastVisit || now - 7 * DAY;
  const repos = index?.repos || [];
  const docs = [...(index?.docs || [])].sort((a, b) => b.mtime.localeCompare(a.mtime));
  const visible = sessions.filter((s) => !s.subagent).sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)));
  const worktrees = repos.flatMap((r) => r.worktrees.map((w) => ({ ...w, repo: r })));
  const commits = repos.flatMap((r) => r.commits.map((c) => ({ ...c, repo: r }))).sort((a, b) => b.date.localeCompare(a.date));
  const ws = project.workspace || {};

  // ----- Decisions and open questions (from documents) -----
  const seen = new Set();
  const decisions = [];
  for (const d of docs) {
    for (const dec of d.decisions || []) {
      if (seen.has(dec.key)) continue;
      seen.add(dec.key);
      const approved = /approved|accepted|confirmed/i.test(dec.status);
      decisions.push({ id: fid('dec', dec.key), key: dec.key, text: `${dec.key} — ${dec.title}`, detail: dec.title.toLowerCase().includes(dec.status.toLowerCase()) ? '' : dec.status, kind: approved ? 'human' : 'doc', at: d.mtime, sources: [docSrc(d, dec.line)], unresolved: /unresolved|pending|proposed|reconcil/i.test(dec.status + ' ' + dec.title) });
    }
  }
  decisions.sort((a, b) => (/DEC-\d/.test(b.key) - /DEC-\d/.test(a.key)) || b.key.localeCompare(a.key, undefined, { numeric: true }));
  const questions = [
    ...decisions.filter((d) => d.unresolved).map((d) => ({ ...d, id: fid('q', d.id) })),
    ...docs.flatMap((d) => (d.questions || []).map((q) => ({ id: fid('q', d.id, q.line), text: q.text, detail: d.title, kind: 'doc', at: d.mtime, sources: [docSrc(d, q.line)] }))),
  ].slice(0, 8);

  // Sessions that finished since your last visit are "needs you" items; they are not repeated elsewhere.
  const newSessions = visible.filter((s) => Date.parse(s.lastAt) > since);
  const review = newSessions.filter((x) => x.status !== 'running').slice(0, 3);
  const reviewIds = new Set(review.map((s) => s.id));

  // ----- Where we left off -----
  const leftOff = [];
  if (ws.focus?.label) {
    leftOff.push({ id: 'you-focus', text: describeFocus(ws.focus), kind: 'you', at: ws.updatedAt || project.lastVisitAt, sources: ws.focus.source ? [ws.focus.source] : [] });
  }
  // Quiet projects still have a last commit: fall back to the newest checkout head when nothing landed recently.
  const newestHead = worktrees.filter((w) => w.last).sort((a, b) => b.last.date.localeCompare(a.last.date))[0];
  const latestCommit = commits[0] || (newestHead && { ...newestHead.last, refs: newestHead.branch || '', repo: newestHead.repo });
  if (latestCommit) {
    const wt = worktrees.find((w) => w.last?.sha === latestCommit.sha);
    const where = [latestCommit.refs ? `on ${latestCommit.refs.replace(/HEAD -> /, '').split(', ')[0]}` : '', wt ? `in ${short(wt.path)}` : ''].filter(Boolean).join(' ');
    leftOff.push({ id: fid('lc', latestCommit.sha), text: `Last commit: ${latestCommit.subject}`, detail: where ? where[0].toUpperCase() + where.slice(1) : '', kind: 'git', at: latestCommit.date, sources: [commitSrc(latestCommit.repo, latestCommit), ...(wt ? [worktreeSrc(wt)] : [])] });
  }
  const latestSession = visible[0];
  if (latestSession && !reviewIds.has(latestSession.id)) {
    leftOff.push({ id: fid('ls', latestSession.id), text: `${latestSession.tool === 'codex' ? 'Codex' : 'Claude Code'} worked on ${latestSession.title || 'an untitled session'}`, detail: meaningful(latestSession.latest?.text), kind: sessionKind(latestSession), at: latestSession.lastAt, sources: [sessionSrc(latestSession)] });
  }
  const focusWt = worktrees.find((w) => w.path === repos[0]?.focus);
  const dirtySoon = focusWt && focusWt.dirty > 0 && focusWt.last && Date.parse(focusWt.last.date) > now - 21 * DAY; // already listed under "needs you"
  if (focusWt && focusWt.dirty && !dirtySoon) {
    leftOff.push({ id: fid('fw', focusWt.path), text: `${focusWt.dirty} uncommitted file${focusWt.dirty === 1 ? '' : 's'} in ${short(focusWt.path)}, your most active checkout`, kind: 'git', at: focusWt.last?.date, sources: [worktreeSrc(focusWt)] });
  }

  // ----- What's changed since your last visit -----
  const changed = [];
  const newCommits = commits.filter((c) => Date.parse(c.date) > since);
  for (const c of newCommits.slice(0, 6)) changed.push({ id: fid('c', c.sha), text: c.subject, detail: `${c.short} · ${c.author}${c.refs ? ' · ' + c.refs.replace(/HEAD -> /, '') : ''}`, kind: 'git', at: c.date, sources: [commitSrc(c.repo, c)] });
  if (newCommits.length > 6) changed.push({ id: 'more-commits', text: `${newCommits.length - 6} more commits across ${new Set(newCommits.map((c) => c.refs || c.sha)).size} refs`, kind: 'git', at: newCommits[6].date, sources: newCommits.slice(6, 12).map((c) => commitSrc(c.repo, c)) });
  for (const s of newSessions.filter((x) => !reviewIds.has(x.id)).slice(0, 5)) changed.push({ id: fid('s', s.id, s.lastAt), text: `${s.tool === 'codex' ? 'Codex' : 'Claude Code'} ${s.status === 'running' ? 'is working on' : 'worked on'}: ${s.title || 'a task'}`, detail: s.latest?.text, kind: sessionKind(s), at: s.lastAt, sources: [sessionSrc(s)], sessionId: s.id });
  const newDocs = docs.filter((d) => Date.parse(d.mtime) > since);
  for (const d of newDocs.slice(0, 5)) changed.push({ id: fid('d', d.id, d.hash), text: `Updated: ${d.title}`, kind: 'doc', at: d.mtime, sources: [docSrc(d)] });
  changed.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  // ----- What needs attention -----
  const attention = [];
  const outside = {};
  for (const s of visible) {
    for (const c of s.commits || []) {
      if (c.verified === false) attention.push({ id: fid('uv', s.id, c.sha), severity: 'high', text: `Reported commit ${c.sha.slice(0, 7)} is not in any repository the session touched`, detail: `${s.tool === 'codex' ? 'Codex' : 'Claude Code'} claimed “${c.subject}”. Git has no such commit locally; it may be on another machine, rewritten, or never landed.`, kind: 'agent', at: c.at || s.lastAt, sources: [sessionSrc(s)] });
      if (c.verified && c.outside && c.repo) (outside[c.repo] ||= []).push({ s, c });
    }
  }
  for (const [repo, list] of Object.entries(outside)) {
    attention.push({ id: fid('out', repo), severity: 'low', text: `${list.length} commit${list.length === 1 ? '' : 's'} landed in ${short(repo)}, which Cereal isn’t watching`, detail: `Latest: “${list[0].c.subject}”. Connect the folder if it belongs to ${def.name}.`, kind: 'git', at: list[0].c.at || list[0].s.lastAt, sources: [{ type: 'folder', path: repo, label: repo }, sessionSrc(list[0].s)] });
  }
  for (const s of visible.slice(0, 15)) {
    if (s.test?.status === 'failed' && Date.parse(s.test.at || s.lastAt) > now - 7 * DAY) attention.push({ id: fid('tf', s.id), severity: 'high', text: `Last reported test run failed: ${s.test.summary}`, detail: s.title, kind: 'agent', at: s.test.at || s.lastAt, sources: [sessionSrc(s)] });
  }
  for (const s of review) {
    attention.push({ id: fid('rv', s.id, s.lastAt), severity: 'medium', text: `${s.title || 'An agent session'} is ready for review`, detail: `${s.tool === 'codex' ? 'Codex' : 'Claude Code'} finished. ${s.test ? `It reported ${s.test.summary}.` : 'It reported no tests.'}${s.latest?.text ? ' “' + s.latest.text.slice(0, 160) + '”' : ''}`, kind: sessionKind(s), at: s.lastAt, sources: [sessionSrc(s)], sessionId: s.id });
  }
  const byCwd = {};
  for (const s of visible.filter((x) => x.cwd && x.attribution?.basis === 'cwd' && Date.parse(x.lastAt) > now - DAY)) (byCwd[s.cwd] ||= []).push(s);
  for (const [cwd, list] of Object.entries(byCwd)) {
    if (list.length > 1) attention.push({ id: fid('cc', cwd), severity: 'medium', text: `${list.length} agents worked in ${short(cwd)} today`, detail: 'Agents sharing a checkout can overwrite each other. Check before merging.', kind: 'inferred', at: list[0].lastAt, sources: list.slice(0, 4).map(sessionSrc) });
  }
  const dirty = worktrees.filter((w) => w.dirty > 0 && w.last && Date.parse(w.last.date) > now - 21 * DAY).sort((a, b) => b.dirty - a.dirty);
  if (dirty.length) attention.push({ id: fid('dirty', dirty.map((w) => w.path).join()), severity: 'low', text: `Uncommitted work in ${dirty.length} checkout${dirty.length === 1 ? '' : 's'}`, detail: dirty.slice(0, 4).map((w) => `${short(w.path)} (${w.dirty})`).join(', '), kind: 'git', at: dirty[0].last.date, sources: dirty.slice(0, 4).map(worktreeSrc) });
  const prunable = worktrees.filter((w) => w.prunable);
  if (prunable.length) attention.push({ id: fid('prune', prunable.map((w) => w.path).join()), severity: 'low', text: `${prunable.length} registered worktree${prunable.length === 1 ? ' is' : 's are'} missing on disk`, detail: 'Git still lists them as prunable. Cleaning up needs your approval; Cereal will not delete worktrees.', kind: 'git', sources: prunable.slice(0, 4).map(worktreeSrc) });
  for (const q of decisions.filter((d) => d.unresolved).slice(0, 2)) attention.push({ ...q, id: fid('ud', q.id), severity: 'medium', text: `Decision needs reconciliation: ${q.text}` });
  const sev = { high: 0, medium: 1, low: 2 };
  attention.sort((a, b) => sev[a.severity] - sev[b.severity] || String(b.at || '').localeCompare(String(a.at || '')));

  // ----- Resume -----
  const resume = [];
  if (ws.focus?.source) resume.push({ id: 'r-focus', label: focusAction(ws.focus.source), sub: ws.focus.label, target: ws.focus.source });
  const reviewable = newSessions.find((s) => s.status !== 'running') || latestSession;
  const sameAsFocus = (t) => ws.focus?.source && ws.focus.source.type === t.type && (ws.focus.source.id || ws.focus.source.path) === (t.id || t.path);
  if (reviewable && sameAsFocus(sessionSrc(reviewable)) && resume[0]) resume[0].command = reviewable.cwd ? `cd ${JSON.stringify(reviewable.cwd)} && ${reviewable.resume}` : reviewable.resume;
  if (reviewable && !sameAsFocus(sessionSrc(reviewable))) resume.push({ id: fid('r-s', reviewable.id), label: `Open the ${reviewable.tool === 'codex' ? 'Codex' : 'Claude Code'} session`, sub: reviewable.title, target: sessionSrc(reviewable), command: reviewable.cwd ? `cd ${JSON.stringify(reviewable.cwd)} && ${reviewable.resume}` : reviewable.resume });
  if (focusWt) resume.push({ id: fid('r-w', focusWt.path), label: `Open ${short(focusWt.path)}`, sub: (focusWt.last?.subject ? `${focusWt.branch || 'detached'}: ${focusWt.last.subject}` : focusWt.branch || 'detached').slice(0, 120), target: worktreeSrc(focusWt), command: `cd ${JSON.stringify(focusWt.path)}` });
  const handoff = docs.find((d) => d.category === 'handoff') || docs[0];
  if (handoff) resume.push({ id: fid('r-d', handoff.id), label: `Read ${handoff.category === 'handoff' ? 'handoff' : 'latest document'}`, sub: handoff.title, target: docSrc(handoff) });

  // ----- Identity, state, git summary -----
  // Describe the project from what it is for, not from instructions written for agents.
  const describe = [/^readme\.md$/i, /(^|\/)product_context\.md$/i, /vision|north[_ -]?star/i].map((re) => docs.find((d) => re.test(d.rel) && d.excerpt && !d.stale)).find(Boolean);
  const lastAt = [latestCommit?.date, latestSession?.lastAt, docs[0]?.mtime].filter(Boolean).sort().pop() || null;
  const running = visible.filter((s) => s.status === 'running');
  const age = lastAt ? now - Date.parse(lastAt) : Infinity;
  const blocked = (index?.unavailable || []).map((u) => ({ path: u.path, code: u.code || 'unreadable', reason: u.reason, retained: u.retained || null }));
  const stateLabel = !index ? 'Not connected' : blocked.length && !docs.length && !repos.length ? 'Can’t read its folders' : running.length ? `${running.length} agent${running.length === 1 ? '' : 's'} working` : age < DAY ? 'Active today' : age < 7 * DAY ? 'Active this week' : lastAt ? `Quiet since ${new Date(lastAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'No activity found';

  const docGroups = {};
  for (const d of docs) (docGroups[d.category] ||= []).push({ id: d.id, title: d.title, rel: d.rel, path: d.path, mtime: d.mtime, checkout: short(d.checkout), branch: d.branch });

  return {
    projectId: def.id, name: def.name, tagline: def.tagline, brand: def.brand,
    revision: index?.revision || null, indexedAt: index?.indexedAt || null, generatedAt: new Date(now).toISOString(),
    since: new Date(since).toISOString(), firstVisit: !lastVisit,
    description: describe ? { text: describe.excerpt, sources: [docSrc(describe)] } : null,
    canonical: (project.sources || []).map((s) => ({ id: s.id, kind: s.kind, path: s.path, label: s.label, canonical: !!s.canonical })),
    state: { label: stateLabel, lastAt, running: running.length },
    blocked, leftOff, changed, attention, resume, decisions: decisions.slice(0, 10), questions,
    agents: { active: running.map(slimSession), recent: visible.slice(0, 12).map(slimSession), total: visible.length },
    git: repos.map((r) => ({ path: r.path, commonDir: r.commonDir, branchTotal: r.branchTotal, focus: r.focus, branches: r.branches.slice(0, 10), worktrees: r.worktrees, commitCount14d: r.commits.length })),
    docs: docGroups, references: (index?.references || []).slice(0, 40),
    counts: { changes: newCommits.length + newSessions.length + newDocs.length, attention: attention.length, docs: docs.length, decisions: decisions.length },
    workspace: ws,
  };
}

// An agent's last line is only worth showing if it says something ("No response requested." doesn't).
function meaningful(text) {
  const t = String(text || '').trim();
  return t.length > 24 && !/^(no response requested|done\.?|ok\.?|okay\.?)$/i.test(t) ? t : '';
}

function focusAction(src) {
  if (src.type === 'doc') return `Open ${String(src.label || '').split(/:(?=\d+$)/)[0].split('/').pop()}`;
  return { session: 'Open that session', commit: 'Open that commit', worktree: 'Open that checkout' }[src.type] || 'Open it again';
}

function describeFocus(focus) {
  const src = focus.source || {};
  if (src.type === 'doc') {
    const [file, line] = String(src.label || focus.label).split(/:(?=\d+$)/);
    return `You were reading ${file.split('/').pop()}${line && line !== '1' ? `, around line ${line}` : ''}`;
  }
  if (src.type === 'session') return `You were looking at the agent session “${String(src.label || '').replace(/^(Claude Code|Codex) · /, '')}”`;
  if (src.type === 'commit') return `You were looking at commit ${String(src.label || '').split(' · ')[0]}`;
  if (src.type === 'worktree') return `You were in the ${String(src.label || '').split(' · ')[0]} checkout`;
  return `You were looking at ${focus.label}`;
}

export function slimSession(s) {
  return { tool: s.tool, id: s.id, title: s.title, task: s.task, status: s.status, lastAt: s.lastAt, startedAt: s.startedAt, cwd: s.cwd, branch: s.branch, latest: s.latest, test: s.test, commits: s.commits, filesChanged: s.filesChanged, attribution: s.attribution, resume: s.resume };
}
