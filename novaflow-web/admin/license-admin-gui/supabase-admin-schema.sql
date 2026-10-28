-- NovaFlow 后台管理 Supabase 表结构草案（轻量版）
-- 用途：只保留当前免费后台真正需要的用户、积分、Provider、基础设置和最小幂等结算状态。
-- 注意：
-- 1. 本文件仅为手动执行的 SQL 草案，不会被 NovaFlow 自动执行。
-- 2. 本文件不修改现有 licenses 授权表，也不改现有授权系统逻辑。
-- 3. 本轮不创建 credit_logs、ai_tasks、ai_models，避免免费数据库产生不必要读写。
-- 4. Service Role Key 只允许后台管理端或未来后台服务使用，不允许写入公开客户端。

-- 可选：如项目未启用 gen_random_uuid()，需先启用 pgcrypto。
create extension if not exists pgcrypto;

-- users：后台管理用户档案表。
-- 不等同于 Supabase Auth 内部用户表；当前由后台管理软件创建账号，并优先使用 auth.users.id 作为此表 id。
-- 用户可见账号不要求邮箱格式；当前限制为小写字母、数字、点、下划线和短横线，并映射为 account@accounts.novaflow.local。
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  display_name text,
  role text default 'user',
  plan text default 'trial',
  status text default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table public.users is 'NovaFlow 后台管理用户档案表';
comment on column public.users.id is '用户主键，可后续映射 Supabase Auth 用户';
comment on column public.users.email is '内部 Supabase Auth 邮箱，唯一；用户可见账号由后台映射生成';
comment on column public.users.display_name is '用户显示名称';
comment on column public.users.role is '角色，例如 user/admin';
comment on column public.users.plan is '账户类型：trial=普通账户（只能用本机算力），standard=中级账户（可用普通算力节点），pro/team=高级账户（可用所有算力节点）；默认 trial';
comment on column public.users.status is '用户状态，例如 active/disabled';

-- credits：用户当前积分余额表。
-- 积分分配只更新当前余额；轻量版不保存消费流水。
create table if not exists public.credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  balance numeric(20, 6) default 0,
  updated_at timestamptz default now()
);

create unique index if not exists credits_user_id_unique_idx on public.credits(user_id);
create index if not exists idx_credits_user_id on public.credits(user_id);

comment on table public.credits is 'NovaFlow 用户当前积分余额表';
comment on column public.credits.user_id is '对应 public.users.id';
comment on column public.credits.balance is '当前可用积分余额，由后台管理端手动分配或后续后台服务扣减';
comment on index public.credits_user_id_unique_idx is '确保每个用户只有一条当前积分余额记录';

-- ai_providers：云端 AI 服务商配置表。
-- api_key_secret_ref 只保存服务端密钥引用，不保存明文 API Key。
create table if not exists public.ai_providers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  provider_key text unique not null,
  status text default 'disabled',
  billing_multiplier numeric default 1.0,
  api_key_secret_ref text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table public.ai_providers is 'NovaFlow AI Provider 配置表';
comment on column public.ai_providers.name is '服务商显示名。在线密钥只配置 RunningHub API Key，不写在本表';
comment on column public.ai_providers.provider_key is '服务商唯一 key，用于后续 Gateway 转发';
comment on column public.ai_providers.status is '启用状态，例如 enabled/disabled';
comment on column public.ai_providers.billing_multiplier is 'Provider 默认计费倍率';
comment on column public.ai_providers.api_key_secret_ref is '服务端密钥引用，不保存明文 API Key';

-- system_settings：后台系统配置表。
-- 当前用于少量配置，例如：
-- - provider_budget_comfyui：ComfyUI 手动总余额
-- - provider_quota_grok_<user_id>：提示词服务次数配额，只记录 allocated_count / used_count
create table if not exists public.system_settings (
  key text primary key,
  value jsonb,
  updated_at timestamptz default now()
);

comment on table public.system_settings is 'NovaFlow 后台基础设置表';
comment on column public.system_settings.key is '配置 key，例如 provider_budget_comfyui 或 provider_quota_grok_<user_id>';
comment on column public.system_settings.value is '配置值，jsonb';
comment on column public.system_settings.updated_at is '更新时间';

-- Durable, service-only ComfyUI usage settlement.
-- A completed prompt is charged once, and the same fixed-point charge is applied
-- atomically to the user's credits and the administrator's manual balance.

