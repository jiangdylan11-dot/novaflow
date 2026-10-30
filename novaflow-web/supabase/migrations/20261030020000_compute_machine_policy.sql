-- Independent administrator policy for compute-only assistants. Runtime heartbeats
-- never write these fields. Existing nodes keep their access until configured.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
-- Only the first upgrade translates old administrator maintenance status.
do $upgrade$ begin
  if not exists(select 1 from information_schema.columns where table_schema='public'
    and table_name='gpu_workers' and column_name='enabled') then
    alter table public.gpu_workers add column enabled boolean not null default true;
    update public.gpu_workers set enabled=false where status='maintenance';
  end if;
end $upgrade$;
alter table public.gpu_workers
  add column if not exists owner_enabled boolean not null default true,
  add column if not exists sharing_enabled boolean not null default true,
  add column if not exists sharing_scope text not null default 'pool',
  add column if not exists allowed_user_ids uuid[] not null default '{}';
do $policy$ begin
  if not exists(select 1 from pg_constraint where conname='gpu_workers_sharing_scope_check'
    and conrelid='public.gpu_workers'::regclass) then
    alter table public.gpu_workers add constraint gpu_workers_sharing_scope_check
      check (sharing_scope in ('pool','selected'));
  end if;
end $policy$;

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
  if p_owner_id is null then
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

  insert into public.gpu_workers as w (
    id, worker_name, owner_id, worker_secret_hash, status, sharing_enabled,
    gpu_name, vram_mb, ram_mb, driver_version, cuda_version,
    worker_version, comfy_version, endpoint_url, transport, last_heartbeat
  ) values (
    p_worker_id, v_name, p_owner_id, p_secret_hash, 'idle',
    coalesce(v_hw->>'registration_profile','') <> 'compute-only',
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
        worker_name = excluded.worker_name,
        owner_id = excluded.owner_id,
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
  returning * into v_worker;

  return v_worker;
end;
$$;


create or replace function public.novaflow_web_worker_can_serve(
  p_worker_id uuid, p_user_id uuid, p_allow_premium boolean default true,
  p_allow_shared boolean default true
) returns boolean language sql stable security invoker
set search_path = pg_catalog, public as $$
  select coalesce((select w.enabled and case
    when p_user_id=w.owner_id then w.owner_enabled
    else p_allow_shared and w.sharing_enabled
      and (w.sharing_scope='pool' or p_user_id=any(w.allowed_user_ids))
      and (w.tier<>'premium' or p_allow_premium)
      and (p_user_id is null or exists(select 1 from public.users u where u.id=p_user_id
        and lower(coalesce(u.plan,'trial')) in ('standard','pro','team')
        and (w.tier<>'premium' or lower(u.plan) in ('pro','team'))))
    end from public.gpu_workers w where w.id=p_worker_id),false);
$$;

create or replace function public.novaflow_web_count_capable_workers(
  p_model_id text, p_min_vram integer, p_timeout integer, p_worker_id uuid default null,
  p_allow_premium boolean default true, p_user_id uuid default null, p_allow_shared boolean default true
) returns integer language sql stable security invoker
set search_path = pg_catalog, public as $$
  select count(*)::integer from public.gpu_workers w
  where w.status in ('idle','busy') and (p_worker_id is null or w.id=p_worker_id)
    and public.novaflow_web_worker_can_serve(w.id,p_user_id,p_allow_premium,p_allow_shared)
    and w.vram_mb>=p_min_vram and w.last_heartbeat>now()-make_interval(secs=>p_timeout)
    and exists(select 1 from public.worker_models wm where wm.worker_id=w.id
      and wm.model_id=p_model_id and wm.status='ready');
$$;

create or replace function public.novaflow_web_capable_model_details(
  p_model_id text, p_min_vram integer, p_timeout integer, p_user_id uuid default null,
  p_allow_premium boolean default true, p_allow_shared boolean default true
) returns table(detail jsonb) language sql stable security invoker
set search_path = pg_catalog, public as $$
  select wm.detail from public.worker_models wm join public.gpu_workers w on w.id=wm.worker_id
  where wm.model_id=p_model_id and wm.status='ready' and w.status in ('idle','busy')
    and w.vram_mb>=p_min_vram and w.last_heartbeat>now()-make_interval(secs=>p_timeout)
    and public.novaflow_web_worker_can_serve(w.id,p_user_id,p_allow_premium,p_allow_shared);
$$;
create or replace function public.novaflow_web_claim_task(
  p_worker_id uuid,
  p_heartbeat_timeout_seconds integer default 75
)
returns public.web_ai_tasks
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_worker public.gpu_workers%rowtype;
  v_task public.web_ai_tasks%rowtype;
begin
  select * into v_worker from public.gpu_workers where id = p_worker_id for update;
  if v_worker.id is null then
    raise exception using errcode = 'P0002', message = 'claim: unknown worker';
  end if;

  -- A worker that is busy, in maintenance, or whose heartbeat has lapsed gets
  -- nothing. This is the same predicate the sweeper uses, so a worker cannot
  -- claim its way around being considered offline.
  if not v_worker.enabled or v_worker.status <> 'idle' then return v_task; end if;
  if v_worker.last_heartbeat is null
     or v_worker.last_heartbeat < now() - make_interval(secs => greatest(coalesce(p_heartbeat_timeout_seconds, 75), 5))
  then
    return v_task;
  end if;
  if exists (
    select 1 from public.web_ai_tasks t
     where t.assigned_worker_id = v_worker.id
       and t.status in ('assigned', 'uploading', 'processing')
  ) then
    return v_task;
  end if;

  select t.* into v_task
    from public.web_ai_tasks t
   where t.status = 'queued'
     and (t.expires_at is null or t.expires_at > now())
     -- A task pinned to one node waits for that node; nobody else takes it.
     and (t.input_manifest ->> 'target_worker_id' is null
          or t.input_manifest ->> 'target_worker_id' = v_worker.id::text)
     -- A 高级 node only takes work whose owner may use 高级 nodes. The control
     -- plane writes the flag; a task without it (older) may run anywhere.
     and public.novaflow_web_worker_can_serve(v_worker.id, t.user_id,
          coalesce(t.input_manifest ->> 'allow_premium_nodes', 'true') <> 'false', true)
     and exists (
       select 1 from public.worker_models wm
        where wm.worker_id = v_worker.id
          and wm.model_id = t.model_id
          and wm.status = 'ready'
     )
     and v_worker.vram_mb >= coalesce((t.input_manifest ->> 'min_vram_mb')::integer, 0)
   order by (t.user_id = v_worker.owner_id) desc, t.created_at
   for update of t skip locked
   limit 1;

  if v_task.id is null then return v_task; end if;

  update public.web_ai_tasks
     set status = 'assigned',
         assigned_worker_id = v_worker.id,
         assigned_at = now(),
         attempt_count = attempt_count + 1,
         last_progress_at = now(),
         updated_at = now()
   where id = v_task.id
  returning * into v_task;

  update public.gpu_workers
     set status = 'busy',
         current_task_id = v_task.id,
         last_assigned_at = now(),
         total_assigned = total_assigned + 1,
         updated_at = now()
   where id = v_worker.id;

  perform public.novaflow_web_log_event(v_task.id, 'queued', 'assigned', 'scheduler', v_worker.id,
    jsonb_build_object('attempt', v_task.attempt_count));
  return v_task;
end;
$$;

revoke all on function public.novaflow_web_worker_can_serve(uuid,uuid,boolean,boolean) from public,anon,authenticated;
revoke all on function public.novaflow_web_count_capable_workers(text,integer,integer,uuid,boolean,uuid,boolean) from public,anon,authenticated;
revoke all on function public.novaflow_web_capable_model_details(text,integer,integer,uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.novaflow_web_worker_can_serve(uuid,uuid,boolean,boolean) to service_role;
grant execute on function public.novaflow_web_count_capable_workers(text,integer,integer,uuid,boolean,uuid,boolean) to service_role;
grant execute on function public.novaflow_web_capable_model_details(text,integer,integer,uuid,boolean,boolean) to service_role;
commit;
