-- NovaFlow Web: 普通 / 高级 compute nodes.
--
-- Accounts come in three tiers (users.plan): trial 普通账户 runs only on its
-- own machine, standard 中级账户 may use 普通 pool nodes, pro 高级账户 may
-- use every node. This migration gives the pool the matching split:
--
--   * gpu_workers.tier                     'standard' | 'premium'
--   * web_worker_registration_codes.tier   the tier a code admits a machine as
--   * novaflow_web_claim_task              a task whose owner may not use 高级
--                                          nodes is never claimed by one
--
-- The control plane writes input_manifest.allow_premium_nodes when it creates
-- a task; a task without the key (created before this migration) behaves as
-- before and may run anywhere.
--
-- ADDITIVE ONLY: two nullable-defaulted columns on Web-owned tables and a
-- rebuild of a Web-owned function with the same signature and grants, so the
-- rollback script for the worker fabric still removes everything. Safe to
-- apply twice.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table public.gpu_workers
  add column if not exists tier text not null default 'standard';

alter table public.web_worker_registration_codes
  add column if not exists tier text not null default 'standard';

do $novaflow_web_node_tiers$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'gpu_workers_tier_check' and conrelid = 'public.gpu_workers'::regclass
  ) then
    alter table public.gpu_workers
      add constraint gpu_workers_tier_check check (tier in ('standard', 'premium'));
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'web_worker_registration_codes_tier_check'
       and conrelid = 'public.web_worker_registration_codes'::regclass
  ) then
    alter table public.web_worker_registration_codes
      add constraint web_worker_registration_codes_tier_check check (tier in ('standard', 'premium'));
  end if;
end
$novaflow_web_node_tiers$;

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
  if v_worker.status <> 'idle' then return v_task; end if;
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
     and (v_worker.tier <> 'premium'
          or coalesce(t.input_manifest ->> 'allow_premium_nodes', 'true') <> 'false')
     and exists (
       select 1 from public.worker_models wm
        where wm.worker_id = v_worker.id
          and wm.model_id = t.model_id
          and wm.status = 'ready'
     )
     and v_worker.vram_mb >= coalesce((t.input_manifest ->> 'min_vram_mb')::integer, 0)
   order by t.created_at
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

revoke all on function public.novaflow_web_claim_task(uuid, integer) from public, anon, authenticated;
grant execute on function public.novaflow_web_claim_task(uuid, integer) to service_role;

commit;
