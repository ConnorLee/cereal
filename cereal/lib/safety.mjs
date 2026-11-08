import path from 'node:path';

// Directories that are never walked: dependencies, build output, caches, VCS internals.
export const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'out', 'DerivedData', 'Pods', 'Carthage',
  '.build', '.swiftpm', 'vendor', '.venv', 'venv', '__pycache__', '.cache', '.turbo', '.vercel',
  '.pnpm-store', 'coverage', '.idea', '.vscode', 'tmp', '.tmp', 'xcuserdata', '.gradle', 'target',
]);

// Files whose names mark them as secrets or signing material. Never read, never listed.
const SECRET_NAME = [
  /^\.env(\..*)?$/i, /\.env$/i, /^\.npmrc$/i, /^\.netrc$/i, /^\.pypirc$/i, /^id_(rsa|dsa|ecdsa|ed25519)/i,
  /\.(pem|key|p8|p12|pfx|cer|crt|der|keystore|jks|mobileprovision|provisionprofile|gpg|asc)$/i,
  /credential/i, /secret/i, /token/i, /password/i, /^auth\.json$/i, /^GoogleService-Info\.plist$/i,
  /^service[-_]?account.*\.json$/i, /\.sqlite(-wal|-shm)?$/i, /^\.DS_Store$/,
];

// Content patterns that indicate a live secret. A file containing one is skipped entirely.
const SECRET_CONTENT = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bsk-ant-[A-Za-z0-9_-]{20,}/, /\bsk-[A-Za-z0-9]{32,}/,
  /\bAKIA[0-9A-Z]{16}\b/, /\bgh[pousr]_[A-Za-z0-9]{30,}/, /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{35}\b/, /\bsk_live_[A-Za-z0-9]{20,}/,
];

export const TEXT_DOC = /\.(md|mdx|markdown|txt|rst)$/i;
export const REFERENCE_FILE = /\.(pdf|pages|key|fig|sketch|png|jpe?g|webp|mov|mp4|docx?)$/i;

export function isSecretPath(p) {
  const parts = p.split(path.sep);
  if (parts.some((seg) => /^\.env(\.|$)/i.test(seg))) return true;
  const base = path.basename(p);
  return SECRET_NAME.some((re) => re.test(base));
}

export function containsSecret(text) {
  return SECRET_CONTENT.some((re) => re.test(text));
}

export function isIgnoredDir(name) {
  return IGNORED_DIRS.has(name) || (name.startsWith('.') && name !== '.github' && name !== '.claude');
}

export function isIndexableDoc(p) {
  return TEXT_DOC.test(p) && !isSecretPath(p) && !p.split(path.sep).some((s) => IGNORED_DIRS.has(s));
}
