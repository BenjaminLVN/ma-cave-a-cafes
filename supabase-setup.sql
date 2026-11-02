-- Ma cave à cafés : à coller une fois dans Supabase > SQL Editor > Run
create table if not exists public.items (
  cave text not null,
  coll text not null,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (cave, coll, id)
);
create table if not exists public.photos (
  cave text not null,
  id text not null,
  data text not null,
  created_at timestamptz not null default now(),
  primary key (cave, id)
);
grant usage on schema public to anon;
grant select, insert, update, delete on public.items, public.photos to anon;
alter table public.items enable row level security;
alter table public.photos enable row level security;

-- Accès sans connexion, limité au code secret de la cave envoyé par l'appli (en-tête x-cave)
create or replace function public.cave_key() returns text language sql stable as $$
  select coalesce(current_setting('request.headers', true)::json->>'x-cave', '')
$$;
grant execute on function public.cave_key() to anon;

drop policy if exists cave_items on public.items;
create policy cave_items on public.items for all to anon
  using (length(cave) >= 24 and cave = public.cave_key())
  with check (length(cave) >= 24 and cave = public.cave_key());

drop policy if exists cave_photos on public.photos;
create policy cave_photos on public.photos for all to anon
  using (length(cave) >= 24 and cave = public.cave_key())
  with check (length(cave) >= 24 and cave = public.cave_key());
