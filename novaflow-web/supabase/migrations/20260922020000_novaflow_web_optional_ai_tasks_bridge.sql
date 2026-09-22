-- OPTIONAL. NOT APPLIED BY DEFAULT. NOT RUN BY THE TEST SUITE.
--
-- The brief asked for these columns on the existing public.ai_tasks:
--   assigned_worker_id, task_type, model_id, progress,
--   input_manifest, output_manifest, assigned_at, started_at,
--   completed_at, expires_at
--
-- We did NOT apply that, and this file is deliberately inert until someone
-- decides otherwise, for one reason: we could not audit the live ai_tasks
-- table. The build host has no service-role access, the deployed
-- novaflow-backend reports writesTaskRecords:false and never selects from
-- ai_tasks, and no migration in the repository creates it. So nothing in the
-- current product tells us whether ai_tasks exists, what shape it has, who
-- writes to it, or whether a Desktop build would notice new columns.
--
-- The standing rule for this work is: if a migration's effect on Desktop
-- cannot be confirmed, use a Web-dedicated table instead. That is what
-- 20260922010000 does with public.web_ai_tasks, and the Web line is complete
-- and tested on that basis. This file exists only so the unification is
-- written down rather than lost.
--
-- BEFORE APPLYING THIS, do the audit:
--
--   1. Confirm the table exists and look at it:
--        select column_name, data_type, is_nullable
--          from information_schema.columns
--         where table_schema = 'public' and table_name = 'ai_tasks'
--         order by ordinal_position;
--
--   2. Confirm nothing writes to it with a positional INSERT (an INSERT
--      without a column list breaks when columns are added):
--        grep -rn "ai_tasks" across the Desktop source and edge functions.
--
--   3. Confirm every added column is NULLABLE with a default, as below, so
--      existing rows and existing writers are unaffected.
--
--   4. Take a backup, then apply in a maintenance window.
--
-- Even after this is applied, the Web line keeps using web_ai_tasks. This
-- migration only makes a later consolidation possible; it does not perform
-- one, and it moves no data.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $novaflow_web_ai_tasks_bridge$
begin
  if pg_catalog.to_regclass('public.ai_tasks') is null then
    raise notice 'public.ai_tasks does not exist; nothing to bridge. This is expected on a project where the Desktop line never created it.';
    return;
  end if;

  -- Every column is nullable and defaulted. An existing writer that names no
  -- columns, or names only the old ones, keeps working unchanged.
  alter table public.ai_tasks
    add column if not exists assigned_worker_id uuid,
    add column if not exists task_type text,
    add column if not exists model_id text,
    add column if not exists progress numeric(5, 2) default 0,
    add column if not exists input_manifest jsonb default '{}'::jsonb,
    add column if not exists output_manifest jsonb default '{}'::jsonb,
    add column if not exists assigned_at timestamptz,
    add column if not exists started_at timestamptz,
    add column if not exists completed_at timestamptz,
    add column if not exists expires_at timestamptz;

  -- The FK is added separately and only if gpu_workers is present, so this
  -- file stays applicable whether or not the Web fabric is installed.
  if pg_catalog.to_regclass('public.gpu_workers') is not null
     and not exists (
       select 1 from pg_catalog.pg_constraint
        where conname = 'ai_tasks_assigned_worker_id_fkey'
          and conrelid = 'public.ai_tasks'::regclass
     )
  then
    alter table public.ai_tasks
      add constraint ai_tasks_assigned_worker_id_fkey
      foreign key (assigned_worker_id) references public.gpu_workers (id) on delete set null;
  end if;

  create index if not exists ai_tasks_assigned_worker_idx
    on public.ai_tasks (assigned_worker_id);
end
$novaflow_web_ai_tasks_bridge$;

commit;

-- Rollback for this file:
--
--   alter table public.ai_tasks
--     drop constraint if exists ai_tasks_assigned_worker_id_fkey,
--     drop column if exists assigned_worker_id,
--     drop column if exists task_type,
--     drop column if exists model_id,
--     drop column if exists progress,
--     drop column if exists input_manifest,
--     drop column if exists output_manifest,
--     drop column if exists assigned_at,
--     drop column if exists started_at,
--     drop column if exists completed_at,
--     drop column if exists expires_at;
--   drop index if exists public.ai_tasks_assigned_worker_idx;
