// Is there a newer Cereal for Mac? One anonymous request to GitHub's public releases API, at most every six hours.
// Nothing about you or your projects goes with it. CEREAL_UPDATE_CHECK=0 turns it off.
export const RELEASES = 'https://api.github.com/repos/ConnorLee/cereal/releases/latest';
const EVERY = 6 * 3600e3;

const parts = (v) => String(v).split('.').map((n) => Number(n) || 0);
// The release's version when it's newer than this one, else null. Tags look like v0.1.4.
export function newerVersion(current, tag) {
  const v = String(tag || '').replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(v)) return null;
  const [a, b] = [parts(v), parts(current)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? v : null;
  return null;
}

export function updateChecker({ current, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
  let last = null;
  let at = 0;
  let job = null;
  return function check() {
    if (job) return job;
    if (last && now() - at < EVERY) return Promise.resolve(last);
    job = (async () => {
      try {
        const r = await fetchImpl(RELEASES, { headers: { accept: 'application/vnd.github+json', 'user-agent': `Cereal/${current}` }, signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
        const rel = await r.json();
        const latest = newerVersion(current, rel.tag_name);
        const dmg = (rel.assets || []).find((a) => a.name === 'Cereal.dmg');
        last = { current, latest, url: latest ? rel.html_url || null : null, download: latest ? dmg?.browser_download_url || null : null };
      } catch (e) {
        last = { current, latest: null, error: String(e.message || e).slice(0, 120) };
      }
      at = now();
      job = null;
      return last;
    })();
    return job;
  };
}
