-- READ-ONLY verification for Phase 1.
-- Run after 20260721010000_emergency_public_data_hardening.sql and before the
-- final service-role-only phase. This script does not mutate application data.

begin transaction read only;

set local statement_timeout = '30s';

do $verify_emergency_acl$
declare
  v_failure text;
begin
  select pg_catalog.string_agg(
           grant_row.grantee || ':' || grant_row.table_name || ':' || grant_row.privilege_type,
           ', '
           order by grant_row.grantee, grant_row.table_name, grant_row.privilege_type
         )
    into v_failure
    from information_schema.role_table_grants grant_row
   where grant_row.table_schema = 'public'
     and grant_row.table_name in (
       'licenses', 'users', 'credits', 'system_settings', 'ai_providers',
       'ai_models', 'ai_tasks', 'credit_logs', 'comfy_usage_settlements'
     )
     and grant_row.grantee in ('PUBLIC', 'anon', 'authenticated')
     and grant_row.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER');

  if v_failure is not null then
    raise exception 'Phase 1 still exposes table write privileges: %', v_failure;
  end if;

  select pg_catalog.string_agg(
           grant_row.grantee || ':' || grant_row.table_name || '.' || grant_row.column_name || ':' || grant_row.privilege_type,
           ', '
           order by grant_row.grantee, grant_row.table_name, grant_row.column_name, grant_row.privilege_type
         )
    into v_failure
    from information_schema.column_privileges grant_row
   where grant_row.table_schema = 'public'
     and grant_row.table_name in (
       'licenses', 'users', 'credits', 'system_settings', 'ai_providers',
       'ai_models', 'ai_tasks', 'credit_logs', 'comfy_usage_settlements'
     )
     and grant_row.grantee in ('PUBLIC', 'anon', 'authenticated')
     and grant_row.privilege_type in ('INSERT', 'UPDATE', 'REFERENCES');

  if v_failure is not null then
    raise exception 'Phase 1 still exposes column write privileges: %', v_failure;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'public'
       and tablename = 'licenses'
       and policyname = 'novaflow_emergency_license_legacy_select_v1'
       and cmd = 'SELECT'
       and roles = array['anon']::name[]
       and qual like '%active%'
       and qual like '%banned%'
       and qual like '%expired%'
  ) then
    raise exception 'Phase 1 legacy license compatibility policy is missing or malformed';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'public'
       and tablename = 'users'
       and policyname = 'novaflow_emergency_users_self_select_v1'
       and cmd = 'SELECT'
       and roles = array['authenticated']::name[]
       and qual like '%auth.uid()%'
  ) then
    raise exception 'Phase 1 users self-read policy is missing or malformed';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'public'
       and tablename = 'credits'
       and policyname = 'novaflow_emergency_credits_self_select_v1'
       and cmd = 'SELECT'
       and roles = array['authenticated']::name[]
       and qual like '%auth.uid()%'
  ) then
    raise exception 'Phase 1 credits self-read policy is missing or malformed';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'public'
       and tablename = 'system_settings'
       and policyname = 'novaflow_emergency_settings_self_select_v1'
       and cmd = 'SELECT'
       and roles = array['authenticated']::name[]
       and qual like '%provider_quota_%'
       and qual like '%auth.uid()%'
  ) then
    raise exception 'Phase 1 settings self-read policy is missing or malformed';
  end if;

  if exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'public'
       and tablename in ('licenses', 'users', 'credits', 'system_settings')
       and policyname not in (
         'novaflow_emergency_license_legacy_select_v1',
         'novaflow_emergency_users_self_select_v1',
         'novaflow_emergency_credits_self_select_v1',
         'novaflow_emergency_settings_self_select_v1'
       )
  ) then
    raise exception 'Phase 1 contains an unmanaged policy on a client-readable table';
  end if;
end;
$verify_emergency_acl$;

select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in (
     'licenses', 'users', 'credits', 'system_settings', 'ai_providers',
     'ai_models', 'ai_tasks', 'credit_logs', 'comfy_usage_settlements'
   )
 order by c.relname;

select grantee, table_name, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name in ('licenses', 'users', 'credits', 'system_settings', 'ai_providers')
 order by table_name, grantee, privilege_type;

select grantee, table_name, column_name, privilege_type
  from information_schema.column_privileges
 where table_schema = 'public'
   and table_name = 'licenses'
 order by grantee, column_name, privilege_type;

rollback;

