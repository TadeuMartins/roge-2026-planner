import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// A missing injection must fail locally, never reach a real endpoint.
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('Real network is forbidden in these tests.'); };
after(() => { globalThis.fetch = originalFetch; });
const { syncTeamEvents } = await import('../scripts/sync-team-events.mjs');
const jwt = role => [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ role })).toString('base64url'),
  'fake-signature-for-tests-only'
].join('.');
const env = { SUPABASE_URL: 'https://example.supabase.co/', SUPABASE_SERVICE_ROLE_KEY: jwt('service_role') };
const event = { id: 'new-id', title: 'New event', date: '2026-09-21', start: '10:00', end: '11:00', location: 'Hall' };
const fields = Object.keys(event);

test('reads the actual scraped envelope and sends only the six metadata fields', async () => {
  const data = JSON.parse(await readFile(new URL('../data/events.json', import.meta.url), 'utf8'));
  let calls = 0;
  const count = await syncTeamEvents({ env, request: async (url, options) => {
    calls++;
    assert.equal(url, 'https://example.supabase.co/rest/v1/rpc/sync_team_events');
    assert.equal(options.method, 'POST');
    assert.deepEqual(options.headers, {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    });
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(options.body), {
      p_events: data.events.map(item => Object.fromEntries(fields.map(field => [field, item[field]])))
    });
    return { ok: true, json: async () => data.events.length };
  } });
  assert.equal(count, data.events.length);
  assert.equal(calls, 1);
});

test('strips assignment, timestamp, seeded flag and other injected fields without mutating input', async () => {
  const input = { ...event, names: ['DO NOT SEND'], updated_at: 'DO NOT SEND', seeded_event: false,
    event: { names: ['DO NOT SEND'] }, speakers: [{ name: 'DO NOT SEND' }] };
  const before = structuredClone(input);
  assert.equal(await syncTeamEvents({ env, events: [input], request: async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), { p_events: [event] });
    assert.ok(!options.body.includes('DO NOT SEND'));
    return { ok: true, json: async () => 1 };
  } }), 1);
  assert.deepEqual(input, before);
});

test('invalid environment fails before any request', async () => {
  let calls = 0;
  const request = async () => { calls++; throw new Error('Unexpected request'); };
  for (const url of [undefined, '', ' ', 'not a URL', 'http://example.com',
    'https://user:password@example.com', 'https://example.com/path',
    'https://example.com/?secret=value', 'https://example.com/#fragment']) {
    await assert.rejects(syncTeamEvents({ env: { ...env, SUPABASE_URL: url }, events: [event], request }), /SUPABASE_URL/);
  }
  for (const key of [undefined, '', ' ', 'sb_publishable_fake', 'sb_secret_fake', 'not.a.jwt', jwt('anon'), jwt('authenticated')]) {
    await assert.rejects(syncTeamEvents({ env: { ...env, SUPABASE_SERVICE_ROLE_KEY: key }, events: [event], request }), /SUPABASE_SERVICE_ROLE_KEY/);
  }
  assert.equal(calls, 0);
});

test('rejects malformed lists, IDs, duplicates and non-string or missing metadata before network', async () => {
  let calls = 0;
  const request = async () => { calls++; throw new Error('Unexpected request'); };
  const invalid = [null, {}, 'events', [null], [[]], [42], [event, event],
    Array.from({ length: 5001 }, (_, i) => ({ ...event, id: `id-${i}` }))];
  for (const id of ['', 'a b', 'x'.repeat(101), '../id']) invalid.push([{ ...event, id }]);
  for (const field of fields) {
    for (const value of [undefined, null, 42, false, [], {}]) invalid.push([{ ...event, [field]: value }]);
  }
  for (const events of invalid) {
    await assert.rejects(syncTeamEvents({ env, events, request }), /Events must|Invalid or duplicate/);
  }
  assert.equal(calls, 0);
});

