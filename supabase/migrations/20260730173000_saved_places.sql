create table if not exists public.saved_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('Casa', 'Trabajo', 'Favorito')),
  label text not null check (char_length(label) between 2 and 300),
  longitude double precision not null check (longitude between -180 and 180),
  latitude double precision not null check (latitude between -90 and 90),
  updated_at timestamptz not null default now(),
  unique (user_id, kind, label)
);

alter table public.saved_places enable row level security;
grant select, insert, update, delete on public.saved_places to authenticated;

create policy "users read own places" on public.saved_places
for select to authenticated using (auth.uid() = user_id);

create policy "users add own places" on public.saved_places
for insert to authenticated with check (auth.uid() = user_id);

create policy "users update own places" on public.saved_places
for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "users delete own places" on public.saved_places
for delete to authenticated using (auth.uid() = user_id);
