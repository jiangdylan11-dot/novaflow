-- Candidate only. Preserves the existing ledger/statuses and ordinary paths.
begin;
alter table public.credit_ledger add column if not exists art_dispatched_at timestamptz;
alter table public.credit_ledger add column if not exists art_request_hash text;
alter table public.credit_ledger add column if not exists art_stage text;
alter table public.credit_ledger add column if not exists art_session_id text;
alter table public.credit_ledger add column if not exists art_resolution text;

create or replace function public.protect_xiaotao_art_dispatch_v2()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if old.art_dispatched_at is not null then
   if new.art_dispatched_at is distinct from old.art_dispatched_at
      or new.art_request_hash is distinct from old.art_request_hash
      or new.art_stage is distinct from old.art_stage
      or new.art_session_id is distinct from old.art_session_id
      or new.user_id is distinct from old.user_id or new.feature is distinct from old.feature
      or new.model is distinct from old.model or new.estimated_credits is distinct from old.estimated_credits
      or new.xiaotao_policy_version is distinct from old.xiaotao_policy_version
      or new.xiaotao_policy_cap is distinct from old.xiaotao_policy_cap
      or new.xiaotao_policy_estimate is distinct from old.xiaotao_policy_estimate
      or new.xiaotao_policy_units is distinct from old.xiaotao_policy_units
      or (new.status='reserved' and new.expires_at is distinct from old.expires_at) then
     raise exception using errcode='22023',message='art dispatch binding immutable';
   end if;
   if new.status='released' and old.status='reserved' and new.art_resolution is distinct from 'provider-rejected-no-charge' then
     raise exception using errcode='22023',message='art dispatch outcome unknown';
   end if;
   if new.status='settled' and old.status='reserved' and
      (new.xiaotao_settlement_terms is null
       or new.xiaotao_settlement_terms->>'model' is distinct from old.model
       or new.xiaotao_settlement_terms->'metadata'->>'art_stage' is distinct from old.art_stage
       or new.xiaotao_settlement_terms->'metadata'->>'art_request_hash' is distinct from old.art_request_hash
       or new.xiaotao_settlement_terms->'metadata'->>'art_session_id' is distinct from old.art_session_id
       or jsonb_typeof(new.xiaotao_settlement_terms->'metadata'->'usage') is distinct from 'object'
       or new.xiaotao_settlement_terms->'metadata'->'usage' = '{}'::jsonb) then
     raise exception using errcode='22023',message='art dispatch settlement binding mismatch';
   end if;
 end if;
 return new;
end $$;
drop trigger if exists protect_xiaotao_art_dispatch_v2 on public.credit_ledger;
create trigger protect_xiaotao_art_dispatch_v2 before update on public.credit_ledger
 for each row execute function public.protect_xiaotao_art_dispatch_v2();

-- The legacy quota APIs can close a mirror independently of the credit RPCs.
-- Read the parent without a reverse row lock: normal close updates the parent
-- first in this transaction; an older API must not close an unknown dispatch.
create or replace function public.protect_xiaotao_art_mirror_v2()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v_parent public.credit_ledger%rowtype;
begin
 select * into v_parent from public.credit_ledger where usage_key=old.usage_key;
 if found and v_parent.art_dispatched_at is not null and old.status='reserved' then
   if new.expires_at is distinct from old.expires_at then
     raise exception using errcode='22023',message='art mirror expiry immutable';
   end if;
   if new.status is distinct from old.status and new.status is distinct from v_parent.status then
     raise exception using errcode='22023',message='art mirror parent not closed';
   end if;
 end if;
 return new;
end $$;
drop trigger if exists protect_xiaotao_art_mirror_v2 on public.grok_quota_reservations;
create trigger protect_xiaotao_art_mirror_v2 before update on public.grok_quota_reservations
 for each row execute function public.protect_xiaotao_art_mirror_v2();

-- Preserve v2's advisory lock, config checks and original duplicate contract;
-- art keys additionally bind the server-created phase, body hash and session.
alter function public.reserve_xiaotao_credits_v2(uuid,text,text,integer,text,jsonb,numeric,numeric,jsonb,text)
 rename to reserve_xiaotao_credits_v2_art_base;
