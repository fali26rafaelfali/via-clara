create table if not exists public.shared_trips (
  token uuid primary key default gen_random_uuid(),
  device_id text not null,
  latitude double precision not null,
  longitude double precision not null,
  destination text not null,
  eta timestamptz not null,
  status text not null default 'driving' check (status in ('driving', 'stopped', 'arrived', 'sos')),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);

alter table public.shared_trips enable row level security;
revoke all on public.shared_trips from anon, authenticated;

create or replace function public.start_shared_trip(
  p_device_id text, p_latitude double precision, p_longitude double precision,
  p_destination text, p_eta timestamptz
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_token uuid;
begin
  insert into shared_trips(device_id, latitude, longitude, destination, eta)
  values(p_device_id, p_latitude, p_longitude, left(p_destination, 300), p_eta)
  returning token into v_token;
  return v_token;
end; $$;

create or replace function public.update_shared_trip(
  p_token uuid, p_device_id text, p_latitude double precision, p_longitude double precision,
  p_eta timestamptz, p_status text default 'driving'
) returns void language plpgsql security definer set search_path = public as $$
begin
  update shared_trips set latitude=p_latitude, longitude=p_longitude, eta=p_eta,
    status=p_status, updated_at=now()
  where token=p_token and device_id=p_device_id and expires_at>now();
end; $$;

create or replace function public.get_shared_trip(p_token uuid)
returns table(latitude double precision, longitude double precision, destination text, eta timestamptz, status text, updated_at timestamptz)
language sql security definer set search_path = public as $$
  select latitude, longitude, destination, eta, status, updated_at
  from shared_trips where token=p_token and expires_at>now();
$$;

grant execute on function public.start_shared_trip(text,double precision,double precision,text,timestamptz) to anon, authenticated;
grant execute on function public.update_shared_trip(uuid,text,double precision,double precision,timestamptz,text) to anon, authenticated;
grant execute on function public.get_shared_trip(uuid) to anon, authenticated;
