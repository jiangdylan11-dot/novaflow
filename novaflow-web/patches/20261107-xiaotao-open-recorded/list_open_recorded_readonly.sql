-- 只读：列出已记用量却一直没关闭的小桃操作（预留一直占着）。6a469892 应在其中。
select o.operation_id, o.user_id, o.model, s.phase_id, s.phase_kind, s.status as stage_status, l.status as ledger_status,
       l.estimated_credits, s.raw_credits, l.created_at, l.updated_at,
       round(extract(epoch from (now()-greatest(l.created_at,coalesce(l.updated_at,l.created_at))))/60) as idle_minutes
  from public.xiaotao_operation_v3_operations o
  join public.xiaotao_operation_v3_stages s on s.operation_id=o.operation_id
  join public.credit_ledger l on l.usage_key=s.usage_key
 where o.status='open'
   and exists(select 1 from public.xiaotao_operation_v3_stages r where r.operation_id=o.operation_id and r.status='recorded')
 order by l.created_at;
