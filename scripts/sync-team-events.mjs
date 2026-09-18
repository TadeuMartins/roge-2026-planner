// Server/Action entry point only. Never import this module into frontend code.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Inject events and request for isolated tests; the CLI reads data/events.json.
export async function syncTeamEvents({ env = process.env, request = globalThis.fetch, events } = {}) {
  let base;
  try {
    base = new URL(env.SUPABASE_URL);
    if (base.protocol !== 'https:' || base.username || base.password ||
        base.search || base.hash || base.pathname !== '/') throw new Error();
  } catch {
    throw new Error('SUPABASE_URL must be an HTTPS project URL without credentials, path, query or fragment.');
  }
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) throw new Error();
    // This is a configuration check, not signature verification. Supabase
    // authenticates the legacy JWT and enforces the service_role grant.
    const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
    if (claims?.role !== 'service_role') throw new Error();
  } catch {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY must be a legacy service_role JWT.');
  }

  if (events === undefined) {
    try {
      const data = JSON.parse(await readFile(new URL('../data/events.json', import.meta.url), 'utf8'));
      events = data.events;
    } catch {
      throw new Error('Unable to read data/events.json.');
    }
  }
  if (!Array.isArray(events) || events.length > 5000) {
    throw new Error('Events must be an array of at most 5000 entries.');
  }
  const fields = ['id', 'title', 'date', 'start', 'end', 'location'];
  const seen = new Set();
  const metadata = events.map(event => {
    if (!event || Array.isArray(event) || fields.some(field => typeof event[field] !== 'string') ||
        !/^[a-zA-Z0-9_-]{1,100}$/.test(event.id) || seen.has(event.id)) {
      throw new Error('Invalid or duplicate event metadata.');
    }
    seen.add(event.id);
    return Object.fromEntries(fields.map(field => [field, event[field]]));
  });

  let response;
  try {
    response = await request(new URL('/rest/v1/rpc/sync_team_events', base).href, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_events: metadata }),
      redirect: 'error',
      signal: AbortSignal.timeout(30000)
    });
  } catch {
    // Request exceptions and response bodies may contain credentials or data.
    throw new Error('Event metadata sync request failed.');
  }
  if (!response.ok) {
    throw new Error(`Event metadata sync failed (HTTP ${response.status}).`);
  }
  let count;
  try {
    count = await response.json();
  } catch {
    throw new Error('Event metadata sync returned an invalid count.');
  }
  if (!Number.isInteger(count) || count !== metadata.length) {
    throw new Error('Event metadata sync returned an invalid count.');
  }
  return count;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const count = await syncTeamEvents();
    console.log(`Synced metadata for ${count} events.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
