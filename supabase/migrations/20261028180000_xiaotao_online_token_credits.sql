-- 小桃 online token holds.
--
-- Depends on:
--   20261028140000_feature_credits.sql
--     credit_ledger, credits, feature_credit_quote, feature_credit_pool_blocked,
--     feature_credit_mirror_reserve, feature_credit_mirror_close
--   20261028170000_token_settle_credits.sql
--     reserve_feature_credits(uuid, text, text, integer, text, jsonb, numeric)
--     settle_feature_credits(uuid, text, text, integer, text, jsonb, numeric, numeric, text)
-- This file replaces those two functions. It does not change GPT Image settlement:
-- gpt_image_2_5_token still refuses to charge more than its hold.
--
-- xiaotao_vision and online_chat_turn (xiaotao-vision / xiaotao-text) honor
-- p_estimated_credits, clamped to xiaotao_online.message_cap_credits (default 80).
-- Settlement is 多退少补: refund the surplus, and charge the actual amount above
-- the hold up to that cap. A short balance charges only what is left and records
-- the uncollected remainder. The balance never goes negative.
-- A 小桃 hold expires after xiaotao_online.hold_ttl_minutes (default 20).
-- release_stale_feature_credits returns those holds. reserve_feature_credits
-- runs that sweep first, so a cancel or a closed page does not keep the hold.
-- Re-applying this file is safe. The application does not apply it.

alter table public.credit_ledger add column if not exists expires_at timestamptz;

create index if not exists credit_ledger_stale_hold_idx
  on public.credit_ledger (expires_at)
  where status = 'reserved' and expires_at is not null;

