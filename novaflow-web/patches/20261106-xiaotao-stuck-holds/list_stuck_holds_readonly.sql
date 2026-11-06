-- 只读：列出派发后再也没有结算的小桃在线阶段（预留一直占着，网页显示"在线请求中断"）。
select o.operation_id, o.user_id, o.model, s.phase_id, s.phase_kind, s.status, l.estimated_credits, l.art_dispatched_at, l.status as ledger_status
  from public.xiaotao_operation_v3_stages s
  join public.xiaotao_operation_v3_operations o on o.operation_id=s.operation_id
  join public.credit_ledger l on l.usage_key=s.usage_key
 where s.status='dispatched' and o.status='open' and l.status='reserved'
   and l.art_dispatched_at < now() - interval '10 minutes'
 order by l.art_dispatched_at;
