-- Phase 1: compatibility-preserving emergency hardening.
--
-- This phase keeps the legacy anonymous license lookup alive while removing
-- every public write path on NovaFlow business tables. Signed-in clients may
-- read only their own profile, credit balance, and provider quota records.
-- Apply this phase before the desktop license lookup has moved to Edge.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Fail closed when the live schema does not match the contract this migration
-- was reviewed against. Silently hardening a different shape creates a false
-- sense of security and can break the current desktop client.
do $novaflow_schema_assertions$
declare
  v_table record;
  v_missing text;
  v_relkind "char";
begin
  for v_table in
    select *
      from (values
        ('licenses', array['license_key', 'machine_id', 'status', 'expire_at', 'permissions']::text[]),
        ('users', array['id', 'email', 'display_name', 'role', 'plan', 'status', 'created_at', 'updated_at']::text[]),
        ('credits', array['id', 'user_id', 'balance', 'updated_at']::text[]),
        ('system_settings', array['key', 'value', 'updated_at']::text[]),
        ('ai_providers', array['id', 'provider_key', 'name', 'status', 'billing_multiplier']::text[])
      ) as required_table(table_name, required_columns)
  loop
    select c.relkind
      into v_relkind
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = v_table.table_name;

    if v_relkind is null or v_relkind not in ('r', 'p') then
      raise exception 'NovaFlow security migration requires public.% to be a table', v_table.table_name;
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
      raise exception 'NovaFlow security migration: public.% is missing columns: %',
        v_table.table_name, v_missing;
    end if;
  end loop;

  if (
    select pg_catalog.format_type(a.atttypid, a.atttypmod)
      from pg_catalog.pg_attribute a
     where a.attrelid = 'public.users'::regclass
       and a.attname = 'id'
       and a.attnum > 0
       and not a.attisdropped
  ) <> 'uuid' then
    raise exception 'NovaFlow security migration requires public.users.id to be uuid';
  end if;

  if (
    select pg_catalog.format_type(a.atttypid, a.atttypmod)
      from pg_catalog.pg_attribute a
     where a.attrelid = 'public.credits'::regclass
       and a.attname = 'user_id'
       and a.attnum > 0
       and not a.attisdropped
  ) <> 'uuid' then
    raise exception 'NovaFlow security migration requires public.credits.user_id to be uuid';
  end if;
end;
$novaflow_schema_assertions$;

-- Own-row policies are permissive by PostgreSQL design, so an unknown policy
-- could broaden them. Abort instead of deleting policies owned by another
-- migration or operator.
do $novaflow_policy_assertions$
declare
  v_unknown text;
begin
  select pg_catalog.string_agg(p.tablename || '.' || p.policyname, ', ' order by p.tablename, p.policyname)
    into v_unknown
    from pg_catalog.pg_policies p
   where p.schemaname = 'public'
     and p.tablename in ('licenses', 'users', 'credits', 'system_settings')
     and p.policyname not in (
       'licenses anon read',
       'novaflow_emergency_license_legacy_select_v1',
       'novaflow_emergency_users_self_select_v1',
       'novaflow_emergency_credits_self_select_v1',
       'novaflow_emergency_settings_self_select_v1'
     );

  if v_unknown is not null then
    raise exception 'NovaFlow security migration found unmanaged RLS policies: %', v_unknown;
  end if;
end;
$novaflow_policy_assertions$;

alter table public.licenses enable row level security;
alter table public.users enable row level security;
alter table public.credits enable row level security;
alter table public.system_settings enable row level security;
alter table public.ai_providers enable row level security;

revoke all privileges on table public.licenses from public, anon, authenticated;
revoke all privileges on table public.users from public, anon, authenticated;
revoke all privileges on table public.credits from public, anon, authenticated;
revoke all privileges on table public.system_settings from public, anon, authenticated;
revoke all privileges on table public.ai_providers from public, anon, authenticated;