create table if not exists public.comfy_usage_settlements (
  id uuid primary key default gen_random_uuid(),
  usage_key text not null,
  prompt_id text not null,
  user_id uuid references public.users(id) on delete set null,
  provider_key text not null default 'comfyui',
  model_key text not null default '',
  task_type text not null default 'local_workflow_video',
  status text not null default 'pending_pricing',
  pricing_source text not null default 'unknown',
  pricing_details jsonb not null default '{}'::jsonb,
  estimated_credit_cost numeric(20, 6),
  charge_amount numeric(20, 6),
  user_balance_before numeric(20, 6),
  user_balance_after numeric(20, 6),
  provider_balance_before numeric(20, 6),
  provider_balance_after numeric(20, 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint comfy_usage_settlements_usage_key_unique unique (usage_key),
  constraint comfy_usage_settlements_usage_key_valid check (
    btrim(usage_key) = usage_key and char_length(usage_key) between 1 and 200
  ),
  constraint comfy_usage_settlements_provider_valid check (provider_key = 'comfyui'),
  constraint comfy_usage_settlements_status_valid check (status in ('pending_pricing', 'settled')),
  constraint comfy_usage_settlements_pricing_details_valid check (jsonb_typeof(pricing_details) = 'object'),
  constraint comfy_usage_settlements_cost_valid check (
    (estimated_credit_cost is null or estimated_credit_cost >= 0)
    and (charge_amount is null or charge_amount > 0)
  ),
  constraint comfy_usage_settlements_state_shape check (
    (
      status = 'pending_pricing'
      and charge_amount is null
      and user_balance_before is null
      and user_balance_after is null
      and provider_balance_before is null
      and provider_balance_after is null
      and settled_at is null
    )
    or
    (
      status = 'settled'
      and charge_amount is not null
      and user_balance_before is not null
      and user_balance_after = user_balance_before - charge_amount
      and provider_balance_before is not null
      and provider_balance_after = provider_balance_before - charge_amount
      and settled_at is not null
    )
  )
);

create index if not exists comfy_usage_settlements_user_created_idx
  on public.comfy_usage_settlements(user_id, created_at desc);

create index if not exists comfy_usage_settlements_pending_idx
  on public.comfy_usage_settlements(created_at)
  where status = 'pending_pricing';

alter table public.comfy_usage_settlements enable row level security;

drop function if exists public.settle_comfy_usage(text, uuid, text, text, text, text, numeric, integer, text, jsonb);

create or replace function public.settle_comfy_usage(
  p_usage_key text,
  p_user_id uuid,
  p_prompt_id text,
  p_provider_key text,
  p_model_key text,
  p_task_type text,
  p_estimated_credit_cost numeric,
  p_charge_amount numeric,
  p_pricing_source text,
  p_pricing_details jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_usage public.comfy_usage_settlements%rowtype;
  v_credit_id uuid;
  v_user_before numeric(20, 6);
  v_user_after numeric(20, 6);
  v_provider_value jsonb;
  v_provider_before numeric(20, 6);
  v_provider_after numeric(20, 6);
  v_estimated numeric(20, 6) := round(greatest(coalesce(p_estimated_credit_cost, 0), 0), 6);
  v_charge numeric(20, 6) := round(greatest(coalesce(p_charge_amount, 0), 0), 6);
  v_pricing_source text := left(coalesce(nullif(btrim(p_pricing_source), ''), 'unknown'), 120);
  v_pricing_details jsonb := coalesce(p_pricing_details, '{}'::jsonb);
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'settle_comfy_usage: user_id is required';
  end if;
  if p_usage_key is null or btrim(p_usage_key) <> p_usage_key or char_length(p_usage_key) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'settle_comfy_usage: invalid usage_key';
  end if;
  if p_prompt_id is null or btrim(p_prompt_id) = '' or char_length(p_prompt_id) > 160 then
    raise exception using errcode = '22023', message = 'settle_comfy_usage: invalid prompt_id';
  end if;
  if lower(coalesce(p_provider_key, '')) <> 'comfyui' then
    raise exception using errcode = '22023', message = 'settle_comfy_usage: provider_key must be comfyui';
  end if;
  if coalesce(p_estimated_credit_cost, 0) < 0 or coalesce(p_charge_amount, 0) < 0 then
    raise exception using errcode = '22023', message = 'settle_comfy_usage: credit cost cannot be negative';
  end if;
  if p_charge_amount is not null and p_charge_amount <> round(p_charge_amount, 6) then
    raise exception using errcode = '22023', message = 'settle_comfy_usage: charge precision exceeds six decimals';
  end if;
  if jsonb_typeof(v_pricing_details) <> 'object' then
    raise exception using errcode = '22023', message = 'settle_comfy_usage: pricing_details must be an object';
  end if;

  insert into public.comfy_usage_settlements (
    usage_key,
    prompt_id,
    user_id,
    provider_key,
    model_key,
    task_type,
    status,
    pricing_source,
    pricing_details,
    estimated_credit_cost,
    created_at,
    updated_at
  ) values (
    p_usage_key,
    btrim(p_prompt_id),
    p_user_id,
    'comfyui',
    left(coalesce(p_model_key, ''), 120),
    left(coalesce(nullif(btrim(p_task_type), ''), 'local_workflow_video'), 100),
    'pending_pricing',
    v_pricing_source,
    v_pricing_details,
    v_estimated,
    v_now,
    v_now
  )
  on conflict (usage_key) do nothing;

  select *
    into v_usage
    from public.comfy_usage_settlements
   where usage_key = p_usage_key
   for update;

  if not found then
    raise exception 'settle_comfy_usage: usage row was not created';
  end if;
  if v_usage.user_id is distinct from p_user_id
     or v_usage.provider_key <> 'comfyui'
     or v_usage.prompt_id <> btrim(p_prompt_id) then
    raise exception using errcode = '22023', message = 'settle_comfy_usage: usage_key payload mismatch';
  end if;

  if v_usage.status = 'settled' then
    if v_usage.charge_amount is distinct from v_charge then
      raise exception using errcode = '22023', message = 'settle_comfy_usage: settled charge mismatch';
    end if;
    return jsonb_build_object(
      'status', 'settled',
      'idempotent', true,
      'usage_key', v_usage.usage_key,
      'prompt_id', v_usage.prompt_id,
      'user_id', v_usage.user_id,
      'charge_amount', v_usage.charge_amount,
      'charge_amount_text', to_char(v_usage.charge_amount, 'FM99999999999990.000000'),
      'estimated_credit_cost', v_usage.estimated_credit_cost,
      'estimated_credit_cost_text', to_char(v_usage.estimated_credit_cost, 'FM99999999999990.000000'),
      'pricing_source', v_usage.pricing_source,
      'credits', jsonb_build_object(
        'before_balance', v_usage.user_balance_before,
        'before_balance_text', to_char(v_usage.user_balance_before, 'FM99999999999990.000000'),
        'balance', v_usage.user_balance_after,
        'balance_text', to_char(v_usage.user_balance_after, 'FM99999999999990.000000'),
        'deducted', v_usage.charge_amount,
        'deducted_text', to_char(v_usage.charge_amount, 'FM99999999999990.000000')
      ),
      'provider_budget', jsonb_build_object(
        'before_balance', v_usage.provider_balance_before,
        'before_balance_text', to_char(v_usage.provider_balance_before, 'FM99999999999990.000000'),
        'balance', v_usage.provider_balance_after,
        'balance_text', to_char(v_usage.provider_balance_after, 'FM99999999999990.000000'),
        'deducted', v_usage.charge_amount,
        'deducted_text', to_char(v_usage.charge_amount, 'FM99999999999990.000000'),
        'unit', 'credits'
      ),
      'settled_at', v_usage.settled_at
    );
  end if;

  if v_charge = 0 then
    update public.comfy_usage_settlements
       set pricing_source = v_pricing_source,
           pricing_details = v_pricing_details,
           estimated_credit_cost = v_estimated,
           updated_at = v_now
     where id = v_usage.id
     returning * into v_usage;

    return jsonb_build_object(
      'status', 'pending_pricing',
      'idempotent', v_usage.created_at <> v_now,
      'usage_key', v_usage.usage_key,
      'prompt_id', v_usage.prompt_id,
      'user_id', v_usage.user_id,
      'charge_amount', 0,
      'charge_amount_text', '0.000000',
      'estimated_credit_cost', v_usage.estimated_credit_cost,
      'estimated_credit_cost_text', to_char(v_usage.estimated_credit_cost, 'FM99999999999990.000000'),
      'pricing_source', v_usage.pricing_source
    );
  end if;

  insert into public.credits (user_id, balance, updated_at)
  values (p_user_id, 0, v_now)
  on conflict (user_id) do nothing;

  select id, coalesce(balance, 0)
    into v_credit_id, v_user_before
    from public.credits
   where user_id = p_user_id
   for update;

  if not found then
    raise exception 'settle_comfy_usage: user credit row is unavailable';
  end if;

  insert into public.system_settings (key, value, updated_at)
  values (
    'provider_budget_comfyui',
    jsonb_build_object(
      'label', 'ComfyUI manual total balance',
      'provider_key', 'comfyui',
      'balance', 0,
      'unit', 'credits',
      'source', 'usage',
      'note', 'Auto-created by ComfyUI settlement',
      'updated_at', v_now
    ),
    v_now
  )
  on conflict (key) do nothing;

  select value
    into v_provider_value
    from public.system_settings
   where key = 'provider_budget_comfyui'
   for update;

  if not found or jsonb_typeof(v_provider_value) <> 'object'
     or jsonb_typeof(v_provider_value -> 'balance') <> 'number' then
    raise exception 'settle_comfy_usage: provider_budget_comfyui balance is invalid';
  end if;

  v_user_after := v_user_before - v_charge;
  v_provider_before := (v_provider_value ->> 'balance')::numeric(20, 6);
  v_provider_after := v_provider_before - v_charge;

  update public.credits
     set balance = v_user_after,
         updated_at = v_now
   where id = v_credit_id;

  update public.system_settings
     set value = jsonb_set(v_provider_value, '{balance}', to_jsonb(v_provider_after), true)
                 || jsonb_build_object(
                   'updated_at', v_now,
                   'last_settlement', jsonb_build_object(
                     'usage_key', p_usage_key,
                     'prompt_id', btrim(p_prompt_id),
                     'charge_amount', v_charge,
                     'charge_amount_text', to_char(v_charge, 'FM99999999999990.000000'),
                     'pricing_source', v_pricing_source,
                     'settled_at', v_now
                   )
                 ),
         updated_at = v_now
   where key = 'provider_budget_comfyui';

  update public.comfy_usage_settlements
     set status = 'settled',
         pricing_source = v_pricing_source,
         pricing_details = v_pricing_details,
         estimated_credit_cost = v_estimated,
         charge_amount = v_charge,
         user_balance_before = v_user_before,
         user_balance_after = v_user_after,
         provider_balance_before = v_provider_before,
         provider_balance_after = v_provider_after,
         updated_at = v_now,
         settled_at = v_now
   where id = v_usage.id and status = 'pending_pricing'
   returning * into v_usage;

  if not found then
    raise exception 'settle_comfy_usage: pending settlement transition failed';
  end if;

  return jsonb_build_object(
    'status', 'settled',
    'idempotent', false,
    'usage_key', v_usage.usage_key,
    'prompt_id', v_usage.prompt_id,
    'user_id', v_usage.user_id,
    'charge_amount', v_usage.charge_amount,
    'charge_amount_text', to_char(v_usage.charge_amount, 'FM99999999999990.000000'),
    'estimated_credit_cost', v_usage.estimated_credit_cost,
    'estimated_credit_cost_text', to_char(v_usage.estimated_credit_cost, 'FM99999999999990.000000'),
    'pricing_source', v_usage.pricing_source,
    'credits', jsonb_build_object(
      'before_balance', v_usage.user_balance_before,
      'before_balance_text', to_char(v_usage.user_balance_before, 'FM99999999999990.000000'),
      'balance', v_usage.user_balance_after,
      'balance_text', to_char(v_usage.user_balance_after, 'FM99999999999990.000000'),
      'deducted', v_usage.charge_amount,
      'deducted_text', to_char(v_usage.charge_amount, 'FM99999999999990.000000')
    ),
    'provider_budget', jsonb_build_object(
      'before_balance', v_usage.provider_balance_before,
      'before_balance_text', to_char(v_usage.provider_balance_before, 'FM99999999999990.000000'),
      'balance', v_usage.provider_balance_after,
      'balance_text', to_char(v_usage.provider_balance_after, 'FM99999999999990.000000'),
      'deducted', v_usage.charge_amount,
      'deducted_text', to_char(v_usage.charge_amount, 'FM99999999999990.000000'),
      'unit', 'credits'
    ),
    'settled_at', v_usage.settled_at
  );
end;
$$;

revoke all on table public.comfy_usage_settlements from public, anon, authenticated;
grant select, insert, update on table public.comfy_usage_settlements to service_role;

revoke all on function public.settle_comfy_usage(text, uuid, text, text, text, text, numeric, numeric, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.settle_comfy_usage(text, uuid, text, text, text, text, numeric, numeric, text, jsonb)
  to service_role;

-- Grok quota reservation schema (synchronized with migration 20260812030000).
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


-- 当前仅创建 public.comfy_usage_settlements 作为最小幂等结算状态表：
-- - 每个 usage_key 只允许一条记录，pending_pricing 可原子迁移为 settled。
-- - 只保存结算标识、定价和扣减前后余额，不保存 Prompt 正文或完整 Workflow。
-- 仍刻意不创建通用任务/消费明细表：
-- - public.credit_logs：当前不保存消费记录或充值流水。
-- - public.ai_tasks：当前不保存任务记录。
-- - public.ai_models：当前不维护模型库；NovaFlow 主程序负责 Workflow、Prompt 和模型选择。
