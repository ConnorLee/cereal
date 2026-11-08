// The morning briefing as an email: one column, editorial, built from tables with inline styles so it
// holds up in Gmail, Apple Mail and Outlook, with a dark-mode layer and a narrow-screen layer on top.
// Images are optional by design: identity comes from type and colour, so blocked images lose nothing.
import { subjectFor } from './briefing.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FONT = "'Aeonik Pro', Aeonik, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const C = { paper: '#FBFBFC', ink: '#17161B', ink2: '#48464F', quiet: '#8B8993', rule: '#E6E4EA', cereal: '#6E5FE8', focus: '#5141D6' };
const STATUS = {
  verified: ['In Git', '#2F8F5B'],
  claimed: ['Agent reported', '#A8650A'],
  unverified: ['Unverified', '#A8650A'],
  progress: ['In progress', '#6E5FE8'],
  failed: ['Needs a look', '#C93C3C'],
  doc: ['Docs', '#8B8993'],
};
const DOT = { failed: '#D14343', deadline: '#C27A12', review: '#6E5FE8', decision: '#C27A12', blocked: '#8B8993', stalled: '#8B8993' };

function mix(hex, other, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [p(hex), p(other)];
  return '#' + a.map((v, i) => Math.round(v * (1 - t) + b[i] * t).toString(16).padStart(2, '0')).join('');
}
const textColor = (accent) => mix(accent, '#000000', 0.38); // the project's colour, dark enough to read on paper
const td = (style, inner, extra = '') => `<td ${extra} style="font-family:${FONT};mso-line-height-rule:exactly;${style}">${inner}</td>`;
const row = (inner, pad = '0 48px') => `<tr><td class="px" style="padding:${pad};">${inner}</td></tr>`;
const table = (inner, extra = '') => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ${extra}>${inner}</table>`;
const label = (t, color = C.quiet) => `<p class="quiet" style="margin:0 0 8px;font-family:${FONT};font-size:12px;line-height:16px;letter-spacing:1.4px;text-transform:uppercase;font-weight:600;color:${color};">${esc(t)}</p>`;
const linked = (href, inner, color) => (href ? `<a href="${esc(href)}" style="color:${color};text-decoration:none;">${inner}</a>` : inner);

function projectBlock(p, i) {
  const accent = p.brand.accent;
  const tc = textColor(accent);
  const changed = p.changed.length
    ? p.changed.map((c) => {
      const [tag, color] = STATUS[c.status] || STATUS.doc;
      return `<p class="ink" style="margin:0 0 10px;font-family:${FONT};font-size:17px;line-height:26px;color:${C.ink};font-weight:400;"><span style="font-size:11px;letter-spacing:0.9px;text-transform:uppercase;font-weight:600;color:${color};white-space:nowrap;">${esc(tag)}</span>&nbsp;&nbsp;${linked(c.href, esc(c.text), C.ink)}</p>`;
    }).join('')
    : `<p class="quiet" style="margin:0 0 10px;font-family:${FONT};font-size:17px;line-height:26px;color:${C.quiet};font-weight:300;">Nothing new${p.quietDays != null ? `. Quiet for ${p.quietDays === 0 ? 'less than a day' : p.quietDays === 1 ? 'a day' : `${p.quietDays} days`}` : ''}.</p>`;
  return `
  ${row(`<div class="rule" style="border-top:1px solid ${C.rule};height:1px;line-height:1px;font-size:1px;${i ? '' : 'display:none;'}">&nbsp;</div>`, i ? '0 48px' : '0')}
  ${row(table(`<tr>
      ${td('width:44px;vertical-align:middle;', `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" valign="middle" width="36" height="36" style="width:36px;height:36px;border-radius:10px;background:${accent};font-family:${FONT};font-size:17px;font-weight:600;color:${accent === '#F2A33A' || parseInt(accent.slice(1), 16) > 0xB0B0B0 ? '#17161B' : '#FFFFFF'};">${esc(p.name[0])}</td></tr></table>`)}
      ${td('vertical-align:middle;', `<p class="pname-${esc(p.id)}" style="margin:0;font-family:${FONT};font-size:28px;line-height:32px;letter-spacing:-0.8px;font-weight:500;color:${tc};">${esc(p.name)}</p>${p.tagline ? `<p class="quiet" style="margin:2px 0 0;font-family:${FONT};font-size:14px;line-height:20px;color:${C.quiet};">${esc(p.tagline)}</p>` : ''}`)}
    </tr>`), i ? '36px 48px 0' : '8px 48px 0')}
  ${row(`${label('What changed')}${changed}`, '24px 48px 0')}
  ${p.leftOff ? row(`${label('Where you left off')}<p class="ink2" style="margin:0;font-family:${FONT};font-size:17px;line-height:26px;color:${C.ink2};font-weight:300;">${linked(p.leftOff.href, esc(p.leftOff.text), C.ink2)}</p>`, '18px 48px 0') : ''}
  ${p.next ? row(`${label('Your next move', tc)}<p class="ink" style="margin:0;font-family:${FONT};font-size:19px;line-height:27px;letter-spacing:-0.3px;color:${C.ink};font-weight:500;">${esc(p.next.text)}</p>${p.next.href ? `<p style="margin:8px 0 0;font-family:${FONT};font-size:15px;line-height:22px;"><a class="pname-${esc(p.id)}" href="${esc(p.next.href)}" style="color:${tc};text-decoration:none;font-weight:500;">Open in Cereal &rarr;</a></p>` : ''}`, p.news?.length ? '18px 48px 0' : '18px 48px 36px') : row('', p.news?.length ? '0' : '0 48px 36px')}
  ${p.news?.length ? row(`${label('In the news')}${p.news.map((n) => `<p style="margin:0 0 12px;font-family:${FONT};font-size:16px;line-height:23px;"><a class="ink" href="${esc(n.url)}" style="color:${C.ink};text-decoration:none;font-weight:400;">${esc(n.title)}</a><br><span class="quiet" style="font-size:13px;line-height:18px;color:${C.quiet};">${esc([n.source, n.when].filter(Boolean).join(' · '))} · about <span class="pname-${esc(p.id)}" style="color:${tc};">${esc(n.topic)}</span></span></p>`).join('')}`, '22px 48px 24px') : ''}`;
}

/**
 * Render a briefing. links: { app, manage, pause, unsubscribe } absolute URLs; provider: who delivers it.
 * Returns { subject, preheader, html, text }.
 */
export function renderBriefingEmail(b, { links = {}, provider = 'your email provider', projectCount } = {}) {
  const { subject, preheader } = subjectFor(b);
  const darkProjects = b.projects.map((p) => `.pname-${p.id}{color:${mix(p.brand.accent, '#FFFFFF', 0.12)} !important;}`).join('');
  const attention = b.attention.length ? `
    ${row(`<div class="rule" style="border-top:1px solid ${C.rule};height:1px;line-height:1px;font-size:1px;">&nbsp;</div>`)}
    ${row(`<h2 class="ink" style="margin:0 0 18px;font-family:${FONT};font-size:24px;line-height:30px;letter-spacing:-0.6px;font-weight:500;color:${C.ink};">Needs your attention</h2>
      ${table(b.attention.map((a) => `<tr>
        ${td('width:22px;vertical-align:top;padding:9px 0 0;', `<div style="width:8px;height:8px;border-radius:4px;background:${DOT[a.kind] || C.quiet};font-size:1px;line-height:1px;">&nbsp;</div>`)}
        ${td(`padding:0 0 14px;font-size:17px;line-height:25px;color:${C.ink};`, `<span class="ink">${linked(a.href, esc(a.text), C.ink)}</span><br><span class="pname-${esc(a.projectId)}" style="font-size:13px;line-height:18px;color:${textColor(a.accent || C.cereal)};font-weight:500;">${esc(a.projectName)}</span>`)}
      </tr>`).join(''))}${b.moreAttention ? `<p class="quiet" style="margin:0;font-family:${FONT};font-size:14px;line-height:20px;color:${C.quiet};">${b.moreAttention === 1 ? 'One more' : `${b.moreAttention} more`} in Cereal.</p>` : ''}`, '36px 48px 20px')}` : '';
  const focus = b.focus ? row(table(`<tr>${td(`background:${C.focus};border-radius:22px;padding:34px 36px 36px;`, `
      <p style="margin:0 0 12px;font-family:${FONT};font-size:12px;line-height:16px;letter-spacing:1.4px;text-transform:uppercase;font-weight:600;color:#D7D2FF;">One thing to focus on today</p>
      <p class="focus-text" style="margin:0;font-family:${FONT};font-size:28px;line-height:34px;letter-spacing:-0.8px;font-weight:500;color:#FFFFFF;">${esc(b.focus.text)}</p>
      <p style="margin:12px 0 0;font-family:${FONT};font-size:16px;line-height:24px;font-weight:300;color:#E6E2FF;">${esc(b.focus.why)} <span style="font-weight:500;color:#FFFFFF;">${esc(b.focus.projectName)}.</span></p>
      ${b.focus.href ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;"><tr><td style="border-radius:999px;background:#FFFFFF;"><a href="${esc(b.focus.href)}" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:${C.focus};text-decoration:none;border-radius:999px;">Open in Cereal</a></td></tr></table>` : ''}`, 'class="focus"')}</tr>`), '20px 32px 8px') : '';
  const n = projectCount ?? b.projects.length;
  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  body,table,td,p,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
  table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
  a{text-decoration:none;}
  @media (max-width:620px){
    .container{width:100% !important;}
    .px{padding-left:24px !important;padding-right:24px !important;}
    .h1{font-size:34px !important;line-height:38px !important;}
    .lede{font-size:18px !important;line-height:27px !important;}
    .focus-text{font-size:23px !important;line-height:29px !important;}
  }
  @media (prefers-color-scheme:dark){
    .bg{background:#121116 !important;}
    .ink{color:#EDEBF3 !important;}
    .ink a{color:#EDEBF3 !important;}
    .ink2,.ink2 a{color:#C9C6D2 !important;}
    .quiet{color:#8E8A99 !important;}
    .rule{border-color:#2A2830 !important;}
    .focus{background:#4A3CC4 !important;}
    ${darkProjects}
  }
  [data-ogsc] .bg{background:#121116 !important;}
  [data-ogsc] .ink,[data-ogsc] .ink a{color:#EDEBF3 !important;}
  [data-ogsc] .ink2{color:#C9C6D2 !important;}
  [data-ogsc] .quiet{color:#8E8A99 !important;}
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:${C.paper};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.paper};">${esc(preheader)}${'&#8202;&zwnj;'.repeat(60)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg" style="background:${C.paper};">
<tr><td align="center" style="padding:24px 0 40px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
  ${row(table(`<tr>
    ${td('vertical-align:middle;', `<span class="ink" style="font-family:${FONT};font-size:26px;line-height:30px;letter-spacing:-1px;font-weight:600;color:${C.ink};"><span style="display:inline-block;width:11px;height:11px;border:3.5px solid ${C.cereal};border-radius:50%;vertical-align:1px;margin-right:7px;"></span>cereal<span style="color:${C.cereal};">.</span></span>`)}
    ${td(`vertical-align:middle;text-align:right;font-size:14px;line-height:20px;color:${C.quiet};`, `<span class="quiet">${esc(b.dateLabel)}</span>`, 'align="right"')}
  </tr>`), '16px 48px 18px')}
  ${row(`<div class="rule" style="border-top:1px solid ${C.rule};height:1px;line-height:1px;font-size:1px;">&nbsp;</div>`)}
  ${row(`<p style="margin:0 0 14px;font-family:${FONT};font-size:12px;line-height:16px;letter-spacing:1.4px;text-transform:uppercase;font-weight:600;color:${C.cereal};">Your morning read</p>
    <h1 class="ink h1" style="margin:0;font-family:${FONT};font-size:42px;line-height:46px;letter-spacing:-1.4px;font-weight:500;color:${C.ink};">${esc(b.headline)}</h1>
    <p class="ink2 lede" style="margin:18px 0 0;font-family:${FONT};font-size:20px;line-height:30px;letter-spacing:-0.2px;font-weight:300;color:${C.ink2};">${esc(b.overview)}</p>`, '40px 48px 40px')}
  ${row(`<p class="quiet" style="margin:0;font-family:${FONT};font-size:12px;line-height:16px;letter-spacing:1.4px;text-transform:uppercase;font-weight:600;color:${C.quiet};">Your projects</p>`, '0 48px 14px')}
  ${b.projects.map(projectBlock).join('')}
  ${attention}
  ${focus}
  ${row(`<p class="ink" style="margin:0;font-family:${FONT};font-size:17px;line-height:24px;letter-spacing:-0.3px;font-weight:500;color:${C.ink};">Made for people making things.</p>
    <p class="quiet" style="margin:10px 0 0;font-family:${FONT};font-size:13px;line-height:20px;color:${C.quiet};">${[['Manage briefing', links.manage], ['Pause emails', links.pause], ['Unsubscribe', links.unsubscribe]].map(([t, h]) => (h ? `<a href="${esc(h)}" style="color:${C.quiet};text-decoration:underline;">${t}</a>` : t)).join(' &nbsp;·&nbsp; ')}</p>
    <p class="quiet" style="margin:14px 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.quiet};">Cereal wrote this on your Mac from the ${n === 1 ? 'one project' : `${n} projects`} you chose. It carries titles and short summaries only: never files, document text, agent conversations or secrets.${b.newsCount ? ' Headlines come from public news searches for the topics you chose; only those words were sent.' : ''} It was delivered through ${esc(provider)}.</p>`, '44px 48px 0')}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`;
  return { subject, preheader, html, text: renderText(b, links) };
}

/** The plain-text part, for clients and readers that prefer it. */
export function renderText(b, links = {}) {
  const out = ['cereal.', b.dateLabel, '', b.headline, '', b.overview, '', 'YOUR PROJECTS', ''];
  for (const p of b.projects) {
    out.push(p.name.toUpperCase(), '');
    out.push('What changed');
    if (p.changed.length) for (const c of p.changed) out.push(`- [${(STATUS[c.status] || STATUS.doc)[0]}] ${c.text}`);
    else out.push('- Nothing new.');
    if (p.leftOff) out.push('', 'Where you left off', p.leftOff.text);
    if (p.news?.length) { out.push('', 'In the news'); for (const n of p.news) out.push(`- ${n.title} (${[n.source, n.when].filter(Boolean).join(', ')}; about ${n.topic}) ${n.url}`); }
    if (p.next) out.push('', 'Your next move', p.next.text + (p.next.href ? ` ${p.next.href}` : ''));
    out.push('');
  }
  if (b.attention.length) { out.push('NEEDS YOUR ATTENTION'); for (const a of b.attention) out.push(`- ${a.text} (${a.projectName})`); out.push(''); }
  if (b.focus) out.push('ONE THING TO FOCUS ON TODAY', b.focus.text, `${b.focus.why} ${b.focus.projectName}.`, '');
  out.push('Made for people making things.');
  if (links.manage) out.push(`Manage briefing: ${links.manage}`);
  if (links.pause) out.push(`Pause emails: ${links.pause}`);
  if (links.unsubscribe) out.push(`Unsubscribe: ${links.unsubscribe}`);
  return out.join('\n');
}
