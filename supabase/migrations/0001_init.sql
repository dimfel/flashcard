-- DeckCard cloud copy. Mirrors the Dexie tables in src/app/core/db/flashcard-db.ts.
--
-- Every row belongs to one user and row-level security keeps it that way.
-- Epoch-millisecond fields stay bigint to match the app. Only keys, updated_at
-- and deleted are NOT NULL, because a delete is pushed as a key plus
-- deleted = true, with no other columns.
-- server_updated_at is set by a trigger and is the pull cursor, so device clocks
-- never decide what gets pulled.

create or replace function public.touch_server_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.server_updated_at := now();
  return new;
end;
$$;

create table public.decks (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  name text,
  language text,
  production_enabled boolean,
  created_at bigint,
  updated_at bigint not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.cards (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  deck_id text,
  term text,
  sentence text,
  reading text,
  meaning text,
  sentence_translation text,
  tags text[],
  created_at bigint,
  updated_at bigint not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.scheduling (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  card_id text not null,
  direction text not null check (direction in ('recognition', 'production')),
  due bigint,
  state smallint,
  fsrs jsonb,
  updated_at bigint not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, card_id, direction)
);

create table public.review_logs (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  card_id text,
  direction text,
  rating smallint,
  reviewed_at bigint,
  elapsed_ms integer,
  previous jsonb,
  updated_at bigint not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.settings (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  new_cards_per_day integer,
  target_retention double precision,
  updated_at bigint not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default now(),
  primary key (user_id)
);

do $$
declare
  t text;
begin
  foreach t in array array['decks', 'cards', 'scheduling', 'review_logs', 'settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "Own rows only" on public.%I for all to authenticated '
      'using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t
    );
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create index %I on public.%I (user_id, server_updated_at)', t || '_pull_idx', t);
    execute format(
      'create trigger touch_server_updated_at before insert or update on public.%I '
      'for each row execute function public.touch_server_updated_at()',
      t
    );
  end loop;
end;
$$;
