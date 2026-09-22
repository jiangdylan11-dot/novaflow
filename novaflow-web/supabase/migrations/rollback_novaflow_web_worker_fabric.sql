-- Rollback for 20260922010000_novaflow_web_worker_fabric.sql
--
-- Drops ONLY what that migration created. It does not touch users, credits,
-- credit_logs, ai_providers, ai_models, ai_tasks, system_settings, licenses or
-- comfy_usage_settlements, and it does not drop settle_comfy_usage - the Web
-- line reuses that function rather than owning it.
--
-- Running this returns the database to exactly the state it was in before the
-- Web fabric was applied. tests/e2e/sql-contract.test.mjs asserts that against
-- a real PostgreSQL on every test run.
--
-- The Web line's own task history is lost, which is the point of a rollback.
-- Desktop is unaffected either way.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Functions first: they depend on the table types.
drop function if exists public.novaflow_web_sweep(integer, integer, integer, integer);
drop function if exists public.novaflow_web_claim_task(uuid, integer);
drop function if exists public.novaflow_web_update_task_status(uuid, uuid, text, numeric, text, jsonb);
drop function if exists public.novaflow_web_create_task(uuid, text, text, jsonb, numeric, timestamptz);
drop function if exists public.novaflow_web_report_models(uuid, jsonb);
drop function if exists public.novaflow_web_worker_heartbeat(uuid, text, uuid, jsonb);
drop function if exists public.novaflow_web_register_worker(uuid, uuid, text, text, jsonb);
drop function if exists public.novaflow_web_mark_result_expired(uuid[]);
drop function if exists public.novaflow_web_log_event(uuid, text, text, text, uuid, jsonb);
drop function if exists public.novaflow_web_allows_transition(text, text);

-- Tables, children before parents. CASCADE is scoped to these tables only.
drop table if exists public.web_task_events cascade;
drop table if exists public.web_ai_tasks cascade;
drop table if exists public.worker_models cascade;
drop table if exists public.web_worker_registration_codes cascade;
drop table if exists public.gpu_workers cascade;

commit;
