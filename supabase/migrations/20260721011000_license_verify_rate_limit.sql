-- Phase 2a: persistent, cross-instance rate limiting for license verification.
-- The Edge Function sends only a SHA-256 identity digest. Raw IP addresses,
-- license keys, and machine IDs are never persisted by this primitive.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.novaflow_license_verify_rate_limits (
  identity_hash text primary key,
  window_started_at timestamptz not null,
  attempts integer not null,
  updated_at timestamptz not null,
  constraint novaflow_license_verify_rate_limits_identity_hash_valid check (
    identity_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint novaflow_license_verify_rate_limits_attempts_valid check (
    attempts >= 1
  )
);

do $novaflow_rate_limit_schema_assertions$
declare
  v_missing text;
begin
  select pg_catalog.string_agg(expected.column_name, ', ' order by expected.column_name)
    into v_missing
    from pg_catalog.unnest(
      array['identity_hash', 'window_started_at', 'attempts', 'updated_at']::text[]
    ) as expected(column_name)
   where not exists (
     select 1
       from pg_catalog.pg_attribute a
      where a.attrelid = 'public.novaflow_license_verify_rate_limits'::regclass
        and a.attname = expected.column_name
        and a.attnum > 0
        and not a.attisdropped
   );

  if v_missing is not null then
    raise exception 'NovaFlow license rate-limit table is missing columns: %', v_missing;
  end if;

  if (
    select pg_catalog.format_type(a.atttypid, a.atttypmod)
      from pg_catalog.pg_attribute a
     where a.attrelid = 'public.novaflow_license_verify_rate_limits'::regclass
       and a.attname = 'attempts'
       and a.attnum > 0
       and not a.attisdropped
  ) <> 'integer' then
    raise exception 'NovaFlow license rate-limit attempts column must be integer';
  end if;
end;
$novaflow_rate_limit_schema_assertions$;

create index if not exists novaflow_license_verify_rate_limits_updated_at_idx
  on public.novaflow_license_verify_rate_limits(updated_at);

alter table public.novaflow_license_verify_rate_limits enable row level security;
alter table public.novaflow_license_verify_rate_limits force row level security;

revoke all privileges on table public.novaflow_license_verify_rate_limits
  from public, anon, authenticated;
grant select, insert, update, delete on table public.novaflow_license_verify_rate_limits
  to service_role;

create or replace function public.check_novaflow_license_verify_rate_limit(
  p_identity_hash text,
  p_window_seconds integer,
  p_max_attempts integer
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $novaflow_rate_limit_function$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_identity_hash text := pg_catalog.lower(pg_catalog.btrim(p_identity_hash));
  v_record public.novaflow_license_verify_rate_limits%rowtype;
  v_window_ends_at timestamptz;
  v_allowed boolean;
  v_retry_after_seconds integer;
begin
  if v_identity_hash !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'identity_hash must be a lowercase 64-character SHA-256 digest';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception using
      errcode = '22023',
      message = 'window_seconds must be between 1 and 86400';
  end if;
  if p_max_attempts is null or p_max_attempts < 1 or p_max_attempts > 10000 then
    raise exception using
      errcode = '22023',
      message = 'max_attempts must be between 1 and 10000';
  end if;

  -- Bound maintenance work per request. The updated_at index makes the stale
  -- scan cheap, SKIP LOCKED avoids waiting behind active identities, and the
  -- second timestamp predicate prevents deleting a row refreshed after the
  -- candidate scan.
  with stale as (
    select candidate.identity_hash
      from public.novaflow_license_verify_rate_limits candidate
     where candidate.updated_at < v_now - interval '24 hours'
     order by candidate.updated_at
     limit 100
     for update skip locked
  )
  delete from public.novaflow_license_verify_rate_limits target
   using stale
   where target.identity_hash = stale.identity_hash
     and target.updated_at < v_now - interval '24 hours';

  insert into public.novaflow_license_verify_rate_limits (
    identity_hash,
    window_started_at,
    attempts,
    updated_at
  ) values (
    v_identity_hash,
    v_now,
    1,
    v_now
  )
  on conflict (identity_hash) do update
    set window_started_at = case
          when public.novaflow_license_verify_rate_limits.window_started_at
                 + pg_catalog.make_interval(secs => p_window_seconds) <= v_now
            then v_now
          else public.novaflow_license_verify_rate_limits.window_started_at
        end,
        attempts = case
          when public.novaflow_license_verify_rate_limits.window_started_at
                 + pg_catalog.make_interval(secs => p_window_seconds) <= v_now
            then 1
          else public.novaflow_license_verify_rate_limits.attempts + 1
        end,
        updated_at = v_now
  returning * into v_record;

  v_window_ends_at := v_record.window_started_at
    + pg_catalog.make_interval(secs => p_window_seconds);
  v_allowed := v_record.attempts <= p_max_attempts;
  v_retry_after_seconds := case
    when v_allowed then 0
    else greatest(
      1,
      pg_catalog.ceil(
        extract(epoch from (v_window_ends_at - v_now))
      )::integer
    )
  end;

  return pg_catalog.jsonb_build_object(
    'allowed', v_allowed,
    'remaining_attempts', greatest(0, p_max_attempts - v_record.attempts),
    'retry_after_seconds', v_retry_after_seconds,
    'window_started_at', v_record.window_started_at,
    'current_attempts', v_record.attempts,
    'max_attempts', p_max_attempts
  );
end;
$novaflow_rate_limit_function$;

revoke all privileges on function public.check_novaflow_license_verify_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.check_novaflow_license_verify_rate_limit(text, integer, integer)
  to service_role;

notify pgrst, 'reload schema';

commit;
