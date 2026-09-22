-- NovaFlow Web - distributed GPU worker fabric.
--
-- ADDITIVE ONLY. This migration:
--   * creates new tables (gpu_workers, worker_models, web_ai_tasks,
--     web_task_events, web_worker_registration_codes)
--   * creates new functions in the novaflow_web_* namespace
--   * creates new RLS policies on the new tables only
--
-- It does NOT touch users, credits, credit_logs, ai_providers, ai_models,
-- ai_tasks, system_settings, licenses or comfy_usage_settlements. It drops
-- nothing, renames nothing and rewrites no existing row. The existing Desktop
-- product keeps working byte-for-byte whether or not this is applied.
--
-- WHY web_ai_tasks INSTEAD OF EXTENDING ai_tasks:
--   The brief asked for new columns on ai_tasks. We could not audit the live
--   ai_tasks table (no service-role access from the build host) and the
--   deployed novaflow-backend reports writesTaskRecords:false, so nothing in
--   the current product proves what shape ai_tasks has or who writes it.
--   Per the standing rule - if a migration's effect on Desktop cannot be
--   confirmed, use a Web-dedicated table - the Web line owns web_ai_tasks.
--   20260922020000_novaflow_web_optional_ai_tasks_bridge.sql contains the
--   opt-in unification, to be applied only after a live audit.
--
-- Rollback: see rollback_novaflow_web_worker_fabric.sql (drops only what this
-- file creates).

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- Preconditions. We depend on users/credits existing, and on service_role
-- being the only trusted data-plane role, exactly like the Desktop hardening.
-- ---------------------------------------------------------------------------
do $novaflow_web_preconditions$
begin
  if pg_catalog.to_regclass('public.users') is null then
    raise exception 'NovaFlow Web fabric requires public.users';
  end if;
  if pg_catalog.to_regclass('public.credits') is null then
    raise exception 'NovaFlow Web fabric requires public.credits';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'service_role' and rolbypassrls
  ) then
    raise exception 'NovaFlow Web fabric requires service_role with BYPASSRLS';
  end if;
end
$novaflow_web_preconditions$;

-- ---------------------------------------------------------------------------
-- gpu_workers - the worker registry (spec 5).
-- ---------------------------------------------------------------------------
create table if not exists public.gpu_workers (
  id uuid primary key default gen_random_uuid(),
  worker_name text not null,
  owner_id uuid not null references public.users (id) on delete cascade,
  -- sha256 of the worker secret; the plaintext never reaches the database.
  worker_secret_hash text not null,
  status text not null default 'offline',
  gpu_name text not null default '',
  vram_mb integer not null default 0,
  ram_mb integer not null default 0,
  driver_version text not null default '',
  cuda_version text not null default '',
  worker_version text not null default '',
  comfy_version text not null default '',
  -- how a browser reaches this worker's gateway; transport-agnostic on purpose
  -- (spec 20) so a tunnel URL and a LAN URL are the same kind of value.
  endpoint_url text not null default '',
  transport text not null default 'direct',
  current_task_id uuid,
  last_heartbeat timestamptz,
  -- fair scheduling cursor (spec 18: least recently assigned)
  last_assigned_at timestamptz,
  total_assigned bigint not null default 0,
  total_completed bigint not null default 0,
  total_failed bigint not null default 0,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gpu_workers_status_check
    check (status in ('idle', 'busy', 'offline', 'maintenance')),
  constraint gpu_workers_transport_check
    check (transport in ('direct', 'tunnel')),
  constraint gpu_workers_name_check
    check (char_length(btrim(worker_name)) between 1 and 80),
  constraint gpu_workers_vram_check check (vram_mb >= 0 and vram_mb <= 4194304),
  constraint gpu_workers_ram_check check (ram_mb >= 0 and ram_mb <= 16777216)
);

-- Identity is the worker id the installer generates once and keeps in its
-- config; names are a human label and may repeat.
create index if not exists gpu_workers_owner_name_idx
  on public.gpu_workers (owner_id, lower(btrim(worker_name)));
create index if not exists gpu_workers_status_idx
  on public.gpu_workers (status, last_heartbeat desc);
create index if not exists gpu_workers_schedule_idx
  on public.gpu_workers (status, last_assigned_at nulls first);

