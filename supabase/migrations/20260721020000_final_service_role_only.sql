-- Phase 4: final service-role-only data plane.
--
-- IMPORTANT: apply only after every supported desktop build verifies licenses
-- and reads account/quota data through novaflow-backend. This intentionally
-- removes the temporary anonymous license lookup installed by Phase 1.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $novaflow_final_schema_assertions$
declare
  v_table record;
  v_missing text;
  v_unknown_policy text;
begin
  if not exists (
    select 1
      from pg_catalog.pg_roles
     where rolname = 'service_role'
       and rolbypassrls
  ) then
    raise exception 'NovaFlow final hardening requires service_role with BYPASSRLS';
  end if;

  for v_table in
    select *
      from (values
        ('licenses', array['license_key', 'machine_id', 'status', 'expire_at', 'permissions']::text[]),
        ('users', array['id', 'email', 'status']::text[]),
        ('credits', array['id', 'user_id', 'balance']::text[]),
        ('system_settings', array['key', 'value', 'updated_at']::text[]),
        ('ai_providers', array['id', 'provider_key', 'status']::text[]),
        ('novaflow_license_verify_rate_limits', array['identity_hash', 'window_started_at', 'attempts']::text[])
      ) as required_table(table_name, required_columns)
  loop
    if pg_catalog.to_regclass(pg_catalog.format('public.%I', v_table.table_name)) is null then
      raise exception 'NovaFlow final hardening requires public.%', v_table.table_name;
    end if;

    select pg_catalog.string_agg(expected.column_name, ', ' order by expected.column_name)
      into v_missing
      from pg_catalog.unnest(v_table.required_columns) as expected(column_name)
     where not exists (
       select 1
         from pg_catalog.pg_attribute a
         join pg_catalog.pg_class c on c.oid = a.attrelid
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = v_table.table_name
          and a.attname = expected.column_name
          and a.attnum > 0
          and not a.attisdropped
     );

    if v_missing is not null then
      raise exception 'NovaFlow final hardening: public.% is missing columns: %',
        v_table.table_name, v_missing;
    end if;
  end loop;

  -- Policies are OR-combined. Refuse to advertise a default-deny state when
  -- an operator- or third-party-owned policy is present.
  select pg_catalog.string_agg(p.tablename || '.' || p.policyname, ', ' order by p.tablename, p.policyname)
    into v_unknown_policy
    from pg_catalog.pg_policies p
   where p.schemaname = 'public'
     and p.tablename in (
       'licenses', 'users', 'credits', 'system_settings', 'ai_providers',
       'ai_models', 'ai_tasks', 'credit_logs', 'comfy_usage_settlements',
       'novaflow_license_verify_rate_limits'
     )
     and p.policyname not in (
       'licenses anon read',
       'novaflow_emergency_license_legacy_select_v1',
       'novaflow_emergency_users_self_select_v1',
       'novaflow_emergency_credits_self_select_v1',
       'novaflow_emergency_settings_self_select_v1'
     );

  if v_unknown_policy is not null then
    raise exception 'NovaFlow final hardening found unmanaged RLS policies: %', v_unknown_policy;
  end if;
end;
$novaflow_final_schema_assertions$;

-- Remove only policies introduced by NovaFlow security phases plus the one
-- exact pre-existing legacy policy reviewed on 2026-07-21.
drop policy if exists "licenses anon read" on public.licenses;
drop policy if exists novaflow_emergency_license_legacy_select_v1 on public.licenses;
drop policy if exists novaflow_emergency_users_self_select_v1 on public.users;
drop policy if exists novaflow_emergency_credits_self_select_v1 on public.credits;
drop policy if exists novaflow_emergency_settings_self_select_v1 on public.system_settings;

do $novaflow_final_table_acl$
declare
  v_table_name text;
  v_columns text;