create function public.reserve_xiaotao_credits_v2(
 p_user_id uuid,p_usage_key text,p_feature text,p_units integer,p_model text,p_metadata jsonb,
 p_estimated_credits numeric,p_expected_cap numeric,p_expected_config jsonb,p_policy_version text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_result jsonb; v_row public.credit_ledger%rowtype;
begin
 v_result:=public.reserve_xiaotao_credits_v2_art_base(p_user_id,p_usage_key,p_feature,p_units,p_model,p_metadata,
   p_estimated_credits,p_expected_cap,p_expected_config,p_policy_version);
 if coalesce((v_result->>'idempotent')::boolean,false) then
   select * into v_row from public.credit_ledger where usage_key=p_usage_key for update;
   if (v_row.pricing_details ? 'art_stage' or coalesce(p_metadata,'{}'::jsonb) ? 'art_stage') and
      (v_row.pricing_details->>'art_stage' is distinct from p_metadata->>'art_stage'
       or v_row.pricing_details->>'art_request_hash' is distinct from p_metadata->>'art_request_hash'
       or v_row.pricing_details->>'art_session_id' is distinct from p_metadata->>'art_session_id') then
     raise exception using errcode='22023',message='art reservation payload mismatch';
   end if;
 end if;
 return v_result;
end $$;

create or replace function public.mark_xiaotao_art_dispatched_v2(
 p_user_id uuid,p_usage_key text,p_feature text,p_model text,p_stage text,p_request_hash text,
 p_session_id text,p_policy_version text,p_estimated_credits numeric
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v_row public.credit_ledger%rowtype; v_mirror public.grok_quota_reservations%rowtype; v_now timestamptz:=clock_timestamp();
begin
 if p_user_id is null or p_usage_key is null or p_stage is null or p_stage not in ('structure','english')
    or p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' or coalesce(length(p_session_id),0) not between 1 and 128 then
   raise exception using errcode='22023',message='invalid art dispatch';
 end if;
 select * into v_row from public.credit_ledger where usage_key=p_usage_key for update;
 if not found or v_row.user_id is distinct from p_user_id or v_row.status is distinct from 'reserved'
    or v_row.feature is distinct from public.canonical_credit_feature(p_feature) or v_row.model is distinct from p_model
    or v_row.xiaotao_policy_version is distinct from p_policy_version
    or v_row.xiaotao_policy_estimate is distinct from p_estimated_credits
    or v_row.pricing_details->>'art_stage' is distinct from p_stage
    or v_row.pricing_details->>'art_request_hash' is distinct from p_request_hash
    or v_row.pricing_details->>'art_session_id' is distinct from p_session_id then
   raise exception using errcode='22023',message='art dispatch reservation mismatch';
 end if;
 if v_row.art_dispatched_at is not null then
   if v_row.art_request_hash is distinct from p_request_hash or v_row.art_stage is distinct from p_stage
      or v_row.art_session_id is distinct from p_session_id then
     raise exception using errcode='22023',message='art dispatch binding mismatch';
   end if;
   return jsonb_build_object('status','dispatched','first_dispatch',false);
 end if;
 if v_row.expires_at is null or v_row.expires_at<=v_now then
   raise exception using errcode='22023',message='art reservation expired before dispatch';
 end if;
 -- Match ledger -> per-user setting -> mirror order used by close/settle.
 perform 1 from public.system_settings where key='provider_quota_grok_'||p_user_id::text for update;
 if not found then raise exception using errcode='22023',message='art mirror setting unavailable'; end if;
 select * into v_mirror from public.grok_quota_reservations where usage_key=p_usage_key for update;
 if not found or v_mirror.user_id is distinct from p_user_id or v_mirror.status is distinct from 'reserved'
    or v_mirror.expires_at<=v_now then
   raise exception using errcode='22023',message='art mirror unavailable before dispatch';
 end if;
 update public.grok_quota_reservations set expires_at='infinity'::timestamptz where usage_key=p_usage_key;
 update public.credit_ledger set art_dispatched_at=v_now,art_request_hash=p_request_hash,art_stage=p_stage,
   art_session_id=p_session_id,expires_at='infinity'::timestamptz where usage_key=p_usage_key;
 return jsonb_build_object('status','dispatched','first_dispatch',true);
end $$;

-- Only call after independently verifying that the provider did not charge.
create or replace function public.reject_xiaotao_art_dispatched_v2(
 p_user_id uuid,p_usage_key text,p_request_hash text,p_session_id text
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v_row public.credit_ledger%rowtype;
begin
 select * into v_row from public.credit_ledger where usage_key=p_usage_key for update;
 if not found or v_row.user_id is distinct from p_user_id or v_row.art_dispatched_at is null
    or v_row.art_request_hash is distinct from p_request_hash or v_row.art_session_id is distinct from p_session_id then
   raise exception using errcode='22023',message='art rejection binding mismatch';
 end if;
 if v_row.status='released' and v_row.art_resolution='provider-rejected-no-charge' then
   return jsonb_build_object('status','released','idempotent',true);
 end if;
 if v_row.status is distinct from 'reserved' then raise exception using errcode='22023',message='art reservation not open'; end if;
 update public.credit_ledger set art_resolution='provider-rejected-no-charge' where usage_key=p_usage_key;
 return public.release_feature_credits(p_user_id,p_usage_key,v_row.feature,'provider-rejected-no-charge','{}'::jsonb);
end $$;

-- Keep the existing v2 settlement implementation and recover its actual
-- stored result on replay instead of inventing a zero shortfall.
alter function public.settle_xiaotao_credits_v2(uuid,text,text,integer,text,jsonb,numeric,numeric,text)
 rename to settle_xiaotao_credits_v2_art_base;
create function public.settle_xiaotao_credits_v2(
 p_user_id uuid,p_usage_key text,p_feature text default null,p_actual_units integer default null,
 p_model text default null,p_metadata jsonb default '{}'::jsonb,p_settled_credits numeric default null,
 p_rh_cost_usd numeric default null,p_pricing_source text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_result jsonb; v_row public.credit_ledger%rowtype;
begin
 v_result:=public.settle_xiaotao_credits_v2_art_base(p_user_id,p_usage_key,p_feature,p_actual_units,p_model,p_metadata,p_settled_credits,p_rh_cost_usd,p_pricing_source);
 if coalesce((v_result->>'idempotent')::boolean,false) then
   select * into v_row from public.credit_ledger where usage_key=p_usage_key and user_id=p_user_id;
   v_result:=v_result||jsonb_build_object(
     'refunded_credits',coalesce(v_row.pricing_details->'refunded_credits',v_result->'refunded_credits'),
     'reserve_capped',coalesce(v_row.pricing_details->'reserve_capped',v_result->'reserve_capped'),
     'topup_credits',coalesce(v_row.pricing_details->'topup_credits',v_result->'topup_credits'),
     'shortfall_credits',coalesce(v_row.pricing_details->'shortfall_credits','0'::jsonb),
     'uncollected_credits',coalesce(v_row.pricing_details->'uncollected_credits',v_result->'uncollected_credits'),
     'balance_short',coalesce(v_row.pricing_details->'balance_short',v_result->'balance_short'),
     'direct_charge',coalesce(v_row.pricing_details->'direct_charge',v_result->'direct_charge'));
 end if;
 return v_result;
end $$;
revoke all on function public.settle_xiaotao_credits_v2_art_base(uuid,text,text,integer,text,jsonb,numeric,numeric,text) from public,anon,authenticated,service_role;
revoke all on function public.reserve_xiaotao_credits_v2_art_base(uuid,text,text,integer,text,jsonb,numeric,numeric,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.reserve_xiaotao_credits_v2(uuid,text,text,integer,text,jsonb,numeric,numeric,jsonb,text) from public,anon,authenticated;
revoke all on function public.settle_xiaotao_credits_v2(uuid,text,text,integer,text,jsonb,numeric,numeric,text) from public,anon,authenticated;
revoke all on function public.mark_xiaotao_art_dispatched_v2(uuid,text,text,text,text,text,text,text,numeric) from public,anon,authenticated;
revoke all on function public.reject_xiaotao_art_dispatched_v2(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.settle_xiaotao_credits_v2(uuid,text,text,integer,text,jsonb,numeric,numeric,text) to service_role;
grant execute on function public.reserve_xiaotao_credits_v2(uuid,text,text,integer,text,jsonb,numeric,numeric,jsonb,text) to service_role;
grant execute on function public.mark_xiaotao_art_dispatched_v2(uuid,text,text,text,text,text,text,text,numeric) to service_role;
grant execute on function public.reject_xiaotao_art_dispatched_v2(uuid,text,text,text) to service_role;
commit;
