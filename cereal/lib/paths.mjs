import os from 'node:os';
import path from 'node:path';

export const HOME = os.homedir();

export function expandHome(p) {
  if (!p) return p;
  if (p === '~') return HOME;
  if (p.startsWith('~/')) return path.join(HOME, p.slice(2));
  return p;
}

export function tildify(p) {
  if (!p) return p;
  return p.startsWith(HOME + '/') ? '~' + p.slice(HOME.length) : p;
}

// Everything Cereal writes lives here, never inside a project folder.
export function dataDir() {
  return process.env.CEREAL_DATA_DIR
    ? expandHome(process.env.CEREAL_DATA_DIR)
    : path.join(HOME, 'Library', 'Application Support', 'Cereal');
}

export function claudeProjectsDir() {
  return expandHome(process.env.CEREAL_CLAUDE_DIR || '~/.claude/projects');
}

export function codexSessionsDir() {
  return expandHome(process.env.CEREAL_CODEX_DIR || '~/.codex/sessions');
}

export function codexIndexFile() {
  return path.join(path.dirname(codexSessionsDir()), 'session_index.jsonl');
}

export function isInside(child, parent) {
  if (!child || !parent) return false;
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
