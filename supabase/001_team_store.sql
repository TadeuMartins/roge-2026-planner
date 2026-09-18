-- Run first in the Supabase SQL Editor as the project owner.
begin;

create table if not exists public.team_assignments (
  event_id text primary key check (event_id ~ '^[a-zA-Z0-9_-]{1,100}$'),
  event jsonb not null check (jsonb_typeof(event) = 'object' and event ->> 'id' = event_id),
  seeded_event boolean not null default false,
  names text[] not null default '{}'::text[],
  updated_at timestamptz,
  check (cardinality(names) <= 30 and coalesce(array_ndims(names), 1) = 1)
);

alter table public.team_assignments enable row level security;
revoke all on table public.team_assignments from public, anon, authenticated;

-- JSON parameters reject numbers, objects, nulls and nested arrays before any
-- text coercion. Match PlannerModel.names: NFKC, JS whitespace, case-insensitive
-- deduplication, first spelling/order retained. Length counts UTF-16 units.
create or replace function public.normalize_team_names(p_names jsonb)
returns text[]
language plpgsql immutable
set search_path = ''
as $$
declare
  item jsonb;
  name text;
  name_key text;
  result text[] := '{}'::text[];
  seen text[] := '{}'::text[];
  units integer;
begin
  if p_names is null or jsonb_typeof(p_names) <> 'array' then
    raise sqlstate 'PT400' using message = 'Names must be a JSON array.';
  end if;
  if jsonb_array_length(p_names) > 30 then
    raise sqlstate 'PT400' using message = 'At most 30 names are allowed.';
  end if;
  for item in select value from jsonb_array_elements(p_names) loop
    if jsonb_typeof(item) <> 'string' then
      raise sqlstate 'PT400' using message = 'Each name must be a non-null string.';
    end if;
    name := btrim(regexp_replace(normalize(item #>> '{}', NFKC),
      U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+', ' ', 'g'));
    if name = '' then continue; end if;
    if name ~ U&'[\0001-\0008\000E-\001F\007F-\009F]' then
      raise sqlstate 'PT400' using message = 'Control characters are not allowed.';
    end if;
    select coalesce(sum(case when ascii(substr(name, i, 1)) > 65535 then 2 else 1 end), 0)
      into units from generate_series(1, char_length(name)) as chars(i);
    if units > 80 then
      raise sqlstate 'PT400' using message = 'Names must have at most 80 characters.';
    end if;
    name_key := lower(name);
    if not (name_key = any(seen)) then
      seen := array_append(seen, name_key);
      result := array_append(result, name);
    end if;
  end loop;
  return result;
end;
$$;

create or replace function public.get_team_schedule()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object('version', 1, 'assignments', coalesce(
    jsonb_object_agg(event_id, jsonb_build_object(
      'names', names, 'event', event, 'updated_at', updated_at)), '{}'::jsonb))
  from public.team_assignments
  where cardinality(names) > 0;
$$;

create or replace function public.save_team_assignment(
  p_event_id text, p_names jsonb, p_expected_names jsonb
)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  next_names text[];
  expected_names text[];
  current_names text[];
begin
  if p_event_id is null or p_event_id !~ '^[a-zA-Z0-9_-]{1,100}$' then
    raise sqlstate 'PT400' using message = 'Invalid event ID.';
  end if;
  next_names := public.normalize_team_names(p_names);
  expected_names := public.normalize_team_names(p_expected_names);

  -- Keep the row even when cleared: it is the permanent CAS lock target.
  select names into current_names from public.team_assignments
    where event_id = p_event_id and seeded_event for update;
  if not found then
    raise sqlstate 'PT404' using message = 'Unknown event ID. Only seeded events may be edited.';
  end if;
  if current_names is distinct from expected_names then
    raise sqlstate 'PT409' using message = 'Another person changed this event. Refresh before saving.';
  end if;
  update public.team_assignments set names = next_names, updated_at = clock_timestamp()
    where event_id = p_event_id;

  -- One transaction and response, never a second client-side read after commit.
  return public.get_team_schedule();
end;
$$;

revoke all on function public.normalize_team_names(jsonb) from public, anon, authenticated;
revoke all on function public.get_team_schedule() from public, anon, authenticated;
revoke all on function public.save_team_assignment(text, jsonb, jsonb) from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
grant execute on function public.get_team_schedule() to anon, authenticated;
grant execute on function public.save_team_assignment(text, jsonb, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
