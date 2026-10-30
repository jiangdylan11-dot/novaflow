-- Public compute assistants enroll as pending devices. Only administrators can
-- assign an owner and turn on use. Quotas are enforced in the same transaction.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
alter table public.gpu_workers alter column owner_id drop not null;
alter table public.gpu_workers add column if not exists name_managed boolean not null default false;
do $constraint$ begin
  if not exists(select 1 from pg_constraint where conname='gpu_workers_pending_permissions_check'
    and conrelid='public.gpu_workers'::regclass) then
    alter table public.gpu_workers add constraint gpu_workers_pending_permissions_check
      check(owner_id is not null or (not enabled and not owner_enabled and not sharing_enabled));
  end if;
end $constraint$;
create table if not exists public.web_compute_enrollment_limits (
  peer_hash text primary key check(length(peer_hash)=64),
  window_start timestamptz not null default now(),
  enrolled_count integer not null default 0 check(enrolled_count>=0)
);
alter table public.web_compute_enrollment_limits enable row level security;
revoke all on public.web_compute_enrollment_limits from public,anon,authenticated;
grant select,insert,update,delete on public.web_compute_enrollment_limits to service_role;

create or replace function public.novaflow_web_reserve_compute_enrollment(p_peer_hash text)
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v_limit public.web_compute_enrollment_limits%rowtype;
begin
  perform pg_advisory_xact_lock(73240,300);
  if length(coalesce(p_peer_hash,''))<>64 then
    raise exception using errcode='22023',message='invalid enrollment peer';
  end if;
  delete from public.web_compute_enrollment_limits where window_start<now()-interval '2 hours';
  insert into public.web_compute_enrollment_limits(peer_hash) values(p_peer_hash) on conflict do nothing;
  select * into v_limit from public.web_compute_enrollment_limits where peer_hash=p_peer_hash for update;
  if v_limit.window_start<=now()-interval '1 hour' then
    update public.web_compute_enrollment_limits set window_start=now(),enrolled_count=0 where peer_hash=p_peer_hash;
    v_limit.enrolled_count:=0;
  end if;
  if v_limit.enrolled_count>=10 then
    raise exception using errcode='P0001',message='compute enrollment rate limit';
  end if;
  if (select count(*) from public.gpu_workers where not enabled and not owner_enabled and not sharing_enabled)>=1000 then
    raise exception using errcode='P0001',message='compute pending enrollment capacity reached';
  end if;
  update public.web_compute_enrollment_limits set enrolled_count=enrolled_count+1 where peer_hash=p_peer_hash;
end;
$$;
revoke all on function public.novaflow_web_reserve_compute_enrollment(text) from public,anon,authenticated;
grant execute on function public.novaflow_web_reserve_compute_enrollment(text) to service_role;

create or replace function public.novaflow_web_register_worker(
  p_worker_id uuid,
  p_owner_id uuid,
  p_worker_name text,
  p_secret_hash text,
  p_hardware jsonb
)
returns public.gpu_workers
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_worker public.gpu_workers%rowtype;
  v_hw jsonb := coalesce(p_hardware, '{}'::jsonb);
  v_name text := btrim(coalesce(p_worker_name, ''));
