-- Rewrite legacy users.plan = 'team' to 'pro'.
--
-- Idempotent. Does not change credits, max_sessions, or expires_at.
-- Do not apply to production until the operator approves migration A.
-- Run the dry-run queries in 20261028160000_users_plan_team_to_pro.dry-run.sql
-- first and keep the counts with the approval.

begin;

create table if not exists public.admin_plan_migration_snapshot (
  user_id uuid primary key,
  from_plan text not null,
  to_plan text not null,
  email text,
  max_sessions integer,
  expires_at timestamptz,
  snapshotted_at timestamptz not null default now()
);

alter table public.admin_plan_migration_snapshot enable row level security;
alter table public.admin_plan_migration_snapshot force row level security;
revoke all on table public.admin_plan_migration_snapshot from public, anon, authenticated;
grant select, insert, update, delete on table public.admin_plan_migration_snapshot to service_role;

insert into public.admin_plan_migration_snapshot (user_id, from_plan, to_plan, email)
select id, plan, 'pro', email
  from public.users
 where plan = 'team'
on conflict (user_id) do nothing;

-- Copy session fields when those columns exist. The live users row is not updated here.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'users' and column_name = 'max_sessions'
  ) and exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'users' and column_name = 'expires_at'
  ) then
    update public.admin_plan_migration_snapshot s
       set max_sessions = u.max_sessions,
           expires_at = u.expires_at
      from public.users u
     where s.user_id = u.id
       and s.from_plan = 'team';
  end if;
end
$$;

update public.users
   set plan = 'pro'
 where plan = 'team';

comment on column public.users.plan is
  '账户类型：trial=普通（仅本机），standard=中级（普通节点），pro=高级（所有节点）；历史 team 已并入 pro';

commit;
