-- Atomic, service-role-only Grok call quota reservations.
-- Reservations prevent concurrent requests and administrator allocation writes
-- from overwriting the JSON value stored in system_settings.

create extension if not exists pgcrypto;

create table if not exists public.grok_quota_reservations (
  usage_key text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  provider_key text not null default 'grok',
  feature text not null,
  min_calls integer not null,
  max_calls integer not null,
  reserved_calls integer not null,
  actual_calls integer,
  status text not null default 'reserved',
  success boolean,
  call_records jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '20 minutes'),
  settled_at timestamptz,
  constraint grok_quota_usage_key_valid check (
    btrim(usage_key) = usage_key and char_length(usage_key) between 1 and 200
  ),
  constraint grok_quota_provider_valid check (provider_key = 'grok'),
  constraint grok_quota_feature_valid check (
    btrim(feature) = feature and char_length(feature) between 1 and 100
  ),
  constraint grok_quota_call_bounds_valid check (
    min_calls >= 0 and max_calls >= min_calls and max_calls <= 20
    and reserved_calls >= min_calls and reserved_calls <= max_calls
    and (actual_calls is null or (actual_calls >= 0 and actual_calls <= reserved_calls))
  ),
  constraint grok_quota_status_valid check (status in ('reserved', 'settled', 'released')),
  constraint grok_quota_json_valid check (
    jsonb_typeof(call_records) = 'array' and jsonb_typeof(metadata) = 'object'
  ),
  constraint grok_quota_state_shape check (
    (status = 'reserved' and actual_calls is null and success is null and settled_at is null)
    or (status = 'settled' and actual_calls is not null and success is not null and settled_at is not null)
    or (status = 'released' and actual_calls = 0 and success = false and settled_at is not null)
  )
);

create index if not exists grok_quota_reservations_user_created_idx
  on public.grok_quota_reservations(user_id, created_at desc);
create index if not exists grok_quota_reservations_open_idx
  on public.grok_quota_reservations(updated_at)
  where status = 'reserved';

alter table public.grok_quota_reservations enable row level security;
alter table public.grok_quota_reservations force row level security;
revoke all on table public.grok_quota_reservations from public, anon, authenticated;
grant select, insert, update, delete on table public.grok_quota_reservations to service_role;

