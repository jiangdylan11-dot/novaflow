-- A failed or moderation-rejected settlement must not consume quota.
-- The reservation is still closed (status settled, success false, reserved
-- count released). used_count moves only when p_success is true.
-- Callers that release instead of settling are unchanged.

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
  v_used := greatest(coalesce((v_value->>'used_count')::integer, 0), 0) + case when p_success then p_actual_calls else 0 end;
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

revoke all on function public.settle_grok_quota(uuid,text,integer,boolean,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.settle_grok_quota(uuid,text,integer,boolean,jsonb,jsonb) to service_role;

notify pgrst, 'reload schema';
