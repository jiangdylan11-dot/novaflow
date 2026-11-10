-- 小桃记忆: each account keeps a short list of its own preferences (models,
-- styles, video/audio/UI habits, export formats, things to avoid). Only the
-- preference text is stored, never chat logs or pictures. One row per
-- (user, category, slot): a newer preference of the same kind replaces the old
-- one, and an account keeps at most 20 rows (the oldest goes first).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table if not exists public.xiaotao_user_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  category text not null check (category in ('model','art','video','audio','ui','export','chat','avoid')),
  slot text not null check (slot ~ '^[a-z0-9_.:-]{1,64}$'),
  memory_text text not null check (char_length(memory_text) between 1 and 120),
  source text not null check (source in ('explicit','adopted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category, slot)
);
create index if not exists xiaotao_user_memories_user_idx on public.xiaotao_user_memories (user_id, updated_at desc);

alter table public.xiaotao_user_memories enable row level security;
revoke all on public.xiaotao_user_memories from public, anon, authenticated;
grant select, insert, update, delete on public.xiaotao_user_memories to service_role;

create or replace function public.xiaotao_memory_save(p_user_id uuid, p_category text, p_slot text, p_text text, p_source text)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_row public.xiaotao_user_memories;
begin
  if not exists (select 1 from public.users where id = p_user_id and status = 'active') then raise exception 'unknown user'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 4711));
  insert into public.xiaotao_user_memories (user_id, category, slot, memory_text, source)
  values (p_user_id, p_category, p_slot, p_text, p_source)
  on conflict (user_id, category, slot) do update
    set memory_text = excluded.memory_text, source = excluded.source, updated_at = now()
  returning * into v_row;
  delete from public.xiaotao_user_memories m where m.user_id = p_user_id and m.id in (
    select id from public.xiaotao_user_memories where user_id = p_user_id order by updated_at desc offset 20);
  return jsonb_build_object('id', v_row.id, 'category', v_row.category, 'slot', v_row.slot,
    'text', v_row.memory_text, 'source', v_row.source, 'updatedAt', v_row.updated_at);
end $$;
revoke all on function public.xiaotao_memory_save(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.xiaotao_memory_save(uuid, text, text, text, text) to service_role;

commit;
