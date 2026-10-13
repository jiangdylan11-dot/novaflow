-- Per-account sign-in limit and validity period.
--
-- Every password login opens one row in user_sessions and the session token
-- carries its id (sid). When an account has more live sessions than
-- users.max_sessions allows, the oldest ones are revoked; the next request
-- made with a revoked token is refused, and the web client drops back to the
-- login screen. users.expires_at (null = permanent) refuses login and every
-- request once it has passed.
--
-- Existing accounts keep working: max_sessions defaults to 1 and expires_at
-- to null. Tokens issued before this migration carry no sid and stay valid
-- until their own exp.

create extension if not exists pgcrypto;

alter table public.users add column if not exists max_sessions integer not null default 1;
alter table public.users add column if not exists expires_at timestamptz;
alter table public.users drop constraint if exists users_max_sessions_valid;
alter table public.users add constraint users_max_sessions_valid check (max_sessions between 1 and 99);

comment on column public.users.max_sessions is '同时在线数：同一账号最多同时登录几处，超出时挤掉最早登录的';
comment on column public.users.expires_at is '有效期：到期后不能登录，已登录的也会被退出；空 = 永久';

create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text
);

create index if not exists user_sessions_user_live_idx
  on public.user_sessions (user_id, created_at desc)
  where revoked_at is null;

comment on table public.user_sessions is 'NovaFlow 登录会话：每次账号密码登录一行，被挤下线或改密码时写 revoked_at';

alter table public.user_sessions enable row level security;
alter table public.user_sessions force row level security;
revoke all on table public.user_sessions from public, anon, authenticated;
grant select, insert, update, delete on table public.user_sessions to service_role;

-- Keep the newest p_keep live sessions of a user and revoke the rest.
-- p_keep = 0 signs the account out everywhere.
create or replace function public.novaflow_trim_user_sessions(p_user_id uuid, p_keep integer, p_reason text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.user_sessions s
     set revoked_at = now(),
         revoked_reason = left(coalesce(p_reason, ''), 40)
   where s.user_id = p_user_id
     and s.revoked_at is null
     and s.id not in (
       select k.id
         from public.user_sessions k
        where k.user_id = p_user_id
          and k.revoked_at is null
        order by k.created_at desc, k.id desc
        limit greatest(coalesce(p_keep, 0), 0)
     );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Open a session for a password login and push out the oldest ones beyond
-- the account's limit. The users row lock serialises two logins of the same
-- account, so both cannot keep their seat.
create or replace function public.novaflow_open_user_session(p_user_id uuid, p_user_agent text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer;
  v_session_id uuid;
begin
  select u.max_sessions into v_limit
    from public.users u
   where u.id = p_user_id
     for update;
  if not found then
    raise exception 'user not found';
  end if;

  delete from public.user_sessions s
   where s.user_id = p_user_id
     and ((s.revoked_at is not null and s.revoked_at < now() - interval '2 days')
       or s.created_at < now() - interval '30 days');

  insert into public.user_sessions (user_id, user_agent)
  values (p_user_id, left(coalesce(p_user_agent, ''), 300))
  returning id into v_session_id;

  perform public.novaflow_trim_user_sessions(p_user_id, greatest(coalesce(v_limit, 1), 1), 'replaced');
  return v_session_id;
end;
$$;

revoke all on function public.novaflow_trim_user_sessions(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.novaflow_open_user_session(uuid, text) from public, anon, authenticated;
grant execute on function public.novaflow_trim_user_sessions(uuid, integer, text) to service_role;
grant execute on function public.novaflow_open_user_session(uuid, text) to service_role;
