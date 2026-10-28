-- GPT Image 2.5 stable-token settlement.
--
-- settle_feature_credits can charge less than the reservation and refunds the
-- difference. A requested amount above the reservation is capped at the hold.
-- p_settled_credits null keeps the previous behavior (settled = estimated).
-- reserve_feature_credits accepts an explicit hold for gpt_image_2_5_token.
-- Image-to-image economy moves from the previous default 22 to 20 only when
-- the stored price is still 22. Re-applying this file is safe.
-- This file is not applied by the application. An operator applies it.

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
    when btrim(p_feature) in ('gpt-image-2.5-token', 'gpt_image_2_5_token') then 'gpt_image_2_5_token'
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
    'lean_research', 14, 'gpt_image_2_5_economy', 20, 'gpt_image_2_official', 4,
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

do $$
declare
  v_value jsonb;
  v_token jsonb;
  v_estimate jsonb;
  v_routes jsonb;
  v_row jsonb;
  v_res text;
  v_qual text;
  v_defaults jsonb := jsonb_build_object(
    '1k', jsonb_build_object('low', 3, 'medium', 6, 'high', 23),
    '2k', jsonb_build_object('low', 6, 'medium', 12, 'high', 40),
    '4k', jsonb_build_object('low', 12, 'medium', 24, 'high', 40)
  );
