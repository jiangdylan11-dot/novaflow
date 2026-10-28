import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

test('settle_grok_quota does not increment used_count when p_success is false', async () => {
  const migration = await readFile(join(repoRoot, 'supabase/migrations/20261028010000_settle_grok_quota_failure_does_not_charge.sql'), 'utf8');
  const adminSchema = await readFile(join(repoRoot, 'novaflow-web/admin/license-admin-gui/supabase-admin-schema.sql'), 'utf8');
  const chargeLine = 'v_used := greatest(coalesce((v_value->>\'used_count\')::integer, 0), 0) + case when p_success then p_actual_calls else 0 end;';
  assert.match(migration, /case when p_success then p_actual_calls else 0 end/);
  assert.ok(adminSchema.includes(chargeLine));

  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(await readFile(join(repoRoot, 'novaflow-web/control-local/src/bootstrap.sql'), 'utf8'));
  await db.exec(await readFile(join(repoRoot, 'supabase/migrations/20260812030000_grok_quota_reservations.sql'), 'utf8'));
  await db.exec(migration);

  const user = (await db.query("insert into public.users (email, display_name, status) values ('quota@novaflow.local', 'Quota', 'active') returning id")).rows[0];
  await db.query('select public.set_grok_quota($1, 5, $2, $3::jsonb)', [user.id, 'test', '{}']);

  await db.query('select public.reserve_grok_quota($1, $2, $3, 1, 1, $4::jsonb)', [user.id, 'fail-1', 'image-reverse', '{}']);
  await db.query('select public.settle_grok_quota($1, $2, 1, false, $3::jsonb, $4::jsonb)', [user.id, 'fail-1', '[]', '{}']);
  const failed = (await db.query(
    "select (value->>'used_count')::int as used, (value->>'reserved_count')::int as reserved from public.system_settings where key = $1",
    ['provider_quota_grok_' + user.id]
  )).rows[0];
  const failedRow = (await db.query('select status, success, actual_calls from public.grok_quota_reservations where usage_key = $1', ['fail-1'])).rows[0];
  assert.equal(Number(failed.used), 0);
  assert.equal(Number(failed.reserved), 0);
  assert.equal(failedRow.status, 'settled');
  assert.equal(failedRow.success, false);
  assert.equal(Number(failedRow.actual_calls), 1);

  await db.query('select public.reserve_grok_quota($1, $2, $3, 1, 1, $4::jsonb)', [user.id, 'ok-1', 'prompt-optimize', '{}']);
  await db.query('select public.settle_grok_quota($1, $2, 1, true, $3::jsonb, $4::jsonb)', [user.id, 'ok-1', '[]', '{}']);
  const ok = (await db.query(
    "select (value->>'used_count')::int as used, (value->>'reserved_count')::int as reserved from public.system_settings where key = $1",
    ['provider_quota_grok_' + user.id]
  )).rows[0];
  assert.equal(Number(ok.used), 1);
  assert.equal(Number(ok.reserved), 0);
  await db.close();
});
