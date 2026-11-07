-- Make "which login is newest" unambiguous.
--
-- 20261013010000_user_session_limits.sql stamped each session with now(),
-- which is the transaction START time, and broke ties by the random uuid.
-- Two problems followed:
--   * Two logins of one account in the same clock tick got the same
--     created_at, so the uuid decided which one was "oldest": half the time
--     the login that just happened was the one pushed out, and its fresh
--     token was refused at once. PostgreSQL in wasm (PGlite, the local
--     control plane and the tests) has a millisecond clock, so this hit
--     the user-session-limits test about 2 runs in 5.
--   * now() is taken before the users row lock. A login that started first
--     but got the lock second was stamped older than the one ahead of it,
--     and trimmed its own new session.
-- The new session is now stamped after the lock is held, and strictly later
-- than every earlier session of the same account. Schema is unchanged;
-- only novaflow_open_user_session is replaced (same signature and grants).

create or replace function public.novaflow_open_user_session(p_user_id uuid, p_user_agent text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer;
  v_session_id uuid;
  v_created_at timestamptz;
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

  -- Taken while the users row lock is held, so it follows login order;
  -- bumped by 1 microsecond when the clock has not moved since the last one.
  select greatest(clock_timestamp(), max(s.created_at) + interval '1 microsecond')
    into v_created_at
    from public.user_sessions s
   where s.user_id = p_user_id;

  insert into public.user_sessions (user_id, user_agent, created_at)
  values (p_user_id, left(coalesce(p_user_agent, ''), 300), v_created_at)
  returning id into v_session_id;

  perform public.novaflow_trim_user_sessions(p_user_id, greatest(coalesce(v_limit, 1), 1), 'replaced');
  return v_session_id;
end;
$$;

revoke all on function public.novaflow_open_user_session(uuid, text) from public, anon, authenticated;
grant execute on function public.novaflow_open_user_session(uuid, text) to service_role;
