-- 小桃：派发后长时间没有结果的在线阶段（边缘函数被掐断、模型没回），由服务器在该用户下一次报价前自动退回。
-- 只处理 p_user_id 自己的、仍是 dispatched 且派发时间早于 p_min_age_seconds 的阶段；进行中的不动。
-- 复用现有函数：reject_xiaotao_operation_stage_v3 释放阶段预留，finalize_xiaotao_operation_v3_refund 按 0 结算。
-- 不改任何被 readiness 哈希钉住的函数。要求已执行 20261106-xiaotao-cancel-refund 补丁。
begin;
CREATE OR REPLACE FUNCTION public.sweep_xiaotao_stale_dispatched_v3(p_user_id uuid, p_min_age_seconds integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare row record; r jsonb; refunded jsonb:='[]'::jsonb; skipped integer:=0;
begin
 if p_user_id is null or p_min_age_seconds is null or p_min_age_seconds<60 then raise exception using errcode='22023',message='invalid sweep request';end if;
 for row in
   select o.operation_id, o.user_id, o.session_id, o.model, o.policy_version, o.intent_hash, s.phase_id, s.request_hash, l.art_dispatched_at
     from public.xiaotao_operation_v3_stages s
     join public.xiaotao_operation_v3_operations o on o.operation_id=s.operation_id
     join public.credit_ledger l on l.usage_key=s.usage_key
    where o.user_id=p_user_id and s.status='dispatched' and o.status='open' and l.status='reserved'
      and l.art_dispatched_at < clock_timestamp() - make_interval(secs=>p_min_age_seconds)
    order by l.art_dispatched_at
    limit 20
 loop
   begin
     r:=public.reject_xiaotao_operation_stage_v3(row.operation_id,row.user_id,row.session_id,row.model,row.policy_version,row.intent_hash,
          row.phase_id,row.request_hash,jsonb_build_object('reason','stale-dispatched','dispatched_at',row.art_dispatched_at,'sweep','sweep_xiaotao_stale_dispatched_v3'));
     if r->>'status'<>'rejected' then skipped:=skipped+1; continue; end if;
     if exists(select 1 from public.xiaotao_operation_v3_stages where operation_id=row.operation_id and status='dispatched') then skipped:=skipped+1; continue; end if;
     r:=public.finalize_xiaotao_operation_v3_refund(row.operation_id,row.user_id,row.session_id,row.model,row.policy_version,row.intent_hash);
     if r->>'status'<>'settled' then skipped:=skipped+1; continue; end if;
     refunded:=refunded||jsonb_build_array(jsonb_build_object('operation_id',row.operation_id,'phase_id',row.phase_id,'charged',r->'charged'));
   exception when others then skipped:=skipped+1;
   end;
 end loop;
 return jsonb_build_object('status','swept','refunded',refunded,'skipped',skipped);
end $function$;
revoke all on function public.sweep_xiaotao_stale_dispatched_v3(uuid,integer) from public, anon, authenticated;
grant execute on function public.sweep_xiaotao_stale_dispatched_v3(uuid,integer) to service_role;
commit;
