import { extractSignals } from './indexer.mjs';

// A summary built only from the document's own structure: its opening, its labelled facts
// (Purpose:, Status:, Scope: …), its sections, decisions and open questions. No model involved.
const LABEL = /^\s*(?:[-*]\s+)?\*\*([A-Z][\w /&()-]{1,32}?):?\*\*:?\s*(.+)$/;
const clean = (s) => s.replace(/\*\*/g, '').replace(/`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();

export function outlineSummary(text) {
  const lines = String(text || '').split('\n');
  const sig = extractSignals(text);
  const facts = [];
  for (let i = 0; i < lines.length && facts.length < 6; i++) {
    const m = LABEL.exec(lines[i]);
    // A decision's own date/status line belongs to that decision, not to the document's facts.
    if (m && clean(m[2]).length > 3 && !/^date\s*\/?\s*status$|^status\s*\/?\s*date$/i.test(m[1].trim())) facts.push({ label: m[1].trim(), text: clean(m[2]).slice(0, 240), line: i + 1 });
  }
  const sections = sig.headings.filter((h, i) => i > 0 || h.text !== sig.title).slice(0, 10);
  const words = String(text || '').split(/\s+/).filter(Boolean).length;
  const lead = facts.find((f) => /purpose|summary|overview|goal|what/i.test(f.label))?.text || sig.excerpt || '';
  return {
    mode: 'outline',
    lead,
    facts: facts.filter((f) => f.text !== lead),
    sections,
    decisions: sig.decisions.slice(0, 5).map((d) => ({ text: `${d.key} — ${d.title}`, status: d.status, line: d.line })),
    questions: sig.questions.slice(0, 5),
    words,
    minutes: Math.max(1, Math.round(words / 230)),
  };
}

// Claude summary of one document, on demand. Lines are numbered so every sentence can point back.
export async function claudeSummary(text, title, { key, model }) {
  const numbered = String(text).split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n').slice(0, 60000);
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: 600,
      messages: [{ role: 'user', content: `Summarize the document "${title}" for its owner, who is coming back to it. Write 3 to 5 short, plain sentences: what it is for, where it stands, and what is still open. After each sentence, cite the line it comes from as (L12). Use only what the document says.\n\n${numbered}` }],
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.message || `Claude API error ${r.status}`), { status: 502 });
  return { mode: 'claude', text: (j.content || []).map((x) => x.text).join('').trim(), model: j.model };
}
