-- Local stand-in for the production base schema.
--
-- This file exists ONLY for the local PGlite control plane and the test
-- suite. It recreates the shape of the tables the live NovaFlow project
-- already has (users, credits, system_settings, ai_providers) so the real
-- settlement migrations and the real Web fabric migration can run unmodified
-- against a throwaway database.
--
-- It is never applied to production. Production already has these tables and
-- this project is forbidden from touching them.

create extension if not exists pgcrypto;

-- service_role must exist with BYPASSRLS because the Web fabric migration
-- asserts it, exactly as the production hardening does.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    create role service_role bypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
end
$$;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text not null default '',
  role text not null default 'user',
  plan text not null default 'trial',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users (id) on delete cascade,
  balance integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (id) on delete set null,
  change integer not null default 0,
  balance_after integer not null default 0,
  reason text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_providers (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null unique,
  status text not null default 'enabled',
  display_name text not null default '',
  created_at timestamptz not null default now()
);

insert into public.ai_providers (provider_key, status, display_name)
values ('comfyui', 'enabled', 'ComfyUI (local worker)')
on conflict (provider_key) do nothing;
