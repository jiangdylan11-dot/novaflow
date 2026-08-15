-- READ-ONLY verification for Phase 4.
-- Success means no public/anon/authenticated table or column privileges, no
-- public RLS policies, and no public execution rights on the server RPCs.

begin transaction read only;

set local statement_timeout = '30s';

do $verify_final_security$
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
       'ai_models', 'ai_tasks', 'credit_logs', 'comfy_usage_settlements',
       'novaflow_license_verify_rate_limits'
     )
     and grant_row.grantee in ('PUBLIC', 'anon', 'authenticated');

  if v_failure is not null then
    raise exception 'Final security still exposes table privileges: %', v_failure;
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
       'ai_models', 'ai_tasks', 'credit_logs', 'comfy_usage_settlements',
       'novaflow_license_verify_rate_limits'
     )
     and grant_row.grantee in ('PUBLIC', 'anon', 'authenticated');

  if v_failure is not null then
    raise exception 'Final security still exposes column privileges: %', v_failure;
  end if;

  select pg_catalog.string_agg(c.relname, ', ' order by c.relname)
    into v_failure
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in (
       'licenses', 'users', 'credits', 'system_settings', 'ai_providers',
       'ai_models', 'ai_tasks', 'credit_logs', 'comfy_usage_settlements',
       'novaflow_license_verify_rate_limits'
     )
     and (not c.relrowsecurity or not c.relforcerowsecurity);

  if v_failure is not null then
    raise exception 'Final security requires enabled and forced RLS on: %', v_failure;
  end if;

  select pg_catalog.string_agg(p.tablename || '.' || p.policyname, ', ' order by p.tablename, p.policyname)
    into v_failure
    from pg_catalog.pg_policies p
   where p.schemaname = 'public'
     and p.tablename in (
       'licenses', 'users', 'credits', 'system_settings', 'ai_providers',
       'ai_models', 'ai_tasks', 'credit_logs', 'comfy_usage_settlements',
       'novaflow_license_verify_rate_limits'
     );

  if v_failure is not null then
    raise exception 'Final security requires default-deny RLS but found policies: %', v_failure;
  end if;

  if pg_catalog.has_function_privilege(
       'anon',
       'public.check_novaflow_license_verify_rate_limit(text,integer,integer)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.check_novaflow_license_verify_rate_limit(text,integer,integer)',
       'EXECUTE'
     )
  then
    raise exception 'Final security exposes a service RPC to a client role';
  end if;
end;
$verify_final_security$;

select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in (
     'licenses', 'users', 'credits', 'system_settings', 'ai_providers',
     'ai_models', 'ai_tasks', 'credit_logs', 'comfy_usage_settlements',
     'novaflow_license_verify_rate_limits'
   )
 order by c.relname;

rollback;