begin
  if p_owner_id is null and not exists(select 1 from public.gpu_workers where id=p_worker_id) then
    raise exception using errcode = '22023', message = 'register_worker: owner is required';
  end if;
  if p_worker_id is null then
    raise exception using errcode = '22023', message = 'register_worker: worker id is required';
  end if;
  if char_length(v_name) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'register_worker: invalid worker name';
  end if;
  if coalesce(btrim(p_secret_hash), '') = '' then
    raise exception using errcode = '22023', message = 'register_worker: secret hash is required';
  end if;

  -- No client profile, account session or legacy code can grant compute access.
  -- Keep enrollment checks atomic for every registration path.
  perform pg_advisory_xact_lock(73240,300);
  if not exists(select 1 from public.gpu_workers where id=p_worker_id) then
    perform public.novaflow_web_reserve_compute_enrollment(v_hw->>'enrollment_peer_hash');
  end if;

  insert into public.gpu_workers as w (
    id, worker_name, owner_id, worker_secret_hash, status, enabled, owner_enabled, sharing_enabled,
    gpu_name, vram_mb, ram_mb, driver_version, cuda_version,
    worker_version, comfy_version, endpoint_url, transport, last_heartbeat
  ) values (
    p_worker_id, v_name, p_owner_id, p_secret_hash, 'idle', false, false, false,
    left(coalesce(v_hw ->> 'gpu_name', ''), 200),
    greatest(coalesce((v_hw ->> 'vram_mb')::integer, 0), 0),
    greatest(coalesce((v_hw ->> 'ram_mb')::integer, 0), 0),
    left(coalesce(v_hw ->> 'driver_version', ''), 80),
    left(coalesce(v_hw ->> 'cuda_version', ''), 80),
    left(coalesce(v_hw ->> 'worker_version', ''), 40),
    left(coalesce(v_hw ->> 'comfy_version', ''), 40),
    left(coalesce(v_hw ->> 'endpoint_url', ''), 500),
    coalesce(nullif(v_hw ->> 'transport', ''), 'direct'),
    now()
  )
  on conflict (id) do update
    set worker_secret_hash = excluded.worker_secret_hash,
        worker_name = case when w.name_managed then w.worker_name else excluded.worker_name end,
        gpu_name = excluded.gpu_name,
        vram_mb = excluded.vram_mb,
        ram_mb = excluded.ram_mb,
        driver_version = excluded.driver_version,
        cuda_version = excluded.cuda_version,
        worker_version = excluded.worker_version,
        comfy_version = excluded.comfy_version,
        endpoint_url = excluded.endpoint_url,
        transport = excluded.transport,
        status = case when w.status = 'maintenance' then 'maintenance' else 'idle' end,
        last_heartbeat = now(),
        updated_at = now()
  where w.worker_secret_hash = coalesce(nullif(v_hw->>'previous_secret_hash',''),p_secret_hash)
  returning * into v_worker;
  if v_worker.id is null then
    raise exception using errcode='23505',message='register: this worker id is already registered with another secret';
  end if;

  return v_worker;
end;
$$;



create or replace function public.novaflow_web_enroll_pending_worker(
  p_worker_id uuid, p_worker_name text, p_secret_hash text, p_hardware jsonb, p_peer_hash text
) returns public.gpu_workers language plpgsql security invoker
set search_path=pg_catalog,public as $$
declare
  v_worker public.gpu_workers%rowtype;
begin
  -- One bounded enrollment critical section prevents concurrent quota bypass.
  perform pg_advisory_xact_lock(73240,300);
  select * into v_worker from public.gpu_workers where id=p_worker_id for update;
  if v_worker.id is not null then
    if v_worker.worker_secret_hash<>p_secret_hash then
      raise exception using errcode='23505',message='enroll: this worker id is already registered with another secret';
    end if;
    -- An idempotent retry may arrive after approval; it must preserve everything.
    return v_worker;
  end if;
  if p_worker_id is null or length(btrim(coalesce(p_worker_name,''))) not between 1 and 80
    or length(coalesce(p_secret_hash,''))<>64 or length(coalesce(p_peer_hash,''))<>64 then
    raise exception using errcode='22023',message='invalid pending enrollment';
  end if;
  perform public.novaflow_web_reserve_compute_enrollment(p_peer_hash);
  insert into public.gpu_workers(id,worker_name,owner_id,worker_secret_hash,status,
    enabled,owner_enabled,sharing_enabled,sharing_scope,gpu_name,vram_mb,ram_mb,worker_version,
    comfy_version,endpoint_url,transport,last_heartbeat)
  values(p_worker_id,btrim(p_worker_name),null,p_secret_hash,'idle',false,false,false,'selected',
    left(coalesce(p_hardware->>'gpu_name',''),200),
    greatest(coalesce((p_hardware->>'vram_mb')::integer,0),0),
    greatest(coalesce((p_hardware->>'ram_mb')::integer,0),0),
    left(coalesce(p_hardware->>'worker_version',''),40),
    left(coalesce(p_hardware->>'comfy_version',''),40),
    left(coalesce(p_hardware->>'endpoint_url',''),500),
    coalesce(nullif(p_hardware->>'transport',''),'direct'),now()) returning * into v_worker;
  return v_worker;
end;
$$;
revoke all on function public.novaflow_web_enroll_pending_worker(uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.novaflow_web_enroll_pending_worker(uuid,text,text,jsonb,text) to service_role;
commit;
