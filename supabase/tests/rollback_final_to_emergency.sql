-- MANUAL EMERGENCY ROLLBACK: Phase 4 -> Phase 1 compatibility.
--
-- This does not restore public writes and does not remove the rate-limit
-- ledger. It temporarily restores only the legacy license read and the
-- signed-in user's own account reads. Use solely when a supported old desktop
-- build must be recovered while the Edge path is repaired.
--
-- The guard deliberately aborts when this file is run unchanged. To authorize
-- the rollback, uncomment the SET LOCAL line below in the same transaction.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';
-- set local novaflow.confirm_security_rollback = 'ROLLBACK_TO_EMERGENCY';

do $rollback_guard$
begin
  if pg_catalog.current_setting('novaflow.confirm_security_rollback', true)
       is distinct from 'ROLLBACK_TO_EMERGENCY' then
    raise exception 'rollback blocked: explicitly set novaflow.confirm_security_rollback';
  end if;
end;
$rollback_guard$;

revoke all privileges on table public.licenses from public, anon, authenticated;
revoke all privileges on table public.users from public, anon, authenticated;
revoke all privileges on table public.credits from public, anon, authenticated;
revoke all privileges on table public.system_settings from public, anon, authenticated;

drop policy if exists novaflow_emergency_license_legacy_select_v1 on public.licenses;
drop policy if exists novaflow_emergency_users_self_select_v1 on public.users;
drop policy if exists novaflow_emergency_credits_self_select_v1 on public.credits;
drop policy if exists novaflow_emergency_settings_self_select_v1 on public.system_settings;

create policy novaflow_emergency_license_legacy_select_v1
  on public.licenses for select to anon
  using (status in ('active', 'banned', 'expired'));
grant select (license_key, machine_id, status, expire_at, permissions)
  on table public.licenses to anon;

create policy novaflow_emergency_users_self_select_v1
  on public.users for select to authenticated
  using (id = (select auth.uid()));
grant select on table public.users to authenticated;

create policy novaflow_emergency_credits_self_select_v1
  on public.credits for select to authenticated
  using (user_id = (select auth.uid()));
grant select on table public.credits to authenticated;

create policy novaflow_emergency_settings_self_select_v1
  on public.system_settings for select to authenticated
  using (
    (select auth.uid()) is not null
    and key like 'provider_quota_%'
    and pg_catalog.right(key, 36) = (select auth.uid())::text
  );
grant select on table public.system_settings to authenticated;

notify pgrst, 'reload schema';

commit;
