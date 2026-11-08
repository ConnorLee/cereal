import fs from 'node:fs/promises';
import path from 'node:path';
import { recentImageCommits, blob } from './git.mjs';
import { imageSize } from './images.mjs';
import { isSecretPath, IGNORED_DIRS } from './safety.mjs';

// The header image is the latest product someone committed: a screenshot, mockup or store shot.
// Icons, logos, test snapshots and build output are never chosen. It updates whenever the index does.
const PRODUCT = /screenshot|screen[-_ ]?shot|screens?\/|mockup|mock-up|preview|hero|app[-_ ]?store|store[-_ ]?listing|marketing|showcase|evidence|capture|og[-_]?image|social|release|promo|frame|shot|demo/i;
const NEVER = /(^|[/_.-])(icon|icons|favicon|logo|logos|mark|avatar|sprite|badge|emoji|glyph|cursor|thumb|placeholder|spinner|loader|bg-pattern)([/_.-]|\d|$)|appiconset|\.xcassets\/|__snapshots__|snapshots?\/|baseline|diff[-_]|fixtures?\/|test[-_]?results|playwright-report|\/coverage\//i;
const DAY = 864e5;

function usable(p) {
  if (isSecretPath(p) || NEVER.test(p)) return false;
  return !p.split('/').some((seg) => IGNORED_DIRS.has(seg));
}

function shape({ w, h }) {
  if (Math.min(w, h) < 500 || Math.max(w, h) < 900) return null; // too small to be a product shot
  const r = h / w;
  if (r > 1.3 && r < 2.4) return 'portrait';
  if (r <= 1.3 && r > 0.35) return 'landscape';
  return null;
}

/** Pick the header for one repository from its recent image commits. */
export async function heroFromRepo(repoPath, sourceId, { since } = {}) {
  const hits = (await recentImageCommits(repoPath, since ? { since } : {})).filter((h) => usable(h.path));
  if (!hits.length) return null;
  // Product-named files first, then anything else, each newest first; one entry per path.
  const seen = new Set();
  const ordered = [...hits.filter((h) => PRODUCT.test(h.path)), ...hits.filter((h) => !PRODUCT.test(h.path))]
    .filter((h) => (seen.has(h.path) ? false : seen.add(h.path)));
  const checked = [];
  for (const h of ordered.slice(0, 40)) {
    const buf = await blob(repoPath, h.sha, h.path);
    const size = buf && imageSize(buf, path.extname(h.path).slice(1));
    const kind = size && shape(size);
    if (kind) checked.push({ ...h, ...size, kind, ext: path.extname(h.path).slice(1).toLowerCase(), product: PRODUCT.test(h.path) });
    if (checked.length >= 8) break;
  }
  if (!checked.length) return null;
  const lead = checked.find((c) => c.product) || checked[0];
  const image = (c) => ({ sha: c.sha, path: c.path, w: c.w, h: c.h, ext: c.ext });
  if (lead.kind === 'portrait') {
    // Phone screenshots read best as a small set of devices from the same moment.
    const set = checked.filter((c) => c.kind === 'portrait' && c.product === lead.product && Math.abs(Date.parse(c.date) - Date.parse(lead.date)) < 21 * DAY).slice(0, 3);
    return { layout: 'devices', images: set.map(image), at: lead.date, subject: lead.subject, repo: repoPath, sourceId };
  }
  return { layout: 'cover', images: [image(lead)], at: lead.date, subject: lead.subject, repo: repoPath, sourceId };
}

/** Fallback for projects without Git imagery: the newest product-like image in an approved folder. */
export async function heroFromReferences(references) {
  const imgs = references.filter((r) => /^(png|jpe?g|webp)$/.test(r.kind) && usable(r.rel)).sort((a, b) => b.mtime.localeCompare(a.mtime));
  for (const r of imgs.slice(0, 12)) {
    let buf;
    try { const fh = await fs.open(r.path, 'r'); buf = Buffer.alloc(64 * 1024); await fh.read(buf, 0, buf.length, 0); await fh.close(); } catch { continue; }
    const size = imageSize(buf, r.kind);
    const kind = size && shape(size);
    if (!kind) continue;
    return { layout: kind === 'portrait' ? 'devices' : 'cover', images: [{ file: r.path, w: size.w, h: size.h, ext: r.kind }], at: r.mtime, subject: r.rel, sourceId: r.sourceId };
  }
  return null;
}
