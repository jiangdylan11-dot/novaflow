-- RunningHub configuration is encrypted in Vault. Only service_role can call
-- these functions; neither user-facing settings nor a public Page receives it.
begin;
create schema if not exists novaflow_private;
revoke all on schema novaflow_private from public, anon, authenticated;
create table if not exists novaflow_private.runninghub_config (
  singleton boolean primary key default true check (singleton),
  secret_id uuid,
  llm_base_url text not null,
  llm_model text not null,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);
alter table novaflow_private.runninghub_config enable row level security;
revoke all on novaflow_private.runninghub_config from public, anon, authenticated;

create or replace function public.novaflow_runninghub_config_set(
  p_api_key text default null, p_clear boolean default false,
  p_llm_base_url text default 'https://llm.runninghub.ai/v1',
  p_llm_model text default 'xai/grok-4.7'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare old_id uuid; new_id uuid; saved novaflow_private.runninghub_config;
begin
  if p_llm_base_url not in ('https://llm.runninghub.ai/v1','https://llm.runninghub.cn/v1')
    or p_llm_model !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$' then
    raise exception 'RunningHub 服务地址或模型格式无效';
  end if;
  if p_api_key is not null and (p_clear or length(btrim(p_api_key)) < 8 or length(p_api_key)>2048 or p_api_key ~ '[\r\n]') then
    raise exception 'RunningHub Key 格式无效或与清空操作冲突';
  end if;
  if p_api_key in ('rh-fixture-key-not-real','test-runninghub-secret-never-return','test-runninghub-key') then
    raise exception '测试占位 Key 不允许写入服务器';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(630174301);
  select secret_id into old_id from novaflow_private.runninghub_config where singleton for update;
  if not found and p_api_key is null and not p_clear then
    raise exception '首次同步服务器配置时请填写 RunningHub Key';
  end if;
  new_id := old_id;
  if p_clear then
    delete from vault.secrets where id=old_id;
    new_id := null;
  elsif p_api_key is not null then
    if old_id is null then
      select vault.create_secret(btrim(p_api_key),'novaflow-runninghub-api-key','Foart server provider configuration') into new_id;
    else
      perform vault.update_secret(old_id,btrim(p_api_key));
    end if;
  end if;
  insert into novaflow_private.runninghub_config(singleton,secret_id,llm_base_url,llm_model)
    values(true,new_id,p_llm_base_url,p_llm_model)
    on conflict(singleton) do update set secret_id=excluded.secret_id,llm_base_url=excluded.llm_base_url,
      llm_model=excluded.llm_model,revision=novaflow_private.runninghub_config.revision+1,updated_at=now()
    returning * into saved;
  return jsonb_build_object('synced',true,'configured',saved.secret_id is not null,'revision',saved.revision,'updatedAt',saved.updated_at);
end $$;

create or replace function public.novaflow_runninghub_config_get()
returns table(api_key text,llm_base_url text,llm_model text,revision bigint,updated_at timestamptz)
language sql security definer set search_path = '' as $$
  select coalesce(s.decrypted_secret,''),c.llm_base_url,c.llm_model,c.revision,c.updated_at
    from novaflow_private.runninghub_config c left join vault.decrypted_secrets s on s.id=c.secret_id where c.singleton;
$$;
revoke all on function public.novaflow_runninghub_config_set(text,boolean,text,text) from public,anon,authenticated;
revoke all on function public.novaflow_runninghub_config_get() from public,anon,authenticated;
grant execute on function public.novaflow_runninghub_config_set(text,boolean,text,text) to service_role;
grant execute on function public.novaflow_runninghub_config_get() to service_role;
notify pgrst,'reload schema';
commit;
