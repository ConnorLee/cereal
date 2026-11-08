// Package the runnable app for the public site: cereal/demo/Cereal.zip
// The zip holds only source files — no data folder, no demo, no tests, no user state.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CEREAL = path.dirname(HERE);
const OUT = path.join(CEREAL, 'demo');
const ZIP = path.join(OUT, 'Cereal.zip');

const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'cereal-pack-'));
const app = path.join(stage, 'Cereal');
fs.mkdirSync(app, { recursive: true });

const copy = (rel, to = rel) => {
  const from = path.join(CEREAL, rel);
  const dest = path.join(app, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(from, dest, { recursive: true, dereference: true });
};

for (const f of ['server.mjs', 'package.json', 'README.md', 'projects.example.json']) copy(f);
copy('lib');
copy('public');
for (const f of ['start-cereal.command', 'briefing-run.mjs', 'briefing-launchd.mjs']) copy(path.join('scripts', f), path.join('scripts', f));

// Double-clickable launcher. Terminal is where macOS already allows reading Documents and Desktop.
const launcher = `#!/bin/sh
# Cereal — a local-first workspace for juggling projects.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "Cereal needs Node.js 22 or newer."
  echo "Install it from https://nodejs.org (the LTS installer), then open this file again."
  echo ""
  printf "Press return to close."; read -r _
  exit 1
fi
if ! node -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)'; then
  echo "Cereal needs Node.js 22 or newer. You have $(node -v). Update from https://nodejs.org."
  printf "Press return to close."; read -r _
  exit 1
fi
echo "Starting Cereal at http://127.0.0.1:4317 — close this window to stop it."
( sleep 1; open http://127.0.0.1:4317 ) >/dev/null 2>&1 &
exec node server.mjs
`;
fs.writeFileSync(path.join(app, 'Start Cereal.command'), launcher, { mode: 0o755 });
fs.chmodSync(path.join(app, 'Start Cereal.command'), 0o755);

fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(ZIP, { force: true });
// ditto keeps the executable bit and is the macOS-native way to make a portable zip.
execFileSync('ditto', ['-c', '-k', '--keepParent', app, ZIP]);
fs.rmSync(stage, { recursive: true, force: true });

const size = fs.statSync(ZIP).size;
console.log(`Packaged ${path.relative(CEREAL, ZIP)} (${(size / 1024).toFixed(0)} KB)`);
