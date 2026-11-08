import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpDir } from './helpers.mjs';
import { heroFromRepo } from '../lib/hero.mjs';
import { imageSize } from '../lib/images.mjs';

// A PNG header is enough for Cereal to size an image; it never decodes pixels.
const png = (w, h) => { const b = Buffer.alloc(64); b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const DAY = 864e5;

function repoWithHistory() {
  const root = tmpDir('hero');
  const repo = path.join(root, 'field-notes');
  const git = (args, daysAgo = 0) => {
    const d = new Date(Date.now() - daysAgo * DAY).toISOString();
    execFileSync('git', ['-C', repo, ...args], { env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@e', GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d } });
  };
  const add = (files, msg, daysAgo) => { for (const [f, buf] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), buf); } git(['add', '-A'], daysAgo); git(['commit', '-q', '-m', msg], daysAgo); };
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  add({ 'README.md': '# Field Notes\n', 'App/Assets.xcassets/AppIcon.appiconset/AppIcon.png': png(1024, 1024) }, 'Start', 30);
  add({ 'docs/screenshots/onboarding.png': png(1290, 2796) }, 'Onboarding screenshot', 20);
  add({ 'design/mockups/home.png': png(2400, 1500) }, 'Home mockup', 10);
  add({ 'tests/__snapshots__/home.png': png(2400, 1500), 'public/badge.png': png(120, 40), 'brand/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"/>' }, 'Snapshots and badge', 2);
  return { repo, add };
}

test('image sizes come from file headers', () => {
  assert.deepEqual(imageSize(png(1290, 2796), 'png'), { w: 1290, h: 2796 });
  assert.deepEqual(imageSize(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"></svg>'), 'svg'), { w: 1600, h: 900 });
  assert.deepEqual(imageSize(Buffer.from('<svg viewBox="0 0 390 844" xmlns="http://www.w3.org/2000/svg"></svg>'), 'svg'), { w: 390, h: 844 });
});

test('the header is the latest product shot, never an icon, snapshot or badge, and it follows new commits', async () => {
  const { repo, add } = repoWithHistory();
  let hero = await heroFromRepo(repo, 's1');
  assert.equal(hero.layout, 'cover');
  assert.equal(hero.images[0].path, 'design/mockups/home.png');
  assert.equal(hero.subject, 'Home mockup');

  // A new release ships phone screenshots: the header becomes a set of devices, automatically.
  add({ 'release/app-store/1-today.png': png(1290, 2796), 'release/app-store/2-map.png': png(1290, 2796), 'release/app-store/3-export.png': png(1290, 2796), 'release/app-store/4-settings.png': png(1290, 2796) }, 'App Store screenshots for 1.2', 0);
  hero = await heroFromRepo(repo, 's1');
  assert.equal(hero.layout, 'devices');
  assert.equal(hero.images.length, 3, 'at most three devices');
  assert.ok(hero.images.every((i) => i.path.startsWith('release/app-store/')));
  assert.equal(hero.subject, 'App Store screenshots for 1.2');
});

test('the project icon is the real app icon before any logo', async () => {
  const { repo } = repoWithHistory();
  const root = path.dirname(repo);
  process.env.CEREAL_CLAUDE_DIR = path.join(root, 'none');
  process.env.CEREAL_CODEX_DIR = path.join(root, 'none');
  const { Store } = await import('../lib/store.mjs');
  const { Engine } = await import('../lib/engine.mjs');
  const engine = new Engine(new Store(path.join(root, 'data')), [{ id: 'fn', name: 'Field Notes', tagline: '', keyword: /field-notes/i, seeds: [root], markers: [], brand: { accent: '#3F7D5B' } }]);
  const disc = await engine.discover('fn');
  await engine.approve('fn', disc.candidates.map((c) => c.id));
  const cap = engine.capsule('fn');
  assert.match(cap.iconUrl, /^\/api\/projects\/fn\/icon\?v=AppIcon\.png/);
  assert.equal(cap.hero.layout, 'cover');
  const img = await engine.heroBytes('fn', 0);
  assert.equal(img.type, 'image/png');
  assert.deepEqual(imageSize(img.buf, 'png'), { w: 2400, h: 1500 }, 'bytes come straight from Git history');
  assert.equal(await engine.heroBytes('fn', 5), null);
});

test('a cover you choose stays until a newer product shot is committed', async () => {
  const { repo, add } = repoWithHistory();
  const root = path.dirname(repo);
  const cover = path.join(root, 'cover.png');
  fs.writeFileSync(cover, png(3200, 1700));
  process.env.CEREAL_CLAUDE_DIR = path.join(root, 'none');
  process.env.CEREAL_CODEX_DIR = path.join(root, 'none');
  const { Store } = await import('../lib/store.mjs');
  const { Engine } = await import('../lib/engine.mjs');
  const pinnedAt = new Date(Date.now() - 864e5).toISOString();
  const engine = new Engine(new Store(path.join(root, 'data')), [{ id: 'fn', name: 'Field Notes', tagline: '', keyword: /field-notes/i, seeds: [root], markers: [], brand: { accent: '#3F7D5B' }, cover: { file: cover, pinnedAt } }]);
  const disc = await engine.discover('fn');
  await engine.approve('fn', disc.candidates.map((c) => c.id));
  let hero = engine.capsule('fn').hero;
  assert.equal(hero.pinned, true, 'older product shots do not replace the chosen cover');
  assert.deepEqual(imageSize((await engine.heroBytes('fn', 0)).buf, 'png'), { w: 3200, h: 1700 });

  add({ 'release/press/hero-shot.png': png(2880, 1600) }, 'Press shot for launch', 0);
  await engine.index('fn');
  hero = engine.capsule('fn').hero;
  assert.equal(hero.pinned, false, 'a newer product shot takes over automatically');
  assert.equal(hero.subject, 'Press shot for launch');
});
