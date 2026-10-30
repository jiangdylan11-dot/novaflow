-- History is retained by default; explicit administrator deletion is supported.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
create table if not exists public.web_compute_usage_deleted (
  task_id uuid primary key,
  deleted_at timestamptz not null default now()
);
alter table public.web_compute_usage_deleted enable row level security;
alter table public.web_compute_usage_deleted force row level security;
revoke all on public.web_compute_usage_deleted from public,anon,authenticated,service_role;

create or replace function public.web_skip_deleted_compute_usage()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.id::text,185));
  if exists(select 1 from public.web_compute_usage_deleted d where d.task_id=new.id) then return null; end if;
  return new;
end $$;
revoke all on function public.web_skip_deleted_compute_usage() from public,anon,authenticated,service_role;
drop trigger if exists web_skip_deleted_compute_usage on public.web_compute_usage;
create trigger web_skip_deleted_compute_usage before insert on public.web_compute_usage for each row execute function public.web_skip_deleted_compute_usage();
-- Direct service-role DELETE remains revoked; only the scoped RPC below may delete.
drop trigger if exists web_protect_compute_usage_delete on public.web_compute_usage;

create or replace function public.admin_delete_compute_usage(p_user_id uuid,p_task_id uuid default null,p_before timestamptz default now())
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  target uuid;
  archived_status text;
  live_status text;
  deleted_count integer:=0;
begin
  if p_user_id is null or p_before is null then raise exception 'A user and cutoff are required'; end if;
  if p_task_id is not null and not exists(select 1 from public.web_compute_usage where id=p_task_id and user_id=p_user_id) then raise exception 'Task record not found for this user'; end if;
  for target in select h.id from public.web_compute_usage h where h.user_id=p_user_id and h.created_at<=p_before
    and (p_task_id is null or h.id=p_task_id) and (p_task_id is not null or h.status in ('completed','failed','cancelled','expired')) order by h.id
  loop
    -- Match the scheduler's lock order: task, per-record advisory lock, history.
    live_status:=null;
    select t.status into live_status from public.web_ai_tasks t where t.id=target for update;
    perform pg_advisory_xact_lock(hashtextextended(target::text,185));
    archived_status:=null;
    select h.status into archived_status from public.web_compute_usage h where h.id=target and h.user_id=p_user_id for update;
    if archived_status is null then continue; end if;
    if archived_status not in ('completed','failed','cancelled','expired') or (live_status is not null and live_status not in ('completed','failed','cancelled','expired')) then
      if p_task_id is not null then raise exception 'Active task records cannot be deleted'; end if;
      continue;
    end if;
    insert into public.web_compute_usage_deleted(task_id) values(target) on conflict do nothing;
    delete from public.web_compute_usage where id=target and user_id=p_user_id;
    deleted_count:=deleted_count+1;
  end loop;
  return jsonb_build_object('deleted',deleted_count);
end $$;
revoke all on function public.admin_delete_compute_usage(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.admin_delete_compute_usage(uuid,uuid,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;