-- Remove any prior column-scoped capability on the known sensitive columns.
revoke select (license_key, machine_id, status, expire_at, permissions),
       insert (license_key, machine_id, status, expire_at, permissions),
       update (license_key, machine_id, status, expire_at, permissions),
       references (license_key, machine_id, status, expire_at, permissions)
  on table public.licenses from public, anon, authenticated;

drop policy if exists novaflow_emergency_license_legacy_select_v1 on public.licenses;
drop policy if exists novaflow_emergency_users_self_select_v1 on public.users;
drop policy if exists novaflow_emergency_credits_self_select_v1 on public.credits;
drop policy if exists novaflow_emergency_settings_self_select_v1 on public.system_settings;

-- Exact live legacy policy reviewed on 2026-07-21. Replace it with a
-- migration-owned equivalent so Phase 4 can remove the exception reliably.
drop policy if exists "licenses anon read" on public.licenses;

-- Temporary compatibility exception. It intentionally exposes only the five
-- columns consumed by the legacy verifier, and it is removed by Phase 4.
create policy novaflow_emergency_license_legacy_select_v1
  on public.licenses
  for select
  to anon
  using (status in ('active', 'banned', 'expired'));

grant select (license_key, machine_id, status, expire_at, permissions)
  on table public.licenses to anon;

create policy novaflow_emergency_users_self_select_v1
  on public.users
  for select
  to authenticated
  using (id = (select auth.uid()));

grant select on table public.users to authenticated;

create policy novaflow_emergency_credits_self_select_v1
  on public.credits
  for select
  to authenticated
  using (user_id = (select auth.uid()));

grant select on table public.credits to authenticated;

create policy novaflow_emergency_settings_self_select_v1
  on public.system_settings
  for select
  to authenticated
  using (
    (select auth.uid()) is not null
    and key like 'provider_quota_%'
    and pg_catalog.right(key, 36) = (select auth.uid())::text
  );

grant select on table public.system_settings to authenticated;

-- Service-side clients and the administration application keep only the DML
-- operations they currently use; TRUNCATE, REFERENCES, and TRIGGER are not
-- granted.
grant select, insert, update, delete on table public.licenses to service_role;
grant select, insert, update, delete on table public.users to service_role;
grant select, insert, update, delete on table public.credits to service_role;
grant select, insert, update, delete on table public.system_settings to service_role;
grant select, insert, update, delete on table public.ai_providers to service_role;

-- Older installations may contain these retired/optional tables. When a table
-- exists, assert the minimum known shape before closing it. No table is created
-- merely to satisfy a legacy name.
do $novaflow_legacy_tables$
declare
  v_table record;
  v_missing text;
begin
  for v_table in
    select *
      from (values
        ('ai_models', array['id']::text[]),
        ('ai_tasks', array['id']::text[]),
        ('credit_logs', array['id']::text[]),
        ('comfy_usage_settlements', array['id', 'user_id']::text[])
      ) as legacy_table(table_name, required_columns)
  loop
    if pg_catalog.to_regclass(pg_catalog.format('public.%I', v_table.table_name)) is null then
      continue;
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
      raise exception 'NovaFlow security migration: optional public.% is missing columns: %',
        v_table.table_name, v_missing;
    end if;

    execute pg_catalog.format('alter table public.%I enable row level security', v_table.table_name);
    execute pg_catalog.format(
      'revoke all privileges on table public.%I from public, anon, authenticated',
      v_table.table_name
    );
    execute pg_catalog.format(
      'grant select, insert, update, delete on table public.%I to service_role',
      v_table.table_name
    );
  end loop;
end;
$novaflow_legacy_tables$;

-- Remove sequence access that could otherwise survive a table-level revoke,
-- while preserving the service role's ability to insert identity/serial rows.
do $novaflow_owned_sequences$
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
         'ai_models', 'ai_tasks', 'credit_logs', 'comfy_usage_settlements'
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
$novaflow_owned_sequences$;

notify pgrst, 'reload schema';

commit;