create or replace function public.reserve_grok_quota(
  p_user_id uuid,
  p_usage_key text,
  p_feature text,
  p_min_calls integer,
  p_max_calls integer,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_key text;
  v_value jsonb;
  v_row public.grok_quota_reservations%rowtype;
  v_allocated integer;
  v_used integer;
  v_reserved integer;
  v_available integer;
  v_budget integer;
  v_expired_reserved integer := 0;
begin
  if p_user_id is null then raise exception using errcode = '22023', message = 'reserve_grok_quota: user_id is required'; end if;
  if p_usage_key is null or btrim(p_usage_key) <> p_usage_key or char_length(p_usage_key) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'reserve_grok_quota: invalid usage_key';
  end if;
  if p_feature is null or btrim(p_feature) = '' or btrim(p_feature) <> p_feature or char_length(p_feature) > 100 then
    raise exception using errcode = '22023', message = 'reserve_grok_quota: invalid feature';
  end if;
  if p_min_calls is null or p_max_calls is null or p_min_calls < 0 or p_max_calls < p_min_calls or p_max_calls > 20 then
    raise exception using errcode = '22023', message = 'reserve_grok_quota: invalid call bounds';
  end if;
  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'reserve_grok_quota: metadata must be an object';
  end if;

  v_key := 'provider_quota_grok_' || p_user_id::text;
  insert into public.system_settings(key, value, updated_at)
  values (v_key, jsonb_build_object(
    'label', 'Prompt service quota', 'provider_key', 'grok', 'user_id', p_user_id,
    'allocated_count', 0, 'used_count', 0, 'reserved_count', 0,
    'remaining_count', 0, 'recent_calls', '[]'::jsonb, 'source', 'reservation', 'updated_at', v_now
  ), v_now)
  on conflict (key) do nothing;

  select value into v_value from public.system_settings where key = v_key for update;
  if not found or jsonb_typeof(v_value) <> 'object' then
    raise exception 'reserve_grok_quota: quota setting is unavailable';
  end if;

  -- Recover abandoned reservations only after taking the same per-user quota
  -- row lock used by reserve/settle/admin allocation. Twenty minutes is longer
  -- than the provider's bounded multi-stage timeout, so an in-flight call is not
  -- normally reclaimed while it can still settle.
  with expired as (
    update public.grok_quota_reservations
       set status = 'released', actual_calls = 0, success = false,
           metadata = metadata || jsonb_build_object('release_reason', 'expired'),
           updated_at = v_now, settled_at = v_now
     where user_id = p_user_id and status = 'reserved' and expires_at <= v_now
     returning reserved_calls
  ) select coalesce(sum(reserved_calls), 0)::integer into v_expired_reserved from expired;
  if v_expired_reserved > 0 then
    v_value := v_value || jsonb_build_object(
      'reserved_count', greatest(coalesce((v_value->>'reserved_count')::integer, 0) - v_expired_reserved, 0),
      'remaining_count', greatest(coalesce((v_value->>'allocated_count')::integer, 0)
        - coalesce((v_value->>'used_count')::integer, 0)
        - greatest(coalesce((v_value->>'reserved_count')::integer, 0) - v_expired_reserved, 0), 0),
      'source', 'expiry_recovery', 'updated_at', v_now
    );
    update public.system_settings set value = v_value, updated_at = v_now where key = v_key;
  end if;

  select * into v_row from public.grok_quota_reservations where usage_key = p_usage_key;
  if found then
    if v_row.user_id <> p_user_id or v_row.feature <> p_feature
       or v_row.min_calls <> p_min_calls or v_row.max_calls <> p_max_calls then
      raise exception using errcode = '22023', message = 'reserve_grok_quota: usage_key payload mismatch';
    end if;
    return jsonb_build_object(
      'status', v_row.status, 'idempotent', true, 'usage_key', v_row.usage_key,
      'reserved_calls', v_row.reserved_calls, 'actual_calls', v_row.actual_calls,
      'provider_call_budget', case when v_row.status = 'reserved' then v_row.reserved_calls else 0 end,
      'quota', jsonb_build_object(
        'allocated_count', greatest(coalesce((v_value->>'allocated_count')::integer, 0), 0),
        'used_count', greatest(coalesce((v_value->>'used_count')::integer, 0), 0),
        'reserved_count', greatest(coalesce((v_value->>'reserved_count')::integer, 0), 0),
        'remaining_count', greatest(coalesce((v_value->>'allocated_count')::integer, 0)
          - coalesce((v_value->>'used_count')::integer, 0) - coalesce((v_value->>'reserved_count')::integer, 0), 0)
      )
    );
  end if;

  v_allocated := greatest(coalesce((v_value->>'allocated_count')::integer, 0), 0);
  v_used := greatest(coalesce((v_value->>'used_count')::integer, 0), 0);
  v_reserved := greatest(coalesce((v_value->>'reserved_count')::integer, 0), 0);
  v_available := greatest(v_allocated - v_used - v_reserved, 0);
  if v_available < p_min_calls then
    raise exception using errcode = 'P0001', message = 'insufficient grok calls';
  end if;
  v_budget := least(p_max_calls, v_available);

  insert into public.grok_quota_reservations(
    usage_key, user_id, feature, min_calls, max_calls, reserved_calls, metadata,
    created_at, updated_at, expires_at
  ) values (
    p_usage_key, p_user_id, p_feature, p_min_calls, p_max_calls, v_budget,
    coalesce(p_metadata, '{}'::jsonb), v_now, v_now, v_now + interval '20 minutes'
  ) returning * into v_row;

  v_reserved := v_reserved + v_budget;
  v_value := v_value || jsonb_build_object(
    'provider_key', 'grok', 'user_id', p_user_id,
    'allocated_count', v_allocated, 'used_count', v_used, 'reserved_count', v_reserved,
    'remaining_count', greatest(v_allocated - v_used - v_reserved, 0),
    'source', 'reservation', 'updated_at', v_now
  );
  update public.system_settings set value = v_value, updated_at = v_now where key = v_key;

  return jsonb_build_object(
    'status', 'reserved', 'idempotent', false, 'usage_key', p_usage_key,
    'reserved_calls', v_budget, 'actual_calls', null, 'provider_call_budget', v_budget,
    'expires_at', v_row.expires_at,
    'quota', jsonb_build_object(
      'allocated_count', v_allocated, 'used_count', v_used,
      'reserved_count', v_reserved, 'remaining_count', greatest(v_allocated - v_used - v_reserved, 0)
    )
  );
end;
$$;

create or replace function public.settle_grok_quota(
  p_user_id uuid,
  p_usage_key text,
  p_actual_calls integer,
  p_success boolean,
  p_call_records jsonb default '[]'::jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_key text := 'provider_quota_grok_' || p_user_id::text;
  v_value jsonb;
  v_row public.grok_quota_reservations%rowtype;
  v_allocated integer;
  v_used integer;
  v_reserved integer;
  v_recent jsonb;
  v_calls jsonb := coalesce(p_call_records, '[]'::jsonb);
begin
  if p_user_id is null then raise exception using errcode = '22023', message = 'settle_grok_quota: user_id is required'; end if;
  if p_usage_key is null or btrim(p_usage_key) <> p_usage_key or char_length(p_usage_key) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'settle_grok_quota: invalid usage_key';
  end if;
  if p_actual_calls is null or p_actual_calls < 0 or p_success is null then
    raise exception using errcode = '22023', message = 'settle_grok_quota: invalid settlement';
  end if;
  if jsonb_typeof(v_calls) <> 'array' or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'settle_grok_quota: invalid json payload';
  end if;

  select value into v_value from public.system_settings where key = v_key for update;
  if not found or jsonb_typeof(v_value) <> 'object' then raise exception 'settle_grok_quota: quota setting is unavailable'; end if;
  select * into v_row from public.grok_quota_reservations where usage_key = p_usage_key for update;
  if not found or v_row.user_id <> p_user_id then raise exception using errcode = '22023', message = 'settle_grok_quota: reservation not found'; end if;
  if v_row.status = 'settled' then
    if v_row.actual_calls <> p_actual_calls then raise exception using errcode = '22023', message = 'settle_grok_quota: actual call mismatch'; end if;
    return jsonb_build_object('status', 'settled', 'idempotent', true, 'usage_key', p_usage_key,
      'reserved_calls', v_row.reserved_calls, 'actual_calls', v_row.actual_calls,
      'quota', jsonb_build_object(
        'allocated_count', greatest(coalesce((v_value->>'allocated_count')::integer, 0), 0),
        'used_count', greatest(coalesce((v_value->>'used_count')::integer, 0), 0),
        'reserved_count', greatest(coalesce((v_value->>'reserved_count')::integer, 0), 0),
        'remaining_count', greatest(coalesce((v_value->>'allocated_count')::integer, 0)
          - coalesce((v_value->>'used_count')::integer, 0) - coalesce((v_value->>'reserved_count')::integer, 0), 0)));
  end if;
  if v_row.status <> 'reserved' then raise exception using errcode = '22023', message = 'settle_grok_quota: reservation is not open'; end if;
  if p_actual_calls > v_row.reserved_calls then raise exception using errcode = '22023', message = 'settle_grok_quota: actual calls exceed reservation'; end if;

  v_allocated := greatest(coalesce((v_value->>'allocated_count')::integer, 0), 0);
  v_used := greatest(coalesce((v_value->>'used_count')::integer, 0), 0) + p_actual_calls;
  v_reserved := greatest(coalesce((v_value->>'reserved_count')::integer, 0) - v_row.reserved_calls, 0);
  v_recent := case when jsonb_typeof(v_value->'recent_calls') = 'array' then v_value->'recent_calls' else '[]'::jsonb end;
  select coalesce(jsonb_agg(item order by ord), '[]'::jsonb) into v_recent
    from (
      select item, ord from jsonb_array_elements(v_recent || v_calls) with ordinality as x(item, ord)
      order by ord desc limit 50
    ) recent;

  v_value := v_value || jsonb_build_object(
    'provider_key', 'grok', 'user_id', p_user_id,
    'allocated_count', v_allocated, 'used_count', v_used, 'reserved_count', v_reserved,
    'remaining_count', greatest(v_allocated - v_used - v_reserved, 0), 'recent_calls', v_recent,
    'source', 'usage', 'updated_at', v_now
  );
  update public.system_settings set value = v_value, updated_at = v_now where key = v_key;
  update public.grok_quota_reservations
     set status = 'settled', actual_calls = p_actual_calls, success = p_success,
         call_records = v_calls, metadata = metadata || coalesce(p_metadata, '{}'::jsonb),
         updated_at = v_now, settled_at = v_now
   where usage_key = p_usage_key returning * into v_row;

  return jsonb_build_object('status', 'settled', 'idempotent', false, 'usage_key', p_usage_key,
    'reserved_calls', v_row.reserved_calls, 'actual_calls', p_actual_calls,
    'quota', jsonb_build_object('allocated_count', v_allocated, 'used_count', v_used,
      'reserved_count', v_reserved, 'remaining_count', greatest(v_allocated - v_used - v_reserved, 0)));
end;
$$;

create or replace function public.release_grok_quota(
  p_user_id uuid,
  p_usage_key text,
  p_reason text default '',
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_key text := 'provider_quota_grok_' || p_user_id::text;
  v_value jsonb;
  v_row public.grok_quota_reservations%rowtype;
  v_allocated integer;
  v_used integer;
  v_reserved integer;
begin
  if p_user_id is null or p_usage_key is null then raise exception using errcode = '22023', message = 'release_grok_quota: identity is required'; end if;
  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then raise exception using errcode = '22023', message = 'release_grok_quota: metadata must be an object'; end if;
  select value into v_value from public.system_settings where key = v_key for update;
  if not found or jsonb_typeof(v_value) <> 'object' then raise exception 'release_grok_quota: quota setting is unavailable'; end if;
  select * into v_row from public.grok_quota_reservations where usage_key = p_usage_key for update;
  if not found or v_row.user_id <> p_user_id then raise exception using errcode = '22023', message = 'release_grok_quota: reservation not found'; end if;
  if v_row.status = 'released' then
    return jsonb_build_object('status', 'released', 'idempotent', true, 'usage_key', p_usage_key, 'reserved_calls', v_row.reserved_calls, 'actual_calls', 0);
  end if;
  if v_row.status <> 'reserved' then raise exception using errcode = '22023', message = 'release_grok_quota: reservation is not open'; end if;
  v_allocated := greatest(coalesce((v_value->>'allocated_count')::integer, 0), 0);
  v_used := greatest(coalesce((v_value->>'used_count')::integer, 0), 0);
  v_reserved := greatest(coalesce((v_value->>'reserved_count')::integer, 0) - v_row.reserved_calls, 0);
  v_value := v_value || jsonb_build_object('reserved_count', v_reserved,
    'remaining_count', greatest(v_allocated - v_used - v_reserved, 0), 'source', 'release', 'updated_at', v_now);
  update public.system_settings set value = v_value, updated_at = v_now where key = v_key;
  update public.grok_quota_reservations set status = 'released', actual_calls = 0, success = false,
    metadata = metadata || coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('release_reason', left(coalesce(p_reason, ''), 240)),
    updated_at = v_now, settled_at = v_now where usage_key = p_usage_key returning * into v_row;
  return jsonb_build_object('status', 'released', 'idempotent', false, 'usage_key', p_usage_key,
    'reserved_calls', v_row.reserved_calls, 'actual_calls', 0,
    'quota', jsonb_build_object('allocated_count', v_allocated, 'used_count', v_used,
      'reserved_count', v_reserved, 'remaining_count', greatest(v_allocated - v_used - v_reserved, 0)));
end;
$$;

create or replace function public.set_grok_quota(
  p_user_id uuid,
  p_allocated_calls integer,
  p_reason text default '',
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_key text := 'provider_quota_grok_' || p_user_id::text;
  v_value jsonb;
  v_used integer;
  v_reserved integer;
begin
  if p_user_id is null or p_allocated_calls is null or p_allocated_calls < 0 then raise exception using errcode = '22023', message = 'set_grok_quota: invalid allocation'; end if;
  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then raise exception using errcode = '22023', message = 'set_grok_quota: metadata must be an object'; end if;
  insert into public.system_settings(key, value, updated_at)
  values(v_key, jsonb_build_object('provider_key','grok','user_id',p_user_id,'allocated_count',0,'used_count',0,'reserved_count',0,'recent_calls','[]'::jsonb), v_now)
  on conflict(key) do nothing;
  select value into v_value from public.system_settings where key = v_key for update;
  if jsonb_typeof(v_value) <> 'object' then raise exception 'set_grok_quota: quota setting is invalid'; end if;
  v_used := greatest(coalesce((v_value->>'used_count')::integer, 0), 0);
  v_reserved := greatest(coalesce((v_value->>'reserved_count')::integer, 0), 0);
  v_value := v_value || coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
    'label','Prompt service quota','provider_key','grok','user_id',p_user_id,
    'allocated_count',p_allocated_calls,'used_count',v_used,'reserved_count',v_reserved,
    'remaining_count',greatest(p_allocated_calls-v_used-v_reserved,0),'source','manual',
    'note',left(coalesce(p_reason,''),500),'updated_at',v_now);
  update public.system_settings set value=v_value, updated_at=v_now where key=v_key;
  return jsonb_build_object('status','updated','user_id',p_user_id,
    'quota',jsonb_build_object('allocated_count',p_allocated_calls,'used_count',v_used,
      'reserved_count',v_reserved,'remaining_count',greatest(p_allocated_calls-v_used-v_reserved,0)));
end;
$$;

revoke all on function public.reserve_grok_quota(uuid,text,text,integer,integer,jsonb) from public, anon, authenticated;
revoke all on function public.settle_grok_quota(uuid,text,integer,boolean,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.release_grok_quota(uuid,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.set_grok_quota(uuid,integer,text,jsonb) from public, anon, authenticated;
grant execute on function public.reserve_grok_quota(uuid,text,text,integer,integer,jsonb) to service_role;
grant execute on function public.settle_grok_quota(uuid,text,integer,boolean,jsonb,jsonb) to service_role;
grant execute on function public.release_grok_quota(uuid,text,text,jsonb) to service_role;
grant execute on function public.set_grok_quota(uuid,integer,text,jsonb) to service_role;

notify pgrst, 'reload schema';
