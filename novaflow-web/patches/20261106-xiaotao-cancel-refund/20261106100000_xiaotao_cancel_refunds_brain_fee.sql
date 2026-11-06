-- 小桃: when a turn fails and produces nothing, its brain fee is refunded in full (Dylan, 2026-11-06).
-- Base: production finalize_xiaotao_operation_v3 as read on 2026-11-06 (2.0.323 live).
-- finalize_xiaotao_operation_v3 keeps its exact behaviour (core with p_refund=false);
-- finalize_xiaotao_operation_v3_refund is the new entry: outcome 'cancel', every phase settled at 0.
-- Apply in one transaction. Re-applying is safe.

begin;

CREATE OR REPLACE FUNCTION public.finalize_xiaotao_operation_v3_core(p_operation_id uuid, p_user_id uuid, p_session_id text, p_model text, p_policy_version text, p_intent_hash text, p_outcome text, p_refund boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare o public.xiaotao_operation_v3_operations%rowtype;s public.xiaotao_operation_v3_stages%rowtype;p public.xiaotao_operation_v3_art_plans%rowtype;cum numeric:=0;prev numeric:=0;now_amount numeric;allocation numeric;r jsonb;receipts jsonb:='[]'::jsonb;allocations jsonb:='{}'::jsonb;charged numeric:=0;uncollected numeric:=0;v_meta jsonb;
begin
 select * into o from public.xiaotao_operation_v3_operations where operation_id=p_operation_id for update;
 if not found or o.user_id is distinct from p_user_id or o.session_id is distinct from p_session_id or o.model is distinct from p_model or o.policy_version is distinct from p_policy_version
   or o.intent_hash is distinct from p_intent_hash or p_outcome is null or p_outcome not in ('success','cancel') or p_refund is null or (p_refund and p_outcome<>'cancel') then raise exception using errcode='22023',message='operation finalize mismatch';end if;
 if o.status='settled' then
  if o.outcome is distinct from p_outcome then raise exception using errcode='22023',message='operation outcome mismatch';end if;
  return o.receipt||jsonb_build_object('idempotent',true);
 end if;
 if exists(select 1 from public.xiaotao_operation_v3_stages where operation_id=p_operation_id and status='dispatched') then return jsonb_build_object('status','pending-reconciliation');end if;
 select * into p from public.xiaotao_operation_v3_art_plans where operation_id=p_operation_id for update;
 if found and p_outcome='success' and (p.parent_hash is null or (p.art_mode='art_dual' and not p.english_validated)) then raise exception using errcode='22023',message='art operation incomplete';end if;
 if p_outcome='success' and (not exists(select 1 from public.xiaotao_operation_v3_stages where operation_id=p_operation_id and status='recorded')
   or exists(select 1 from public.xiaotao_operation_v3_stages where operation_id=p_operation_id and status='reserved')) then raise exception using errcode='22023',message='operation incomplete';end if;
 -- Freeze each allocation in model-call order, but perform refunds before
 -- top-ups. Otherwise a later surplus hold cannot fund an earlier shortfall.
 for s in select * from public.xiaotao_operation_v3_stages where operation_id=p_operation_id and status='recorded' order by sequence_no for update loop
  cum:=cum+least(s.raw_credits,o.phase_cap);
  if public.xiaotao_decimal_policy_v1(o.expected_config,o.policy_snapshot_text) then
    now_amount:=ceil(cum*1000000)/1000000;
   else
    now_amount:=case o.round_mode when 'floor' then floor(cum+0.000000001) when 'round' then round(cum) else ceil(cum-0.000000001) end;
    if p_outcome='success' then now_amount:=greatest(1,now_amount); end if;
   end if;
  -- A failed turn that produced nothing settles every recorded phase at 0: its hold is refunded in full.
  -- The ledger still records usd_cost, so the platform's own cost stays visible.
  if p_refund then now_amount:=0; end if;
  allocation:=now_amount-prev;prev:=now_amount;
  if allocation<0 or allocation>o.phase_cap then raise exception using errcode='22023',message='invalid phase allocation';end if;
  allocations:=allocations||jsonb_build_object(s.phase_id,allocation);
 end loop;
 -- Match the existing ledger-before-account lock order; lock every stage in a
 -- deterministic order before applying settlement in refund-first order.
 perform 1 from public.credit_ledger l join public.xiaotao_operation_v3_stages t on t.usage_key=l.usage_key
  where t.operation_id=p_operation_id order by l.usage_key for update of l;
 for s in select t.* from public.xiaotao_operation_v3_stages t join public.credit_ledger l on l.usage_key=t.usage_key
   where t.operation_id=p_operation_id
   order by case when t.status='reserved' or (allocations->>t.phase_id)::numeric<=l.estimated_credits then 0 else 1 end,t.sequence_no
   for update of t loop
  if s.status='reserved' then
   r:=public.release_feature_credits(p_user_id,s.usage_key,s.feature,'operation cancelled','{}'::jsonb);
   if r->>'status'<>'released' then raise exception using errcode='22023',message='phase release unconfirmed';end if;
   update public.xiaotao_operation_v3_stages set status='cancelled' where operation_id=p_operation_id and phase_id=s.phase_id;
  elsif s.status='recorded' then
   allocation:=(allocations->>s.phase_id)::numeric;
   v_meta:=jsonb_build_object('art_stage',s.phase_kind,'art_request_hash',s.request_hash,'art_session_id',p_session_id,'usage',s.usage,'operation_id',p_operation_id::text,'operation_phase',s.phase_id);
    if public.xiaotao_decimal_policy_v1(o.expected_config,o.policy_snapshot_text) then
     v_meta:=v_meta||jsonb_build_object('raw_usd_cost_exact',s.usd_cost::text,'raw_credits_exact',s.raw_credits::text,'credit_amount_policy','decimal-v1');
    end if;
   r:=public.settle_xiaotao_credits_v2(p_user_id,s.usage_key,s.feature,1,p_model,v_meta,allocation,s.usd_cost,'token_rate_estimate');
   if r->>'status'<>'settled' then raise exception using errcode='22023',message='phase settle unconfirmed';end if;
   charged:=charged+coalesce((r->>'settled_credits')::numeric,0);uncollected:=uncollected+coalesce((r->>'uncollected_credits')::numeric,0);
   receipts:=receipts||jsonb_build_array(jsonb_build_object('phase_id',s.phase_id,'allocated',allocation,'settled',r->'settled_credits','usd_cost',s.usd_cost));
   update public.xiaotao_operation_v3_stages set status='settled' where operation_id=p_operation_id and phase_id=s.phase_id;
  elsif s.status='rejected' then null;
  else raise exception using errcode='22023',message='unexpected phase state';end if;
 end loop;
 select coalesce(jsonb_agg(j.item order by st.sequence_no),'[]'::jsonb) into receipts
 from jsonb_array_elements(receipts) j(item)
 join public.xiaotao_operation_v3_stages st on st.operation_id=p_operation_id and st.phase_id=j.item->>'phase_id';
 r:=jsonb_build_object('status','settled','idempotent',false,'outcome',p_outcome,'raw_capped',cum,'requested',prev,'charged',charged,'uncollected',uncollected,'phases',receipts,'refunded',p_refund);
 if public.xiaotao_decimal_policy_v1(o.expected_config,o.policy_snapshot_text) then
   r:=r||jsonb_build_object('credit_amount_policy','decimal-v1','credit_precision',6,'credit_rounding','ceil','minimum_positive_credits',0);
  end if;
  update public.xiaotao_operation_v3_operations set status='settled',outcome=p_outcome,receipt=r where operation_id=p_operation_id;
 return r;
end $function$;

CREATE OR REPLACE FUNCTION public.finalize_xiaotao_operation_v3(p_operation_id uuid, p_user_id uuid, p_session_id text, p_model text, p_policy_version text, p_intent_hash text, p_outcome text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$ select public.finalize_xiaotao_operation_v3_core(p_operation_id,p_user_id,p_session_id,p_model,p_policy_version,p_intent_hash,p_outcome,false) $function$;

-- 小桃 turn failed and produced nothing: cancel the operation and refund every phase.
CREATE OR REPLACE FUNCTION public.finalize_xiaotao_operation_v3_refund(p_operation_id uuid, p_user_id uuid, p_session_id text, p_model text, p_policy_version text, p_intent_hash text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$ select public.finalize_xiaotao_operation_v3_core(p_operation_id,p_user_id,p_session_id,p_model,p_policy_version,p_intent_hash,'cancel',true) $function$;

revoke all on function public.finalize_xiaotao_operation_v3_core(uuid,uuid,text,text,text,text,text,boolean) from public, anon, authenticated;
revoke all on function public.finalize_xiaotao_operation_v3(uuid,uuid,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.finalize_xiaotao_operation_v3_refund(uuid,uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.finalize_xiaotao_operation_v3_core(uuid,uuid,text,text,text,text,text,boolean) to service_role;
grant execute on function public.finalize_xiaotao_operation_v3(uuid,uuid,text,text,text,text,text) to service_role;
grant execute on function public.finalize_xiaotao_operation_v3_refund(uuid,uuid,text,text,text,text) to service_role;

commit;
