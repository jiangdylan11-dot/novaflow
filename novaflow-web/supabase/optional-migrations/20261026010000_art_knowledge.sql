-- Prepared shared-method service. OPTIONAL: explicitly apply only after local
-- acceptance. No personal long-term library, images, chats or source prompts.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
create table if not exists public.art_method_candidates (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  scope jsonb not null,
  method text not null check(length(method) between 1 and 600),
  created_at timestamptz not null default now()
);
create table if not exists public.art_learning_consents (
  user_id uuid primary key references public.users(id),
  allowed boolean not null default false,
  updated_at timestamptz not null default now()
);
-- Explicit owner binding, configured by the deployer after acceptance. An
-- unset owner denies publication; the first caller never becomes the owner.
create table if not exists public.art_knowledge_policy (
  singleton boolean primary key default true check(singleton),
  publisher_user_id uuid references public.users(id)
);
insert into public.art_knowledge_policy(singleton) values(true) on conflict do nothing;
create table if not exists public.art_method_evidence (
  candidate_id uuid not null references public.art_method_candidates(id),
  user_id uuid not null references public.users(id),
  task_id text not null check(length(task_id) between 1 and 128),
  result_sha256 text not null check(result_sha256 ~ '^[a-f0-9]{64}$'),
  feedback text not null check(feedback in ('satisfied','adopted','unsatisfied','revision')),
  improvement boolean not null default false,
  created_at timestamptz not null default now(),
  primary key(candidate_id,user_id,task_id)
);
create table if not exists public.art_knowledge_releases (
  skill_id text not null,
  version text not null,
  methods jsonb not null,
  skill jsonb,
  validation jsonb not null,
  reviewed_by uuid not null references public.users(id),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  primary key(skill_id,version)
);
create unique index if not exists art_knowledge_active_skill on public.art_knowledge_releases(skill_id) where active;
alter table public.art_method_candidates enable row level security;
alter table public.art_learning_consents enable row level security;
alter table public.art_knowledge_policy enable row level security;
alter table public.art_method_evidence enable row level security;
alter table public.art_knowledge_releases enable row level security;
revoke all on public.art_method_candidates,public.art_method_evidence,public.art_knowledge_releases,public.art_learning_consents,public.art_knowledge_policy from public,anon,authenticated;
grant select,insert,update,delete on public.art_method_candidates,public.art_method_evidence,public.art_knowledge_releases,public.art_learning_consents,public.art_knowledge_policy to service_role;

create or replace function public.novaflow_art_submit_method(p_user_id uuid,p_scope jsonb,p_method text,p_evidence jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v_id uuid; v_key text; v_item jsonb; v_existing text;
begin
  if not exists(select 1 from public.users where id=p_user_id and status='active') then raise exception 'unknown user'; end if;
  if not exists(select 1 from public.art_learning_consents where user_id=p_user_id and allowed) then raise exception 'shared learning consent required'; end if;
  if length(p_method) not between 1 and 600 or p_method ~* '(data:image/|https?://|Bearer[[:space:]])' then raise exception 'invalid abstract method'; end if;
  if jsonb_typeof(p_scope)<>'object' or p_scope->>'skillId' not in ('style-transfer','image-creation')
     or not(p_scope ?& array['skillId','generationModel','variant','brain'])
     or (select count(*) from jsonb_object_keys(p_scope))<>4
     or jsonb_typeof(p_evidence)<>'array' or jsonb_array_length(p_evidence) not between 1 and 20 then raise exception 'invalid method scope or evidence'; end if;
  perform pg_advisory_xact_lock(hashtext('art:'||(p_scope->>'skillId')));
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));
  if (select count(*) from public.art_method_evidence where user_id=p_user_id and created_at>now()-interval '1 hour')>=100 then raise exception 'method feedback limit'; end if;
  v_key=encode(public.digest(p_scope::text||E'\n'||lower(regexp_replace(normalize(p_method,NFKC),'[[:space:][:punct:]，。！？；：、（）【】《》“”‘’]','','g')),'sha256'),'hex');
  insert into public.art_method_candidates(fingerprint,scope,method) values(v_key,p_scope,p_method)
    on conflict(fingerprint) do update set fingerprint=excluded.fingerprint returning id into v_id;
  for v_item in select value from jsonb_array_elements(p_evidence) loop
    select result_sha256 into v_existing from public.art_method_evidence where candidate_id=v_id and user_id=p_user_id and task_id=v_item->>'taskId';
    if found and v_existing<>v_item->>'resultSHA256' then raise exception 'result identity changed'; end if;
    insert into public.art_method_evidence(candidate_id,user_id,task_id,result_sha256,feedback,improvement)
      values(v_id,p_user_id,v_item->>'taskId',v_item->>'resultSHA256',v_item->>'feedback',coalesce((v_item->>'improvement')::boolean,false))
      on conflict(candidate_id,user_id,task_id) do update set feedback=excluded.feedback,improvement=excluded.improvement;
  end loop;
  return jsonb_build_object('accepted',true,'candidateId',v_id,'status','candidate');
