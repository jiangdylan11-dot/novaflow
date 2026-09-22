// Migration safety contract.
//
// The standing rule for this product line is that the Web migration must not
// change anything the stable Desktop product depends on. This suite proves
// that against a REAL PostgreSQL, by snapshotting the pre-existing schema,
// applying the Web migration, and comparing.
//
// It also proves the rollback really removes only what the migration added.

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { check, checkEqual, section, finish } from '../helpers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(HERE, '../..');
const STABLE_MIGRATIONS = resolve(WEB_ROOT, '../supabase/migrations');
const WEB_MIGRATIONS = join(WEB_ROOT, 'supabase/migrations');

const BASELINE_MIGRATIONS = [
  '20260710000000_comfyui_usage_settlement.sql',
  '20260710001000_credits_user_id_unique.sql',
  '20260712000000_decimal_comfy_image_settlement.sql'
];

// Everything the stable Desktop product reads or writes.
const PROTECTED_TABLES = [
  'users', 'credits', 'credit_logs', 'system_settings',
  'ai_providers', 'comfy_usage_settlements'
];

async function snapshot(db) {
  const columns = await db.query(`
    select c.relname as table_name, a.attname as column_name,
           pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
           a.attnotnull as not_null,
           pg_catalog.pg_get_expr(d.adbin, d.adrelid) as default_expr
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid = c.oid
      left join pg_catalog.pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
     where n.nspname = 'public' and c.relkind = 'r'
       and a.attnum > 0 and not a.attisdropped
     order by 1, 2`);

  const constraints = await db.query(`
    select c.relname as table_name, con.conname as constraint_name,
           pg_catalog.pg_get_constraintdef(con.oid) as definition
      from pg_catalog.pg_constraint con
      join pg_catalog.pg_class c on c.oid = con.conrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
     order by 1, 2`);

  const indexes = await db.query(`
    select tablename as table_name, indexname as index_name, indexdef as definition
      from pg_catalog.pg_indexes where schemaname = 'public' order by 1, 2`);

  const functions = await db.query(`
    select p.proname as name,
           pg_catalog.pg_get_function_identity_arguments(p.oid) as args,
           md5(pg_catalog.pg_get_functiondef(p.oid)) as body_hash
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
     order by 1, 2`);

  const policies = await db.query(`
    select tablename as table_name, policyname as policy_name, qual, with_check
      from pg_catalog.pg_policies where schemaname = 'public' order by 1, 2`);

  return {
    columns: columns.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
    functions: functions.rows,
    policies: policies.rows
  };
}

function only(rows, tables) {
  return rows.filter((r) => tables.includes(r.table_name));
}

async function applyDir(db, dir, files) {
  for (const name of files) {
    await db.exec(await readFile(join(dir, name), 'utf8'));
  }
}

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(await readFile(join(WEB_ROOT, 'control-local/src/bootstrap.sql'), 'utf8'));
await applyDir(db, STABLE_MIGRATIONS, BASELINE_MIGRATIONS);

// Seed real rows so we can prove data survives untouched.
await db.query(
  "insert into public.users (email, display_name, status) values ('keep@novaflow.local', 'Keep Me', 'active') returning id"
);
const user = (await db.query("select id from public.users where email = 'keep@novaflow.local'")).rows[0];
await db.query('insert into public.credits (user_id, balance) values ($1, 4242)', [user.id]);
await db.query(
  "insert into public.system_settings (key, value) values ('provider_budget_comfyui', '{\"balance\": 777}'::jsonb)"
);

const before = await snapshot(db);
const beforeCredits = (await db.query('select balance from public.credits where user_id = $1', [user.id])).rows[0];
const beforeUsers = (await db.query('select count(*)::int as n from public.users')).rows[0].n;
const beforeSettings = (await db.query("select value from public.system_settings where key = 'provider_budget_comfyui'")).rows[0];

// ---------------------------------------------------------------------------
const webFiles = (await readdir(WEB_MIGRATIONS))
  .filter((f) => f.endsWith('.sql') && !f.startsWith('rollback_') && !f.includes('optional'))
  .sort();
await applyDir(db, WEB_MIGRATIONS, webFiles);
const after = await snapshot(db);

// ---------------------------------------------------------------------------
section('the migration applies cleanly');
{
  check('web migrations found', webFiles.length > 0, webFiles);
  check('it is idempotent (applying twice does not fail)', await (async () => {
    try { await applyDir(db, WEB_MIGRATIONS, webFiles); return true; } catch (e) {
      console.log('    second apply failed: ' + e.message);
      return false;
    }
  })());
}

