-- Apply before deploying the client that reads routines and session targets.
-- A routine is one small, ordered document: saving its exercises and targets
-- is atomic, including when two devices synchronize. Completed sessions hold
-- independent target snapshots, with no cascading relation to the routine.
begin;

create function private.routine_integer(value jsonb, minimum integer, maximum integer)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare n numeric;
begin
  if value is null or jsonb_typeof(value) <> 'number' then return false; end if;
  n := value::numeric;
  return n = trunc(n) and n between minimum and maximum;
end;
$$;

create function private.valid_exercise_target(value jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
begin
  if value is null or jsonb_typeof(value) <> 'object' then return false; end if;
  if not private.routine_integer(value->'sets', 1, 30)
    or not private.routine_integer(value->'restSec', 5, 3600) then return false; end if;
  if value->>'metric' = 'reps' then
    if not private.routine_integer(value->'repsMin', 1, 1000)
      or not private.routine_integer(value->'repsMax', 1, 1000) then return false; end if;
    return (value->>'repsMin')::numeric <= (value->>'repsMax')::numeric and not (value ? 'durationSec');
  elsif value->>'metric' = 'time' then
    return private.routine_integer(value->'durationSec', 1, 3600) and not (value ? 'repsMin') and not (value ? 'repsMax');
  end if;
  return false;
end;
$$;

create function private.valid_routine_exercises(value jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare entry jsonb; ids text[] := array[]::text[];
begin
  if value is null or jsonb_typeof(value) <> 'array' then return false; end if;
  if jsonb_array_length(value) not between 1 and 40 then return false; end if;
  for entry in select * from jsonb_array_elements(value) loop
    if jsonb_typeof(entry) <> 'object' then return false; end if;
    if coalesce(jsonb_typeof(entry->'id'), '') <> 'string' or coalesce(length(btrim(entry->>'id')), 0) = 0
      or coalesce(jsonb_typeof(entry->'exerciseId'), '') <> 'string' or coalesce(length(btrim(entry->>'exerciseId')), 0) = 0
      or coalesce(jsonb_typeof(entry->'exerciseName'), '') <> 'string' or coalesce(length(btrim(entry->>'exerciseName')), 0) = 0
      or not private.valid_exercise_target(entry->'target') then return false; end if;
    if entry->>'id' = any(ids) then return false; end if;
    ids := array_append(ids, entry->>'id');
  end loop;
  return true;
end;
$$;

create table public.routines (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 80 and length(title) <= 80),
  exercises jsonb not null check (private.valid_routine_exercises(exercises)),
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index routines_user_id_idx on public.routines(user_id);
alter table public.routines enable row level security;
create policy "own routines" on public.routines for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.routines to authenticated;
revoke all on public.routines from anon;
create trigger routines_set_updated_at before update on public.routines
  for each row execute function private.set_updated_at();

alter table public.session_exercises add column target jsonb
  check (target is null or private.valid_exercise_target(target));

-- Constraint helpers carry no data privileges. They must remain callable by
-- the authenticated role evaluating CHECK constraints and nested helpers.
grant usage on schema private to authenticated;
revoke execute on function private.routine_integer(jsonb, integer, integer) from public;
revoke execute on function private.valid_exercise_target(jsonb) from public;
revoke execute on function private.valid_routine_exercises(jsonb) from public;
grant execute on function private.routine_integer(jsonb, integer, integer) to authenticated;
grant execute on function private.valid_exercise_target(jsonb) to authenticated;
grant execute on function private.valid_routine_exercises(jsonb) to authenticated;

commit;
