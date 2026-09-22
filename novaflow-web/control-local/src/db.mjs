// Local control-plane database: real PostgreSQL, compiled to wasm (PGlite).
//
// The point of using PGlite rather than a mock is that the SQL in
// supabase/migrations runs here exactly as it will run on Supabase - the same
// constraints, the same FOR UPDATE SKIP LOCKED semantics, the same plpgsql.
// A test that passes here is evidence about the production migration, not
// about a lookalike.

import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(HERE, '../..');
// The credits migrations come from THIS worktree's checkout of stable HEAD
// (D:/AI_APP/NovaFlow-Web/supabase/migrations), never from the live stable
// working directory - the Web line does not read or write that tree at all.
const STABLE_MIGRATIONS = resolve(WEB_ROOT, '../supabase/migrations');

// The production credits path the Web line reuses verbatim. Listed explicitly
// rather than globbed, because the security-hardening migrations assume a live
// project and are not part of what the Web line depends on.
const REUSED_STABLE_MIGRATIONS = [
  '20260710000000_comfyui_usage_settlement.sql',
  '20260710001000_credits_user_id_unique.sql',
  '20260712000000_decimal_comfy_image_settlement.sql'
];

export async function createDatabase({ verbose = false } = {}) {
  // pgcrypto is preloaded because the reused stable migration asks for it.
  const db = new PGlite({ extensions: { pgcrypto } });
  const log = verbose ? (m) => console.log('[db] ' + m) : () => {};

  await db.exec(await readFile(join(HERE, 'bootstrap.sql'), 'utf8'));
  log('bootstrap applied');

  for (const name of REUSED_STABLE_MIGRATIONS) {
    const sql = await readFile(join(STABLE_MIGRATIONS, name), 'utf8');
    await db.exec(sql);
    log('stable migration applied: ' + name);
  }

  const webMigrationDir = join(WEB_ROOT, 'supabase/migrations');
  const files = (await readdir(webMigrationDir))
    .filter((f) => f.endsWith('.sql') && !f.startsWith('rollback_') && !f.includes('optional'))
    .sort();
  for (const name of files) {
    const sql = await readFile(join(webMigrationDir, name), 'utf8');
    await db.exec(sql);
    log('web migration applied: ' + name);
  }

  return db;
}

/** Seed a user with a credit balance. Test/demo helper only. */
export async function seedUser(db, { email, balance = 1000, displayName = '' }) {
  const res = await db.query(
    `insert into public.users (email, display_name, status)
     values ($1, $2, 'active')
     on conflict (email) do update set display_name = excluded.display_name
     returning *`,
    [email, displayName]
  );
  const user = res.rows[0];
  await db.query(
    `insert into public.credits (user_id, balance) values ($1, $2)
     on conflict (user_id) do update set balance = excluded.balance, updated_at = now()`,
    [user.id, balance]
  );
  return user;
}

/**
 * The manual provider budget settle_comfy_usage debits alongside the user.
 * Production keeps this in system_settings; we mirror the same key so the
 * settlement function behaves identically.
 */
export async function seedProviderBudget(db, { providerKey = 'comfyui', balance = 100000 } = {}) {
  await db.query(
    `insert into public.system_settings (key, value)
     values ($1, $2::jsonb)
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    ['provider_budget_' + providerKey, JSON.stringify({ balance })]
  );
}