// ---------------------------------------------------------------------------
section('no existing table was altered');
{
  checkEqual('protected table columns are byte-identical',
    only(after.columns, PROTECTED_TABLES), only(before.columns, PROTECTED_TABLES));

  checkEqual('protected table constraints are unchanged',
    only(after.constraints, PROTECTED_TABLES), only(before.constraints, PROTECTED_TABLES));

  checkEqual('protected table indexes are unchanged',
    only(after.indexes, PROTECTED_TABLES), only(before.indexes, PROTECTED_TABLES));

  checkEqual('protected table policies are unchanged',
    only(after.policies, PROTECTED_TABLES), only(before.policies, PROTECTED_TABLES));
}

// ---------------------------------------------------------------------------
section('no existing function was redefined');
{
  const beforeByKey = new Map(before.functions.map((f) => [f.name + '(' + f.args + ')', f.body_hash]));
  const changed = after.functions
    .filter((f) => beforeByKey.has(f.name + '(' + f.args + ')'))
    .filter((f) => beforeByKey.get(f.name + '(' + f.args + ')') !== f.body_hash)
    .map((f) => f.name + '(' + f.args + ')');
  checkEqual('every pre-existing function has the same body', changed, []);

  const removed = [...beforeByKey.keys()]
    .filter((key) => !after.functions.some((f) => f.name + '(' + f.args + ')' === key));
  checkEqual('no pre-existing function was dropped', removed, []);

  check('settle_comfy_usage is reused, not rewritten',
    beforeByKey.has('settle_comfy_usage(p_usage_key text, p_user_id uuid, p_prompt_id text, p_provider_key text, p_model_key text, p_task_type text, p_estimated_credit_cost numeric, p_charge_amount numeric, p_pricing_source text, p_pricing_details jsonb)')
    || [...beforeByKey.keys()].some((k) => k.startsWith('settle_comfy_usage(')),
    [...beforeByKey.keys()].filter((k) => k.startsWith('settle_')));
}

// ---------------------------------------------------------------------------
section('no existing data was touched');
{
  const credits = (await db.query('select balance from public.credits where user_id = $1', [user.id])).rows[0];
  checkEqual('credit balance is unchanged', Number(credits.balance), Number(beforeCredits.balance));

  const users = (await db.query('select count(*)::int as n from public.users')).rows[0].n;
  checkEqual('user count is unchanged', users, beforeUsers);

  const settings = (await db.query("select value from public.system_settings where key = 'provider_budget_comfyui'")).rows[0];
  checkEqual('system settings are unchanged', settings.value, beforeSettings.value);
}

// ---------------------------------------------------------------------------
section('what it added is exactly what it claims');
{
  const NEW_TABLES = ['gpu_workers', 'worker_models', 'web_ai_tasks', 'web_task_events', 'web_worker_registration_codes'];
  const beforeTables = new Set(before.columns.map((c) => c.table_name));
  const afterTables = new Set(after.columns.map((c) => c.table_name));
  const added = [...afterTables].filter((t) => !beforeTables.has(t)).sort();
  checkEqual('exactly the declared new tables were added', added, NEW_TABLES.slice().sort());

  const dropped = [...beforeTables].filter((t) => !afterTables.has(t));
  checkEqual('no table was dropped', dropped, []);

  const newFunctions = after.functions
    .filter((f) => !before.functions.some((b) => b.name === f.name && b.args === f.args))
    .map((f) => f.name).sort();
  check('all new functions are namespaced novaflow_web_*',
    newFunctions.every((n) => n.startsWith('novaflow_web_')), newFunctions);

  // ai_tasks must be left alone entirely - the brief asked for columns on it,
  // and we deliberately did not add them without a live audit.
  check('ai_tasks was not created or altered by this migration',
    !afterTables.has('ai_tasks') || beforeTables.has('ai_tasks'),
    { existed: beforeTables.has('ai_tasks'), exists: afterTables.has('ai_tasks') });
}

