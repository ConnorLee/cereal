// The morning edition: what happened in each project, said plainly, with the detail folded away.
// Every line comes from an indexed fact and keeps its source. Nothing here is written by a model.
const DAY = 864e5;
const docSrc = (d, line) => ({ type: 'doc', docId: d.id, path: d.path, line: line || 1, label: `${d.rel}${line ? `:${line}` : ''}` });
const commitSrc = (repo, c) => ({ type: 'commit', repo, sha: c.sha, label: `${c.short} · ${c.subject}`.slice(0, 90) });
const sessionSrc = (s) => ({ type: 'session', tool: s.tool, id: s.id, label: `${s.tool === 'codex' ? 'Codex' : 'Claude Code'} · ${s.title || s.id.slice(0, 8)}` });
const toolName = (s) => (s.tool === 'codex' ? 'Codex' : 'Claude');
// A real market note, not a table row, code reference or a stray "timing" in engineering notes.
export const NOT_PROSE = /^\s*\||\|\s*$|`|\]\(|\b[A-Z][a-z]+[A-Z]\w*\.\w+|\b\w+\.\w+\.\w+|\b[\w-]+\.(md|ts|js|mjs|swift|json)\b/;
const marketNote = (m) => !NOT_PROSE.test(m.text) && (m.kind === 'market' || /\bwhy now\b|\btailwinds?\b|\bmarket timing\b/i.test(m.text));
const lower = (t) => String(t || '').replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase());

export function buildDispatch({ def, capsule, index, now = Date.now() }) {
  const repos = index?.repos || [];
  const docs = index?.docs || [];
  const sessions = (capsule.agents?.recent || []).filter((s) => !s.subagent);
  const commits = repos.flatMap((r) => r.commits.map((c) => ({ ...c, repo: r.path }))).sort((a, b) => b.date.localeCompare(a.date));

  // "Overnight" is the last day; a quiet day widens to the week so the edition still has something true to say.
  let window = DAY;
  const moved = (w) => commits.some((c) => now - Date.parse(c.date) < w) || sessions.some((s) => now - Date.parse(s.lastAt) < w);
  if (!moved(window)) window = 7 * DAY;
  const fresh = (iso) => now - Date.parse(iso) < window;
  const newCommits = commits.filter((c) => fresh(c.date));
  const finished = sessions.filter((s) => s.status !== 'running' && fresh(s.lastAt));
  const running = sessions.filter((s) => s.status === 'running');

  // Headline: the single most newsworthy thing.
  let headline;
  if (finished[0]) headline = { text: `${toolName(finished[0])} finished ${finished[0].title ? `“${finished[0].title.split(/:\s/)[0]}”` : 'a task'}${finished[0].test?.status === 'passed' ? ', tests passing' : finished[0].test?.status === 'failed' ? ', with failing tests' : ''}`, src: sessionSrc(finished[0]) };
  else if (newCommits[0]) headline = { text: `Shipped: ${newCommits[0].subject}`, src: commitSrc(newCommits[0].repo, newCommits[0]) };
  else if (running[0]) headline = { text: `${toolName(running[0])} is working on “${running[0].title || 'a task'}”`, src: sessionSrc(running[0]) };
  else if (commits[0]) headline = { text: `Quiet since “${commits[0].subject}”`, src: commitSrc(commits[0].repo, commits[0]) };
  else if (/^Last commit: /.test(capsule.leftOff?.[0]?.text || '')) headline = { text: `Quiet since “${capsule.leftOff[0].text.slice(13)}”`, src: capsule.leftOff[0].sources?.[0] || null };
  else headline = { text: `Nothing new in ${def.name}`, src: null };

  const span = window === DAY ? 'since yesterday' : 'this week';
  const bits = [];
  if (newCommits.length) bits.push(`${newCommits.length} commit${newCommits.length === 1 ? '' : 's'}`);
  if (finished.length) bits.push(`${finished.length} agent result${finished.length === 1 ? '' : 's'}`);
  const open = capsule.questions?.[0];
  const deck = [
    bits.length ? `${bits.join(' and ')} ${span}.` : `No new commits ${span}.`,
    running.length ? `${running.length === 1 ? 'One agent is' : `${running.length} agents are`} still working.` : '',
    open ? `Still waiting on your call: ${lower(open.text.replace(/^([A-Z]{1,8}[-\d]*\d+)\s*[—–-]\s*/, ''))}.` : '',
  ].filter(Boolean).join(' ');

  // Market and why now: lines the project's own documents say about its market (news is added by the server).
  const market = [];
  for (const d of docs) for (const m of d.market || []) if (market.length < 4 && marketNote(m)) market.push({ text: m.text, kind: m.kind, src: docSrc(d, m.line) });
  market.sort((a, b) => (a.kind === 'market' ? 0 : 1) - (b.kind === 'market' ? 0 : 1));

  // What's new in the product: commits and agent results in the window.
  const product = [
    ...finished.slice(0, 4).map((s) => ({ text: `${toolName(s)}: ${s.title || 'session'}`, detail: s.latest?.text || '', kind: 'agent', src: sessionSrc(s), at: s.lastAt })),
    ...newCommits.slice(0, 6).map((c) => ({ text: c.subject, detail: c.refs ? c.refs.replace(/HEAD -> /, '') : '', kind: 'git', src: commitSrc(c.repo, c), at: c.date })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));

  // How it got here: the decisions that shaped it and the lines of work in flight.
  const process = [
    ...(capsule.decisions || []).slice(0, 5).map((d) => ({ text: d.text, detail: d.detail || '', kind: d.kind, src: d.sources?.[0], at: d.at })),
    ...repos.flatMap((r) => r.branches.slice(0, 4).map((b) => ({ text: `Branch ${b.name}`, detail: `${b.subject}`, kind: 'git', src: { type: 'worktree', path: (r.worktrees.find((w) => w.branch === b.name) || {}).path || r.path, label: `${b.name}` }, at: b.date }))).slice(0, 4),
  ];

  return { projectId: def.id, headline, deck, span, market, product, process, moved: newCommits.length + finished.length };
}

export function buildLede(dispatches, now = new Date()) {
  const movedOvernight = dispatches.filter((d) => d.moved && d.span === 'since yesterday');
  const names = movedOvernight.map((d) => d.name);
  const list = names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  const text = !dispatches.length ? 'Nothing to report yet.'
    : !names.length ? 'A quiet night. Nothing moved since yesterday.'
    : names.length === dispatches.length ? `Everything moved overnight: ${list}.`
    : `${list} moved overnight.`;
  return { date: now.toISOString(), text };
}