begin
  select value into v_value from public.system_settings where key = 'feature_credit_config' for update;
  if v_value is null or jsonb_typeof(v_value) <> 'object' then
    return;
  end if;
  if coalesce(v_value #>> '{prices,gpt_image_2_5_economy}', '22') = '22' then
    v_value := jsonb_set(v_value, '{prices,gpt_image_2_5_economy}', '20'::jsonb, true);
  end if;
  if coalesce(v_value->>'credits_per_usd', '') = '' then
    v_value := jsonb_set(v_value, '{credits_per_usd}', '211'::jsonb, true);
  end if;
  v_token := coalesce(v_value->'token_billing', '{}'::jsonb);
  if jsonb_typeof(v_token) <> 'object' then v_token := '{}'::jsonb; end if;
  if not (v_token ? 'markup') then v_token := v_token || jsonb_build_object('markup', 2); end if;
  if not (v_token ? 'round') then v_token := v_token || jsonb_build_object('round', 'ceil'); end if;
  if not (v_token ? 'min_credits_per_image') then v_token := v_token || jsonb_build_object('min_credits_per_image', 1); end if;
  if not (v_token ? 'settle_cap_credits') then v_token := v_token || jsonb_build_object('settle_cap_credits', 40); end if;
  v_estimate := coalesce(v_token->'estimate_credits', '{}'::jsonb);
  if jsonb_typeof(v_estimate) <> 'object' then v_estimate := '{}'::jsonb; end if;
  foreach v_res in array array['1k', '2k', '4k'] loop
    v_row := coalesce(v_estimate->v_res, '{}'::jsonb);
    if jsonb_typeof(v_row) <> 'object' then v_row := '{}'::jsonb; end if;
    foreach v_qual in array array['low', 'medium', 'high'] loop
      if not (v_row ? v_qual) then
        v_row := v_row || jsonb_build_object(v_qual, (v_defaults #>> array[v_res, v_qual])::integer);
      end if;
    end loop;
    v_estimate := jsonb_set(v_estimate, array[v_res], v_row, true);
  end loop;
  v_token := jsonb_set(v_token, '{estimate_credits}', v_estimate, true);
  v_value := jsonb_set(v_value, '{token_billing}', v_token, true);
  v_routes := coalesce(v_value->'gpt_image', '{}'::jsonb);
  if jsonb_typeof(v_routes) <> 'object' then v_routes := '{}'::jsonb; end if;
  if not (v_routes ? 'text_endpoint') then
    v_routes := v_routes || jsonb_build_object('text_endpoint', '/openapi/v2/rhart-image-g-2.5-official-token/sunburst/text-to-image');
  end if;
  if not (v_routes ? 'image_endpoint') then
    v_routes := v_routes || jsonb_build_object('image_endpoint', '/openapi/v2/rhart-image-g-2.5/sunburst/image-to-image');
  end if;
  if not (v_routes ? 'fallback_text_endpoint') then
    v_routes := v_routes || jsonb_build_object('fallback_text_endpoint', '/openapi/v2/rhart-image-g-2-official/text-to-image');
  end if;
  if not (v_routes ? 'fallback_image_endpoint') then
    v_routes := v_routes || jsonb_build_object('fallback_image_endpoint', '/openapi/v2/rhart-image-g-2-official/image-to-image');
  end if;
  if not (v_routes ? 'token_markers') then
    v_routes := v_routes || jsonb_build_object('token_markers', jsonb_build_array('official-token'));
  end if;
  if not (v_routes ? 'text_model') then
    v_routes := v_routes || jsonb_build_object('text_model', 'rhart-image-g-2.5-official-token');
  end if;
  if not (v_routes ? 'image_model') then
    v_routes := v_routes || jsonb_build_object('image_model', 'rhart-image-g-2.5');
  end if;
  if not (v_routes ? 'official_model') then
    v_routes := v_routes || jsonb_build_object('official_model', 'rhart-image-g-2-official');
  end if;
  v_value := jsonb_set(v_value, '{gpt_image}', v_routes, true);
  update public.system_settings
     set value = v_value, updated_at = clock_timestamp()
   where key = 'feature_credit_config';
end;
$$;

drop function if exists public.reserve_feature_credits(uuid, text, text, integer, text, jsonb);

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
  v_token_override boolean := public.canonical_credit_feature(p_feature) = 'gpt_image_2_5_token' and p_estimated_credits is not null;
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

  if v_token_override then
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
    pricing_source, pricing_details, created_at, updated_at
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

drop function if exists public.settle_feature_credits(uuid, text, text, integer, text, jsonb);

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
  v_refund numeric(20, 6);
  v_balance numeric(20, 6);
  v_reserve_capped boolean := false;
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
      'refunded_credits', 0, 'reserve_capped', false
    );
  end if;
  if v_row.status <> 'reserved' then
    raise exception using errcode = '22023', message = 'settle_feature_credits: reservation is not open';
  end if;
  if p_settled_credits is null then
    v_actual := v_row.estimated_credits;
  elsif p_settled_credits > v_row.estimated_credits then
    v_reserve_capped := true;
    v_actual := v_row.estimated_credits;
  else
    v_actual := ceil(p_settled_credits);
  end if;
  v_refund := v_row.estimated_credits - v_actual;
  select balance into v_balance from public.credits where user_id = p_user_id for update;
  if v_refund > 0 then
    v_balance := coalesce(v_balance, 0) + v_refund;
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
             'overrun_credits', case when v_reserve_capped then p_settled_credits - v_row.estimated_credits else 0 end
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
    'rh_cost_usd', v_row.rh_cost_usd, 'pricing_source', v_row.pricing_source
  );
end;
$$;

revoke all on function public.canonical_credit_feature(text) from public, anon, authenticated;
revoke all on function public.feature_credit_quote(text, integer) from public, anon, authenticated;
revoke all on function public.reserve_feature_credits(uuid, text, text, integer, text, jsonb, numeric) from public, anon, authenticated;
revoke all on function public.settle_feature_credits(uuid, text, text, integer, text, jsonb, numeric, numeric, text) from public, anon, authenticated;

grant execute on function public.canonical_credit_feature(text) to service_role;
grant execute on function public.feature_credit_quote(text, integer) to service_role;
grant execute on function public.reserve_feature_credits(uuid, text, text, integer, text, jsonb, numeric) to service_role;
grant execute on function public.settle_feature_credits(uuid, text, text, integer, text, jsonb, numeric, numeric, text) to service_role;

notify pgrst, 'reload schema';
