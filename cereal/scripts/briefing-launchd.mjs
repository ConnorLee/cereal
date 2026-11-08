// The dependable scheduler for the morning briefing on a Mac: a launchd agent that runs briefing-run.mjs
// every ten minutes and when you log in. launchd keeps running while Cereal is closed and catches up after
// sleep; the delivery window makes repeated runs harmless.
//
//   npm run briefing:launchd              print the agent definition (changes nothing)
//   npm run briefing:launchd -- --install write it to ~/Library/LaunchAgents and load it
//   npm run briefing:launchd -- --remove  unload and delete it
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dataDir } from '../lib/paths.mjs';

const LABEL = 'app.cereal.briefing';
const here = path.dirname(fileURLToPath(import.meta.url));
const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const log = path.join(dataDir(), 'briefing.log');
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(CEREAL_|RESEND_API_KEY$|PORT$)/.test(k)));
const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${x(process.execPath)}</string><string>${x(path.join(here, 'briefing-run.mjs'))}</string></array>
  <key>StartInterval</key><integer>600</integer>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key><dict>${Object.entries(env).map(([k, v]) => `<key>${x(k)}</key><string>${x(v)}</string>`).join('')}</dict>
  <key>StandardOutPath</key><string>${x(log)}</string>
  <key>StandardErrorPath</key><string>${x(log)}</string>
</dict></plist>
`;

const uid = process.getuid();
if (process.argv.includes('--install')) {
  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  fs.writeFileSync(plistPath, plist);
  try { execFileSync('launchctl', ['bootout', `gui/${uid}`, plistPath], { stdio: 'ignore' }); } catch { /* not loaded yet */ }
  execFileSync('launchctl', ['bootstrap', `gui/${uid}`, plistPath]);
  console.log(`Installed ${plistPath}. Log: ${log}`);
} else if (process.argv.includes('--remove')) {
  try { execFileSync('launchctl', ['bootout', `gui/${uid}`, plistPath], { stdio: 'ignore' }); } catch { /* not loaded */ }
  fs.rmSync(plistPath, { force: true });
  console.log(`Removed ${plistPath}`);
} else {
  process.stdout.write(plist);
  console.error(`\nNothing was installed. Run with --install to write ${plistPath} and load it.`);
}
