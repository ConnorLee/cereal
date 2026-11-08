import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './paths.mjs';

// Which projects to look for is personal, so it lives on this Mac, not in the code:
// CEREAL_PROJECTS_JSON, or <data dir>/projects.json (see projects.example.json).
// Every location in a definition is a place to *look*; what Cereal shows comes from Git metadata
// and files found there, after the user approves them.
const FALLBACK_BRAND = { surface: '#F3F1F8', ink: '#18161F', accent: '#6E5FE8', glow: '#D9D3FA', mode: 'light' };

export function projectsFile() {
  return path.join(dataDir(), 'projects.json');
}

function normalize(list) {
  return list.map((p) => ({
    ...p,
    tagline: p.tagline || '',
    keyword: p.keyword instanceof RegExp ? p.keyword : new RegExp(p.keyword || p.id, 'i'),
    seeds: p.seeds || [],
    markers: p.markers || [],
    brand: { ...FALLBACK_BRAND, ...(p.brand || {}) },
  }));
}

// New projects get a calm identity automatically; picking colours is a decision nobody needs to make on day one.
const PALETTE = [
  { surface: '#EEF2EE', ink: '#14201A', accent: '#3F7D5B', glow: '#CFE3D6', mode: 'light' },
  { surface: '#0E0D14', ink: '#F4F2FA', accent: '#F2A33A', glow: '#7A5CFF', mode: 'dark' },
  { surface: '#F3EFF8', ink: '#1C1626', accent: '#7B5BD6', glow: '#DCD2F5', mode: 'light' },
  { surface: '#F6F0EA', ink: '#231A12', accent: '#B4693A', glow: '#EBD8C6', mode: 'light' },
  { surface: '#0D1417', ink: '#EAF4F6', accent: '#3FB6C9', glow: '#2B6CB0', mode: 'dark' },
];

export function makeDefinition(name, folder, existing) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
  let id = base;
  for (let n = 2; existing.some((d) => d.id === id); n++) id = `${base}-${n}`;
  const words = String(name).trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return { id, name: String(name).trim(), tagline: '', keyword: words.join('[ _-]?'), seeds: [folder], markers: [], brand: PALETTE[existing.length % PALETTE.length] };
}

// Saved definitions keep keyword as a string so the file stays plain JSON.
export function saveDefinitions(defs) {
  if (process.env.CEREAL_PROJECTS_JSON) return false; // inline configuration is read-only
  const plain = defs.map(({ id, name, tagline, keyword, seeds, markers, brand }) => ({ id, name, tagline, keyword: keyword instanceof RegExp ? keyword.source : keyword, seeds, markers, brand }));
  fs.mkdirSync(path.dirname(projectsFile()), { recursive: true });
  const tmp = `${projectsFile()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(plain, null, 2) + '\n');
  fs.renameSync(tmp, projectsFile());
  return true;
}

export function normalizeOne(p) {
  return normalize([p])[0];
}

export function projectDefs() {
  if (process.env.CEREAL_PROJECTS_JSON) return normalize(JSON.parse(process.env.CEREAL_PROJECTS_JSON));
  try {
    return normalize(JSON.parse(fs.readFileSync(projectsFile(), 'utf8')));
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`Couldn’t read ${projectsFile()}: ${e.message}`);
    return [];
  }
}
