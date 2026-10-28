-- Optional. Not a migration. Do not copy this file into supabase/migrations.
-- A file under supabase/migrations is applied on deploy.
--
-- Requires owner approval before anyone runs it. Apply only after
-- 20261028160000_users_plan_team_to_pro.sql, and only after
-- select count(*) from public.users where plan = 'team' returns 0.
-- Until then, normalizePlan('team') already treats a leftover team row as pro.

alter table public.users drop constraint if exists users_plan_valid;
alter table public.users add constraint users_plan_valid
  check (plan in ('trial', 'standard', 'pro'));
