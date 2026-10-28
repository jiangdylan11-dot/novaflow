// Two real Postgres connections. PGlite has one connection, so this skips
// unless NOVAFLOW_MIGRATION_TEST_URL points at a disposable database.
// novaflow-web/tools/test-quota-migration-concurrency.mjs starts Docker
// Postgres or reports that Supabase/Docker are unavailable and exits 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

const SQL = [
  'novaflow-web/control-local/src/bootstrap.sql',
  'supabase/migrations/20260812030000_grok_quota_reservations.sql',
  'supabase/migrations/20261028010000_settle_grok_quota_failure_does_not_charge.sql',
  'supabase/migrations/20261028140000_feature_credits.sql'
];

test('two connections cannot double-credit one quota migration', async (t) => {
  const url = String(process.env.NOVAFLOW_MIGRATION_TEST_URL || '').trim();
  if (!url) {
    t.skip('NOVAFLOW_MIGRATION_TEST_URL is unset. Run node novaflow-web/tools/test-quota-migration-concurrency.mjs when Docker or Supabase Postgres is available.');
    return;
  }
  let pg;
  try {
    pg = await import('pg');
  } catch {
    t.skip('pg is not installed');
    return;
  }
  const Client = pg.default?.Client || pg.Client;
  const admin = new Client({ connectionString: url });
  await admin.connect();
  await admin.query('drop schema if exists public cascade');
  await admin.query('create schema public');
  for (const file of SQL) await admin.query(await readFile(join(repoRoot, file), 'utf8'));
  const user = (await admin.query(
    "insert into public.users (email, display_name, status) values ('race@novaflow.local', 'Race', 'active') returning id"
  )).rows[0];
  await admin.query('insert into public.credits (user_id, balance) values ($1, 0)', [user.id]);
  await admin.query('select public.set_grok_quota($1, 10, $2, $3::jsonb)', [user.id, 'seed', '{}']);
  await admin.end();

  const held = new Client({ connectionString: url });
  const other = new Client({ connectionString: url });
  await held.connect();
  await other.connect();
  await held.query('select pg_advisory_lock(81402128)');
  await assert.rejects(
    other.query('select public.migrate_grok_quota_to_credits($1, 4, false)', ['batch-b']),
    /another batch holds the lock/
  );
  assert.equal(Number((await other.query('select balance from public.credits where user_id = $1', [user.id])).rows[0].balance), 0);
  await held.query('select pg_advisory_unlock(81402128)');
  const migrated = (await other.query('select public.migrate_grok_quota_to_credits($1, 4, false) as row', ['batch-b'])).rows[0].row;
  assert.equal(migrated.status, 'completed');
  const second = (await held.query('select public.migrate_grok_quota_to_credits($1, 4, false) as row', ['batch-a'])).rows[0].row;
  assert.equal(second.status, 'completed');
  assert.equal(Number(second.credits_added), 0);
  assert.equal(Number((await held.query('select balance from public.credits where user_id = $1', [user.id])).rows[0].balance), 40);
  await held.end();
  await other.end();
});
