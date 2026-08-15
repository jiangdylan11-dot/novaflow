import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath) => readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

const emergency = read("supabase/migrations/20260721010000_emergency_public_data_hardening.sql");
const rateLimit = read("supabase/migrations/20260721011000_license_verify_rate_limit.sql");
const finalLockdown = read("supabase/migrations/20260721020000_final_service_role_only.sql");
const rollback = read("supabase/tests/rollback_final_to_emergency.sql");
const emergencyVerification = read("supabase/tests/verify_emergency_public_data_hardening.sql");
const finalVerification = read("supabase/tests/verify_final_service_role_only.sql");

const migrations = [emergency, rateLimit, finalLockdown];

test("every security migration is transactional, bounded, and reloads PostgREST", () => {
  for (const source of migrations) {
    assert.match(source, /^--[\s\S]*?\nbegin;\s*$/im);
    assert.match(source, /set local lock_timeout = '5s';/i);
    assert.match(source, /set local statement_timeout = '60s';/i);
    assert.match(source, /notify pgrst, 'reload schema';/i);
    assert.match(source, /commit;\s*$/i);
  }
});

test("emergency phase removes writes and preserves only reviewed read compatibility", () => {
  assert.match(emergency, /revoke all privileges on table public\.licenses from public, anon, authenticated/i);
  assert.match(emergency, /revoke all privileges on table public\.users from public, anon, authenticated/i);
  assert.match(emergency, /revoke all privileges on table public\.credits from public, anon, authenticated/i);
  assert.match(emergency, /revoke all privileges on table public\.system_settings from public, anon, authenticated/i);
  assert.match(emergency, /revoke all privileges on table public\.ai_providers from public, anon, authenticated/i);

  assert.match(emergency, /drop policy if exists "licenses anon read" on public\.licenses/i);
  assert.match(emergency, /create policy novaflow_emergency_license_legacy_select_v1[\s\S]*?to anon[\s\S]*?using \(status in \('active', 'banned', 'expired'\)\)/i);
  assert.doesNotMatch(emergency, /novaflow_emergency_license_legacy_select_v1[\s\S]{0,180}using \(true\)/i);
  assert.match(emergency, /grant select \(license_key, machine_id, status, expire_at, permissions\)[\s\S]*?to anon/i);

  assert.match(emergency, /create policy novaflow_emergency_users_self_select_v1[\s\S]*?id = \(select auth\.uid\(\)\)/i);
  assert.match(emergency, /create policy novaflow_emergency_credits_self_select_v1[\s\S]*?user_id = \(select auth\.uid\(\)\)/i);
  assert.match(emergency, /create policy novaflow_emergency_settings_self_select_v1[\s\S]*?provider_quota_%[\s\S]*?auth\.uid\(\)/i);

  assert.doesNotMatch(emergency, /grant\s+(?:insert|update|delete|all)[^;]*\bto\s+(?:public|anon|authenticated)\b/i);
  assert.match(emergency, /optional public\.% is missing columns/i);
});

test("policy cleanup is restricted to NovaFlow-owned policies and one reviewed legacy policy", () => {
  const allowed = new Set([
    "licenses anon read",
    "novaflow_emergency_license_legacy_select_v1",
    "novaflow_emergency_users_self_select_v1",
    "novaflow_emergency_credits_self_select_v1",
    "novaflow_emergency_settings_self_select_v1"
  ]);

  for (const source of [emergency, finalLockdown, rollback]) {
    const dropped = [...source.matchAll(/drop policy if exists\s+(?:"([^"]+)"|([a-z0-9_]+))\s+on/gi)]
      .map((match) => match[1] || match[2]);
    assert.ok(dropped.length > 0);
    for (const policyName of dropped) assert.equal(allowed.has(policyName), true, `unmanaged policy drop: ${policyName}`);
  }
});

test("license verification limiter is persistent, atomic, and service-role-only", () => {
  assert.match(rateLimit, /create table if not exists public\.novaflow_license_verify_rate_limits/i);
  assert.match(rateLimit, /identity_hash ~ '\^\[0-9a-f\]\{64\}\$'/i);
  assert.match(rateLimit, /create or replace function public\.check_novaflow_license_verify_rate_limit\(\s*p_identity_hash text,\s*p_window_seconds integer,\s*p_max_attempts integer\s*\)/i);
  assert.match(rateLimit, /on conflict \(identity_hash\) do update/i);
  assert.match(rateLimit, /'allowed', v_allowed/i);
  assert.match(rateLimit, /'retry_after_seconds', v_retry_after_seconds/i);
  assert.match(rateLimit, /'remaining_attempts'/i);
  assert.match(rateLimit, /updated_at < v_now - interval '24 hours'/i);
  assert.match(rateLimit, /limit 100\s+for update skip locked/i);
  assert.match(rateLimit, /alter table public\.novaflow_license_verify_rate_limits force row level security/i);
  assert.match(rateLimit, /revoke all privileges on function public\.check_novaflow_license_verify_rate_limit\(text, integer, integer\)[\s\S]*?from public, anon, authenticated/i);
  assert.match(rateLimit, /grant execute on function public\.check_novaflow_license_verify_rate_limit\(text, integer, integer\)[\s\S]*?to service_role/i);
});

test("final phase is forced-RLS default deny with explicit service grants", () => {
  assert.match(finalLockdown, /alter table public\.%I force row level security/i);
  assert.match(finalLockdown, /revoke all privileges on table public\.%I from public, anon, authenticated/i);
  assert.match(finalLockdown, /grant select, insert, update, delete on table public\.%I to service_role/i);
  assert.match(finalLockdown, /Table- and column-level ACLs are independent/i);
  assert.doesNotMatch(finalLockdown, /create policy/i);
  assert.match(finalLockdown, /found unmanaged RLS policies/i);
  assert.match(finalLockdown, /check_novaflow_license_verify_rate_limit/i);
  assert.doesNotMatch(finalLockdown, /novaflow_grok_quota_reservations|reserve_novaflow_grok_quota|settle_novaflow_grok_quota/i);
});

test("verification and rollback artifacts are safe by default", () => {
  assert.match(emergencyVerification, /begin transaction read only;/i);
  assert.match(emergencyVerification, /rollback;\s*$/i);
  assert.match(finalVerification, /begin transaction read only;/i);
  assert.match(finalVerification, /rollback;\s*$/i);
  assert.match(finalVerification, /requires default-deny RLS/i);
  assert.match(rollback, /current_setting\('novaflow\.confirm_security_rollback', true\)/i);
  assert.match(rollback, /-- set local novaflow\.confirm_security_rollback = 'ROLLBACK_TO_EMERGENCY';/i);
  assert.doesNotMatch(rollback, /^set local novaflow\.confirm_security_rollback = 'ROLLBACK_TO_EMERGENCY';/im);
  assert.doesNotMatch(rollback, /grant\s+(?:insert|update|delete|all)[^;]*\bto\s+(?:public|anon|authenticated)\b/i);
});
