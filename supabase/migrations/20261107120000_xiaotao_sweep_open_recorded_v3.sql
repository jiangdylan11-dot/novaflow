-- 小桃: an operation whose last phase was recorded but never closed keeps its hold forever (live 2.0.341,
-- operation 6a469892: the browser's close arrived 4 s before the planner recorded its usage, and nothing
-- closed it afterwards). The per-user sweep now also closes such operations once they have been idle for
-- 30 minutes, with the same rule as a browser cancel: recorded usage is charged, unrecorded phases are
-- released (finalize_xiaotao_operation_v3 with outcome 'cancel').
--
-- Only sweep_xiaotao_stale_dispatched_v3 changes. Its first loop is the live definition, unchanged.
-- No settle, finalize, reserve or status function changes, so get_xiaotao_decimal_v1_readiness keeps its pins.
-- 30 minutes is far past the 80 s model limit and the edge worker limit, and longer than a tool step
-- (a video generation) normally keeps an operation waiting between two planner phases.
-- Apply in one transaction. Re-applying is safe. Rollback: rollback_20261107120000_xiaotao_sweep_open_recorded_v3.sql.

begin;

CREATE OR REPLACE FUNCTION public.sweep_xiaotao_stale_dispatched_v3(p_user_id uuid, p_min_age_seconds integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare row record; r jsonb; refunded jsonb:='[]'::jsonb; closed jsonb:='[]'::jsonb; skipped integer:=0;
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
 -- Abandoned after usage was recorded: nothing in flight, nothing touched for 30 minutes. Closed like a browser cancel.
 for row in
   select o.operation_id, o.user_id, o.session_id, o.model, o.policy_version, o.intent_hash
     from public.xiaotao_operation_v3_operations o
    where o.user_id=p_user_id and o.status='open'
      and exists(select 1 from public.xiaotao_operation_v3_stages s where s.operation_id=o.operation_id and s.status='recorded')
      and not exists(select 1 from public.xiaotao_operation_v3_stages s where s.operation_id=o.operation_id and s.status='dispatched')
      and (select max(greatest(l.created_at,coalesce(l.updated_at,l.created_at),coalesce(l.art_dispatched_at,l.created_at)))
             from public.xiaotao_operation_v3_stages s join public.credit_ledger l on l.usage_key=s.usage_key
            where s.operation_id=o.operation_id) < clock_timestamp() - interval '30 minutes'
    limit 20
 loop
   begin
     r:=public.finalize_xiaotao_operation_v3(row.operation_id,row.user_id,row.session_id,row.model,row.policy_version,row.intent_hash,'cancel');
     if r->>'status'<>'settled' then skipped:=skipped+1; continue; end if;
     closed:=closed||jsonb_build_array(jsonb_build_object('operation_id',row.operation_id,'charged',r->'charged'));
   exception when others then skipped:=skipped+1;
   end;
 end loop;
 return jsonb_build_object('status','swept','refunded',refunded,'closed',closed,'skipped',skipped);
end $function$;

revoke all on function public.sweep_xiaotao_stale_dispatched_v3(uuid,integer) from public, anon, authenticated;
grant execute on function public.sweep_xiaotao_stale_dispatched_v3(uuid,integer) to service_role;

commit;
