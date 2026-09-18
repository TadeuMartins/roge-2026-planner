# Public Team Store

This uses a Supabase Free project with anonymous read/edit access for everyone
who has the public project URL and key. Anyone can add or clear participants;
there is no login, GitHub token, private membership or abuse protection. Do not
store sensitive information. Supabase free-tier quotas and inactivity pauses apply.

## Provisioning

1. Create a Supabase account and a Free project. The configured project is `hhrsansjccdmkwngarpe`.
2. In the project's SQL Editor, run the entire `supabase/001_team_store.sql` file.
3. In a second query, run the entire `supabase/002_seed_team_schedule.sql` file.
4. From the project Connect/API settings, obtain the project URL and **publishable** key (`sb_publishable_...`). A legacy **anon** key also works. Never use a secret (`sb_secret_...`) or `service_role` key in the frontend.
5. Set `js/team-config.js` to `{ url: 'https://YOUR_PROJECT.supabase.co', publishableKey: 'YOUR_PUBLIC_KEY' }` inside the existing `globalThis.ROGE_TEAM_CONFIG` assignment, then publish the frontend through its normal workflow.
6. Run `supabase/003_sync_events.sql`. Configure the GitHub Actions variable `SUPABASE_URL` and encrypted secret `SUPABASE_SERVICE_ROLE_KEY` (legacy server-only service-role JWT). The scheduled workflow calls `scripts/sync-team-events.mjs` after scraping. Never place that credential in frontend files or logs. Public API roles cannot execute the metadata sync function.

Both SQL files are included locally. To regenerate the seed after updating event
data, run `node scripts/prepare-supabase.mjs` from the project root. It reads
`data/events.json` and `data/team.json` without modifying them. The current source
has 460 events and an empty legacy schedule. No network or credentials are needed
to generate SQL. Run schema, then seed, sequentially in the Dashboard, not as RPCs.

Rerunning either file does not wipe assignments. The seed imports legacy names
only on the first insertion of a row, never into an existing empty row. Metadata
for real events is refreshed; removed events and nonempty legacy orphans are
retained. Imported orphans without a real seeded event remain visible but cannot
be edited through the save RPC until that event is seeded from real event data.

## Contract

- `new TeamStore(config, request = fetch)` accepts `{ url: '', publishableKey: '' }` and exposes boolean `configured`. Empty configuration makes reads/saves fail before any network request.
- `validate(data)` validates and returns a version-1 schedule with normalized name arrays, without filtering out orphan IDs.
- `read()` returns `{ data }`, using `POST /rest/v1/rpc/get_team_schedule` with `{}`.
- `save(event, input, expectedNames)` normalizes name arrays and returns the full authoritative `{ version: 1, assignments }` from `POST /rest/v1/rpc/save_team_assignment`, with `{ p_event_id: event.id, p_names: [...], p_expected_names: [...] }`. Client metadata is never sent.
- Each assignment contains `names`, trusted `event` metadata and `updated_at`. Empty assignments are omitted from snapshots but their rows are retained for locking and safe seed reruns.
- The public key is sent as `apikey`. Only legacy anon JWT keys also use `Authorization: Bearer`; publishable keys are not JWTs.
- Saves lock the seeded event row and compare normalized expected names exactly, including order/case. Stale edits raise SQLSTATE `PT409` (HTTP 409); the client exposes `error.status === 409` and never retries or overwrites automatically. Refresh and let the user review their edit.
- No second network read follows a successful save. Different events do not overwrite each other. A response snapshot includes that save and other changes visible at snapshot time; it cannot include transactions committed later.
- A timeout/network failure may occur after a server commit. The client rejects without retrying; refresh before resubmitting. Do not treat a rejected request as proof that no commit occurred.

Tables have RLS enabled and no direct privileges for `anon`/`authenticated`.
Only the getter and save functions have public-client execute grants; all
functions use a fixed empty `search_path`. The save RPC accepts JSON arrays to
reject null, non-string and multidimensional inputs before SQL text coercion.
Both arrays are bounded to 30 entries, with 80 UTF-16 units per normalized name.
Normalization uses NFKC, JavaScript whitespace collapse, empty-name removal and
case-insensitive deduplication retaining the first spelling. Ordinary Portuguese
case folding uses the project's PostgreSQL locale. The SQL owner remains trusted
and is the only actor allowed to seed or update event metadata.

## Verification

Run `npm test` for client RPC mocks, validation, CAS behavior and seed generation
unit tests. These tests do not provision Supabase or make production writes.
Before sharing a provisioned project, verify the RPCs in that project's own test
environment: denied direct table access, unknown event rejection, clear/reseed
preservation, and two concurrent same-event saves yielding one HTTP 409.
