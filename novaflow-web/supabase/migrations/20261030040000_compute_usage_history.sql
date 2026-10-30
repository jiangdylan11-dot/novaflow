-- A small, permanent operational record, independent of users, nodes and task payloads.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table if not exists public.web_compute_usage (
  id uuid primary key,
  user_id uuid not null,
  user_account text not null default '',
  assigned_worker_id uuid,
  worker_name text not null default '',
  task_type text not null,
  model_id text not null default '',
  status text not null,
  attempt_count integer not null default 0,
  charged_credit_cost numeric(20,6) not null default 0,
  error_code text not null default '',
  error_message text not null default '',
  created_at timestamptz not null,
  assigned_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz not null
);
create index if not exists web_compute_usage_user_time_idx on public.web_compute_usage(user_id, created_at desc, id desc);
create index if not exists web_compute_usage_time_idx on public.web_compute_usage(created_at desc, id desc);
alter table public.web_compute_usage enable row level security;
alter table public.web_compute_usage force row level security;
revoke all on public.web_compute_usage from public, anon, authenticated, service_role;
grant select on public.web_compute_usage to service_role;

create or replace function public.web_capture_compute_usage()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t public.web_ai_tasks%rowtype;
  account_name text;
  node_name text;
begin
  if tg_op = 'UPDATE' and row(new.assigned_worker_id,new.task_type,new.model_id,new.status,new.attempt_count,new.charged_credit_cost,new.error_code,new.error_message,new.assigned_at,new.started_at,new.completed_at,new.failed_at,new.cancelled_at)
    is not distinct from row(old.assigned_worker_id,old.task_type,old.model_id,old.status,old.attempt_count,old.charged_credit_cost,old.error_code,old.error_message,old.assigned_at,old.started_at,old.completed_at,old.failed_at,old.cancelled_at) then return new; end if;
  if tg_op = 'DELETE' then t := old; else t := new; end if;
  select coalesce(nullif(to_jsonb(u)->>'account',''), nullif(to_jsonb(u)->>'display_name',''), u.email, '') into account_name
    from public.users u where u.id = t.user_id;
  select w.worker_name into node_name from public.gpu_workers w where w.id = t.assigned_worker_id;
  insert into public.web_compute_usage as h (
    id,user_id,user_account,assigned_worker_id,worker_name,task_type,model_id,status,attempt_count,charged_credit_cost,
    error_code,error_message,created_at,assigned_at,started_at,completed_at,failed_at,cancelled_at,updated_at
  ) values (
    t.id,t.user_id,coalesce(account_name,''),t.assigned_worker_id,coalesce(node_name,''),t.task_type,t.model_id,t.status,t.attempt_count,t.charged_credit_cost,
    t.error_code,left(t.error_message,2000),t.created_at,t.assigned_at,t.started_at,t.completed_at,t.failed_at,t.cancelled_at,t.updated_at
  ) on conflict (id) do update set
    -- Keep identity snapshots when a user/node disappears or a task is requeued.
    user_account = case when h.user_account = '' then excluded.user_account else h.user_account end,
    assigned_worker_id = coalesce(excluded.assigned_worker_id,h.assigned_worker_id),
    worker_name = case when excluded.assigned_worker_id is not null and excluded.assigned_worker_id is distinct from h.assigned_worker_id then excluded.worker_name
                       when h.worker_name = '' then excluded.worker_name else h.worker_name end,
    model_id = excluded.model_id,status = excluded.status,attempt_count = excluded.attempt_count,
    charged_credit_cost = excluded.charged_credit_cost,error_code = excluded.error_code,error_message = excluded.error_message,
    assigned_at = coalesce(excluded.assigned_at,h.assigned_at),started_at = coalesce(excluded.started_at,h.started_at),
    completed_at = excluded.completed_at,failed_at = excluded.failed_at,cancelled_at = excluded.cancelled_at,updated_at = excluded.updated_at;
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;
revoke all on function public.web_capture_compute_usage() from public, anon, authenticated, service_role;
drop trigger if exists web_capture_compute_usage on public.web_ai_tasks;
create trigger web_capture_compute_usage after insert or update or delete on public.web_ai_tasks
  for each row execute function public.web_capture_compute_usage();

-- Existing rows are copied without modifying the scheduler's task rows.
insert into public.web_compute_usage (
  id,user_id,user_account,assigned_worker_id,worker_name,task_type,model_id,status,attempt_count,charged_credit_cost,
  error_code,error_message,created_at,assigned_at,started_at,completed_at,failed_at,cancelled_at,updated_at
)
select t.id,t.user_id,coalesce(nullif(to_jsonb(u)->>'account',''),nullif(to_jsonb(u)->>'display_name',''),u.email,''),
  coalesce(t.assigned_worker_id,e.worker_id),coalesce(w.worker_name,''),t.task_type,t.model_id,t.status,t.attempt_count,t.charged_credit_cost,
  t.error_code,left(t.error_message,2000),t.created_at,t.assigned_at,t.started_at,t.completed_at,t.failed_at,t.cancelled_at,t.updated_at
from public.web_ai_tasks t left join public.users u on u.id = t.user_id
left join lateral (select ev.worker_id from public.web_task_events ev where ev.task_id=t.id and ev.worker_id is not null order by ev.id desc limit 1) e on true
left join public.gpu_workers w on w.id=coalesce(t.assigned_worker_id,e.worker_id)
on conflict(id) do nothing;

create or replace function public.web_protect_compute_usage()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin raise exception 'Compute usage history must be retained' using errcode='42501'; end $$;
revoke all on function public.web_protect_compute_usage() from public, anon, authenticated, service_role;
drop trigger if exists web_protect_compute_usage_delete on public.web_compute_usage;
create trigger web_protect_compute_usage_delete before delete on public.web_compute_usage for each statement execute function public.web_protect_compute_usage();
drop trigger if exists web_protect_compute_usage_truncate on public.web_compute_usage;
create trigger web_protect_compute_usage_truncate before truncate on public.web_compute_usage for each statement execute function public.web_protect_compute_usage();

create or replace function public.admin_compute_usage_summary()
returns table(user_id uuid,user_account text,total_tasks bigint,failed_tasks bigint,latest_at timestamptz,workers jsonb)
language sql stable security invoker set search_path = public, pg_temp as $$
  with nodes as (
    select h.user_id,h.assigned_worker_id,h.worker_name,count(*) as tasks
      from public.web_compute_usage h where h.assigned_worker_id is not null group by h.user_id,h.assigned_worker_id,h.worker_name
  )
  select h.user_id,max(h.user_account),count(*),count(*) filter(where h.status='failed'),max(h.created_at),
    coalesce((select jsonb_agg(jsonb_build_object('id',n.assigned_worker_id,'name',n.worker_name,'tasks',n.tasks) order by n.tasks desc,n.assigned_worker_id) from nodes n where n.user_id=h.user_id),'[]'::jsonb)
  from public.web_compute_usage h group by h.user_id order by count(*) desc,h.user_id;
$$;
revoke all on function public.admin_compute_usage_summary() from public, anon, authenticated;
grant execute on function public.admin_compute_usage_summary() to service_role;
notify pgrst, 'reload schema';
commit;
