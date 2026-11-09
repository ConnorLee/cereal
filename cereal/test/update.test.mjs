import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newerVersion, updateChecker } from '../lib/update.mjs';

test('a release counts as an update only when its version is newer', () => {
  assert.equal(newerVersion('0.1.3', 'v0.1.4'), '0.1.4');
  assert.equal(newerVersion('0.1.3', 'v0.2.0'), '0.2.0');
  assert.equal(newerVersion('0.1.9', 'v0.1.10'), '0.1.10', 'compared as numbers, not text');
  assert.equal(newerVersion('0.1.3', 'v0.1.3'), null);
  assert.equal(newerVersion('0.1.3', 'v0.1.2'), null);
  assert.equal(newerVersion('0.1.3', 'nightly'), null);
  assert.equal(newerVersion('0.1.3', undefined), null);
});

test('the check asks GitHub at most every six hours and survives a failed request', async () => {
  let calls = 0;
  let clock = 0;
  let answer = { ok: true, status: 200, json: async () => ({ tag_name: 'v0.1.4', html_url: 'https://github.com/ConnorLee/cereal/releases/tag/v0.1.4', assets: [{ name: 'Cereal.dmg', browser_download_url: 'https://example.com/Cereal.dmg' }] }) };
  const check = updateChecker({ current: '0.1.3', now: () => clock, fetchImpl: async (url, opts) => { calls++; assert.match(opts.headers['user-agent'], /^Cereal\/0\.1\.3$/); return answer; } });
  const [a, b] = await Promise.all([check(), check()]);
  assert.equal(calls, 1, 'simultaneous asks share one request');
  assert.deepEqual(a, b);
  assert.equal(a.latest, '0.1.4');
  assert.equal(a.download, 'https://example.com/Cereal.dmg');
  clock += 3600e3;
  await check();
  assert.equal(calls, 1, 'an hour later the answer is reused');
  clock += 6 * 3600e3;
  answer = { ok: false, status: 503 };
  const failed = await check();
  assert.equal(calls, 2);
  assert.equal(failed.latest, null);
  assert.match(failed.error, /503/);
});