end $$;

-- Shared by both adapters. No raw task text, user IDs or image data leave SQL.
create or replace function public.novaflow_art_review_candidates()
returns jsonb language sql security invoker set search_path=pg_catalog,public as $$
  select coalesce(jsonb_agg(row_data order by created_at desc),'[]'::jsonb) from (
    select c.created_at,jsonb_build_object('id',c.id,'scope',c.scope,'method',c.method,
      'evidence_count',count(e.*),'positive_count',count(*) filter(where e.feedback in ('satisfied','adopted')),
      'negative_count',count(*) filter(where e.feedback in ('unsatisfied','revision')),
      'positive_users',count(distinct e.user_id) filter(where e.feedback in ('satisfied','adopted')),
      'improvement_count',count(*) filter(where e.improvement and e.feedback in ('satisfied','adopted')),
      'evidence_fingerprint',encode(public.digest(coalesce(jsonb_agg(jsonb_build_array(e.user_id,e.task_id,e.result_sha256,e.feedback,e.improvement) order by e.user_id,e.task_id) filter(where e.candidate_id is not null),'[]'::jsonb)::text,'sha256'),'hex')) as row_data
    from public.art_method_candidates c left join public.art_method_evidence e on e.candidate_id=c.id
    group by c.id order by c.created_at desc limit 500
  ) reviewed;
$$;
revoke all on function public.novaflow_art_review_candidates() from public,anon,authenticated;
grant execute on function public.novaflow_art_review_candidates() to service_role;

create or replace function public.novaflow_art_publish_knowledge(p_admin_id uuid,p_skill_id text,p_version text,p_candidate_ids uuid[],p_validation jsonb,p_skill jsonb default null)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v_methods jsonb; v_count integer; v_current jsonb; v_review jsonb; v_row jsonb;
begin
  if not exists(select 1 from public.users u join public.art_knowledge_policy p on p.publisher_user_id=u.id where u.id=p_admin_id and u.role='admin' and u.status='active') then raise exception 'publisher owner required'; end if;
  if p_skill_id not in ('style-transfer','image-creation') or p_version!~'^[0-9]+\.[0-9]+\.[0-9]+$'
     or coalesce(p_validation->>'passed','')<>'true'
     or coalesce(p_validation->>'benchmarkSHA256','')!~'^[a-f0-9]{64}$'
     or coalesce((p_validation->>'cases')::integer,0)<1
     or coalesce(p_validation->>'ownerApproved','')<>'true'
     or coalesce(p_validation->>'approvedBy','')<>p_admin_id::text then raise exception 'fixed benchmark and explicit owner approval required'; end if;
  if cardinality(p_candidate_ids) not between 1 and 20 then raise exception 'invalid release size'; end if;
  if p_skill is not null and (p_skill->>'id'<>p_skill_id or p_skill->>'status'<>'stable'
    or encode(public.digest(p_skill->>'systemPrompt','sha256'),'hex')<>p_skill->>'systemSHA256') then raise exception 'invalid professional skill'; end if;
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
  insert into public.art_knowledge_releases(skill_id,version,methods,validation,reviewed_by,skill) values(p_skill_id,p_version,v_methods,p_validation,p_admin_id,p_skill);
  update public.art_knowledge_releases set active=false where skill_id=p_skill_id and active;
  update public.art_knowledge_releases set active=true where skill_id=p_skill_id and version=p_version;
  return jsonb_build_object('version',p_version,'methods',v_methods,'skill',p_skill);
end $$;
create or replace function public.novaflow_art_rollback_knowledge(p_admin_id uuid,p_skill_id text,p_version text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if not exists(select 1 from public.users u join public.art_knowledge_policy p on p.publisher_user_id=u.id where u.id=p_admin_id and u.role='admin' and u.status='active') then raise exception 'publisher owner required'; end if;
  perform pg_advisory_xact_lock(hashtext('art:'||p_skill_id));
  if not exists(select 1 from public.art_knowledge_releases where skill_id=p_skill_id and version=p_version) then raise exception 'approved version not found'; end if;
  update public.art_knowledge_releases set active=false where skill_id=p_skill_id and active;
  update public.art_knowledge_releases set active=true where skill_id=p_skill_id and version=p_version;
  return jsonb_build_object('version',p_version,'rolledBack',true);
end $$;
revoke all on function public.novaflow_art_submit_method(uuid,jsonb,text,jsonb) from public,anon,authenticated;
revoke all on function public.novaflow_art_publish_knowledge(uuid,text,text,uuid[],jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.novaflow_art_rollback_knowledge(uuid,text,text) from public,anon,authenticated;
grant execute on function public.novaflow_art_submit_method(uuid,jsonb,text,jsonb) to service_role;
grant execute on function public.novaflow_art_publish_knowledge(uuid,text,text,uuid[],jsonb,jsonb) to service_role;
grant execute on function public.novaflow_art_rollback_knowledge(uuid,text,text) to service_role;
commit;