// ---------------------------------------------------------------------------
section('new tables are locked to service_role');
{
  const NEW_TABLES = ['gpu_workers', 'worker_models', 'web_ai_tasks', 'web_task_events', 'web_worker_registration_codes'];
  for (const table of NEW_TABLES) {
    const rls = await db.query(
      "select relrowsecurity, relforcerowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname='public' and c.relname=$1",
      [table]
    );
    check(table + ' has RLS enabled and forced',
      rls.rows[0]?.relrowsecurity === true && rls.rows[0]?.relforcerowsecurity === true, rls.rows[0]);

    const policies = after.policies.filter((p) => p.table_name === table);
    check(table + ' denies anon/authenticated',
      policies.some((p) => String(p.qual).includes('false')), policies);

    const grants = await db.query(
      "select grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name=$1 and grantee in ('anon','authenticated')",
      [table]
    );
    checkEqual(table + ' grants nothing to anon/authenticated', grants.rows, []);
  }
}

// ---------------------------------------------------------------------------
section('the migration changes no permission it does not own');
{
  // A real one this caught, on the production database: the migration used to
  // `revoke all on function public.gen_random_uuid() from public`. That is a
  // built-in every table defaults to - including the Desktop product's own -
  // so revoking it from PUBLIC changes shared state rather than adding to it.
  // It also does not live under `public` on a real Supabase project, so the
  // whole migration aborted and nothing applied.
  //
  // Every grant here is written through `execute format(...)` over this
  // migration's own object names, so what matters is that no grant or revoke
  // names a CONCRETE identifier belonging to anything else.
  const sql = await readFile(join(WEB_MIGRATIONS, '20260922010000_novaflow_web_worker_fabric.sql'), 'utf8');
  const lines = sql.split('\n').filter((l) => /\b(grant|revoke)\b/i.test(l) && !/^\s*--/.test(l));

  const OURS = /^(gpu_workers|worker_models|web_ai_tasks|web_task_events|web_worker_registration_codes|novaflow_web_\w+)$/;
  const offenders = [];
  for (const line of lines) {
    const after = /\bon\s+(?:function\s+|table\s+|schema\s+|sequence\s+)?([^\s]+)/i.exec(line);
    if (!after) continue;
    const target = after[1].replace(/^public\./i, '').replace(/\(.*$/, '').replace(/[",;]/g, '');
    // %I / %s are filled from this migration's own name arrays.
    if (target.includes('%')) continue;
    if (!OURS.test(target)) offenders.push(line.trim().slice(0, 100));
  }

  checkEqual('no grant or revoke names an object this migration did not create',
    offenders, []);
  check('there are grants to check, so this is not vacuous', lines.length >= 3, lines.length);

  // And the names those placeholders are filled with are all ours.
  const arrays = [...sql.matchAll(/array\s*\[([^\]]+)\]/gi)].map((m) => m[1]);
  const named = arrays.flatMap((a) => [...a.matchAll(/'([^']+)'/g)].map((m) => m[1]))
    .filter((n) => /^[a-z_]+$/i.test(n));
  const foreignNames = named.filter((n) => !OURS.test(n.replace(/\(.*$/, '')));
  checkEqual('the name arrays those loops iterate contain only our objects',
    foreignNames, []);
}

section('rollback removes only what was added');
{
  const rollbackPath = join(WEB_MIGRATIONS, 'rollback_novaflow_web_worker_fabric.sql');
  let rollbackSql = '';
  try { rollbackSql = await readFile(rollbackPath, 'utf8'); } catch { /* reported below */ }
  check('a rollback script exists', rollbackSql.length > 0, rollbackPath);

  if (rollbackSql) {
    await db.exec(rollbackSql);
    const rolled = await snapshot(db);

    checkEqual('protected columns survive the rollback',
      only(rolled.columns, PROTECTED_TABLES), only(before.columns, PROTECTED_TABLES));

    const stillThere = ['gpu_workers', 'worker_models', 'web_ai_tasks', 'web_task_events', 'web_worker_registration_codes']
      .filter((t) => rolled.columns.some((c) => c.table_name === t));
    checkEqual('every Web table is gone after rollback', stillThere, []);

    const leftoverFns = rolled.functions.filter((f) => f.name.startsWith('novaflow_web_')).map((f) => f.name);
    checkEqual('every Web function is gone after rollback', leftoverFns, []);

    const credits = (await db.query('select balance from public.credits where user_id = $1', [user.id])).rows[0];
    checkEqual('credits survive the rollback', Number(credits.balance), Number(beforeCredits.balance));

    const settle = rolled.functions.filter((f) => f.name === 'settle_comfy_usage');
    check('settle_comfy_usage survives the rollback', settle.length === 1, settle);
  }
}

finish('sql-contract');
