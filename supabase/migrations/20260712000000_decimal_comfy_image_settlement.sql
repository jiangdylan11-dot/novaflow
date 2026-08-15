-- Preserve exact Comfy image charges as fixed-point credits.
-- The RPC remains service-role only, prompt-keyed, idempotent, and atomic across
-- the user balance and the administrator's manual Comfy balance.

begin;

drop function if exists public.settle_comfy_usage(text, uuid, text, text, text, text, numeric, integer, text, jsonb);

alter table public.credits
  alter column balance type numeric(20, 6) using balance::numeric(20, 6),
  alter column balance set default 0;

alter table public.comfy_usage_settlements
  alter column charge_amount type numeric(20, 6) using charge_amount::numeric(20, 6),
  alter column user_balance_before type numeric(20, 6) using user_balance_before::numeric(20, 6),
  alter column user_balance_after type numeric(20, 6) using user_balance_after::numeric(20, 6);

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

notify pgrst, 'reload schema';

commit;
