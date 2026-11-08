// One engine per data folder. Two (say, Cereal for Mac and a copy started in Terminal) would each save over
// the other's changes, so the second one stops with a clear message instead.
import fs from 'node:fs';
import path from 'node:path';

export const ALREADY_RUNNING = 3; // exit code Cereal for Mac recognises

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
// A recycled pid could look alive, so the holder must also still be answering as Cereal.
async function answering(port) {
  try { const r = await fetch(`http://127.0.0.1:${port}/api/state`, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; }
}

/** Claims the folder for this process. Returns null when claimed, or the running holder { pid, port, desktop }. */
export async function claimEngine(dir, { port, desktop = false } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'engine.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, port, desktop, at: new Date().toISOString() }), { flag: 'wx' });
      const release = () => { try { if (JSON.parse(fs.readFileSync(file, 'utf8')).pid === process.pid) fs.unlinkSync(file); } catch { /* already gone */ } };
      process.on('exit', release);
      return null;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let held = null;
      try { held = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* unreadable: treat as stale */ }
      if (held?.pid && held.pid !== process.pid && alive(held.pid) && (await answering(held.port))) return held;
      try { fs.unlinkSync(file); } catch { /* someone else cleaned it up */ }
    }
  }
  throw new Error(`Couldn’t claim ${file}`);
}
