-- 小桃：派发后超过 10 分钟仍无结果的在线阶段，当作模型失败处理：释放预留，整个操作按 0 结算（退款）。
-- 先跑 list_stuck_holds_readonly.sql 看清要退哪些。要求已执行 20261106-xiaotao-cancel-refund 补丁（有 finalize_xiaotao_operation_v3_refund）。
-- 可重复执行；正在进行中（10 分钟内）的阶段不动。
begin;
do $refund$
declare row record; r jsonb;
begin
  for row in
    select o.operation_id, o.user_id, o.session_id, o.model, o.policy_version, o.intent_hash, s.phase_id, s.request_hash, l.art_dispatched_at
      from public.xiaotao_operation_v3_stages s
      join public.xiaotao_operation_v3_operations o on o.operation_id=s.operation_id
      join public.credit_ledger l on l.usage_key=s.usage_key
     where s.status='dispatched' and o.status='open' and l.status='reserved'
       and l.art_dispatched_at < now() - interval '10 minutes'
     order by l.art_dispatched_at
  loop
    r:=public.reject_xiaotao_operation_stage_v3(row.operation_id,row.user_id,row.session_id,row.model,row.policy_version,row.intent_hash,
          row.phase_id,row.request_hash,jsonb_build_object('reason','provider-no-result','dispatched_at',row.art_dispatched_at,'patch','20261106-xiaotao-stuck-holds'));
    if r->>'status'<>'rejected' then raise exception 'reject failed for %/%: %',row.operation_id,row.phase_id,r; end if;
    -- 同一操作里还有已记录用量的阶段也一并退（这轮用户什么都没拿到）；还有别的派发中阶段的先跳过。
    if exists(select 1 from public.xiaotao_operation_v3_stages where operation_id=row.operation_id and status='dispatched') then continue; end if;
    r:=public.finalize_xiaotao_operation_v3_refund(row.operation_id,row.user_id,row.session_id,row.model,row.policy_version,row.intent_hash);
    if r->>'status'<>'settled' then raise exception 'refund failed for %: %',row.operation_id,r; end if;
    raise notice 'refunded % (%): charged %',row.operation_id,row.model,r->>'charged';
  end loop;
end
$refund$;
commit;
