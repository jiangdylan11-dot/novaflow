-- Cheaper RunningHub image lines beside GPT Image 2.5 (release 344, 2026-11-10):
-- Nano Banana 2.1 (13 credits a picture), Grok 图像 (8), GPT Image 2 image-to-image (11).
-- reserve_feature_credits prices a hold through feature_credit_quote, which reads
-- system_settings.feature_credit_config.prices on top of its own built-in defaults.
-- The deployed config predates these lines and the built-in defaults did not know
-- them, so every hold came back "该功能积分单价未配置" and the client showed 积分不足.
--
-- This migration (1) teaches feature_credit_quote the three keys as built-in
-- defaults, so a config that lacks a price falls back to the code default (the
-- same number the client quotes) instead of refusing, and counts them per image;
-- (2) writes the three prices and catalog costs into the stored config where
-- they are missing, so the admin price page shows and can change them.
-- reserve/settle/finalize/status functions are untouched: the decimal-v1
-- readiness pins and the guarded legacy reservation hash stay valid.

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
    'gpt_image_2_edit', 11, 'nano_banana_21', 13, 'grok_image_official', 8,
    'grok_image_g42', 6, 'local', 0
  );
  v_cost_defaults jsonb := jsonb_build_object(
    'xiaotao_vision', 0.0073, 'online_chat_turn', 0.0034, 'prompt_optimize', 0.0075,
    'image_reverse', 0.0073, 'lean_research', 0.0306, 'gpt_image_2_5_economy', 0.05,
    'gpt_image_2_official', 0.009, 'gpt_image_2_edit', 0.027, 'nano_banana_21', 0.03,
    'grok_image_official', 0.02, 'grok_image_g42', 0.01, 'local', 0
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
  v_per_image := v_key in ('gpt_image_2_5_economy', 'gpt_image_2_official', 'gpt_image_2_edit', 'nano_banana_21', 'grok_image_official', 'grok_image_g42', 'gpt_image_2_5_token');
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

revoke all on function public.feature_credit_quote(text, integer) from public, anon, authenticated;
grant execute on function public.feature_credit_quote(text, integer) to service_role;

-- Store the three prices where the config lacks them. Existing numbers, including
-- ones an admin changed, are kept: the new entries sit under the stored ones.
do $$
declare
  v_value jsonb;
  v_prices jsonb;
  v_costs jsonb;
begin
  select value into v_value from public.system_settings where key = 'feature_credit_config' for update;
  if v_value is null or jsonb_typeof(v_value) <> 'object' then
    return;
  end if;
  v_prices := jsonb_build_object('gpt_image_2_edit', 11, 'nano_banana_21', 13, 'grok_image_official', 8)
    || coalesce(case when jsonb_typeof(v_value->'prices') = 'object' then v_value->'prices' end, '{}'::jsonb);
  v_costs := jsonb_build_object('gpt_image_2_edit', 0.027, 'nano_banana_21', 0.03, 'grok_image_official', 0.02)
    || coalesce(case when jsonb_typeof(v_value->'rh_cost_usd') = 'object' then v_value->'rh_cost_usd' end, '{}'::jsonb);
  update public.system_settings
     set value = v_value || jsonb_build_object('prices', v_prices, 'rh_cost_usd', v_costs),
         updated_at = clock_timestamp()
   where key = 'feature_credit_config';
end;
$$;

notify pgrst, 'reload schema';
