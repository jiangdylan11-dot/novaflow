-- Dry-run only. Do not apply this file. It does not change rows.
-- Run against the target database before 20261028160000_users_plan_team_to_pro.sql
-- and paste the counts into the approval. Production project cjakoblszlmbmotchzva
-- must not be updated from this repository automatically.

select plan, count(*) as users
  from public.users
 group by plan
 order by 1;

select count(*) as team_rows
  from public.users
 where plan = 'team';

select id, email, display_name, plan, max_sessions, expires_at
  from public.users
 where plan = 'team'
 order by email;
