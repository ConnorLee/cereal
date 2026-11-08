// Send the morning briefing if one is due, then exit. Run by the launchd agent so the briefing goes out
// even when Cereal isn't open; safe to run as often as you like, because each morning is claimed once.
// It reads Cereal's saved index and never writes to it, so it can run alongside the app.
import { Store } from '../lib/store.mjs';
import { Engine } from '../lib/engine.mjs';
import { projectDefs } from '../lib/projects.mjs';
import { BriefingStore, mailerFromEnv, deliver } from '../lib/briefing-delivery.mjs';

const store = new Store();
store.save = () => {};
store.flush = () => {};
const engine = new Engine(store, projectDefs());
const bstore = new BriefingStore(store.dir);
const mailer = mailerFromEnv(process.env, store.dir);
const appUrl = (process.env.CEREAL_APP_URL || `http://127.0.0.1:${process.env.PORT || 4317}`).replace(/\/$/, '');

try {
  await engine.refreshAgents(); // agent logs live outside protected folders; project files are not re-read here
  const r = await deliver({ engine, bstore, mailer, appUrl, kind: 'scheduled' });
  console.log(new Date().toISOString(), r.skipped ? `skipped (${r.skipped})` : r.ok ? `sent ${r.key} via ${r.provider}` : `failed ${r.key}: ${r.error}`);
  process.exitCode = r.ok === false ? 1 : 0;
} catch (e) {
  console.error(new Date().toISOString(), 'briefing run failed:', e.message);
  process.exitCode = 1;
}
