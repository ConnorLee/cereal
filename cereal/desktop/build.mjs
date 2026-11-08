// Build Cereal.app and Cereal.dmg: the native window, Cereal's server and a bundled Node runtime.
//
//   npm run desktop                    builds desktop/dist/Cereal.app and desktop/dist/Cereal.dmg
//   NODE_BIN=/path/to/node npm run desktop   bundle a specific Node 22+ binary (default: the one running this)
//
// Needs Xcode's command-line tools (swiftc). The app is signed ad hoc: without a Developer ID it isn't
// notarized, so the first launch is right-click → Open. Set CODESIGN_IDENTITY to sign with your own.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CEREAL = path.dirname(HERE);
const DIST = path.join(HERE, 'dist');
const APP = path.join(DIST, 'Cereal.app');
const C = path.join(APP, 'Contents');
const pkg = JSON.parse(fs.readFileSync(path.join(CEREAL, 'package.json'), 'utf8'));
const VERSION = pkg.version;
const NODE = process.env.NODE_BIN || process.execPath;
const IDENTITY = process.env.CODESIGN_IDENTITY || '-';
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], ...opts }).toString();

const nodeMajor = Number(run(NODE, ['-p', 'process.versions.node']).trim().split('.')[0]);
if (nodeMajor < 22) throw new Error(`Cereal needs Node 22 or newer to bundle; ${NODE} is ${nodeMajor}.`);
const arch = run('lipo', ['-archs', NODE]).trim();

fs.rmSync(DIST, { recursive: true, force: true });
for (const d of ['MacOS', 'Resources/app', 'Resources/node']) fs.mkdirSync(path.join(C, d), { recursive: true });

// 1. The native app.
run('xcrun', ['swiftc', '-O', '-target', `${arch.includes('arm64') ? 'arm64' : 'x86_64'}-apple-macos13.0`, '-o', path.join(C, 'MacOS', 'Cereal'), path.join(HERE, 'Cereal.swift'), '-framework', 'AppKit', '-framework', 'WebKit', '-framework', 'ServiceManagement']);

// 2. Info.plist: folders can be dropped on the Dock icon; protected-folder prompts say why Cereal asks.
const why = 'Cereal reads the project folders you give it, so it can tell you where you left off. It never changes them.';
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Cereal</string>
  <key>CFBundleDisplayName</key><string>Cereal</string>
  <key>CFBundleIdentifier</key><string>app.cereal.desktop</string>
  <key>CFBundleExecutable</key><string>Cereal</string>
  <key>CFBundleIconFile</key><string>Cereal</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>Made for people making things.</string>
  <key>CFBundleDocumentTypes</key><array><dict>
    <key>CFBundleTypeName</key><string>Project folder</string>
    <key>CFBundleTypeRole</key><string>Viewer</string>
    <key>LSHandlerRank</key><string>Alternate</string>
    <key>LSItemContentTypes</key><array><string>public.folder</string><string>public.directory</string></array>
  </dict></array>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
  <key>NSDocumentsFolderUsageDescription</key><string>${why}</string>
  <key>NSDesktopFolderUsageDescription</key><string>${why}</string>
  <key>NSDownloadsFolderUsageDescription</key><string>${why}</string>
  <key>NSRemovableVolumesUsageDescription</key><string>${why}</string>
  <key>NSNetworkVolumesUsageDescription</key><string>${why}</string>
</dict></plist>
`;
fs.writeFileSync(path.join(C, 'Info.plist'), plist);

// 3. Cereal itself: the same source files as the download, no data, demo or tests.
const appDir = path.join(C, 'Resources', 'app');
for (const f of ['server.mjs', 'package.json', 'README.md', 'projects.example.json']) fs.copyFileSync(path.join(CEREAL, f), path.join(appDir, f));
for (const d of ['lib', 'public']) fs.cpSync(path.join(CEREAL, d), path.join(appDir, d), { recursive: true });
fs.mkdirSync(path.join(appDir, 'scripts'));
for (const f of ['briefing-run.mjs', 'briefing-launchd.mjs']) fs.copyFileSync(path.join(CEREAL, 'scripts', f), path.join(appDir, 'scripts', f));

// 4. Node, with its licence.
fs.copyFileSync(NODE, path.join(C, 'Resources', 'node', 'node'));
fs.chmodSync(path.join(C, 'Resources', 'node', 'node'), 0o755);
const nodeLicense = path.join(path.dirname(path.dirname(NODE)), 'LICENSE');
if (fs.existsSync(nodeLicense)) fs.copyFileSync(nodeLicense, path.join(C, 'Resources', 'node', 'LICENSE'));

// 5. The icon, from the cereal-box emblem.
const iconset = path.join(os.tmpdir(), `cereal-${process.pid}.iconset`);
fs.rmSync(iconset, { recursive: true, force: true });
fs.mkdirSync(iconset);
const src = path.join(CEREAL, 'public', 'brand', 'cereal-icon-512.png');
for (const s of [16, 32, 128, 256, 512]) {
  run('sips', ['-z', String(s), String(s), src, '--out', path.join(iconset, `icon_${s}x${s}.png`)]);
  run('sips', ['-z', String(s * 2), String(s * 2), src, '--out', path.join(iconset, `icon_${s}x${s}@2x.png`)]);
}
run('iconutil', ['-c', 'icns', iconset, '-o', path.join(C, 'Resources', 'Cereal.icns')]);
fs.rmSync(iconset, { recursive: true, force: true });

// 6. Sign: Node first, then the app around it.
run('codesign', ['--force', '--sign', IDENTITY, path.join(C, 'Resources', 'node', 'node')]);
run('codesign', ['--force', '--sign', IDENTITY, APP]);
run('codesign', ['--verify', '--strict', APP]);

// 7. A disk image with the app and a shortcut to Applications, so installing is one drag.
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'cereal-dmg-'));
run('ditto', [APP, path.join(stage, 'Cereal.app')]);
fs.symlinkSync('/Applications', path.join(stage, 'Applications'));
run('hdiutil', ['create', '-volname', 'Cereal', '-srcfolder', stage, '-ov', '-format', 'UDZO', '-quiet', path.join(DIST, 'Cereal.dmg')]);
fs.rmSync(stage, { recursive: true, force: true });

const size = (p) => `${(Number(run('du', ['-sk', p]).split('\t')[0]) / 1024).toFixed(0)} MB`;
console.log(`Built ${path.relative(CEREAL, APP)} (${size(APP)}, ${arch}, Node ${run(NODE, ['-v']).trim()}) and ${path.relative(CEREAL, path.join(DIST, 'Cereal.dmg'))} (${size(path.join(DIST, 'Cereal.dmg'))}).`);
