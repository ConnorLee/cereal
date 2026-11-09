// Build Cereal.app and Cereal.dmg: the native window, Cereal's server and a bundled Node runtime.
//
//   npm run desktop                    builds desktop/dist/Cereal.app and desktop/dist/Cereal.dmg
//   NODE_BIN=/path/to/node npm run desktop   bundle a specific Node 22+ binary (default: the one running this)
//   CEREAL_DESKTOP_OUT=/some/dir npm run desktop   build somewhere else (rebuilding under a running copy stops it)
//
// Needs Xcode's command-line tools (swiftc). Everything runs under the hardened runtime, as notarization requires.
//
// Signing and notarizing, so macOS opens the download without "couldn't verify" or malware warnings:
//   - With one "Developer ID Application" certificate in your keychain, it's used automatically
//     (or name one: CODESIGN_IDENTITY="Developer ID Application: Your Company (TEAMID)").
//   - Notarization needs credentials stored once in the keychain under a profile name (default cereal-notary).
//     Easiest is an App Store Connect team API key (Users and Access › Integrations, Developer role):
//       xcrun notarytool store-credentials cereal-notary --key AuthKey_KEYID.p8 --key-id KEYID --issuer ISSUER-ID
//     or an Apple ID with an app-specific password (account.apple.com › Sign-In and Security; your normal
//     password is refused): xcrun notarytool store-credentials cereal-notary --apple-id you@example.com --team-id TEAMID
//     NOTARY_PROFILE picks another profile; NOTARIZE=0 signs without notarizing.
//   - Then the app is notarized and stapled, the disk image is signed, notarized and stapled, and both are
//     checked the way Gatekeeper checks a download.
// Without a Developer ID the app is signed ad hoc, and the first open needs Open Anyway in System Settings › Privacy & Security.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CEREAL = path.dirname(HERE);
const DIST = process.env.CEREAL_DESKTOP_OUT ? path.resolve(process.env.CEREAL_DESKTOP_OUT) : path.join(HERE, 'dist');
const APP = path.join(DIST, 'Cereal.app');
const C = path.join(APP, 'Contents');
const pkg = JSON.parse(fs.readFileSync(path.join(CEREAL, 'package.json'), 'utf8'));
const VERSION = pkg.version;
const NODE = process.env.NODE_BIN || process.execPath;
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], ...opts }).toString();

// The signing identity: CODESIGN_IDENTITY, else the keychain's only Developer ID Application certificate, else ad hoc.
const identities = run('security', ['find-identity', '-v', '-p', 'codesigning']).split('\n')
  .map((l) => /\)\s+([0-9A-F]{40})\s+"(.+)"/.exec(l)).filter(Boolean).map((m) => ({ hash: m[1], name: m[2] }));
