-- Unified feature credits.
--
-- credits.balance is the source of truth. reserve/settle/release_feature_credits
-- hold and settle that balance, write credit_ledger, and dual-write the old
-- grok quota tables until phase E. Applying this file does not migrate users
-- and does not contact a provider. migrate_grok_quota_to_credits is explicit.
-- The whole migration function runs in the caller's transaction: a raised
-- error rolls the batch back. Re-applying this file is safe.

create extension if not exists pgcrypto;

alter table public.credits
  alter column balance type numeric(20, 6) using balance::numeric(20, 6),
  alter column balance set default 0;

alter table public.credits drop constraint if exists credits_balance_nonnegative;
alter table public.credits add constraint credits_balance_nonnegative check (balance >= 0);

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  usage_key text not null,
  user_id uuid not null references public.users(id) on delete cascade,
  feature text not null,
  provider_key text not null default 'runninghub',
  model text,
  status text not null default 'reserved',
  estimated_credits numeric(20, 6) not null default 0,
  settled_credits numeric(20, 6),
  balance_before numeric(20, 6),
  balance_after numeric(20, 6),
  rh_cost_usd numeric(20, 8),
  rh_cost_currency text,
  pricing_source text not null default 'admin_unit_price',
  pricing_details jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint credit_ledger_usage_key_unique unique (usage_key),
  constraint credit_ledger_usage_key_valid check (
    btrim(usage_key) = usage_key and char_length(usage_key) between 1 and 200
  ),
  constraint credit_ledger_feature_valid check (
    btrim(feature) = feature and char_length(feature) between 1 and 80
  ),
  -- reserved: hold open, balance already reduced.
  -- settled: success; settled_credits stays charged.
  -- released: failure, moderation, or cancel; settled_credits is 0 and the hold was returned.
  -- A failed call is released. There is no separate failed status.
  constraint credit_ledger_status_valid check (status in ('reserved', 'settled', 'released')),
  constraint credit_ledger_amounts_valid check (
    estimated_credits >= 0
    and (settled_credits is null or settled_credits >= 0)
    and (rh_cost_usd is null or rh_cost_usd >= 0)
  ),
  constraint credit_ledger_json_valid check (jsonb_typeof(pricing_details) = 'object')
);

create index if not exists credit_ledger_user_created_idx
  on public.credit_ledger(user_id, created_at desc);
create index if not exists credit_ledger_feature_created_idx
  on public.credit_ledger(feature, created_at desc);
create index if not exists credit_ledger_open_idx
  on public.credit_ledger(status)
  where status = 'reserved';

alter table public.credit_ledger enable row level security;
alter table public.credit_ledger force row level security;
revoke all on table public.credit_ledger from public, anon, authenticated;
grant select, insert, update, delete on table public.credit_ledger to service_role;

comment on column public.credit_ledger.status is
  'reserved: hold open and balance reduced. settled: success, settled_credits is the charge. released: failure, moderation, or cancel; settled_credits is 0 and the hold was returned. A failed call is released; there is no separate failed status.';

create table if not exists public.quota_migration_batches (
  batch_id text primary key,
  status text not null,
  price numeric(20, 6) not null,
  user_count integer not null default 0,
  credits_added numeric(20, 6) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quota_migration_batch_status check (status in ('completed', 'rolled_back'))
);

