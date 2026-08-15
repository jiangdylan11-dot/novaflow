-- Durable, service-only ComfyUI usage settlement.
-- A completed prompt is charged once, and the same integer charge is applied
-- atomically to the user's credits and the administrator's manual balance.

create extension if not exists pgcrypto;

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
  charge_amount integer,
  user_balance_before integer,
  user_balance_after integer,
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

create or replace function public.settle_comfy_usage(
  p_usage_key text,
  p_user_id uuid,
  p_prompt_id text,
  p_provider_key text,
  p_model_key text,
  p_task_type text,
  p_estimated_credit_cost numeric,
  p_charge_amount integer,
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
  v_user_before integer;
  v_user_after integer;
  v_provider_value jsonb;
  v_provider_before numeric(20, 6);
  v_provider_after numeric(20, 6);
  v_estimated numeric(20, 6) := greatest(coalesce(p_estimated_credit_cost, 0), 0);
  v_charge integer := greatest(coalesce(p_charge_amount, 0), 0);
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
      'estimated_credit_cost', v_usage.estimated_credit_cost,
      'pricing_source', v_usage.pricing_source,
      'credits', jsonb_build_object(
        'before_balance', v_usage.user_balance_before,
        'balance', v_usage.user_balance_after,
        'deducted', v_usage.charge_amount
      ),
      'provider_budget', jsonb_build_object(
        'before_balance', v_usage.provider_balance_before,
        'balance', v_usage.provider_balance_after,
        'deducted', v_usage.charge_amount,
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
      'estimated_credit_cost', v_usage.estimated_credit_cost,
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
    'estimated_credit_cost', v_usage.estimated_credit_cost,
    'pricing_source', v_usage.pricing_source,
    'credits', jsonb_build_object(
      'before_balance', v_usage.user_balance_before,
      'balance', v_usage.user_balance_after,
      'deducted', v_usage.charge_amount
    ),
    'provider_budget', jsonb_build_object(
      'before_balance', v_usage.provider_balance_before,
      'balance', v_usage.provider_balance_after,
      'deducted', v_usage.charge_amount,
      'unit', 'credits'
    ),
    'settled_at', v_usage.settled_at
  );
end;
$$;

revoke all on table public.comfy_usage_settlements from public, anon, authenticated;
grant select, insert, update on table public.comfy_usage_settlements to service_role;

revoke all on function public.settle_comfy_usage(text, uuid, text, text, text, text, numeric, integer, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.settle_comfy_usage(text, uuid, text, text, text, text, numeric, integer, text, jsonb)
  to service_role;