const devIds = identities.filter((i) => i.name.startsWith('Developer ID Application'));
if (!process.env.CODESIGN_IDENTITY && devIds.length > 1) throw new Error(`Several Developer ID certificates; choose one with CODESIGN_IDENTITY:\n${devIds.map((i) => `  ${i.name}`).join('\n')}`);
const IDENTITY = process.env.CODESIGN_IDENTITY || devIds[0]?.name || '-';
const identityName = identities.find((i) => i.hash === IDENTITY.toUpperCase())?.name || IDENTITY;
const DEVELOPER_ID = identityName.startsWith('Developer ID Application');
const NOTARIZE = DEVELOPER_ID && process.env.NOTARIZE !== '0';
const NOTARY_PROFILE = process.env.NOTARY_PROFILE || 'cereal-notary';
const STORE_HINT = `Store credentials once, with an App Store Connect API key (Users and Access › Integrations):\n  xcrun notarytool store-credentials ${NOTARY_PROFILE} --key AuthKey_KEYID.p8 --key-id KEYID --issuer ISSUER-ID\n(or build with NOTARIZE=0 to sign without notarizing)`;
// Check the notarization credentials before building, so a missing profile fails in seconds, not after the build.
if (NOTARIZE) {
  try { execFileSync('xcrun', ['notarytool', 'history', '--keychain-profile', NOTARY_PROFILE], { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) {
    throw new Error(`Signing with ${identityName}, but notarization can't sign in with the keychain profile "${NOTARY_PROFILE}":\n${(e.stderr?.toString() || e.message).trim()}\n${STORE_HINT}`);
  }
}

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

// 5. The icon: the cereal-box emblem drawn on Apple's icon grid (see icon.swift), so it's Dock-sized.
const iconset = path.join(os.tmpdir(), `cereal-${process.pid}.iconset`);
fs.rmSync(iconset, { recursive: true, force: true });
fs.mkdirSync(iconset);
const src = path.join(os.tmpdir(), `cereal-${process.pid}-icon.png`);
run('xcrun', ['swift', path.join(HERE, 'icon.swift'), path.join(HERE, 'icon-art.png'), src]);
for (const s of [16, 32, 128, 256, 512]) {
  run('sips', ['-z', String(s), String(s), src, '--out', path.join(iconset, `icon_${s}x${s}.png`)]);
  run('sips', ['-z', String(s * 2), String(s * 2), src, '--out', path.join(iconset, `icon_${s}x${s}@2x.png`)]);
}
run('iconutil', ['-c', 'icns', iconset, '-o', path.join(C, 'Resources', 'Cereal.icns')]);
fs.rmSync(iconset, { recursive: true, force: true });
fs.rmSync(src, { force: true });

// 6. Sign under the hardened runtime: Node first (with only the JIT exceptions V8 needs), then the app around it.
//    A real identity also gets a secure timestamp, which notarization requires.
const sign = (target, extra = []) => run('codesign', ['--force', '--sign', IDENTITY, '--options', 'runtime', IDENTITY === '-' ? '--timestamp=none' : '--timestamp', ...extra, target]);
sign(path.join(C, 'Resources', 'node', 'node'), ['--identifier', 'app.cereal.desktop.node', '--entitlements', path.join(HERE, 'node.entitlements')]);
sign(APP);
run('codesign', ['--verify', '--strict', '--deep', APP]);

// Notarizing: Apple scans the upload and issues a ticket; stapling attaches it, so the first open works offline too.
function notarize(file) {
  console.log(`Notarizing ${path.basename(file)} (usually a few minutes)…`);
  let out;
  try {
    out = execFileSync('xcrun', ['notarytool', 'submit', file, '--keychain-profile', NOTARY_PROFILE, '--wait', '--output-format', 'json'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  } catch (e) {
    out = e.stdout?.toString() || '';
    const err = e.stderr?.toString() || e.message;
    if (!out.trim().startsWith('{')) {
      throw new Error(/keychain|profile|credential/i.test(err)
        ? `No notarization credentials in the keychain under "${NOTARY_PROFILE}". ${STORE_HINT}`
        : `Notarization didn't run: ${err.trim()}`);
    }
  }
  const result = JSON.parse(out);
  if (result.status !== 'Accepted') {
    let log = '';
    try { log = run('xcrun', ['notarytool', 'log', result.id, '--keychain-profile', NOTARY_PROFILE]); } catch {}
    throw new Error(`Apple didn't accept ${path.basename(file)} (${result.status}): ${result.message || ''}\n${log}`);
  }
  console.log(`Notarized ${path.basename(file)} (${result.id}).`);
}
if (NOTARIZE) {
  const zip = path.join(DIST, 'Cereal-for-notarization.zip');
  run('ditto', ['-c', '-k', '--keepParent', APP, zip]);
  notarize(zip);
  fs.rmSync(zip, { force: true });
  run('xcrun', ['stapler', 'staple', APP]);
}

// 7. A disk image with the app and a shortcut to Applications, so installing is one drag. With a real identity it is
//    signed too, and notarized and stapled alongside the app.
const DMG = path.join(DIST, 'Cereal.dmg');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'cereal-dmg-'));
run('ditto', [APP, path.join(stage, 'Cereal.app')]);
fs.symlinkSync('/Applications', path.join(stage, 'Applications'));
run('hdiutil', ['create', '-volname', 'Cereal', '-srcfolder', stage, '-ov', '-format', 'UDZO', '-quiet', DMG]);
fs.rmSync(stage, { recursive: true, force: true });
if (IDENTITY !== '-') run('codesign', ['--force', '--sign', IDENTITY, '--timestamp', DMG]);
if (NOTARIZE) {
  notarize(DMG);
  run('xcrun', ['stapler', 'staple', DMG]);
}

// 8. Check the result the way Gatekeeper checks a download.
const assess = (args) => { try { execFileSync('spctl', args, { stdio: ['ignore', 'pipe', 'pipe'] }); return true; } catch { return false; } };
const appOK = assess(['--assess', '--type', 'exec', APP]);
const dmgOK = IDENTITY !== '-' && assess(['--assess', '--type', 'open', '--context', 'context:primary-signature', DMG]);
if (NOTARIZE && !(appOK && dmgOK)) throw new Error('Signed and notarized, but Gatekeeper still rejects the app or the disk image; see spctl --assess -vv.');

const size = (p) => `${(Number(run('du', ['-sk', p]).split('\t')[0]) / 1024).toFixed(0)} MB`;
console.log(`Built ${path.relative(CEREAL, APP)} (${size(APP)}, ${arch}, Node ${run(NODE, ['-v']).trim()}) and ${path.relative(CEREAL, DMG)} (${size(DMG)}).`);
console.log(NOTARIZE ? `Signed by ${identityName}, notarized and stapled: macOS opens it without warnings.`
  : DEVELOPER_ID ? `Signed by ${identityName}, not notarized (NOTARIZE=0): macOS still warns on first open.`
  : `Signed ${IDENTITY === '-' ? 'ad hoc' : `by ${identityName}`}, not notarized: the first open needs Open Anyway in System Settings › Privacy & Security.`);