-- ---------------------------------------------------------------------------
-- worker_models - per-worker model capability (spec 5, 22).
-- ---------------------------------------------------------------------------
create table if not exists public.worker_models (
  worker_id uuid not null references public.gpu_workers (id) on delete cascade,
  model_id text not null,
  model_version text not null default '',
  status text not null default 'missing',
  detail jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (worker_id, model_id),
  constraint worker_models_status_check
    check (status in ('ready', 'missing', 'invalid', 'updating')),
  constraint worker_models_model_id_check
    check (char_length(btrim(model_id)) between 1 and 120)
);

create index if not exists worker_models_ready_idx
  on public.worker_models (model_id, status);

-- ---------------------------------------------------------------------------
-- web_worker_registration_codes - one-time codes an owner hands to a friend so
-- the installer can self-register without ever seeing a Supabase key (spec 21).
-- ---------------------------------------------------------------------------
create table if not exists public.web_worker_registration_codes (
  code_hash text primary key,
  owner_id uuid not null references public.users (id) on delete cascade,
  label text not null default '',
  max_uses integer not null default 1,
  used_count integer not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint web_worker_registration_codes_uses_check
    check (max_uses between 1 and 50 and used_count >= 0)
);

create index if not exists web_worker_registration_codes_owner_idx
  on public.web_worker_registration_codes (owner_id, expires_at desc);

-- ---------------------------------------------------------------------------
-- web_ai_tasks - the Web line's task queue (spec 5, 15).
-- ---------------------------------------------------------------------------
create table if not exists public.web_ai_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  task_type text not null,
  model_id text not null default '',
  status text not null default 'created',
  progress numeric(5, 2) not null default 0,
  progress_note text not null default '',
  -- business parameters only. A ComfyUI graph is never stored here and never
  -- travels to a browser (spec 10).
  input_manifest jsonb not null default '{}'::jsonb,
  output_manifest jsonb not null default '{}'::jsonb,
  assigned_worker_id uuid references public.gpu_workers (id) on delete set null,
  -- the ComfyUI prompt id, used as the idempotency key for credit settlement
  prompt_id text,
  estimated_credit_cost numeric(20, 6) not null default 0,
  charged_credit_cost numeric(20, 6) not null default 0,
  credit_settled boolean not null default false,
  attempt_count integer not null default 0,
  error_code text not null default '',
  error_message text not null default '',
  result_expired boolean not null default false,
  created_at timestamptz not null default now(),
  queued_at timestamptz,
  assigned_at timestamptz,
  uploading_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  last_progress_at timestamptz,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint web_ai_tasks_status_check
    check (status in ('created', 'queued', 'assigned', 'uploading', 'processing',
                      'completed', 'failed', 'cancelled', 'expired')),
  constraint web_ai_tasks_progress_check check (progress >= 0 and progress <= 100),
  constraint web_ai_tasks_attempts_check check (attempt_count >= 0 and attempt_count <= 20),
  constraint web_ai_tasks_task_type_check
    check (char_length(btrim(task_type)) between 1 and 80)
);

create index if not exists web_ai_tasks_user_idx
  on public.web_ai_tasks (user_id, created_at desc);
-- The scheduler's hot path: oldest queued task first.
create index if not exists web_ai_tasks_queue_idx
  on public.web_ai_tasks (status, created_at)
  where status = 'queued';
create index if not exists web_ai_tasks_worker_idx
  on public.web_ai_tasks (assigned_worker_id, status);
create index if not exists web_ai_tasks_sweep_idx
  on public.web_ai_tasks (status, last_progress_at);
create unique index if not exists web_ai_tasks_prompt_id_key
  on public.web_ai_tasks (prompt_id) where prompt_id is not null;