create table if not exists public.quota_migration_snapshots (
  id uuid primary key default gen_random_uuid(),
  batch_id text not null references public.quota_migration_batches(batch_id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  allocated_count integer not null,
  used_count integer not null,
  reserved_count integer not null,
  remaining_count integer not null,
  balance_before numeric(20, 6) not null,
  credits_added numeric(20, 6) not null,
  balance_after numeric(20, 6) not null,
  created_at timestamptz not null default now(),
  constraint quota_migration_snapshot_user unique (batch_id, user_id)
);

alter table public.quota_migration_batches enable row level security;
alter table public.quota_migration_batches force row level security;
alter table public.quota_migration_snapshots enable row level security;
alter table public.quota_migration_snapshots force row level security;
revoke all on table public.quota_migration_batches from public, anon, authenticated;
revoke all on table public.quota_migration_snapshots from public, anon, authenticated;
grant select, insert, update, delete on table public.quota_migration_batches to service_role;
grant select, insert, update, delete on table public.quota_migration_snapshots to service_role;

insert into public.system_settings(key, value, updated_at)
values (
  'feature_credit_config',
  jsonb_build_object(
    'prices', jsonb_build_object(
      'xiaotao_vision', 4,
      'online_chat_turn', 4,
      'prompt_optimize', 4,
      'image_reverse', 4,
      'lean_research', 14,
      'gpt_image_2_5_economy', 22,
      'gpt_image_2_official', 4,
      'grok_image_g42', 6,
      'local', 0
    ),
    'rh_cost_usd', jsonb_build_object(
      'xiaotao_vision', 0.0073,
      'online_chat_turn', 0.0034,
      'prompt_optimize', 0.0075,
      'image_reverse', 0.0073,
      'lean_research', 0.0306,
      'gpt_image_2_5_economy', 0.05,
      'gpt_image_2_official', 0.009,
      'grok_image_g42', 0.01,
      'local', 0
    ),
    'credits_to_cny', null,
    'low_balance_usd', 2,
    'low_balance_cny', 15,
    'balance_ttl_seconds', 600,
    'stale_balance_policy', 'allow',
    'credits_per_usd', 211
  ),
  clock_timestamp()
)
on conflict (key) do nothing;

create or replace function public.canonical_credit_feature(p_feature text)
returns text
language sql
immutable
as $$
  select case
    when p_feature is null or btrim(p_feature) = '' then ''
    when btrim(p_feature) = 'local' or btrim(p_feature) like 'local\_%' or btrim(p_feature) like 'local-%' then 'local'
    when btrim(p_feature) in ('xiaotao-vision', 'xiaotao_vision') then 'xiaotao_vision'
    when btrim(p_feature) in ('xiaotao-text', 'online-chat-turn', 'online_chat_turn') then 'online_chat_turn'
    when btrim(p_feature) in ('prompt-optimize', 'prompt_optimize') then 'prompt_optimize'
    when btrim(p_feature) in ('image-reverse', 'image_reverse', 'video-reverse', 'video_reverse') then 'image_reverse'
    when btrim(p_feature) in ('ui-catalog', 'lean-research', 'lean_research') then 'lean_research'
    when btrim(p_feature) in ('gpt-image-2.5', 'gpt-image-2.5-economy', 'gpt_image_2_5', 'gpt_image_2_5_economy') then 'gpt_image_2_5_economy'
    when btrim(p_feature) in ('gpt-image-2', 'gpt_image_2', 'gpt_image_2_official') then 'gpt_image_2_official'
    when btrim(p_feature) in ('g-4.2', 'grok-image-g42', 'grok_image_g42') then 'grok_image_g42'
    else replace(btrim(p_feature), '-', '_')
  end;
$$;

create or replace function public.feature_credit_quote(p_feature text, p_units integer)
returns jsonb
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  v_key text := public.canonical_credit_feature(p_feature);
  v_config jsonb := coalesce((select value from public.system_settings where key = 'feature_credit_config'), '{}'::jsonb);
  v_defaults jsonb := jsonb_build_object(
    'xiaotao_vision', 4, 'online_chat_turn', 4, 'prompt_optimize', 4, 'image_reverse', 4,
    'lean_research', 14, 'gpt_image_2_5_economy', 22, 'gpt_image_2_official', 4,
    'grok_image_g42', 6, 'local', 0
  );
  v_cost_defaults jsonb := jsonb_build_object(
    'xiaotao_vision', 0.0073, 'online_chat_turn', 0.0034, 'prompt_optimize', 0.0075,
    'image_reverse', 0.0073, 'lean_research', 0.0306, 'gpt_image_2_5_economy', 0.05,
    'gpt_image_2_official', 0.009, 'grok_image_g42', 0.01, 'local', 0
  );
  v_prices jsonb;
  v_costs jsonb;
  v_per_image boolean;
  v_units integer;
  v_price numeric;
  v_cost numeric;
begin
  if v_key = '' then
    raise exception using errcode = '22023', message = 'feature_credit_quote: invalid feature';
  end if;
  if v_key = 'local' then
    return jsonb_build_object('feature', 'local', 'units', 1, 'unit_price', 0, 'credits', 0, 'rh_cost_usd', 0, 'local', true);
  end if;
  v_prices := v_defaults || coalesce(v_config->'prices', '{}'::jsonb);
  v_prices := v_prices || jsonb_build_object('local', 0);
  v_costs := v_cost_defaults || coalesce(v_config->'rh_cost_usd', '{}'::jsonb);
  v_per_image := v_key in ('gpt_image_2_5_economy', 'gpt_image_2_official', 'grok_image_g42', 'gpt_image_2_5_token');
  v_units := case when v_per_image then least(greatest(coalesce(p_units, 1), 1), 100) else 1 end;
  if v_prices ? v_key and v_prices->>v_key is not null and v_prices->>v_key <> 'null' then
    v_price := round((v_prices->>v_key)::numeric);
  else
    v_price := null;
  end if;
  if v_price is null or v_price < 0 then
    return jsonb_build_object('feature', v_key, 'units', v_units, 'unpriced', true, 'local', false);
  end if;
  v_cost := coalesce((v_costs->>v_key)::numeric, 0) * v_units;
  return jsonb_build_object(
    'feature', v_key, 'units', v_units, 'unit_price', v_price,
    'credits', v_price * v_units, 'rh_cost_usd', v_cost,
    'local', v_price = 0, 'unpriced', false, 'per_image', v_per_image
  );
end;
$$;

create or replace function public.credit_ledger_estimated_rh_cost()
returns numeric
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select coalesce(sum(rh_cost_usd), 0)
    from public.credit_ledger
   where status = 'settled' and rh_cost_usd is not null;
$$;

create or replace function public.feature_credit_pool_blocked()
returns boolean
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  v_balance jsonb := coalesce((select value from public.system_settings where key = 'rh_domestic_balance'), '{}'::jsonb);
  v_config jsonb := coalesce((select value from public.system_settings where key = 'feature_credit_config'), '{}'::jsonb);
  v_money numeric;
  v_currency text;
  v_checked timestamptz;
  v_ttl integer;
  v_policy text;
  v_threshold numeric;
begin
  -- Stored domestic snapshot. Missing or older than the TTL follows
  -- stale_balance_policy (default allow). A fresh snapshot compares USD or CNY.
  v_ttl := coalesce((v_config->>'balance_ttl_seconds')::integer, 600);
  if v_ttl < 30 then v_ttl := 600; end if;
  v_policy := case when lower(coalesce(v_config->>'stale_balance_policy', 'allow')) = 'block' then 'block' else 'allow' end;
  begin
    v_checked := nullif(v_balance->>'checkedAt', '')::timestamptz;
  exception when others then
    v_checked := null;
  end;
  if v_checked is null or v_checked < clock_timestamp() - make_interval(secs => v_ttl) then
    return v_policy = 'block';
  end if;
  if coalesce(v_balance->>'remainMoney', '') = '' then
    return v_policy = 'block';
  end if;
  v_money := (v_balance->>'remainMoney')::numeric;
  v_currency := upper(coalesce(v_balance->>'currency', ''));
  if v_money <= 0 then return true; end if;
  if v_currency in ('', 'USD') then
    v_threshold := coalesce((v_config->>'low_balance_usd')::numeric, 2);
    return v_money < v_threshold;
  end if;
  if v_currency = 'CNY' then
    v_threshold := coalesce((v_config->>'low_balance_cny')::numeric, 15);
    return v_money < v_threshold;
  end if;
  return false;
end;
$$;

create or replace function public.feature_credit_mirror_reserve(
  p_user_id uuid, p_usage_key text, p_feature text, p_units integer, p_metadata jsonb
)
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_key text := 'provider_quota_grok_' || p_user_id::text;
  v_value jsonb;
  v_calls integer := least(greatest(coalesce(p_units, 1), 1), 20);
begin
  if to_regclass('public.grok_quota_reservations') is null then return; end if;
  if exists (select 1 from public.grok_quota_reservations where usage_key = p_usage_key) then return; end if;
  insert into public.system_settings(key, value, updated_at)
  values (v_key, jsonb_build_object(
    'label', 'Prompt service quota', 'provider_key', 'grok', 'user_id', p_user_id,
    'allocated_count', 0, 'used_count', 0, 'reserved_count', 0, 'remaining_count', 0,
    'recent_calls', '[]'::jsonb, 'source', 'credit_mirror', 'updated_at', v_now
  ), v_now)
  on conflict (key) do nothing;
  select value into v_value from public.system_settings where key = v_key for update;
  insert into public.grok_quota_reservations(
    usage_key, user_id, feature, min_calls, max_calls, reserved_calls, metadata, created_at, updated_at, expires_at
  ) values (
    p_usage_key, p_user_id, left(p_feature, 100), v_calls, v_calls, v_calls,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('credit_mirror', true),
    v_now, v_now, v_now + interval '20 minutes'
  );
  v_value := coalesce(v_value, '{}'::jsonb) || jsonb_build_object(
    'provider_key', 'grok', 'user_id', p_user_id,
    'allocated_count', greatest(coalesce((v_value->>'allocated_count')::integer, 0), 0),
    'used_count', greatest(coalesce((v_value->>'used_count')::integer, 0), 0),
    'reserved_count', greatest(coalesce((v_value->>'reserved_count')::integer, 0), 0) + v_calls,
    'remaining_count', greatest(
      greatest(coalesce((v_value->>'allocated_count')::integer, 0), 0)
      - greatest(coalesce((v_value->>'used_count')::integer, 0), 0)
      - (greatest(coalesce((v_value->>'reserved_count')::integer, 0), 0) + v_calls), 0),
    'source', 'credit_mirror', 'updated_at', v_now
  );
  update public.system_settings set value = v_value, updated_at = v_now where key = v_key;
end;
$$;

create or replace function public.feature_credit_mirror_close(
  p_user_id uuid, p_usage_key text, p_actual_units integer, p_success boolean, p_reason text
)
returns void
language plpgsql
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
  v_actual integer;
begin
  if to_regclass('public.grok_quota_reservations') is null then return; end if;
  select value into v_value from public.system_settings where key = v_key for update;
  select * into v_row from public.grok_quota_reservations where usage_key = p_usage_key for update;
  if not found or v_row.status <> 'reserved' then return; end if;
  v_allocated := greatest(coalesce((v_value->>'allocated_count')::integer, 0), 0);
  v_used := greatest(coalesce((v_value->>'used_count')::integer, 0), 0);
  v_reserved := greatest(coalesce((v_value->>'reserved_count')::integer, 0) - v_row.reserved_calls, 0);
  if p_success then
    v_actual := least(greatest(coalesce(p_actual_units, 0), 0), v_row.reserved_calls);
    v_used := v_used + v_actual;
    update public.grok_quota_reservations
       set status = 'settled', actual_calls = v_actual, success = true, updated_at = v_now, settled_at = v_now
     where usage_key = p_usage_key;
  else
    update public.grok_quota_reservations
       set status = 'released', actual_calls = 0, success = false,
           metadata = metadata || jsonb_build_object('release_reason', left(coalesce(p_reason, ''), 240)),
           updated_at = v_now, settled_at = v_now
     where usage_key = p_usage_key;
  end if;
  if v_value is not null then
    v_value := v_value || jsonb_build_object(
      'allocated_count', v_allocated, 'used_count', v_used, 'reserved_count', v_reserved,
      'remaining_count', greatest(v_allocated - v_used - v_reserved, 0),
      'source', 'credit_mirror', 'updated_at', v_now
    );
    update public.system_settings set value = v_value, updated_at = v_now where key = v_key;
  end if;
end;
$$;

create or replace function public.reserve_feature_credits(
  p_user_id uuid,
  p_usage_key text,
  p_feature text,
  p_units integer,
  p_model text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_quote jsonb;
  v_row public.credit_ledger%rowtype;
  v_credits numeric(20, 6);
  v_before numeric(20, 6);
  v_after numeric(20, 6);
  v_locked text;
begin
  if p_user_id is null then raise exception using errcode = '22023', message = 'reserve_feature_credits: user_id is required'; end if;
  if p_usage_key is null or btrim(p_usage_key) <> p_usage_key or char_length(p_usage_key) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'reserve_feature_credits: invalid usage_key';
  end if;
  if p_units is null or p_units < 1 or p_units > 100 then
    raise exception using errcode = '22023', message = 'reserve_feature_credits: invalid units';
  end if;
  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'reserve_feature_credits: metadata must be an object';
  end if;
  select value->>'locked' into v_locked from public.system_settings where key = 'quota_migration_lock';
  if v_locked = 'true' then
    raise exception using errcode = 'P0001', message = '积分迁移维护中，请稍后再试';
  end if;

  select * into v_row from public.credit_ledger where usage_key = p_usage_key;
  if found then
    if v_row.user_id <> p_user_id then
      raise exception using errcode = '22023', message = 'reserve_feature_credits: usage_key payload mismatch';
    end if;
    return jsonb_build_object(
      'status', v_row.status, 'idempotent', true, 'usage_key', v_row.usage_key,
      'feature', v_row.feature, 'units', coalesce((v_row.pricing_details->>'call_units')::integer, p_units),
      'estimated_credits', v_row.estimated_credits, 'balance_after', v_row.balance_after
    );
  end if;

  v_quote := public.feature_credit_quote(p_feature, p_units);
  if coalesce((v_quote->>'local')::boolean, false) or coalesce((v_quote->>'credits')::numeric, 0) = 0 and coalesce((v_quote->>'unpriced')::boolean, false) = false then
    return jsonb_build_object('status', 'local', 'idempotent', false, 'feature', v_quote->>'feature', 'units', p_units, 'estimated_credits', 0, 'local', true);
  end if;
  if coalesce((v_quote->>'unpriced')::boolean, false) then
    raise exception using errcode = 'P0001', message = '该功能积分单价未配置';
  end if;
  if public.feature_credit_pool_blocked() then
    raise exception using errcode = 'P0001', message = '云服务余额不足，请联系管理员';
  end if;

  v_credits := (v_quote->>'credits')::numeric(20, 6);
  insert into public.credits(user_id, balance) values (p_user_id, 0) on conflict (user_id) do nothing;
  select balance into v_before from public.credits where user_id = p_user_id for update;
  if v_before is null then raise exception using errcode = 'P0001', message = '积分不足'; end if;
  if v_before < v_credits then raise exception using errcode = 'P0001', message = '积分不足'; end if;
  v_after := v_before - v_credits;
  update public.credits set balance = v_after, updated_at = v_now where user_id = p_user_id;

  insert into public.credit_ledger(
    usage_key, user_id, feature, provider_key, model, status,
    estimated_credits, balance_before, balance_after, rh_cost_usd, rh_cost_currency,
    pricing_source, pricing_details, created_at, updated_at
  ) values (
    p_usage_key, p_user_id, v_quote->>'feature', 'runninghub', nullif(left(coalesce(p_model, ''), 200), ''),
    'reserved', v_credits, v_before, v_after, (v_quote->>'rh_cost_usd')::numeric, 'USD',
    'admin_unit_price',
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'call_units', p_units, 'billable_units', (v_quote->>'units')::integer,
      'unit_price', (v_quote->>'unit_price')::numeric, 'rh_cost_source', 'estimate'
    ),
    v_now, v_now
  ) returning * into v_row;

  perform public.feature_credit_mirror_reserve(p_user_id, p_usage_key, v_row.feature, p_units, coalesce(p_metadata, '{}'::jsonb));

  return jsonb_build_object(
    'status', 'reserved', 'idempotent', false, 'usage_key', p_usage_key,
    'feature', v_row.feature, 'units', p_units, 'estimated_credits', v_credits,
    'balance_before', v_before, 'balance_after', v_after, 'rh_cost_usd', v_row.rh_cost_usd
  );
end;
$$;

create or replace function public.settle_feature_credits(
  p_user_id uuid,
  p_usage_key text,
  p_feature text default null,
  p_actual_units integer default null,
  p_model text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_row public.credit_ledger%rowtype;
begin
  if p_user_id is null or p_usage_key is null then
    raise exception using errcode = '22023', message = 'settle_feature_credits: identity is required';
  end if;
  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'settle_feature_credits: metadata must be an object';
  end if;
  select * into v_row from public.credit_ledger where usage_key = p_usage_key for update;
  if not found or v_row.user_id <> p_user_id then
    raise exception using errcode = '22023', message = 'settle_feature_credits: reservation not found';
  end if;
  if v_row.status = 'settled' then
    return jsonb_build_object(
      'status', 'settled', 'idempotent', true, 'usage_key', p_usage_key,
      'feature', v_row.feature, 'estimated_credits', v_row.estimated_credits,
      'settled_credits', v_row.settled_credits, 'balance_after', v_row.balance_after
    );
  end if;
  if v_row.status <> 'reserved' then
    raise exception using errcode = '22023', message = 'settle_feature_credits: reservation is not open';
  end if;
  -- The hold already left the balance. Record the balance the user can see now.
  select balance into v_row.balance_after from public.credits where user_id = p_user_id;
  update public.credit_ledger
     set status = 'settled',
         settled_credits = estimated_credits,
         balance_after = v_row.balance_after,
         model = coalesce(nullif(left(coalesce(p_model, ''), 200), ''), model),
         pricing_details = pricing_details || coalesce(p_metadata, '{}'::jsonb),
         updated_at = v_now,
         settled_at = v_now
   where usage_key = p_usage_key
   returning * into v_row;
  perform public.feature_credit_mirror_close(p_user_id, p_usage_key, coalesce(p_actual_units, 1), true, null);
  return jsonb_build_object(
    'status', 'settled', 'idempotent', false, 'usage_key', p_usage_key,
    'feature', v_row.feature, 'estimated_credits', v_row.estimated_credits,
    'settled_credits', v_row.settled_credits, 'balance_after', v_row.balance_after,
    'rh_cost_usd', v_row.rh_cost_usd
  );
end;
$$;

create or replace function public.release_feature_credits(
  p_user_id uuid,
  p_usage_key text,
  p_feature text default null,
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
  v_row public.credit_ledger%rowtype;
  v_balance numeric(20, 6);
begin
  if p_user_id is null or p_usage_key is null then
    raise exception using errcode = '22023', message = 'release_feature_credits: identity is required';
  end if;
  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'release_feature_credits: metadata must be an object';
  end if;
  select * into v_row from public.credit_ledger where usage_key = p_usage_key for update;
  if not found or v_row.user_id <> p_user_id then
    raise exception using errcode = '22023', message = 'release_feature_credits: reservation not found';
  end if;
  if v_row.status = 'released' then
    return jsonb_build_object(
      'status', 'released', 'idempotent', true, 'usage_key', p_usage_key,
      'settled_credits', 0, 'balance_after', v_row.balance_after
    );
  end if;
  if v_row.status <> 'reserved' then
    raise exception using errcode = '22023', message = 'release_feature_credits: reservation is not open';
  end if;
  select balance into v_balance from public.credits where user_id = p_user_id for update;
  v_balance := coalesce(v_balance, 0) + v_row.estimated_credits;
  update public.credits set balance = v_balance, updated_at = v_now where user_id = p_user_id;
  update public.credit_ledger
     set status = 'released', settled_credits = 0, balance_after = v_balance,
         error_code = left(coalesce(p_reason, ''), 80),
         error_message = left(coalesce(p_reason, ''), 240),
         pricing_details = pricing_details || coalesce(p_metadata, '{}'::jsonb),
         updated_at = v_now, settled_at = v_now
   where usage_key = p_usage_key
   returning * into v_row;
  perform public.feature_credit_mirror_close(p_user_id, p_usage_key, 0, false, p_reason);
  return jsonb_build_object(
    'status', 'released', 'idempotent', false, 'usage_key', p_usage_key,
    'settled_credits', 0, 'balance_after', v_balance, 'estimated_credits', v_row.estimated_credits
  );
end;
$$;

-- Old call-count reserve refuses new holds while a migration lock is on.
-- The body otherwise matches the phase-B reservation function. Credits, not
-- this remaining-count gate, decide whether an online call proceeds.
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
  v_locked text;
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
  select value->>'locked' into v_locked from public.system_settings where key = 'quota_migration_lock';
  if v_locked = 'true' then
    raise exception using errcode = 'P0001', message = '积分迁移维护中，请稍后再试';
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
      'provider_call_budget', case when v_row.status = 'reserved' then v_row.reserved_calls else 0 end
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
    'expires_at', v_row.expires_at
  );
end;
$$;

create or replace function public.migrate_grok_quota_to_credits(
  p_batch_id text,
  p_price numeric default null,
  p_force_fail boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_batch public.quota_migration_batches%rowtype;
  v_price numeric(20, 6);
  v_setting record;
  v_user_id uuid;
  v_value jsonb;
  v_allocated integer;
  v_used integer;
  v_reserved integer;
  v_remaining integer;
  v_add numeric(20, 6);
  v_before numeric(20, 6);
  v_after numeric(20, 6);
  v_users integer := 0;
  v_total numeric(20, 6) := 0;
  v_open record;
  v_snap record;
  v_check numeric;
  v_lock jsonb;
begin
  if p_batch_id is null or p_batch_id !~ '^[A-Za-z0-9_-]{1,80}$' then
    raise exception using errcode = '22023', message = 'migrate_grok_quota_to_credits: invalid batch id';
  end if;
  -- One migration transaction at a time. A second connection is rejected
  -- instead of waiting and then crediting the same remaining counts.
  if not pg_try_advisory_xact_lock(81402128) then
    raise exception using errcode = 'P0001', message = 'migrate_grok_quota_to_credits: another batch holds the lock';
  end if;
  insert into public.system_settings(key, value, updated_at)
  values ('quota_migration_lock', jsonb_build_object('locked', false, 'status', 'idle', 'batch_id', ''), v_now)
  on conflict (key) do nothing;
  select value into v_lock from public.system_settings where key = 'quota_migration_lock' for update;
  if coalesce(v_lock->>'batch_id', '') <> ''
     and v_lock->>'batch_id' is distinct from p_batch_id
     and (
       coalesce(v_lock->>'locked', 'false') = 'true'
       or coalesce(v_lock->>'status', '') = 'held'
     ) then
    raise exception using errcode = 'P0001', message = 'migrate_grok_quota_to_credits: another batch holds the lock';
  end if;
  select * into v_batch from public.quota_migration_batches where batch_id = p_batch_id;
  if found and v_batch.status = 'completed' then
    return jsonb_build_object('status', 'already_migrated', 'batch_id', p_batch_id, 'credits_added', v_batch.credits_added);
  end if;
  if found and v_batch.status = 'rolled_back' then
    delete from public.credit_ledger
     where feature = 'quota_migration' and pricing_details->>'batch_id' = p_batch_id;
    delete from public.quota_migration_snapshots where batch_id = p_batch_id;
    delete from public.quota_migration_batches where batch_id = p_batch_id;
  end if;

  if p_price is null then
    v_price := coalesce((public.feature_credit_quote('xiaotao_vision', 1)->>'unit_price')::numeric, 4);
  else
    v_price := p_price;
  end if;
  if v_price < 0 then
    raise exception using errcode = '22023', message = 'migrate_grok_quota_to_credits: invalid price';
  end if;

  update public.system_settings
     set value = jsonb_build_object('locked', true, 'status', 'held', 'batch_id', p_batch_id, 'updated_at', v_now),
         updated_at = v_now
   where key = 'quota_migration_lock';

  insert into public.quota_migration_batches(batch_id, status, price, user_count, credits_added, created_at, updated_at)
  values (p_batch_id, 'completed', v_price, 0, 0, v_now, v_now);

  if to_regclass('public.grok_quota_reservations') is not null then
    for v_open in
      select * from public.grok_quota_reservations where status = 'reserved' order by user_id, usage_key for update
    loop
      perform public.release_grok_quota(v_open.user_id, v_open.usage_key, 'quota migration', jsonb_build_object('batch_id', p_batch_id));
    end loop;
  end if;

  for v_setting in
    select key, value from public.system_settings
     where key like 'provider_quota_grok_%'
     order by key
     for update
  loop
    begin
      v_user_id := substring(v_setting.key from 'provider_quota_grok_(.*)')::uuid;
    exception when others then
      continue;
    end;
    if v_user_id is null or not exists (select 1 from public.users where id = v_user_id) then continue; end if;
    v_value := v_setting.value;
    v_allocated := greatest(coalesce((v_value->>'allocated_count')::integer, 0), 0);
    v_used := greatest(coalesce((v_value->>'used_count')::integer, 0), 0);
    v_reserved := greatest(coalesce((v_value->>'reserved_count')::integer, 0), 0);
    v_remaining := greatest(v_allocated - v_used - v_reserved, 0);
    v_add := ceil(v_remaining * v_price);
    insert into public.credits(user_id, balance) values (v_user_id, 0) on conflict (user_id) do nothing;
    select balance into v_before from public.credits where user_id = v_user_id for update;
    v_before := coalesce(v_before, 0);
    v_after := v_before + v_add;
    update public.credits set balance = v_after, updated_at = v_now where user_id = v_user_id;
    if v_add > 0 then
      insert into public.credit_ledger(
        usage_key, user_id, feature, provider_key, status, estimated_credits, settled_credits,
        balance_before, balance_after, rh_cost_usd, rh_cost_currency, pricing_source, pricing_details,
        created_at, updated_at, settled_at
      ) values (
        'migrate_grok_quota_' || v_user_id::text || '_' || p_batch_id,
        v_user_id, 'quota_migration', 'runninghub', 'settled', v_add, v_add,
        v_before, v_after, 0, 'USD', 'admin_unit_price',
        jsonb_build_object('remaining_count', v_remaining, 'price', v_price, 'batch_id', p_batch_id),
        v_now, v_now, v_now
      );
    end if;
    update public.system_settings
       set value = v_value || jsonb_build_object(
         'allocated_count', v_used, 'used_count', v_used, 'reserved_count', 0, 'remaining_count', 0,
         'migration_frozen', true, 'migration_batch', p_batch_id, 'source', 'quota_migration', 'updated_at', v_now
       ),
           updated_at = v_now
     where key = v_setting.key;
    insert into public.quota_migration_snapshots(
      batch_id, user_id, allocated_count, used_count, reserved_count, remaining_count,
      balance_before, credits_added, balance_after
    ) values (
      p_batch_id, v_user_id, v_allocated, v_used, v_reserved, v_remaining, v_before, v_add, v_after
    );
    v_users := v_users + 1;
    v_total := v_total + v_add;
  end loop;

  if p_force_fail then
    raise exception using errcode = 'P0001', message = 'migrate_grok_quota_to_credits: forced failure';
  end if;

  for v_snap in select * from public.quota_migration_snapshots where batch_id = p_batch_id loop
    select balance into v_check from public.credits where user_id = v_snap.user_id;
    if coalesce(v_check, -1) <> v_snap.balance_after then
      raise exception using errcode = 'P0001', message = 'migrate_grok_quota_to_credits: balance check failed';
    end if;
  end loop;

  insert into public.quota_migration_batches(batch_id, status, price, user_count, credits_added, created_at, updated_at)
  values (p_batch_id, 'completed', v_price, v_users, v_total, v_now, v_now)
  on conflict (batch_id) do update
    set status = 'completed', price = excluded.price, user_count = excluded.user_count,
        credits_added = excluded.credits_added, updated_at = excluded.updated_at;

  update public.system_settings
     set value = jsonb_build_object('locked', false, 'status', 'completed', 'batch_id', p_batch_id, 'updated_at', v_now),
         updated_at = v_now
   where key = 'quota_migration_lock';

  return jsonb_build_object('status', 'completed', 'batch_id', p_batch_id, 'user_count', v_users, 'credits_added', v_total, 'price', v_price);
end;
$$;

create or replace function public.rollback_grok_quota_migration(p_batch_id text)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_batch public.quota_migration_batches%rowtype;
  v_snap public.quota_migration_snapshots%rowtype;
  v_key text;
  v_value jsonb;
begin
  if p_batch_id is null or p_batch_id !~ '^[A-Za-z0-9_-]{1,80}$' then
    raise exception using errcode = '22023', message = 'rollback_grok_quota_migration: invalid batch id';
  end if;
  if not pg_try_advisory_xact_lock(81402128) then
    raise exception using errcode = 'P0001', message = 'rollback_grok_quota_migration: another batch holds the lock';
  end if;
  select * into v_batch from public.quota_migration_batches where batch_id = p_batch_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found', 'batch_id', p_batch_id);
  end if;
  if v_batch.status = 'rolled_back' then
    return jsonb_build_object('status', 'already_rolled_back', 'batch_id', p_batch_id);
  end if;
  for v_snap in
    select * from public.quota_migration_snapshots where batch_id = p_batch_id order by user_id for update
  loop
    update public.credits set balance = v_snap.balance_before, updated_at = v_now where user_id = v_snap.user_id;
    v_key := 'provider_quota_grok_' || v_snap.user_id::text;
    select value into v_value from public.system_settings where key = v_key for update;
    if v_value is not null then
      update public.system_settings
         set value = v_value || jsonb_build_object(
           'allocated_count', v_snap.allocated_count,
           'used_count', v_snap.used_count,
           'reserved_count', v_snap.reserved_count,
           'remaining_count', v_snap.remaining_count,
           'migration_frozen', false,
           'source', 'quota_migration_rollback',
           'updated_at', v_now
         ),
             updated_at = v_now
       where key = v_key;
    end if;
  end loop;
  delete from public.credit_ledger
   where feature = 'quota_migration' and pricing_details->>'batch_id' = p_batch_id;
  update public.quota_migration_batches
     set status = 'rolled_back', updated_at = v_now
   where batch_id = p_batch_id;
  update public.system_settings
     set value = jsonb_build_object('locked', false, 'batch_id', p_batch_id, 'updated_at', v_now),
         updated_at = v_now
   where key = 'quota_migration_lock';
  return jsonb_build_object('status', 'rolled_back', 'batch_id', p_batch_id);
end;
$$;

revoke all on function public.canonical_credit_feature(text) from public, anon, authenticated;
revoke all on function public.feature_credit_quote(text, integer) from public, anon, authenticated;
revoke all on function public.credit_ledger_estimated_rh_cost() from public, anon, authenticated;
revoke all on function public.feature_credit_pool_blocked() from public, anon, authenticated;
revoke all on function public.feature_credit_mirror_reserve(uuid, text, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.feature_credit_mirror_close(uuid, text, integer, boolean, text) from public, anon, authenticated;
revoke all on function public.reserve_feature_credits(uuid, text, text, integer, text, jsonb) from public, anon, authenticated;
revoke all on function public.settle_feature_credits(uuid, text, text, integer, text, jsonb) from public, anon, authenticated;
revoke all on function public.release_feature_credits(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.reserve_grok_quota(uuid, text, text, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.migrate_grok_quota_to_credits(text, numeric, boolean) from public, anon, authenticated;
revoke all on function public.rollback_grok_quota_migration(text) from public, anon, authenticated;

grant execute on function public.canonical_credit_feature(text) to service_role;
grant execute on function public.feature_credit_quote(text, integer) to service_role;
grant execute on function public.credit_ledger_estimated_rh_cost() to service_role;
grant execute on function public.feature_credit_pool_blocked() to service_role;
grant execute on function public.feature_credit_mirror_reserve(uuid, text, text, integer, jsonb) to service_role;
grant execute on function public.feature_credit_mirror_close(uuid, text, integer, boolean, text) to service_role;
grant execute on function public.reserve_feature_credits(uuid, text, text, integer, text, jsonb) to service_role;
grant execute on function public.settle_feature_credits(uuid, text, text, integer, text, jsonb) to service_role;
grant execute on function public.release_feature_credits(uuid, text, text, text, jsonb) to service_role;
grant execute on function public.reserve_grok_quota(uuid, text, text, integer, integer, jsonb) to service_role;
grant execute on function public.migrate_grok_quota_to_credits(text, numeric, boolean) to service_role;
grant execute on function public.rollback_grok_quota_migration(text) to service_role;

notify pgrst, 'reload schema';
