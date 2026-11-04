-- A service-role-only snapshot path for Xiaotao token billing.
-- Legacy reserve is guarded and extended for key serialization. Never apply without review.
-- The public quote contains the normalized cap read by get_xiaotao_pricing_cap_v2.
-- During v2 reserve a shared lock on the explicit pricing settings row makes
-- that cap comparison and reservation atomic with respect to its update/delete. A dedicated
-- ledger column, not request metadata, retains it for v2 settlement.

-- BEGIN EARLY LEGACY GUARD
-- Validate before any schema changes; the later guard repeats before replacement.
do $guard$
declare v_body_hash text; v_security_definer boolean; v_config text[];
        v_default_count integer; v_return regtype; v_language name;
        v_owner oid; v_acl aclitem[]; v_oid oid;
begin
  select md5(replace(p.prosrc, E'\r\n', E'\n')), p.prosecdef, p.proconfig,
         p.pronargdefaults, p.prorettype::regtype, l.lanname, p.proowner, p.proacl, p.oid
    into v_body_hash, v_security_definer, v_config, v_default_count, v_return, v_language,
         v_owner, v_acl, v_oid
    from pg_proc p join pg_language l on l.oid=p.prolang
   where p.oid=to_regprocedure('public.reserve_feature_credits(uuid,text,text,integer,text,jsonb,numeric)');
  if not found or v_body_hash not in ('7059b627309cabb4743b6af73697dc01','ace9f5d1c4350e51a04f5cd9f1b95841')
     or v_security_definer or v_config is distinct from ARRAY['search_path=pg_catalog, public']::text[]
     or v_default_count <> 3 or v_return <> 'jsonb'::regtype or v_language <> 'plpgsql'
     or not pg_has_role(current_user, v_owner, 'USAGE')
     or not has_function_privilege('service_role', v_oid, 'EXECUTE')
     or has_function_privilege('anon', v_oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or exists (select 1 from aclexplode(coalesce(v_acl, acldefault('f', v_owner))) acl
                 where acl.privilege_type='EXECUTE'
                   and acl.grantee not in (v_owner, 'service_role'::regrole::oid)) then
    raise exception using errcode='P0001', message='legacy credit reservation definition changed; manual merge required';
  end if;
end;
$guard$;
-- END EARLY LEGACY GUARD

alter table public.credit_ledger add column if not exists xiaotao_policy_cap numeric;
alter table public.credit_ledger add column if not exists xiaotao_policy_version text;
alter table public.credit_ledger add column if not exists xiaotao_policy_estimate numeric;
alter table public.credit_ledger add column if not exists xiaotao_policy_units integer;
alter table public.credit_ledger add column if not exists xiaotao_settlement_terms jsonb;

create or replace function public.get_xiaotao_pricing_cap_v2()
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  v_config jsonb;
  v_cap numeric := 80;
begin
  select value into v_config from public.system_settings where key = 'feature_credit_config';
  if not found then
    raise exception using errcode = 'P0001', message = 'xiaotao pricing config missing';
  end if;
  if jsonb_typeof(v_config) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'xiaotao pricing config must be an object';
  end if;
  if (v_config #>> '{xiaotao_online,message_cap_credits}') ~ '^[0-9]+(\.[0-9]+)?$' then
    v_cap := (v_config #>> '{xiaotao_online,message_cap_credits}')::numeric;
    if v_cap < 1 or v_cap > 1000000 then v_cap := 80; end if;
  end if;
  -- The application normalizes the cap to an integer. Reject fractional caps
  -- rather than reporting a different cap from the legacy DB reservation.
  if v_cap <> trunc(v_cap) then
    raise exception using errcode = '22023', message = 'xiaotao pricing cap must be an integer';
  end if;
  if to_regprocedure('public.reserve_xiaotao_credits_v2(uuid,text,text,integer,text,jsonb,numeric,numeric,jsonb,text)') is null
     or to_regprocedure('public.settle_xiaotao_credits_v2(uuid,text,text,integer,text,jsonb,numeric,numeric,text)') is null then
    raise exception using errcode = 'P0001', message = 'xiaotao pricing v2 is not installed';
  end if;
  -- Service role only: callers must not expose raw config to the browser.
  return jsonb_build_object('protocol', 'xiaotao-pricing-v2', 'config', v_config, 'message_cap_credits', v_cap);
end;
$$;

-- The legacy mirror close intentionally ignores released reservations. A v2
-- provider result may arrive after the stale-hold sweep released its mirror;
-- reconcile that exact expired mirror once without subtracting the reservation
-- count a second time. Keep the mirror optional just like the legacy helpers.
create or replace function public.reconcile_xiaotao_stale_mirror_v2(
  p_user_id uuid, p_usage_key text, p_actual_units integer
)
returns void language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  v_key text := 'provider_quota_grok_' || p_user_id::text;
  v_value jsonb;
  v_row record;
  v_actual integer;
  v_allocated integer;
  v_used integer;
  v_reserved integer;
  v_now timestamptz := clock_timestamp();
begin
  if to_regclass('public.grok_quota_reservations') is null then return; end if;
  -- Match the existing mirror helper's settings -> reservation lock order.
  select value into v_value from public.system_settings where key = v_key for update;
  select * into v_row from public.grok_quota_reservations where usage_key = p_usage_key for update;
  if not found then return; end if;
  if v_value is null or v_row.user_id is distinct from p_user_id
     or v_row.status is distinct from 'released'
     or v_row.metadata->>'credit_mirror' is distinct from 'true'
     or v_row.metadata->>'release_reason' is distinct from 'expired' then
    raise exception using errcode = 'P0001', message = 'xiaotao v2 expired mirror mismatch';
  end if;
  v_actual := least(greatest(coalesce(p_actual_units, 0), 0), v_row.reserved_calls);
  v_allocated := greatest(coalesce((v_value->>'allocated_count')::integer, 0), 0);
  v_used := greatest(coalesce((v_value->>'used_count')::integer, 0), 0) + v_actual;
  v_reserved := greatest(coalesce((v_value->>'reserved_count')::integer, 0), 0);
  update public.grok_quota_reservations
     set status = 'settled', actual_calls = v_actual, success = true,
         metadata = metadata || jsonb_build_object('stale_settled', true),
         updated_at = v_now, settled_at = v_now
   where usage_key = p_usage_key;
  update public.system_settings set value = v_value || jsonb_build_object(
    'allocated_count', v_allocated, 'used_count', v_used, 'reserved_count', v_reserved,
    'remaining_count', greatest(v_allocated - v_used - v_reserved, 0),
    'source', 'credit_mirror', 'updated_at', v_now
  ), updated_at = v_now where key = v_key;
end;
$$;

-- BEGIN GUARDED LEGACY RESERVATION
-- Preserve the deployed function identity and privileges. Refuse to replace
-- any unrecognised/parallel version rather than overwriting its implementation.
-- The SQL body below is the 20261028180000 implementation plus the key lock
-- and the cross-protocol snapshot check; both expected hashes are pinned.
do $guard$
declare v_body_hash text; v_security_definer boolean; v_config text[];
        v_default_count integer; v_return regtype; v_language name;
        v_owner oid; v_acl aclitem[]; v_oid oid;
begin
  select md5(replace(p.prosrc, E'\r\n', E'\n')), p.prosecdef, p.proconfig,
         p.pronargdefaults, p.prorettype::regtype, l.lanname, p.proowner, p.proacl, p.oid
    into v_body_hash, v_security_definer, v_config, v_default_count, v_return, v_language,
         v_owner, v_acl, v_oid
    from pg_proc p join pg_language l on l.oid=p.prolang
   where p.oid=to_regprocedure('public.reserve_feature_credits(uuid,text,text,integer,text,jsonb,numeric)');
  if not found or v_body_hash not in ('7059b627309cabb4743b6af73697dc01','ace9f5d1c4350e51a04f5cd9f1b95841')
     or v_security_definer or v_config is distinct from ARRAY['search_path=pg_catalog, public']::text[]
     or v_default_count <> 3 or v_return <> 'jsonb'::regtype or v_language <> 'plpgsql'
     or not pg_has_role(current_user, v_owner, 'USAGE')
     or not has_function_privilege('service_role', v_oid, 'EXECUTE')
     or has_function_privilege('anon', v_oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or exists (select 1 from aclexplode(coalesce(v_acl, acldefault('f', v_owner))) acl
                 where acl.privilege_type='EXECUTE'
                   and acl.grantee not in (v_owner, 'service_role'::regrole::oid)) then
    raise exception using errcode='P0001', message='legacy credit reservation definition changed; manual merge required';
  end if;
end;
$guard$;

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
  -- Coordinate legacy and v2 calls without changing other reservation rules.
  perform pg_advisory_xact_lock(hashtextextended('xiaotao-v2:' || p_usage_key, 0));

  select value->>'locked' into v_locked from public.system_settings where key = 'quota_migration_lock';
  if v_locked = 'true' then
    raise exception using errcode = 'P0001', message = '积分迁移维护中，请稍后再试';
  end if;

  -- A closed page or a cancelled request leaves the hold. Return it before
  -- taking a new one. The sweep is bounded and only touches expired 小桃 rows.
  perform public.release_stale_feature_credits(200);

  select * into v_row from public.credit_ledger where usage_key = p_usage_key;
  if found then
    -- A v2 hold has a server-verified pricing snapshot. An old client cannot
    -- silently reuse it without presenting the same complete terms.
    if v_row.xiaotao_policy_version is not null and (
      v_row.user_id is distinct from p_user_id
      or v_row.feature is distinct from v_feature
      or v_row.model is distinct from p_model
      or v_row.xiaotao_policy_version is distinct from (p_metadata->>'pricing_version')
      or v_row.xiaotao_policy_estimate is distinct from p_estimated_credits
      or v_row.xiaotao_policy_units is distinct from p_units
      or (v_row.pricing_details->>'call_units') is distinct from p_units::text
    ) then
      raise exception using errcode = '22023', message = 'xiaotao reservation payload mismatch; verify existing hold';
    end if;
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
-- END GUARDED LEGACY RESERVATION

create or replace function public.reserve_xiaotao_credits_v2(
  p_user_id uuid, p_usage_key text, p_feature text, p_units integer,
  p_model text, p_metadata jsonb, p_estimated_credits numeric, p_expected_cap numeric,
  p_expected_config jsonb, p_policy_version text
)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  v_cap numeric;
  v_result jsonb;
  v_row public.credit_ledger%rowtype;
  v_feature text := public.canonical_credit_feature(p_feature);
  v_config jsonb;
begin
  if p_usage_key is null or btrim(p_usage_key) <> p_usage_key or char_length(p_usage_key) not between 1 and 200
     or v_feature is null or v_feature not in ('xiaotao_vision', 'online_chat_turn') or p_model is null
     or btrim(p_model) <> p_model or char_length(p_model) not between 1 and 200
     or p_expected_cap is null or p_estimated_credits is null
     or jsonb_typeof(p_expected_config) is distinct from 'object'
     or p_policy_version is null or p_policy_version !~ '^sha256:[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'xiaotao v2 invalid reservation';
  end if;
  -- Missing ledger rows cannot be row-locked. Serialize v2 replays of the same
  -- key before checking for an existing row so retries return idempotently.
  perform pg_advisory_xact_lock(hashtextextended('xiaotao-v2:' || p_usage_key, 0));
  -- A previous attempt may have committed even if its response was lost.
  -- Check this before validating today's settings: an existing hold is not a
  -- new, uncharged request. Do not attach v2 terms to a legacy reservation.
  select * into v_row from public.credit_ledger where usage_key = p_usage_key for update;
  if found then
    if v_row.user_id is distinct from p_user_id or v_row.feature is distinct from v_feature
       or v_row.model is distinct from p_model
       or v_row.xiaotao_policy_version is distinct from p_policy_version
       or v_row.xiaotao_policy_cap is distinct from p_expected_cap
       or v_row.xiaotao_policy_estimate is distinct from p_estimated_credits
       or v_row.xiaotao_policy_units is distinct from p_units
       or v_row.estimated_credits is distinct from least(ceil(p_estimated_credits), p_expected_cap)
       or (v_row.pricing_details->>'call_units') is distinct from p_units::text then
      raise exception using errcode = '22023', message = 'xiaotao v2 reservation payload mismatch';
    end if;
    return jsonb_build_object('status', 'duplicate', 'idempotent', true);
  end if;
  -- Require an existing explicit row. Its row-level SHARE lock prevents an
  -- update/delete between validation and reservation without blocking the
  -- legacy quota mirror's writes to separate system_settings keys. Missing
  -- config fails closed rather than relying on an unlocked absent-row default.
  perform 1 from public.system_settings where key = 'feature_credit_config' for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'xiaotao pricing config missing';
  end if;
  v_config := public.get_xiaotao_pricing_cap_v2();
  v_cap := (v_config->>'message_cap_credits')::numeric;
  if v_config->'config' is distinct from p_expected_config then
    raise exception using errcode = 'P0001', message = 'xiaotao pricing changed; obtain a new quote';
  end if;
  if p_expected_cap <> v_cap then
    raise exception using errcode = 'P0001', message = 'xiaotao pricing changed; obtain a new quote';
  end if;
  -- The version-checked legacy implementation below takes the same key lock.
  -- Never turn an unrelated unique violation into an apparent duplicate.
  v_result := public.reserve_feature_credits(p_user_id, p_usage_key, p_feature, p_units,
                                             p_model, p_metadata, p_estimated_credits);
  if coalesce((v_result->>'idempotent')::boolean,false) then
    -- A row appearing after the locked check was written by an uncoordinated
    -- path and its v2 terms cannot be verified. Fail closed.
    raise exception using errcode = '22023', message = 'xiaotao v2 reservation payload mismatch';
  end if;
  if v_result->>'status' <> 'reserved' then
    return v_result || jsonb_build_object('message_cap_credits', v_cap, 'policy_version', p_policy_version);
  end if;
  update public.credit_ledger set xiaotao_policy_cap = v_cap, xiaotao_policy_version = p_policy_version,
    xiaotao_policy_estimate = p_estimated_credits, xiaotao_policy_units = p_units
    where usage_key = p_usage_key and user_id = p_user_id and status = 'reserved';
  if not found then raise exception using errcode = 'P0001', message = 'xiaotao v2 snapshot write failed'; end if;
  return v_result || jsonb_build_object('message_cap_credits', v_cap, 'policy_version', p_policy_version);
end;
$$;

create or replace function public.settle_xiaotao_credits_v2(
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
  v_stale boolean := false;
  v_terms jsonb;
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
  if v_row.feature not in ('xiaotao_vision', 'online_chat_turn')
     or v_row.xiaotao_policy_cap is null or v_row.xiaotao_policy_version is null
     or p_feature is null or public.canonical_credit_feature(p_feature) <> v_row.feature
     or p_model is null or p_model is distinct from v_row.model then
    raise exception using errcode = '22023', message = 'xiaotao v2 reservation payload mismatch';
  end if;
  -- Preserve the original settlement inputs, not the capped or partially
  -- collected amount. A replay may only acknowledge the exact same terms.
  -- JSONB comparison is insensitive to key order but retains null vs values.
  v_terms := jsonb_build_object(
    'feature', public.canonical_credit_feature(p_feature),
    'actual_units', p_actual_units, 'model', p_model,
    'metadata', coalesce(p_metadata, '{}'::jsonb),
    'settled_credits', p_settled_credits, 'rh_cost_usd', p_rh_cost_usd,
    'pricing_source', p_pricing_source
  );
  if v_row.status = 'settled' then
    if v_row.xiaotao_settlement_terms is distinct from v_terms then
      raise exception using errcode = '22023', message = 'xiaotao v2 settlement payload mismatch';
    end if;
    return jsonb_build_object(
      'status', 'settled', 'idempotent', true, 'usage_key', p_usage_key,
      'feature', v_row.feature, 'estimated_credits', v_row.estimated_credits,
      'settled_credits', v_row.settled_credits, 'balance_after', v_row.balance_after,
      'refunded_credits', 0, 'reserve_capped', false,
      'topup_credits', 0, 'uncollected_credits', 0, 'balance_short', false,
      'direct_charge', false
    );
  end if;

  v_xiaotao := v_row.feature in ('xiaotao_vision', 'online_chat_turn');
  -- The 20-minute sweep already returned this hold. The provider call still
  -- finished, so charge from the live balance instead of rejecting the settle.
  v_stale := v_row.status = 'released' and v_xiaotao and (
    v_row.error_code = 'expired' or coalesce(v_row.pricing_details->>'release_reason', '') = 'expired'
  );
  if v_row.status <> 'reserved' and not v_stale then
    raise exception using errcode = '22023', message = 'settle_feature_credits: reservation is not open';
  end if;

  -- This cap was read and stored under a settings lock during v2 reserve.
  -- Never take the current setting or caller-supplied metadata at settlement.
  if not v_xiaotao or v_row.xiaotao_policy_cap is null then
    raise exception using errcode = '22023', message = 'xiaotao v2 reservation snapshot missing';
  end if;
  if p_feature is null or public.canonical_credit_feature(p_feature) <> v_row.feature
     or p_model is null or p_model is distinct from v_row.model then
    raise exception using errcode = '22023', message = 'xiaotao v2 reservation payload mismatch';
  end if;
  v_cap := v_row.xiaotao_policy_cap;

  select balance into v_balance from public.credits where user_id = p_user_id for update;
  v_balance := coalesce(v_balance, 0);
  if v_stale then
    v_requested := least(ceil(coalesce(p_settled_credits, v_row.estimated_credits)), v_cap);
    v_shortfall := v_requested;
    v_topup := least(v_shortfall, greatest(v_balance, 0));
    v_uncollected := v_shortfall - v_topup;
    v_actual := v_topup;
    v_balance := greatest(v_balance, 0) - v_topup;
  elsif p_settled_credits is null then
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
         xiaotao_settlement_terms = v_terms,
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
         error_code = case when v_stale then null else error_code end,
         error_message = case when v_stale then null else error_message end,
         pricing_details = pricing_details || coalesce(p_metadata, '{}'::jsonb) || case
           when p_settled_credits is null and not v_stale then '{}'::jsonb
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
             'direct_charge', v_stale,
             'stale_hold', v_stale,
             'message_cap_credits', case when v_xiaotao then v_cap else null end
           )
         end,
         updated_at = v_now,
         settled_at = v_now
   where usage_key = p_usage_key
   returning * into v_row;
  if v_stale then
    perform public.reconcile_xiaotao_stale_mirror_v2(p_user_id, p_usage_key, coalesce(p_actual_units, 1));
  else
    perform public.feature_credit_mirror_close(p_user_id, p_usage_key, coalesce(p_actual_units, 1), true, null);
  end if;
  return jsonb_build_object(
    'status', 'settled', 'idempotent', false, 'usage_key', p_usage_key,
    'feature', v_row.feature, 'estimated_credits', v_row.estimated_credits,
    'settled_credits', v_row.settled_credits, 'balance_after', v_row.balance_after,
    'refunded_credits', v_refund, 'reserve_capped', v_reserve_capped,
    'topup_credits', v_topup, 'shortfall_credits', v_shortfall,
    'uncollected_credits', v_uncollected, 'balance_short', v_uncollected > 0,
    'direct_charge', v_stale,
    'rh_cost_usd', v_row.rh_cost_usd, 'pricing_source', v_row.pricing_source
  );
end;
$$;

revoke all on function public.get_xiaotao_pricing_cap_v2() from public, anon, authenticated;
revoke all on function public.reconcile_xiaotao_stale_mirror_v2(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.reserve_xiaotao_credits_v2(uuid, text, text, integer, text, jsonb, numeric, numeric, jsonb, text) from public, anon, authenticated;
revoke all on function public.settle_xiaotao_credits_v2(uuid, text, text, integer, text, jsonb, numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.get_xiaotao_pricing_cap_v2() to service_role;
grant execute on function public.reconcile_xiaotao_stale_mirror_v2(uuid, text, integer) to service_role;
grant execute on function public.reserve_xiaotao_credits_v2(uuid, text, text, integer, text, jsonb, numeric, numeric, jsonb, text) to service_role;
grant execute on function public.settle_xiaotao_credits_v2(uuid, text, text, integer, text, jsonb, numeric, numeric, text) to service_role;
notify pgrst, 'reload schema';