create or replace function public.release_stale_feature_credits(
  p_limit integer default 200
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
  v_count integer := 0;
  v_credits numeric(20, 6) := 0;
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
begin
  for v_row in
    select * from public.credit_ledger
     where status = 'reserved'
       and expires_at is not null
       and expires_at <= v_now
       and feature in ('xiaotao_vision', 'online_chat_turn')
     order by expires_at
     limit v_limit
     for update skip locked
  loop
    select balance into v_balance from public.credits where user_id = v_row.user_id for update;
    v_balance := coalesce(v_balance, 0) + v_row.estimated_credits;
    update public.credits set balance = v_balance, updated_at = v_now where user_id = v_row.user_id;
    update public.credit_ledger
       set status = 'released',
           settled_credits = 0,
           balance_after = v_balance,
           error_code = 'expired',
           error_message = 'stale hold released',
           pricing_details = pricing_details || jsonb_build_object(
             'release_reason', 'expired',
             'expired_at', v_row.expires_at
           ),
           updated_at = v_now,
           settled_at = v_now
     where usage_key = v_row.usage_key;
    perform public.feature_credit_mirror_close(v_row.user_id, v_row.usage_key, 0, false, 'expired');
    v_count := v_count + 1;
    v_credits := v_credits + v_row.estimated_credits;
  end loop;
  return jsonb_build_object('status', 'released', 'count', v_count, 'released_credits', v_credits);
end;
$$;

create or replace function public.reserve_feature_credits(
  p_user_id uuid,
  p_usage_key text,
  p_feature text,
  p_units integer,
  p_model text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_estimated_credits numeric default null
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
  v_config jsonb;
  v_feature text := public.canonical_credit_feature(p_feature);
  v_xiaotao boolean := v_feature in ('xiaotao_vision', 'online_chat_turn');
  v_token_override boolean := (v_feature = 'gpt_image_2_5_token' or v_xiaotao) and p_estimated_credits is not null;
  v_cap numeric := 80;
  v_hold numeric;
  v_ttl_minutes integer := 20;
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
  if v_token_override and (p_estimated_credits <= 0 or p_estimated_credits > 1000000) then
    raise exception using errcode = '22023', message = 'reserve_feature_credits: invalid estimated credits';
  end if;
  select value->>'locked' into v_locked from public.system_settings where key = 'quota_migration_lock';
  if v_locked = 'true' then
    raise exception using errcode = 'P0001', message = '积分迁移维护中，请稍后再试';
  end if;

  -- A closed page or a cancelled request leaves the hold. Return it before
  -- taking a new one. The sweep is bounded and only touches expired 小桃 rows.
  perform public.release_stale_feature_credits(200);

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

  v_config := coalesce((select value from public.system_settings where key = 'feature_credit_config'), '{}'::jsonb);
  if (v_config #>> '{xiaotao_online,message_cap_credits}') ~ '^[0-9]+(\.[0-9]+)?$' then
    v_cap := (v_config #>> '{xiaotao_online,message_cap_credits}')::numeric;
    if v_cap < 1 or v_cap > 1000000 then v_cap := 80; end if;
  end if;
  if (v_config #>> '{xiaotao_online,hold_ttl_minutes}') ~ '^[0-9]+$' then
    v_ttl_minutes := (v_config #>> '{xiaotao_online,hold_ttl_minutes}')::integer;
    if v_ttl_minutes < 1 or v_ttl_minutes > 1440 then v_ttl_minutes := 20; end if;
  end if;

  if v_feature = 'gpt_image_2_5_token' and p_estimated_credits is not null then
    v_quote := jsonb_build_object(
      'feature', 'gpt_image_2_5_token',
      'units', least(greatest(coalesce(p_units, 1), 1), 100),
      'unit_price', ceil(p_estimated_credits),
      'credits', ceil(p_estimated_credits),
      'local', false,
      'unpriced', false,
      'per_image', true,
      'billing_mode', 'token'
    );
  elsif v_xiaotao and p_estimated_credits is not null then
    v_hold := least(ceil(p_estimated_credits), v_cap);
    v_quote := jsonb_build_object(
      'feature', v_feature,
      'units', 1,
      'unit_price', v_hold,
      'credits', v_hold,
      'local', false,
      'unpriced', false,
      'per_image', false,
      'billing_mode', 'token'
    );
  else
    v_quote := public.feature_credit_quote(p_feature, p_units);
  end if;
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
    pricing_source, pricing_details, created_at, updated_at, expires_at
  ) values (
    p_usage_key, p_user_id, v_quote->>'feature', 'runninghub', nullif(left(coalesce(p_model, ''), 200), ''),
    'reserved', v_credits, v_before, v_after,
    case when v_token_override then null else (v_quote->>'rh_cost_usd')::numeric end,
    'USD',
    case when v_token_override then 'token_estimate' else 'admin_unit_price' end,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'call_units', p_units, 'billable_units', (v_quote->>'units')::integer,
      'unit_price', (v_quote->>'unit_price')::numeric,
      'billing_mode', case when v_token_override then 'token' else 'fixed' end,
      'rh_cost_source', 'estimate'
    ),
    v_now, v_now,
    case
      when v_quote->>'feature' in ('xiaotao_vision', 'online_chat_turn')
        then v_now + make_interval(mins => v_ttl_minutes)
      else null
    end
  ) returning * into v_row;

  perform public.feature_credit_mirror_reserve(p_user_id, p_usage_key, v_row.feature, p_units, coalesce(p_metadata, '{}'::jsonb));

  return jsonb_build_object(
    'status', 'reserved', 'idempotent', false, 'usage_key', p_usage_key,
    'feature', v_row.feature, 'units', p_units, 'estimated_credits', v_credits,
    'balance_before', v_before, 'balance_after', v_after, 'rh_cost_usd', v_row.rh_cost_usd,
    'expires_at', v_row.expires_at
  );
end;
$$;

create or replace function public.settle_feature_credits(
  p_user_id uuid,
  p_usage_key text,
  p_feature text default null,
  p_actual_units integer default null,
  p_model text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_settled_credits numeric default null,
  p_rh_cost_usd numeric default null,
  p_pricing_source text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_row public.credit_ledger%rowtype;
  v_actual numeric(20, 6);
  v_refund numeric(20, 6) := 0;
  v_balance numeric(20, 6);
  v_reserve_capped boolean := false;
  v_xiaotao boolean := false;
  v_config jsonb;
  v_cap numeric := 80;
  v_requested numeric(20, 6);
  v_shortfall numeric(20, 6) := 0;
  v_topup numeric(20, 6) := 0;
  v_uncollected numeric(20, 6) := 0;
begin
  if p_user_id is null or p_usage_key is null then
    raise exception using errcode = '22023', message = 'settle_feature_credits: identity is required';
  end if;
  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'settle_feature_credits: metadata must be an object';
  end if;
  if p_settled_credits is not null and p_settled_credits < 0 then
    raise exception using errcode = '22023', message = 'settle_feature_credits: invalid settled credits';
  end if;
  select * into v_row from public.credit_ledger where usage_key = p_usage_key for update;
  if not found or v_row.user_id <> p_user_id then
    raise exception using errcode = '22023', message = 'settle_feature_credits: reservation not found';
  end if;
  if v_row.status = 'settled' then
    return jsonb_build_object(
      'status', 'settled', 'idempotent', true, 'usage_key', p_usage_key,
      'feature', v_row.feature, 'estimated_credits', v_row.estimated_credits,
      'settled_credits', v_row.settled_credits, 'balance_after', v_row.balance_after,
      'refunded_credits', 0, 'reserve_capped', false,
      'topup_credits', 0, 'uncollected_credits', 0, 'balance_short', false
    );
  end if;
  if v_row.status <> 'reserved' then
    raise exception using errcode = '22023', message = 'settle_feature_credits: reservation is not open';
  end if;

  v_xiaotao := v_row.feature in ('xiaotao_vision', 'online_chat_turn');
  v_config := coalesce((select value from public.system_settings where key = 'feature_credit_config'), '{}'::jsonb);
  if (v_config #>> '{xiaotao_online,message_cap_credits}') ~ '^[0-9]+(\.[0-9]+)?$' then
    v_cap := (v_config #>> '{xiaotao_online,message_cap_credits}')::numeric;
    if v_cap < 1 or v_cap > 1000000 then v_cap := 80; end if;
  end if;

  select balance into v_balance from public.credits where user_id = p_user_id for update;
  v_balance := coalesce(v_balance, 0);
  if p_settled_credits is null then
    v_actual := v_row.estimated_credits;
  elsif v_xiaotao then
    v_requested := least(ceil(p_settled_credits), v_cap);
    if v_requested < v_row.estimated_credits then
      v_actual := v_requested;
      v_refund := v_row.estimated_credits - v_actual;
      v_balance := v_balance + v_refund;
    elsif v_requested > v_row.estimated_credits then
      v_shortfall := v_requested - v_row.estimated_credits;
      v_topup := least(v_shortfall, greatest(v_balance, 0));
      v_uncollected := v_shortfall - v_topup;
      v_actual := v_row.estimated_credits + v_topup;
      v_balance := greatest(v_balance, 0) - v_topup;
    else
      v_actual := v_requested;
    end if;
  elsif p_settled_credits > v_row.estimated_credits then
    v_reserve_capped := true;
    v_actual := v_row.estimated_credits;
  else
    v_actual := ceil(p_settled_credits);
    v_refund := v_row.estimated_credits - v_actual;
    v_balance := v_balance + v_refund;
  end if;
  if v_refund > 0 or v_topup > 0 then
    update public.credits set balance = v_balance, updated_at = v_now where user_id = p_user_id;
  end if;
  update public.credit_ledger
     set status = 'settled',
         settled_credits = v_actual,
         balance_after = v_balance,
         model = coalesce(nullif(left(coalesce(p_model, ''), 200), ''), model),
         rh_cost_usd = case
           when p_rh_cost_usd is not null and p_rh_cost_usd >= 0 then p_rh_cost_usd
           else rh_cost_usd
         end,
         pricing_source = case
           when p_pricing_source ~ '^[a-z0-9_]{1,40}$' then p_pricing_source
           else pricing_source
         end,
         pricing_details = pricing_details || coalesce(p_metadata, '{}'::jsonb) || case
           when p_settled_credits is null then '{}'::jsonb
           else jsonb_build_object(
             'refunded_credits', v_refund,
             'settled_credits', v_actual,
             'estimated_credits', v_row.estimated_credits,
             'reserve_capped', v_reserve_capped,
             'overrun_credits', case when v_reserve_capped then p_settled_credits - v_row.estimated_credits else 0 end,
             'topup_credits', v_topup,
             'shortfall_credits', v_shortfall,
             'uncollected_credits', v_uncollected,
             'balance_short', v_uncollected > 0,
             'message_cap_credits', case when v_xiaotao then v_cap else null end
           )
         end,
         updated_at = v_now,
         settled_at = v_now
   where usage_key = p_usage_key
   returning * into v_row;
  perform public.feature_credit_mirror_close(p_user_id, p_usage_key, coalesce(p_actual_units, 1), true, null);
  return jsonb_build_object(
    'status', 'settled', 'idempotent', false, 'usage_key', p_usage_key,
    'feature', v_row.feature, 'estimated_credits', v_row.estimated_credits,
    'settled_credits', v_row.settled_credits, 'balance_after', v_row.balance_after,
    'refunded_credits', v_refund, 'reserve_capped', v_reserve_capped,
    'topup_credits', v_topup, 'shortfall_credits', v_shortfall,
    'uncollected_credits', v_uncollected, 'balance_short', v_uncollected > 0,
    'rh_cost_usd', v_row.rh_cost_usd, 'pricing_source', v_row.pricing_source
  );
end;
$$;

revoke all on function public.release_stale_feature_credits(integer) from public, anon, authenticated;
revoke all on function public.reserve_feature_credits(uuid, text, text, integer, text, jsonb, numeric) from public, anon, authenticated;
revoke all on function public.settle_feature_credits(uuid, text, text, integer, text, jsonb, numeric, numeric, text) from public, anon, authenticated;

grant execute on function public.release_stale_feature_credits(integer) to service_role;
grant execute on function public.reserve_feature_credits(uuid, text, text, integer, text, jsonb, numeric) to service_role;
grant execute on function public.settle_feature_credits(uuid, text, text, integer, text, jsonb, numeric, numeric, text) to service_role;

notify pgrst, 'reload schema';
