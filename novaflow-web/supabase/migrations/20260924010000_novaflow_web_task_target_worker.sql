-- NovaFlow Web: a task may be pinned to one compute node.
--
-- The topbar's 算力源 picker lets a 高级账户 choose which machine in the pool
-- runs its work. The control plane writes that choice into
-- input_manifest.target_worker_id; this migration teaches the scheduler to
-- honour it: a pinned task is claimed only by the node it names, every other
-- worker skips it. An unpinned task (no key, or null) behaves exactly as before.
--
-- Same signature, same grants as the original in
-- 20260922010000_novaflow_web_worker_fabric.sql, so the rollback script there
-- still removes it. Safe to apply twice.

begin;

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
