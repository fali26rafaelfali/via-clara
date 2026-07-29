create extension if not exists pgcrypto;

create table if not exists public.road_reports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('accident','traffic','works','hazard','vehicle')),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  device_id text not null check (char_length(device_id) between 16 and 80),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  confirmations integer not null default 1 check (confirmations >= 0),
  denials integer not null default 0 check (denials >= 0),
  status text not null default 'active' check (status in ('active','cleared'))
);

create index if not exists road_reports_active_idx on public.road_reports (status, expires_at);
create index if not exists road_reports_location_idx on public.road_reports (latitude, longitude);

create table if not exists public.report_votes (
  report_id uuid not null references public.road_reports(id) on delete cascade,
  device_id text not null,
  vote boolean not null,
  created_at timestamptz not null default now(),
  primary key (report_id, device_id)
);

alter table public.road_reports enable row level security;
alter table public.report_votes enable row level security;
revoke all on public.road_reports from anon, authenticated;
revoke all on public.report_votes from anon, authenticated;
grant select on public.road_reports to anon, authenticated;

create policy "read active reports" on public.road_reports
for select to anon, authenticated
using (status = 'active' and expires_at > now());

create or replace function public.report_road_incident(
  p_kind text, p_latitude double precision, p_longitude double precision, p_device_id text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_expiry interval;
begin
  if p_kind not in ('accident','traffic','works','hazard','vehicle')
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180
     or char_length(p_device_id) not between 16 and 80 then raise exception 'invalid report'; end if;
  if exists (select 1 from road_reports where device_id=p_device_id and created_at > now()-interval '60 seconds')
    then raise exception 'rate limited'; end if;
  select id into v_id from road_reports
    where kind=p_kind and status='active' and expires_at>now()
      and abs(latitude-p_latitude)<0.001 and abs(longitude-p_longitude)<0.001
    order by created_at desc limit 1;
  if v_id is not null then
    insert into report_votes(report_id,device_id,vote) values(v_id,p_device_id,true) on conflict do nothing;
    if found then update road_reports set confirmations=confirmations+1 where id=v_id; end if;
    return v_id;
  end if;
  v_expiry := case p_kind when 'traffic' then interval '45 minutes' when 'vehicle' then interval '1 hour'
    when 'accident' then interval '90 minutes' when 'hazard' then interval '2 hours' else interval '8 hours' end;
  insert into road_reports(kind,latitude,longitude,device_id,expires_at)
    values(p_kind,p_latitude,p_longitude,p_device_id,now()+v_expiry) returning id into v_id;
  insert into report_votes(report_id,device_id,vote) values(v_id,p_device_id,true);
  return v_id;
end; $$;

create or replace function public.vote_road_report(p_report_id uuid,p_device_id text,p_present boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if char_length(p_device_id) not between 16 and 80 then raise exception 'invalid device'; end if;
  insert into report_votes(report_id,device_id,vote) values(p_report_id,p_device_id,p_present) on conflict do nothing;
  if found then
    if p_present then update road_reports set confirmations=confirmations+1 where id=p_report_id;
    else update road_reports set denials=denials+1,
      status=case when denials+1>=3 then 'cleared' else status end where id=p_report_id; end if;
  end if;
end; $$;

grant execute on function public.report_road_incident(text,double precision,double precision,text) to anon, authenticated;
grant execute on function public.vote_road_report(uuid,text,boolean) to anon, authenticated;
