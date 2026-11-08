import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tmpDir } from './helpers.mjs';
import { claimEngine } from '../lib/engine-lock.mjs';

const lockOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'engine.lock'), 'utf8'));
const write = (dir, held) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'engine.lock'), JSON.stringify(held)); };
const listen = (handler) => new Promise((resolve) => { const s = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(s)); });
const sleeper = () => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)'], { stdio: 'ignore' });

test('the first engine claims its data folder', async () => {
  const dir = tmpDir();
  assert.equal(await claimEngine(dir, { port: 4999 }), null);
  assert.equal(lockOf(dir).pid, process.pid);
});

test('a lock left by an engine that died is taken over', async () => {
  const dir = tmpDir();
  write(dir, { pid: 2147480000, port: 4999 });
  assert.equal(await claimEngine(dir, { port: 4998 }), null);
  assert.equal(lockOf(dir).pid, process.pid);
});

test('a second engine on the same data is refused while the first is running', async () => {
  const dir = tmpDir();
  const other = sleeper();
  const server = await listen((req, res) => { res.writeHead(req.url === '/api/state' ? 200 : 404); res.end('{}'); });
  try {
    write(dir, { pid: other.pid, port: server.address().port, desktop: true });
    const held = await claimEngine(dir, { port: 4997 });
    assert.equal(held?.pid, other.pid);
    assert.equal(held.desktop, true);
    assert.equal(lockOf(dir).pid, other.pid, 'the running engine keeps its lock');
  } finally { other.kill(); server.close(); }
});

test('a recycled pid that is not answering as Cereal does not block', async () => {
  const dir = tmpDir();
  const other = sleeper();
  try {
    write(dir, { pid: other.pid, port: 9 });
    assert.equal(await claimEngine(dir, { port: 4996 }), null);
  } finally { other.kill(); }
});
