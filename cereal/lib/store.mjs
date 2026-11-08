import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './paths.mjs';

// One JSON document in Cereal's own data directory. Writes are atomic (temp file + rename)
// and debounced, so context survives restarts and a crash mid-write cannot corrupt it.
export class Store {
  constructor(dir = dataDir()) {
    this.dir = dir;
    this.file = path.join(dir, 'cereal.json');
    this.agentFile = path.join(dir, 'agent-cache.json');
    fs.mkdirSync(dir, { recursive: true });
    this.data = this.#read(this.file, { version: 1, projects: {}, notifications: [], ui: {} });
    this.agentCache = this.#read(this.agentFile, {});
    this.timer = null;
  }

  #read(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
  }

  project(id) {
    if (!this.data.projects[id]) this.data.projects[id] = { id, sources: [], discovery: null, index: null, agents: [], workspace: {}, visits: [], lastVisitAt: null, known: {} };
    return this.data.projects[id];
  }

  save({ now = false } = {}) {
    clearTimeout(this.timer);
    if (now) return this.flush();
    this.timer = setTimeout(() => this.flush(), 250);
  }

  flush() {
    clearTimeout(this.timer);
    this.#write(this.file, this.data);
    this.#write(this.agentFile, this.agentCache);
  }

  #write(file, obj) {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, file);
  }
}
