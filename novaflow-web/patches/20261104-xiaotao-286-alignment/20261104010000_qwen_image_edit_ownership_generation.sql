-- Candidate only. Keep the image-edit control-plane feature disabled until
-- this migration, token refresh and installed-worker acceptance are complete.
begin;

alter table public.gpu_workers
  add column if not exists ownership_generation uuid;

alter table public.gpu_workers
  alter column ownership_generation set default gen_random_uuid();

update public.gpu_workers
set ownership_generation = gen_random_uuid()
where ownership_generation is null;

alter table public.gpu_workers
  alter column ownership_generation set not null;

create or replace function public.novaflow_worker_ownership_generation()
returns trigger language plpgsql
set search_path = pg_catalog, public as $$
begin
  if tg_op = 'INSERT' then
    new.ownership_generation := gen_random_uuid();
  elsif new.owner_id is distinct from old.owner_id then
    new.ownership_generation := gen_random_uuid();
  elsif new.ownership_generation is distinct from old.ownership_generation then
    raise exception 'worker ownership generation is controlled by the database';
  end if;
  return new;
end;
$$;

revoke all on function public.novaflow_worker_ownership_generation() from public;
drop trigger if exists novaflow_worker_ownership_generation on public.gpu_workers;
create trigger novaflow_worker_ownership_generation
before insert or update of owner_id, ownership_generation on public.gpu_workers
for each row execute function public.novaflow_worker_ownership_generation();

commit;