begin
  foreach v_table_name in array array[
    'licenses', 'users', 'credits', 'system_settings', 'ai_providers',
    'ai_models', 'ai_tasks', 'credit_logs', 'comfy_usage_settlements',
    'novaflow_license_verify_rate_limits'
  ]::text[]
  loop
    if pg_catalog.to_regclass(pg_catalog.format('public.%I', v_table_name)) is null then
      continue;
    end if;

    select pg_catalog.string_agg(pg_catalog.format('%I', a.attname), ', ' order by a.attnum)
      into v_columns
      from pg_catalog.pg_attribute a
     where a.attrelid = pg_catalog.to_regclass(pg_catalog.format('public.%I', v_table_name))
       and a.attnum > 0
       and not a.attisdropped;

    execute pg_catalog.format('alter table public.%I enable row level security', v_table_name);
    execute pg_catalog.format('alter table public.%I force row level security', v_table_name);
    execute pg_catalog.format(
      'revoke all privileges on table public.%I from public, anon, authenticated',
      v_table_name
    );

    -- Table- and column-level ACLs are independent in PostgreSQL. Remove both.
    if v_columns is not null then
      execute pg_catalog.format(
        'revoke select (%1$s), insert (%1$s), update (%1$s), references (%1$s) on table public.%2$I from public, anon, authenticated',
        v_columns,
        v_table_name
      );
    end if;

    execute pg_catalog.format(
      'grant select, insert, update, delete on table public.%I to service_role',
      v_table_name
    );
  end loop;
end;
$novaflow_final_table_acl$;

do $novaflow_final_sequence_acl$
declare
  v_sequence record;
begin
  for v_sequence in
    select distinct sequence_ns.nspname as schema_name, sequence_class.relname as sequence_name
      from pg_catalog.pg_class table_class
      join pg_catalog.pg_namespace table_ns on table_ns.oid = table_class.relnamespace
      join pg_catalog.pg_attribute table_column
        on table_column.attrelid = table_class.oid
       and table_column.attnum > 0
       and not table_column.attisdropped
      join pg_catalog.pg_depend dependency
        on dependency.refobjid = table_class.oid
       and dependency.refobjsubid = table_column.attnum
       and dependency.deptype in ('a', 'i')
      join pg_catalog.pg_class sequence_class
        on sequence_class.oid = dependency.objid
       and sequence_class.relkind = 'S'
      join pg_catalog.pg_namespace sequence_ns on sequence_ns.oid = sequence_class.relnamespace
     where table_ns.nspname = 'public'
       and table_class.relname in (
         'licenses', 'users', 'credits', 'system_settings', 'ai_providers',
         'ai_models', 'ai_tasks', 'credit_logs', 'comfy_usage_settlements',
         'novaflow_license_verify_rate_limits'
       )
  loop
    execute pg_catalog.format(
      'revoke all privileges on sequence %I.%I from public, anon, authenticated',
      v_sequence.schema_name, v_sequence.sequence_name
    );
    execute pg_catalog.format(
      'grant usage, select on sequence %I.%I to service_role',
      v_sequence.schema_name, v_sequence.sequence_name
    );
  end loop;
end;
$novaflow_final_sequence_acl$;

-- Keep the known server-side RPC surface explicit and service-only, including
-- all settle_comfy_usage overloads that may exist on an older project.
do $novaflow_final_function_acl$
declare
  v_function record;
  v_identity text;
begin
  for v_function in
    select p.oid, n.nspname as schema_name, p.proname
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'settle_comfy_usage',
         'check_novaflow_license_verify_rate_limit'
       )
  loop
    v_identity := pg_catalog.format(
      '%I.%I(%s)',
      v_function.schema_name,
      v_function.proname,
      pg_catalog.pg_get_function_identity_arguments(v_function.oid)
    );
    execute pg_catalog.format(
      'revoke all privileges on function %s from public, anon, authenticated',
      v_identity
    );
    execute pg_catalog.format(
      'grant execute on function %s to service_role',
      v_identity
    );
  end loop;
end;
$novaflow_final_function_acl$;

notify pgrst, 'reload schema';

commit;
