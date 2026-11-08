// Cereal's component kit: shadcn/ui's anatomy and names (Tabs, Card, Badge, Accordion, Table, Sheet),
// ported to plain template functions so Cereal stays dependency-free and works as static files.
// Markup mirrors shadcn's data-slot / data-state conventions; ui.css carries the matching styles.
// Icons are drawn after Lucide (ISC), the set shadcn uses.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cx = (...c) => c.filter(Boolean).join(' ');

const ICONS = {
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  commit: '<circle cx="12" cy="12" r="3"/><path d="M3 12h6"/><path d="M15 12h6"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  branch: '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  list: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  finder: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
};
export const Icon = (name, cls = '') => `<svg class="${cx('ui-icon', cls)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

/** Badge: default (project colour), secondary, outline, success, warning, destructive. */
export const Badge = (html, { variant = 'secondary', title, cls } = {}) =>
  `<span data-slot="badge" class="${cx('ui-badge', `ui-badge-${variant}`, cls)}"${title ? ` title="${esc(title)}"` : ''}>${html}</span>`;

/** Card with optional header (title, description, action), content and footer. */
export function Card({ title, description, action, body = '', footer, cls, attrs = '' } = {}) {
  const header = title || description || action
    ? `<div data-slot="card-header" class="ui-card-header${action ? ' has-action' : ''}">${title ? `<div data-slot="card-title" class="ui-card-title">${title}</div>` : ''}${description ? `<div data-slot="card-description" class="ui-card-description">${description}</div>` : ''}${action ? `<div data-slot="card-action" class="ui-card-action">${action}</div>` : ''}</div>`
    : '';
  return `<div data-slot="card" class="${cx('ui-card', cls)}" ${attrs}>${header}${body ? `<div data-slot="card-content" class="ui-card-content">${body}</div>` : ''}${footer ? `<div data-slot="card-footer" class="ui-card-footer">${footer}</div>` : ''}</div>`;
}

/** Description list for label/value rows inside a card. */
export const Fields = (rows) => `<dl class="ui-fields">${rows.filter(Boolean).map(([k, v]) => `<div class="ui-field"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;

/**
 * Tabs: a list of triggers and one panel per item. Switching happens in the browser (see bindTabs);
 * items: [{ value, label, count, panel }]. Only the active panel is visible.
 */
export function Tabs({ id, value, items, cls }) {
  const active = items.some((i) => i.value === value) ? value : items[0]?.value;
  const list = items.map((i) => `<button type="button" role="tab" class="ui-tabs-trigger" data-ui-tab="${esc(i.value)}" id="${id}-t-${esc(i.value)}" aria-controls="${id}-p-${esc(i.value)}" aria-selected="${i.value === active}"${i.ariaLabel ? ` aria-label="${esc(i.ariaLabel)}"` : ''} data-state="${i.value === active ? 'active' : 'inactive'}" tabindex="${i.value === active ? 0 : -1}">${i.label}${i.count != null ? `<span class="ui-tabs-count">${i.count}</span>` : ''}</button>`).join('');
  const panels = items.map((i) => `<div role="tabpanel" class="ui-tabs-content" id="${id}-p-${esc(i.value)}" aria-labelledby="${id}-t-${esc(i.value)}" data-ui-panel="${esc(i.value)}" data-state="${i.value === active ? 'active' : 'inactive'}"${i.value === active ? '' : ' hidden'}>${i.panel ?? ''}</div>`).join('');
  return `<div data-slot="tabs" class="${cx('ui-tabs', cls)}" id="${id}"><div role="tablist" class="ui-tabs-list">${list}</div>${panels}</div>`;
}

/** Make one trigger active within its Tabs. Returns the panel that is now showing. */
export function selectTab(trigger) {
  const root = trigger.closest('.ui-tabs');
  if (!root) return null;
  const value = trigger.dataset.uiTab;
  for (const t of root.querySelectorAll(':scope > .ui-tabs-list > .ui-tabs-trigger')) {
    const on = t === trigger;
    t.setAttribute('aria-selected', String(on));
    t.dataset.state = on ? 'active' : 'inactive';
    t.tabIndex = on ? 0 : -1;
  }
  let shown = null;
  for (const p of root.querySelectorAll(':scope > .ui-tabs-content')) {
    const on = p.dataset.uiPanel === value;
    p.hidden = !on;
    p.dataset.state = on ? 'active' : 'inactive';
    if (on) shown = p;
  }
  return shown;
}

/** Click and arrow-key behaviour for every Tabs on the page, as Radix Tabs does it (automatic activation). */
export function bindTabs(doc = document) {
  doc.addEventListener('click', (ev) => {
    const t = ev.target.closest?.('.ui-tabs-trigger[data-ui-tab]');
    if (t) selectTab(t);
  });
  doc.addEventListener('keydown', (ev) => {
    const t = ev.target.closest?.('.ui-tabs-trigger');
    if (!t || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) return;
    const all = [...t.parentElement.querySelectorAll('.ui-tabs-trigger')];
    const i = all.indexOf(t);
    const next = ev.key === 'Home' ? all[0] : ev.key === 'End' ? all.at(-1) : all[(i + (ev.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length];
    ev.preventDefault();
    next.focus();
    next.click();
  });
}

/** Accordion built on <details>, so it works without script and keeps its state in the DOM. */
export const AccordionItem = ({ title, meta = '', body, open = false, cls, attrs = '' }) =>
  `<details data-slot="accordion-item" class="${cx('ui-accordion-item', cls)}"${open ? ' open' : ''} ${attrs}><summary class="ui-accordion-trigger"><span class="ui-accordion-title">${title}</span>${meta ? `<span class="ui-accordion-meta">${meta}</span>` : ''}${Icon('chevron-down', 'ui-accordion-chevron')}</summary><div class="ui-accordion-content">${body}</div></details>`;
export const Accordion = (items, cls) => `<div data-slot="accordion" class="${cx('ui-accordion', cls)}">${items.join('')}</div>`;

/** Table: head is a list of header cells, rows are pre-rendered <tr> strings. */
export const Table = ({ head, rows, cls }) => `<div class="ui-table-wrap"><table class="${cx('ui-table', cls)}"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;

export const Separator = () => '<div data-slot="separator" role="none" class="ui-separator"></div>';

/** Sheet header: eyebrow (icon, kind, project), title, description, close button. */
export const SheetHeader = ({ icon, kind, project = '', close = 'data-act="close-drawer"' }) =>
  `<div data-slot="sheet-header" class="ui-sheet-header dr-head"><span class="ui-sheet-eyebrow">${icon ? Icon(icon) : ''}<span class="dr-kind">${esc(kind)}</span>${project}</span><button type="button" class="ui-button ui-button-ghost ui-button-icon dr-close" ${close} aria-label="Close">${Icon('x')}</button></div>`;

/** A row of stat tiles: [[value, label], …]. */
export const Stats = (items) => `<div class="ui-stats">${items.map(([v, l]) => `<div class="ui-stat"><span class="ui-stat-value">${v}</span><span class="ui-stat-label">${l}</span></div>`).join('')}</div>`;
