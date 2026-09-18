-- Run after 001_team_store.sql as the project owner. Scheduled sync uses only
-- the server-side service_role credential; public saves cannot change metadata.
begin;

create or replace function public.sync_team_events(p_events jsonb)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  item jsonb;
  field text;
  synced integer;
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise sqlstate 'PT400' using message = 'Events must be a JSON array.';
  end if;
  if jsonb_array_length(p_events) > 5000 then
    raise sqlstate 'PT400' using message = 'At most 5000 events are allowed.';
  end if;
  for item in select value from jsonb_array_elements(p_events) loop
    if jsonb_typeof(item) <> 'object' then
      raise sqlstate 'PT400' using message = 'Each event must be an object.';
    end if;
    foreach field in array array['id', 'title', 'date', 'start', 'end', 'location'] loop
      if jsonb_typeof(item -> field) is distinct from 'string' then
        raise sqlstate 'PT400' using message = 'Event metadata fields must be strings.';
      end if;
    end loop;
    if item ->> 'id' !~ '^[a-zA-Z0-9_-]{1,100}$' then
      raise sqlstate 'PT400' using message = 'Invalid event ID.';
    end if;
  end loop;
  if (select count(distinct value ->> 'id') from jsonb_array_elements(p_events))
      <> jsonb_array_length(p_events) then
    raise sqlstate 'PT400' using message = 'Duplicate event IDs are not allowed.';
  end if;

  -- Explicit allowlist: neither extra JSON fields nor conflict updates can
  -- inject assignments. Defaults create new rows with empty names/null time.
  insert into public.team_assignments (event_id, event, seeded_event)
  select value ->> 'id', jsonb_build_object(
    'id', value ->> 'id', 'title', value ->> 'title', 'date', value ->> 'date',
    'start', value ->> 'start', 'end', value ->> 'end', 'location', value ->> 'location'
  ), true
  from jsonb_array_elements(p_events)
  on conflict (event_id) do update
    set event = excluded.event, seeded_event = true;
  get diagnostics synced = row_count;

  -- Missing IDs remain untouched, retaining orphan assignments and CAS state.
  -- Count includes all supplied IDs, even when their metadata was unchanged.
  return synced;
end;
$$;

revoke all on function public.sync_team_events(jsonb) from public, anon, authenticated;
grant execute on function public.sync_team_events(jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
