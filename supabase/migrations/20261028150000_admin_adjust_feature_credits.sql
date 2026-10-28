-- Admin credit adjustments write credits.balance and credit_ledger in one transaction.
--
-- service_role only. Do not apply this file to production until the operator
-- approves migration C. Re-applying the function is safe. It does not read or
-- write a provider key and does not move existing balances by itself.

create or replace function public.admin_adjust_feature_credits(
  p_user_id uuid,
  p_mode text,
  p_amount numeric,
  p_reason text,
  p_note text default '',
  p_admin_label text default null,
  p_usage_key text default null
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_mode text := lower(btrim(coalesce(p_mode, '')));
  v_amount numeric := p_amount;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_note text := btrim(coalesce(p_note, ''));
  v_label text := nullif(btrim(coalesce(p_admin_label, '')), '');
  v_key text := nullif(btrim(coalesce(p_usage_key, '')), '');
  v_before numeric;
  v_after numeric;
  v_delta numeric;
  v_existing public.credit_ledger%rowtype;
  v_details jsonb;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = '请选择用户';
  end if;
  if v_mode not in ('add', 'deduct', 'set') then
    raise exception using errcode = '22023', message = '不支持的积分操作';
  end if;
  if v_amount is null or v_amount <> trunc(v_amount) then
    raise exception using errcode = '22023', message = '积分必须是整数';
  end if;
  if v_mode = 'set' then
    if v_amount < 0 then
      raise exception using errcode = '22023', message = '设置余额不能小于 0';
    end if;
  elsif v_amount <= 0 then
    raise exception using errcode = '22023', message = '充值或扣减积分必须大于 0';
  end if;
  if v_reason = '' or char_length(v_reason) > 200 then
    raise exception using errcode = '22023', message = '请填写不超过 200 字的调整原因';
  end if;
  if char_length(v_note) > 500 then
    raise exception using errcode = '22023', message = '备注不能超过 500 字';
  end if;
  if v_label is not null then
    v_label := left(v_label, 120);
  end if;
  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception using errcode = 'P0002', message = '用户不存在，无法分配积分';
  end if;
  if v_key is null then
    v_key := 'admin_adjust_' || gen_random_uuid()::text;
  end if;
  if char_length(v_key) > 200 or btrim(v_key) <> v_key then
    raise exception using errcode = '22023', message = 'usage_key 无效';
  end if;

  select * into v_existing from public.credit_ledger where usage_key = v_key;
  if found then
    if v_existing.user_id = p_user_id
       and v_existing.feature = 'admin_adjust'
       and coalesce(v_existing.pricing_details->>'mode', '') = v_mode
       and coalesce(v_existing.pricing_details->>'reason', '') = v_reason
       and coalesce(v_existing.pricing_details->>'note', '') = v_note
       and (v_existing.pricing_details->>'amount')::numeric = v_amount
    then
      return jsonb_build_object(
        'status', 'settled',
        'usage_key', v_key,
        'before_balance', v_existing.balance_before,
        'after_balance', v_existing.balance_after,
        'delta', coalesce((v_existing.pricing_details->>'delta')::numeric, 0),
        'idempotent', true
      );
    end if;
    raise exception using errcode = '23505', message = 'usage_key 已存在且内容不一致';
  end if;

  insert into public.credits (user_id, balance)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select balance into v_before
    from public.credits
   where user_id = p_user_id
   for update;
  if v_before is null then
    raise exception using errcode = 'P0002', message = '积分账户不存在';
  end if;

  if v_mode = 'set' then
    v_delta := v_amount - v_before;
  elsif v_mode = 'deduct' then
    v_delta := -v_amount;
  else
    v_delta := v_amount;
  end if;
  v_after := v_before + v_delta;
  if v_after < 0 then
    raise exception using errcode = '23514', message = '扣减后积分不能小于 0';
  end if;

  v_details := jsonb_build_object(
    'mode', v_mode,
    'amount', v_amount,
    'delta', v_delta,
    'reason', v_reason,
    'note', v_note,
    'admin_label', v_label,
    'source', 'admin_gui'
  );

  insert into public.credit_ledger (
    usage_key, user_id, feature, provider_key, status,
    estimated_credits, settled_credits, balance_before, balance_after,
    pricing_source, pricing_details, settled_at
  ) values (
    v_key, p_user_id, 'admin_adjust', 'admin', 'settled',
    abs(v_delta), abs(v_delta), v_before, v_after,
    'admin_adjust', v_details, clock_timestamp()
  );

  update public.credits
     set balance = v_after,
         updated_at = clock_timestamp()
   where user_id = p_user_id;

  return jsonb_build_object(
    'status', 'settled',
    'usage_key', v_key,
    'before_balance', v_before,
    'after_balance', v_after,
    'delta', v_delta,
    'idempotent', false
  );
end;
$$;

revoke all on function public.admin_adjust_feature_credits(uuid, text, numeric, text, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_adjust_feature_credits(uuid, text, numeric, text, text, text, text) to service_role;

comment on function public.admin_adjust_feature_credits(uuid, text, numeric, text, text, text, text) is
  'service_role only. One transaction: lock credits, reject a negative balance, insert credit_ledger feature=admin_adjust status=settled, then update credits.balance.';