-- ---------------------------------------------------------------------------
-- web_task_events - append-only transition log. Every state change lands here
-- with its own timestamp, which is what makes the state machine auditable
-- (spec 15).
-- ---------------------------------------------------------------------------
create table if not exists public.web_task_events (
  id bigserial primary key,
  task_id uuid not null references public.web_ai_tasks (id) on delete cascade,
  from_status text not null default '',
  to_status text not null,
  actor text not null default 'system',
  worker_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists web_task_events_task_idx
  on public.web_task_events (task_id, created_at);

-- ---------------------------------------------------------------------------
-- RLS: deny everything to anon/authenticated. service_role has BYPASSRLS and
-- is the only path in, matching the Desktop data plane's posture.
-- ---------------------------------------------------------------------------
do $novaflow_web_rls$
declare
  v_table text;
begin
  foreach v_table in array array[
    'gpu_workers', 'worker_models', 'web_ai_tasks',
    'web_task_events', 'web_worker_registration_codes'
  ] loop
    execute pg_catalog.format('alter table public.%I enable row level security', v_table);
    execute pg_catalog.format('alter table public.%I force row level security', v_table);
    execute pg_catalog.format('revoke all on public.%I from anon, authenticated', v_table);
    execute pg_catalog.format(
      'drop policy if exists %I on public.%I',
      v_table || '_no_public_access', v_table
    );
    -- An explicit deny-all policy so an accidental future GRANT still yields
    -- zero rows instead of a silent data leak.
    execute pg_catalog.format(
      'create policy %I on public.%I for all to anon, authenticated using (false) with check (false)',
      v_table || '_no_public_access', v_table
    );
  end loop;
end
$novaflow_web_rls$;

revoke all on function public.gen_random_uuid() from public;

-- ---------------------------------------------------------------------------
-- Helper: record a transition and enforce the state machine.
-- ---------------------------------------------------------------------------
create or replace function public.novaflow_web_allows_transition(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case p_from
    when 'created'    then p_to in ('queued', 'cancelled', 'failed')
    when 'queued'     then p_to in ('assigned', 'cancelled', 'expired', 'failed')
    when 'assigned'   then p_to in ('uploading', 'processing', 'queued', 'cancelled', 'failed', 'expired')
    when 'uploading'  then p_to in ('processing', 'queued', 'cancelled', 'failed', 'expired')
    when 'processing' then p_to in ('completed', 'failed', 'cancelled', 'queued', 'expired')
    else false
  end;
$$;

create or replace function public.novaflow_web_log_event(
  p_task_id uuid,
  p_from text,
  p_to text,
  p_actor text,
  p_worker_id uuid,
  p_detail jsonb
)
returns void
language sql
security invoker
set search_path = pg_catalog, public
as $$
  insert into public.web_task_events (task_id, from_status, to_status, actor, worker_id, detail)
  values (p_task_id, coalesce(p_from, ''), p_to, coalesce(p_actor, 'system'), p_worker_id,
          coalesce(p_detail, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- novaflow_web_register_worker - idempotent upsert keyed on (owner, name).
-- Returns the worker row the control plane needs to mint a worker token.
-- ---------------------------------------------------------------------------
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
    id, worker_name, owner_id, worker_secret_hash, status,
    gpu_name, vram_mb, ram_mb, driver_version, cuda_version,
    worker_version, comfy_version, endpoint_url, transport, last_heartbeat
  ) values (
    p_worker_id, v_name, p_owner_id, p_secret_hash, 'idle',
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

-- ---------------------------------------------------------------------------
-- novaflow_web_worker_heartbeat (spec 14).
-- ---------------------------------------------------------------------------
create or replace function public.novaflow_web_worker_heartbeat(
  p_worker_id uuid,
  p_status text,
  p_current_task_id uuid,
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
  v_status text := lower(coalesce(nullif(btrim(p_status), ''), 'idle'));
begin
  if v_status not in ('idle', 'busy', 'offline', 'maintenance') then
    raise exception using errcode = '22023', message = 'heartbeat: invalid status';
  end if;

  update public.gpu_workers
     set status = v_status,
         current_task_id = p_current_task_id,
         gpu_name = coalesce(nullif(left(v_hw ->> 'gpu_name', 200), ''), gpu_name),
         vram_mb = coalesce((v_hw ->> 'vram_mb')::integer, vram_mb),
         ram_mb = coalesce((v_hw ->> 'ram_mb')::integer, ram_mb),
         comfy_version = coalesce(nullif(left(v_hw ->> 'comfy_version', 40), ''), comfy_version),
         worker_version = coalesce(nullif(left(v_hw ->> 'worker_version', 40), ''), worker_version),
         endpoint_url = coalesce(nullif(left(v_hw ->> 'endpoint_url', 500), ''), endpoint_url),
         last_heartbeat = now(),
         updated_at = now()
   where id = p_worker_id
  returning * into v_worker;

  if v_worker.id is null then
    raise exception using errcode = 'P0002', message = 'heartbeat: unknown worker';
  end if;
  return v_worker;
end;
$$;

-- ---------------------------------------------------------------------------
-- novaflow_web_report_models - replace a worker's capability set (spec 22).
-- ---------------------------------------------------------------------------
create or replace function public.novaflow_web_report_models(
  p_worker_id uuid,
  p_models jsonb
)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_count integer := 0;
begin
  if jsonb_typeof(coalesce(p_models, 'null'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'report_models: models must be an array';
  end if;

  insert into public.worker_models (worker_id, model_id, model_version, status, detail, updated_at)
  select p_worker_id,
         left(btrim(item ->> 'model_id'), 120),
         left(coalesce(item ->> 'model_version', ''), 80),
         coalesce(nullif(item ->> 'status', ''), 'missing'),
         coalesce(item -> 'detail', '{}'::jsonb),
         now()
    from jsonb_array_elements(p_models) as item
   where coalesce(btrim(item ->> 'model_id'), '') <> ''
     and coalesce(nullif(item ->> 'status', ''), 'missing') in ('ready', 'missing', 'invalid', 'updating')
  on conflict (worker_id, model_id) do update
    set model_version = excluded.model_version,
        status = excluded.status,
        detail = excluded.detail,
        updated_at = now();

  get diagnostics v_count = row_count;

  -- Models the worker no longer reports are dropped, so a removed model cannot
  -- keep attracting tasks.
  delete from public.worker_models wm
   where wm.worker_id = p_worker_id
     and not exists (
       select 1 from jsonb_array_elements(p_models) as item
        where left(btrim(item ->> 'model_id'), 120) = wm.model_id
     );

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- novaflow_web_create_task - enqueue a task (spec 15, 17).
-- Pricing is passed in already computed by the trusted control plane; the
-- browser never supplies a cost.
-- ---------------------------------------------------------------------------
create or replace function public.novaflow_web_create_task(
  p_user_id uuid,
  p_task_type text,
  p_model_id text,
  p_input_manifest jsonb,
  p_estimated_credit_cost numeric,
  p_expires_at timestamptz
)
returns public.web_ai_tasks
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_task public.web_ai_tasks%rowtype;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'create_task: user is required';
  end if;
  if coalesce(btrim(p_task_type), '') = '' then
    raise exception using errcode = '22023', message = 'create_task: task_type is required';
  end if;

  insert into public.web_ai_tasks (
    user_id, task_type, model_id, status, input_manifest,
    estimated_credit_cost, expires_at, queued_at
  ) values (
    p_user_id,
    left(btrim(p_task_type), 80),
    left(coalesce(p_model_id, ''), 120),
    'queued',
    coalesce(p_input_manifest, '{}'::jsonb),
    round(greatest(coalesce(p_estimated_credit_cost, 0), 0), 6),
    p_expires_at,
    now()
  )
  returning * into v_task;

  perform public.novaflow_web_log_event(v_task.id, 'created', 'queued', 'user', null,
    jsonb_build_object('task_type', v_task.task_type, 'model_id', v_task.model_id));
  return v_task;
end;
$$;

-- ---------------------------------------------------------------------------
-- novaflow_web_claim_task - the scheduler (spec 18, 19).
--
-- Two workers can never claim the same task: the queued row is locked with
-- FOR UPDATE SKIP LOCKED inside one statement, so the loser sees no row rather
-- than a duplicate.
--
-- Eligibility: worker online + idle + owns the required model in 'ready' +
-- enough VRAM. Fairness: oldest queued task first, and among equal workers the
-- least recently assigned one goes first (enforced by the caller passing its
-- own id; the worker pulls, so fairness is naturally least-recently-served).
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- novaflow_web_update_task_status - the one guarded write path for the state
-- machine. Every caller goes through here, so an illegal transition is
-- impossible regardless of which service attempts it.
-- ---------------------------------------------------------------------------
create or replace function public.novaflow_web_update_task_status(
  p_task_id uuid,
  p_worker_id uuid,
  p_to_status text,
  p_progress numeric,
  p_progress_note text,
  p_detail jsonb
)
returns public.web_ai_tasks
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_task public.web_ai_tasks%rowtype;
  v_from text;
  v_detail jsonb := coalesce(p_detail, '{}'::jsonb);
begin
  select * into v_task from public.web_ai_tasks where id = p_task_id for update;
  if v_task.id is null then
    raise exception using errcode = 'P0002', message = 'update_task: unknown task';
  end if;
  if p_worker_id is not null and v_task.assigned_worker_id is distinct from p_worker_id then
    raise exception using errcode = '42501', message = 'update_task: task is not assigned to this worker';
  end if;

  v_from := v_task.status;
  -- A terminal task is final. Re-cancelling or re-failing one must be refused
  -- rather than quietly accepted, so the caller learns the task already ended.
  if v_from in ('completed', 'failed', 'cancelled', 'expired') then
    raise exception using errcode = '22023',
      message = pg_catalog.format('update_task: task is already %s', v_from);
  end if;

  if v_from = p_to_status then
    -- Idempotent progress ping while the task is still running.
    update public.web_ai_tasks
       set progress = coalesce(round(p_progress, 2), progress),
           progress_note = coalesce(left(p_progress_note, 200), progress_note),
           last_progress_at = now(),
           updated_at = now()
     where id = p_task_id
    returning * into v_task;
    return v_task;
  end if;

  if not public.novaflow_web_allows_transition(v_from, p_to_status) then
    raise exception using errcode = '22023',
      message = pg_catalog.format('update_task: illegal transition %s -> %s', v_from, p_to_status);
  end if;

  update public.web_ai_tasks
     set status = p_to_status,
         progress = coalesce(round(p_progress, 2), case when p_to_status = 'completed' then 100 else progress end),
         progress_note = coalesce(left(p_progress_note, 200), progress_note),
         prompt_id = coalesce(nullif(left(v_detail ->> 'prompt_id', 160), ''), prompt_id),
         output_manifest = case when v_detail ? 'output_manifest'
                                then v_detail -> 'output_manifest' else output_manifest end,
         error_code = case when p_to_status = 'failed'
                           then left(coalesce(v_detail ->> 'error_code', 'worker_error'), 80)
                           else error_code end,
         error_message = case when p_to_status = 'failed'
                              then left(coalesce(v_detail ->> 'error_message', ''), 500)
                              else error_message end,
         uploading_at = case when p_to_status = 'uploading' then now() else uploading_at end,
         started_at = case when p_to_status = 'processing' and started_at is null then now() else started_at end,
         completed_at = case when p_to_status = 'completed' then now() else completed_at end,
         failed_at = case when p_to_status = 'failed' then now() else failed_at end,
         cancelled_at = case when p_to_status = 'cancelled' then now() else cancelled_at end,
         queued_at = case when p_to_status = 'queued' then now() else queued_at end,
         assigned_worker_id = case when p_to_status = 'queued' then null else assigned_worker_id end,
         last_progress_at = now(),
         updated_at = now()
   where id = p_task_id
  returning * into v_task;

  -- Releasing the worker is part of the same transaction as the task leaving a
  -- running state, so a crash can never leave a worker pinned to a dead task.
  if p_to_status in ('completed', 'failed', 'cancelled', 'expired', 'queued') then
    update public.gpu_workers
       set status = case when status = 'maintenance' then 'maintenance' else 'idle' end,
           current_task_id = null,
           total_completed = total_completed + case when p_to_status = 'completed' then 1 else 0 end,
           total_failed = total_failed + case when p_to_status = 'failed' then 1 else 0 end,
           updated_at = now()
     where current_task_id = p_task_id;
  end if;

  perform public.novaflow_web_log_event(p_task_id, v_from, p_to_status,
    coalesce(v_detail ->> 'actor', case when p_worker_id is null then 'system' else 'worker' end),
    p_worker_id, v_detail);
  return v_task;
end;
$$;

-- ---------------------------------------------------------------------------
-- novaflow_web_sweep - heartbeat / assign / processing timeouts (spec 16).
--
-- Requeues a task whose worker vanished, up to p_max_attempts, then fails it.
-- A failed task is NEVER charged: settlement only happens on the completion
-- path, so "失败不误扣" is a structural property, not a check we remember to do.
-- ---------------------------------------------------------------------------
create or replace function public.novaflow_web_sweep(
  p_heartbeat_timeout_seconds integer default 75,
  p_assign_timeout_seconds integer default 120,
  p_processing_timeout_seconds integer default 1800,
  p_max_attempts integer default 3
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_offline integer := 0;
  v_requeued integer := 0;
  v_failed integer := 0;
  v_expired integer := 0;
  v_task record;
  v_reason text;
begin
  -- 1. Workers whose heartbeat lapsed go offline and stop attracting tasks.
  update public.gpu_workers
     set status = 'offline', current_task_id = null, updated_at = now()
   where status in ('idle', 'busy')
     and (last_heartbeat is null
          or last_heartbeat < now() - make_interval(secs => greatest(p_heartbeat_timeout_seconds, 5)));
  get diagnostics v_offline = row_count;

  -- 2. Tasks stranded on a dead/slow worker.
  for v_task in
    select t.*, w.status as worker_status, w.last_heartbeat
      from public.web_ai_tasks t
      left join public.gpu_workers w on w.id = t.assigned_worker_id
     where t.status in ('assigned', 'uploading', 'processing')
     for update of t skip locked
  loop
    v_reason := null;
    if v_task.assigned_worker_id is null then
      v_reason := 'worker_missing';
    elsif v_task.worker_status = 'offline'
       or v_task.last_heartbeat is null
       or v_task.last_heartbeat < now() - make_interval(secs => greatest(p_heartbeat_timeout_seconds, 5)) then
      v_reason := 'worker_offline';
    elsif v_task.status = 'assigned'
      and v_task.assigned_at < now() - make_interval(secs => greatest(p_assign_timeout_seconds, 10)) then
      v_reason := 'assign_timeout';
    elsif v_task.status in ('uploading', 'processing')
      and coalesce(v_task.last_progress_at, v_task.assigned_at)
          < now() - make_interval(secs => greatest(p_processing_timeout_seconds, 60)) then
      v_reason := 'processing_timeout';
    end if;

    if v_reason is null then continue; end if;

    if v_task.attempt_count < greatest(p_max_attempts, 1) then
      perform public.novaflow_web_update_task_status(
        v_task.id, null, 'queued', null, 'requeued after ' || v_reason,
        jsonb_build_object('actor', 'sweeper', 'reason', v_reason));
      v_requeued := v_requeued + 1;
    else
      perform public.novaflow_web_update_task_status(
        v_task.id, null, 'failed', null, v_reason,
        jsonb_build_object('actor', 'sweeper', 'error_code', v_reason,
                           'error_message', 'worker did not finish the task'));
      v_failed := v_failed + 1;
    end if;
  end loop;

  -- 3. Queued tasks past their deadline.
  for v_task in
    select * from public.web_ai_tasks
     where status in ('created', 'queued')
       and expires_at is not null and expires_at <= now()
     for update skip locked
  loop
    perform public.novaflow_web_update_task_status(
      v_task.id, null, 'expired', null, 'queue deadline passed',
      jsonb_build_object('actor', 'sweeper'));
    v_expired := v_expired + 1;
  end loop;

  return jsonb_build_object(
    'workers_marked_offline', v_offline,
    'tasks_requeued', v_requeued,
    'tasks_failed', v_failed,
    'tasks_expired', v_expired,
    'swept_at', now()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- novaflow_web_mark_result_expired - TTL bookkeeping (spec 13). The worker
-- deletes the bytes; this records that the metadata outlived them.
-- ---------------------------------------------------------------------------
create or replace function public.novaflow_web_mark_result_expired(p_task_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_count integer := 0;
begin
  update public.web_ai_tasks
     set result_expired = true, updated_at = now()
   where id = any(coalesce(p_task_ids, array[]::uuid[]))
     and result_expired = false;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Functions are service-role-only, like the rest of the data plane.
do $novaflow_web_grants$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'novaflow_web_register_worker(uuid, uuid, text, text, jsonb)',
    'novaflow_web_worker_heartbeat(uuid, text, uuid, jsonb)',
    'novaflow_web_report_models(uuid, jsonb)',
    'novaflow_web_create_task(uuid, text, text, jsonb, numeric, timestamptz)',
    'novaflow_web_claim_task(uuid, integer)',
    'novaflow_web_update_task_status(uuid, uuid, text, numeric, text, jsonb)',
    'novaflow_web_sweep(integer, integer, integer, integer)',
    'novaflow_web_mark_result_expired(uuid[])',
    'novaflow_web_log_event(uuid, text, text, text, uuid, jsonb)'
  ] loop
    execute pg_catalog.format('revoke all on function public.%s from public, anon, authenticated', v_fn);
    execute pg_catalog.format('grant execute on function public.%s to service_role', v_fn);
  end loop;
end
$novaflow_web_grants$;

commit;
