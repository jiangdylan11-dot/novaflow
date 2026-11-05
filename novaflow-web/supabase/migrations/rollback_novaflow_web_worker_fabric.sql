-- Rollback for 20260922010000_novaflow_web_worker_fabric.sql and the compute
-- migrations built on it (20261030020000 to 20261030050000).
--
-- Drops ONLY what those migrations created. It does not touch users, credits,
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

-- Compute usage first: its trigger sits on web_ai_tasks and its functions are
-- held by triggers on the tables dropped here.
drop trigger if exists web_capture_compute_usage on public.web_ai_tasks;
drop table if exists public.web_compute_usage_deleted cascade;
drop table if exists public.web_compute_usage cascade;
drop table if exists public.web_compute_enrollment_limits cascade;
drop function if exists public.admin_delete_compute_usage(uuid, uuid, timestamptz);
drop function if exists public.admin_compute_usage_summary();
drop function if exists public.web_skip_deleted_compute_usage();
drop function if exists public.web_protect_compute_usage();
drop function if exists public.web_capture_compute_usage();

-- Functions next: they depend on the table types.
drop function if exists public.novaflow_web_enroll_pending_worker(uuid, text, text, jsonb, text);
drop function if exists public.novaflow_web_reserve_compute_enrollment(text);
drop function if exists public.novaflow_web_capable_model_details(text, integer, integer, uuid, boolean, boolean);
drop function if exists public.novaflow_web_count_capable_workers(text, integer, integer, uuid, boolean, uuid, boolean);
drop function if exists public.novaflow_web_worker_can_serve(uuid, uuid, boolean, boolean);
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