test('accepts empty lists, empty optional text and the 5000-event boundary', async () => {
  for (const events of [[], [{ ...event, start: '', end: '', location: '' }],
    Array.from({ length: 5000 }, (_, i) => ({ ...event, id: `id-${i}` }))]) {
    assert.equal(await syncTeamEvents({ env, events, request: async (_url, options) => {
      assert.equal(JSON.parse(options.body).p_events.length, events.length);
      return { ok: true, json: async () => events.length };
    } }), events.length);
  }
});

test('HTTP failures reject once without reading or exposing the error body', async () => {
  for (const status of [400, 401, 403, 404, 409, 429, 500, 503]) {
    let calls = 0;
    await assert.rejects(syncTeamEvents({ env, events: [event], request: async () => {
      calls++;
      return { ok: false, status, json: () => assert.fail('Must not read error payload'),
        text: () => assert.fail('Must not read error payload') };
    } }), { message: `Event metadata sync failed (HTTP ${status}).` });
    assert.equal(calls, 1);
  }
});

test('network and response parsing failures do not expose sensitive exception text', async () => {
  const sensitive = `${env.SUPABASE_SERVICE_ROLE_KEY} DO NOT PRINT NAMES`;
  await assert.rejects(syncTeamEvents({ env, events: [event], request: async () => {
    throw new Error(sensitive);
  } }), { message: 'Event metadata sync request failed.' });
  await assert.rejects(syncTeamEvents({ env, events: [event], request: async () => ({
    ok: true, json: async () => { throw new Error(sensitive); }
  }) }), { message: 'Event metadata sync returned an invalid count.' });
  for (const count of [null, '1', {}, -1, 0, 2, 1.5]) {
    await assert.rejects(syncTeamEvents({ env, events: [event], request: async () => ({
      ok: true, json: async () => count
    }) }), /invalid count/);
  }
});

test('CLI fails with nonzero status for missing environment without printing data', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/sync-team-events.mjs', import.meta.url))], {
    env: { ...process.env, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }, encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^SUPABASE_URL must be an HTTPS project URL[^\r\n]*\r?\n$/);
});

test('SQL contract restricts execution and limits writes to trusted metadata', async () => {
  const sql = (await readFile(new URL('../supabase/003_sync_events.sql', import.meta.url), 'utf8'))
    .replace(/--[^\n]*/g, '');
  assert.match(sql, /function public\.sync_team_events\(p_events jsonb\)/i);
  assert.match(sql, /returns integer/i);
  assert.match(sql, /security definer\s+set search_path = ''/i);
  assert.match(sql, /revoke all on function public\.sync_team_events\(jsonb\) from public, anon, authenticated/i);
  assert.deepEqual([...sql.matchAll(/grant\s+execute[^;]+/gi)].map(match => match[0]), [
    'grant execute on function public.sync_team_events(jsonb) to service_role'
  ]);
  assert.match(sql, /p_events is null or jsonb_typeof\(p_events\) <> 'array'/);
  assert.match(sql, /jsonb_array_length\(p_events\) > 5000/);
  assert.match(sql, /jsonb_typeof\(item\) <> 'object'/);
  assert.match(sql, /array\['id', 'title', 'date', 'start', 'end', 'location'\]/);
  assert.match(sql, /jsonb_typeof\(item -> field\) is distinct from 'string'/);
  assert.ok(sql.includes("'^[a-zA-Z0-9_-]{1,100}$'"));
  assert.match(sql, /count\(distinct value ->> 'id'\)/);
  assert.match(sql, /insert into public\.team_assignments \(event_id, event, seeded_event\)/);
  assert.match(sql, /jsonb_build_object\(/);
  for (const field of fields) assert.ok(sql.includes(`'${field}', value ->> '${field}'`));
  assert.match(sql, /on conflict \(event_id\) do update\s+set event = excluded\.event, seeded_event = true;/);
  assert.doesNotMatch(sql, /\b(names|updated_at|delete|truncate)\b/i);
  assert.match(sql, /get diagnostics synced = row_count;\s+return synced;/);
});
