-- Management authority comes from the separately configured Supabase service
-- credentials in the admin tool, never from a NovaFlow creative-user account.
-- The existing RPCs remain executable only by service_role. NULL actor denotes
-- admin-tool capability, not an anonymous or auto-created user. Keep historical
-- account audit values while recording new management actions explicitly.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
alter table public.art_knowledge_reviews alter column prepared_by drop not null;
alter table public.art_knowledge_reviews add column if not exists prepared_via text not null default 'legacy-account';
alter table public.art_knowledge_releases alter column reviewed_by drop not null;
alter table public.art_knowledge_releases add column if not exists reviewed_via text not null default 'legacy-account';
update public.art_knowledge_reviews set state='outdated' where state='pending' and prepared_via='legacy-account';
update public.art_knowledge_policy set publisher_user_id=null;
create or replace function public.novaflow_art_publish_knowledge(p_admin_id uuid,p_skill_id text,p_version text,p_candidate_ids uuid[],p_validation jsonb,p_skill jsonb default null)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v_methods jsonb; v_count integer; v_current jsonb; v_review jsonb; v_row jsonb;
begin
  if p_admin_id is not null then raise exception 'backend management tool required'; end if;
  if p_skill_id not in ('style-transfer','image-creation') or p_version!~'^[0-9]+\.[0-9]+\.[0-9]+$'
     or coalesce(p_validation->>'passed','')<>'true'
     or coalesce(p_validation->>'benchmarkSHA256','')!~'^[a-f0-9]{64}$'
     or coalesce((p_validation->>'cases')::integer,0)<1
     or coalesce(p_validation->>'ownerApproved','')<>'true'
     or coalesce(p_validation->>'approvedBy','')<>'admin-tool' then raise exception 'fixed benchmark and explicit owner approval required'; end if;
  if cardinality(p_candidate_ids) not between 1 and 20 then raise exception 'invalid release size'; end if;
  if not exists(select 1 from public.art_knowledge_reviews where batch_sha256=p_validation->>'approvalSHA256' and prepared_by is null and prepared_via='admin-tool' and state='pending') then raise exception 'pending owner review required'; end if;
  if p_skill is not null and (p_skill->>'id'<>p_skill_id or p_skill->>'status'<>'stable'
    or encode(pg_catalog.sha256(pg_catalog.convert_to(p_skill->>'systemPrompt','UTF8')),'hex')<>p_skill->>'systemSHA256') then raise exception 'invalid professional skill'; end if;
  -- Serialize submissions and publication per skill, then recheck the exact
  -- evidence fingerprints reviewed by the owner to close the approval race.
  perform pg_advisory_xact_lock(hashtext('art:'||p_skill_id));
  v_review=public.novaflow_art_review_candidates();
  for v_row in select value from jsonb_array_elements(v_review) where (value->>'id')::uuid=any(p_candidate_ids) loop
    if p_validation->'evidenceFingerprints'->>(v_row->>'id') is distinct from v_row->>'evidence_fingerprint' then raise exception 'reviewed evidence changed'; end if;
  end loop;
  select methods into v_current from public.art_knowledge_releases where skill_id=p_skill_id and active;
  if coalesce(p_validation->>'baseVersion','0') is distinct from coalesce((select version from public.art_knowledge_releases where skill_id=p_skill_id and active),'0') then raise exception 'active knowledge changed'; end if;
  select count(*),jsonb_agg(jsonb_build_object('id',c.id,'text',c.method,'scope',c.scope,'status','stable') order by c.id)
    into v_count,v_methods from public.art_method_candidates c where c.id=any(p_candidate_ids) and c.scope->>'skillId'=p_skill_id
      and exists(select 1 from public.art_method_evidence e where e.candidate_id=c.id and e.feedback in ('satisfied','adopted'));
  if v_count<>cardinality(p_candidate_ids) then raise exception 'missing positive evidence or duplicate candidate IDs'; end if;
  -- Retain previously approved methods; new releases add knowledge rather
  -- than accidentally deleting every method not in this review batch.
  select coalesce(jsonb_agg(value order by value->>'id'),'[]'::jsonb) into v_methods from (
    select distinct on(value->>'id') value from jsonb_array_elements(coalesce(v_current,'[]'::jsonb)||v_methods)
  ) merged;
  if jsonb_array_length(v_methods)>100 or octet_length(v_methods::text)>100000 then raise exception 'knowledge capacity review required'; end if;
  if p_skill is null then select skill into p_skill from public.art_knowledge_releases where skill_id=p_skill_id and active; end if;
  if octet_length(jsonb_build_object('version',p_version,'methods',v_methods,'skill',p_skill)::text)>131072 then raise exception 'knowledge packet too large';end if;
  insert into public.art_knowledge_releases(skill_id,version,methods,validation,reviewed_by,skill,reviewed_via) values(p_skill_id,p_version,v_methods,p_validation,null,p_skill,'admin-tool');
  update public.art_knowledge_releases set active=false where skill_id=p_skill_id and active;
  update public.art_knowledge_releases set active=true where skill_id=p_skill_id and version=p_version;
  update public.art_knowledge_reviews set state='published' where batch_sha256=p_validation->>'approvalSHA256';
  update public.art_knowledge_reviews set state='outdated' where state='pending' and report->'publishRequest'->>'skillId'=p_skill_id;
  return jsonb_build_object('version',p_version,'methods',v_methods,'skill',p_skill);
end $$;
create or replace function public.novaflow_art_rollback_knowledge(p_admin_id uuid,p_skill_id text,p_version text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if p_admin_id is not null then raise exception 'backend management tool required'; end if;
  perform pg_advisory_xact_lock(hashtext('art:'||p_skill_id));
  if not exists(select 1 from public.art_knowledge_releases where skill_id=p_skill_id and version=p_version) then raise exception 'approved version not found'; end if;
  update public.art_knowledge_releases set active=false where skill_id=p_skill_id and active;
  update public.art_knowledge_releases set active=true where skill_id=p_skill_id and version=p_version;
  return jsonb_build_object('version',p_version,'rolledBack',true);
end $$;
commit;
