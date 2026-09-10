-- Durable, per-user storage for Workout. IDs remain client-generated UUIDs so
-- an offline write has its final identity before it is synchronised.
--
-- Time values are stored as timestamptz; local calendar dates remain date so
-- the day a user selected never shifts when they travel.

create schema if not exists private;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.exercises (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  name_key text not null,
  load_type text not null check (load_type in ('external', 'bodyweight', 'weighted_bodyweight', 'assisted')),
  metric text not null check (metric in ('reps', 'time')),
  per_side boolean not null default false,
  muscle_group text,
  default_increment_kg numeric(7, 3),
  is_custom boolean not null,
  archived_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, name_key),
  unique (user_id, id)
);

create table public.sessions (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  date date not null,
  title text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (ended_at is null or ended_at >= started_at),
  unique (user_id, id)
);

create table public.session_exercises (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  session_id uuid not null,
  exercise_id uuid not null,
  position integer not null check (position >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, id),
  foreign key (user_id, session_id) references public.sessions(user_id, id) on delete cascade,
  foreign key (user_id, exercise_id) references public.exercises(user_id, id)
);

create table public.sets (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  session_id uuid not null,
  session_exercise_id uuid not null,
  exercise_id uuid not null,
  performed_at timestamptz not null,
  logged_at timestamptz not null,
  position integer not null check (position >= 0),
  kind text not null check (kind in ('work', 'warmup')),
  weight_kg numeric(7, 3) check (weight_kg >= 0),
  reps integer check (reps > 0),
  duration_sec integer check (duration_sec > 0),
  rpe integer check (rpe between 1 and 10),
  is_failure boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((reps is null) <> (duration_sec is null)),
  foreign key (user_id, session_id) references public.sessions(user_id, id) on delete cascade,
  foreign key (user_id, session_exercise_id) references public.session_exercises(user_id, id) on delete cascade,
  foreign key (user_id, exercise_id) references public.exercises(user_id, id)
);

create table public.bodyweights (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  weight_kg numeric(6, 3) not null check (weight_kg > 0),
  recorded_at timestamptz not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, date)
);

create table public.training_blocks (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label text not null,
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (ends_on >= starts_on)
);

create table public.retired_exercises (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name_key text not null,
  retired_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, name_key)
);

-- RLS predicates are indexed and wrap auth.uid() in SELECT so Postgres caches
-- it once per query instead of evaluating it once per candidate row.
create index exercises_user_id_idx on public.exercises(user_id);
create index sessions_user_date_idx on public.sessions(user_id, date desc);
create index session_exercises_user_session_position_idx on public.session_exercises(user_id, session_id, position);
create index session_exercises_user_exercise_idx on public.session_exercises(user_id, exercise_id);
create index sets_user_session_position_idx on public.sets(user_id, session_id, position);
create index sets_user_exercise_performed_idx on public.sets(user_id, exercise_id, performed_at desc, position desc);
create index training_blocks_user_starts_on_idx on public.training_blocks(user_id, starts_on);

alter table public.profiles enable row level security;
alter table public.exercises enable row level security;
alter table public.sessions enable row level security;
alter table public.session_exercises enable row level security;
alter table public.sets enable row level security;
alter table public.bodyweights enable row level security;
alter table public.training_blocks enable row level security;
alter table public.retired_exercises enable row level security;

-- The Data API is browser-facing, so anonymous callers receive no table
-- privileges at all. Signed-in callers receive only the operations that RLS
-- subsequently narrows to their own rows.
revoke all on public.profiles, public.exercises, public.sessions,
  public.session_exercises, public.sets, public.bodyweights,
  public.training_blocks, public.retired_exercises from anon;
grant select, insert, update, delete on public.profiles, public.exercises,
  public.sessions, public.session_exercises, public.sets, public.bodyweights,
  public.training_blocks, public.retired_exercises to authenticated;

create policy "own profile" on public.profiles for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own exercises" on public.exercises for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own sessions" on public.sessions for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own session exercises" on public.session_exercises for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own sets" on public.sets for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own bodyweights" on public.bodyweights for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own training blocks" on public.training_blocks for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own retired exercises" on public.retired_exercises for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create trigger profiles_set_updated_at before update on public.profiles for each row execute function private.set_updated_at();
create trigger exercises_set_updated_at before update on public.exercises for each row execute function private.set_updated_at();
create trigger sessions_set_updated_at before update on public.sessions for each row execute function private.set_updated_at();
create trigger session_exercises_set_updated_at before update on public.session_exercises for each row execute function private.set_updated_at();
create trigger sets_set_updated_at before update on public.sets for each row execute function private.set_updated_at();
create trigger bodyweights_set_updated_at before update on public.bodyweights for each row execute function private.set_updated_at();
create trigger training_blocks_set_updated_at before update on public.training_blocks for each row execute function private.set_updated_at();
create trigger retired_exercises_set_updated_at before update on public.retired_exercises for each row execute function private.set_updated_at();
