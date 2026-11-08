import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from './helpers.mjs';
import { saveMailConfig, readMailConfig, clearMailConfig, mailerFor, maskKey } from '../lib/briefing-delivery.mjs';

const KEY = 're_abc123def456ghi789';

test('a Resend key saved in the app is used, kept private, and never shown in full', () => {
  const dir = tmpDir('mail-config');
  const saved = saveMailConfig(dir, { key: KEY, from: 'Cereal <briefing@northwind.example>' });
  assert.equal(saved.from, 'Cereal <briefing@northwind.example>');
  assert.equal(saved.keyHint, maskKey(KEY));
  assert.ok(!saved.keyHint.includes('abc123'), 'the hint keeps only the last four characters');

  const file = path.join(dir, 'mail.json');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'only the user can read the key');
  assert.equal(readMailConfig(dir).key, KEY);

  const mailer = mailerFor({}, dir);
  assert.equal(mailer.name, 'resend');
  assert.equal(mailer.label, 'Resend');
  assert.equal(mailer.external, true);
  assert.equal(mailer.managedBy, 'app');
  assert.equal(mailer.from, 'Cereal <briefing@northwind.example>');
  assert.ok(!JSON.stringify(mailer).includes(KEY), 'the key is not copied into status objects');
});

test('environment variables win over a saved key, and a bare sending address is accepted', () => {
  const dir = tmpDir('mail-config-env');
  saveMailConfig(dir, { key: KEY, from: 'briefing@cereal.example' });
  const mailer = mailerFor({ CEREAL_MAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_fromenv12345678', CEREAL_MAIL_FROM: 'hello@cereal.example' }, dir);
  assert.equal(mailer.managedBy, 'env');
  assert.equal(mailer.from, 'hello@cereal.example');
});

test('a bad key or sending address is refused, and removing the provider falls back to the outbox', () => {
  const dir = tmpDir('mail-config-bad');
  assert.throws(() => saveMailConfig(dir, { key: 'sk-not-resend', from: 'a@b.co' }), /Resend API key/);
  assert.throws(() => saveMailConfig(dir, { key: KEY, from: 'not an address' }), /sending address/);
  assert.equal(readMailConfig(dir), null);

  saveMailConfig(dir, { key: KEY, from: 'a@b.co' });
  clearMailConfig(dir);
  assert.equal(readMailConfig(dir), null);
  const mailer = mailerFor({}, dir);
  assert.equal(mailer.name, 'outbox');
  assert.equal(mailer.external, false);
});
