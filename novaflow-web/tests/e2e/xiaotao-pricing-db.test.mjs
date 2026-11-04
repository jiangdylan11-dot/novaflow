import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Isolated in-memory PostgreSQL. Mirror/pool functions are narrow stubs: these
// tests exercise ledger, balance, version and role behavior, not provider calls.
async function createDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.system_settings (key text primary key, value jsonb);
    create table public.credits (user_id uuid primary key, balance numeric(20,6) not null, updated_at timestamptz default now());
    create table public.credit_ledger (
      usage_key text primary key, user_id uuid not null, feature text not null,
      provider_key text not null, model text, status text not null,
      estimated_credits numeric(20,6) not null, settled_credits numeric(20,6),
      balance_before numeric(20,6), balance_after numeric(20,6), rh_cost_usd numeric(20,8),
      rh_cost_currency text, pricing_source text, pricing_details jsonb not null default '{}'::jsonb,
      error_code text, error_message text, created_at timestamptz, updated_at timestamptz,
      settled_at timestamptz
    );
    create function public.canonical_credit_feature(text) returns text language sql immutable as $$
      select case $1 when 'xiaotao-text' then 'online_chat_turn' when 'xiaotao-vision' then 'xiaotao_vision' else $1 end
    $$;
    create function public.feature_credit_quote(text,integer) returns jsonb language sql as $$ select '{}'::jsonb $$;
    create function public.feature_credit_pool_blocked() returns boolean language sql as $$ select false $$;
    create function public.feature_credit_mirror_reserve(uuid,text,text,integer,jsonb) returns void language sql as $$ select $$;
    create function public.feature_credit_mirror_close(uuid,text,integer,boolean,text) returns void language sql as $$ select $$;
    grant select, insert, update on public.credits, public.credit_ledger to service_role;
    grant select, insert, update, delete on public.system_settings to service_role;
    insert into public.system_settings values ('feature_credit_config', '{"xiaotao_online":{"message_cap_credits":80},"credits_per_usd":211}'::jsonb);
    insert into public.credits(user_id,balance) values ('00000000-0000-0000-0000-000000000001', 1000);
  `);
  const original = await readFile(new URL('../../../supabase/migrations/20261028180000_xiaotao_online_token_credits.sql', import.meta.url), 'utf8');
  const snapshot = await readFile(new URL('../../../supabase/migrations/20261031190000_xiaotao_pricing_snapshot.sql', import.meta.url), 'utf8');
  await db.exec(original);
  await db.exec(snapshot);
  return db;
}

const user = '00000000-0000-0000-0000-000000000001';
const model = 'glm/glm-5.3-flash';
const version = 'sha256:' + 'a'.repeat(64);
const reserve = `select public.reserve_xiaotao_credits_v2($1,$2,'xiaotao-text',1,$3,'{}',20,$4,$5::jsonb,$6) as result`;
const settle = `select public.settle_xiaotao_credits_v2($1,$2,'xiaotao-text',1,$3,'{}',60,null,'token_rate_estimate') as result`;

test('stale database quote rejects before reserving any balance', async () => {
  const db = await createDb();
  try {
    const { rows: [quote] } = await db.query('select public.get_xiaotao_pricing_cap_v2() as value');
    assert.equal(quote.value.protocol, 'xiaotao-pricing-v2');
    await db.exec(`update public.system_settings set value = jsonb_set(value,'{credits_per_usd}','212') where key='feature_credit_config'`);
    await assert.rejects(db.query(reserve, [user,'stale',model,80,JSON.stringify(quote.value.config),version]), /pricing changed/);
    const { rows: [row] } = await db.query('select balance, (select count(*) from public.credit_ledger) as count from public.credits where user_id=$1',[user]);
    assert.equal(Number(row.balance),1000); assert.equal(Number(row.count),0);
  } finally { await db.close(); }
});

test('settlement uses reserved cap after settings change and is idempotent', async () => {
  const db = await createDb();
  try {
    const { rows: [quote] } = await db.query('select public.get_xiaotao_pricing_cap_v2() as value');
    const args=[user,'snapshot',model,80,JSON.stringify(quote.value.config),version];
    const { rows: [held] }=await db.query(reserve,args);
    assert.equal(Number(held.result.estimated_credits),20);
    const { rows: [duplicate] }=await db.query(reserve,args);
    assert.equal(duplicate.result.idempotent,true);
    await assert.rejects(db.query(reserve,[user,'snapshot',model,80,JSON.stringify(quote.value.config),'sha256:'+'b'.repeat(64)]), /payload mismatch/);
    await db.exec(`update public.system_settings set value = jsonb_set(value,'{xiaotao_online,message_cap_credits}','30') where key='feature_credit_config'`);
    const { rows: [done] }=await db.query(settle,[user,'snapshot',model]);
    assert.equal(Number(done.result.settled_credits),60);
    const { rows: [again] }=await db.query(settle,[user,'snapshot',model]);
    assert.equal(again.result.idempotent,true);
    const { rows: [row] }=await db.query('select balance, xiaotao_policy_cap, xiaotao_policy_version from public.credits join public.credit_ledger using(user_id) where usage_key=$1',['snapshot']);
    assert.equal(Number(row.balance),940); assert.equal(Number(row.xiaotao_policy_cap),80); assert.equal(row.xiaotao_policy_version,version);
    await assert.rejects(db.query(settle,[user,'snapshot','openai/gpt-6.1-sol-saver']), /payload mismatch/);
  } finally { await db.close(); }
});

test('new RPCs are restricted and unsupported fractional cap fails closed', async () => {
  const db = await createDb();
  try {
    const { rows: [perms] }=await db.query(`select has_function_privilege('anon','public.get_xiaotao_pricing_cap_v2()','EXECUTE') as anon,
      has_function_privilege('authenticated','public.reserve_xiaotao_credits_v2(uuid,text,text,integer,text,jsonb,numeric,numeric,jsonb,text)','EXECUTE') as authenticated,
      has_function_privilege('service_role','public.settle_xiaotao_credits_v2(uuid,text,text,integer,text,jsonb,numeric,numeric,text)','EXECUTE') as service`);
    assert.equal(perms.anon,false); assert.equal(perms.authenticated,false); assert.equal(perms.service,true);
    await db.exec(`update public.system_settings set value = jsonb_set(value,'{xiaotao_online,message_cap_credits}','80.5') where key='feature_credit_config'`);
    await assert.rejects(db.query('select public.get_xiaotao_pricing_cap_v2()'), /must be an integer/);
    await db.exec(`delete from public.system_settings where key='feature_credit_config'`);
    await assert.rejects(db.query('select public.get_xiaotao_pricing_cap_v2()'), /config missing/);
  } finally { await db.close(); }
});

test('expired hold and low balance settle only once using the reserved cap', async () => {
  const db = await createDb();
  try {
    const { rows: [quote] }=await db.query('select public.get_xiaotao_pricing_cap_v2() as value');
    await db.query(reserve,[user,'expired',model,80,JSON.stringify(quote.value.config),version]);
    await db.exec(`update public.credit_ledger set expires_at=now()-interval '1 minute' where usage_key='expired';
      select public.release_stale_feature_credits(200);
      update public.credits set balance=30 where user_id='${user}';
      update public.system_settings set value=jsonb_set(value,'{xiaotao_online,message_cap_credits}','10') where key='feature_credit_config';`);
    const { rows: [done] }=await db.query(settle,[user,'expired',model]);
    assert.equal(done.result.direct_charge,true);
    assert.equal(Number(done.result.settled_credits),30);
    assert.equal(Number(done.result.uncollected_credits),30);
    const { rows: [again] }=await db.query(settle,[user,'expired',model]);
    assert.equal(again.result.idempotent,true);
    const { rows: [row] }=await db.query('select balance from public.credits where user_id=$1',[user]);
    assert.equal(Number(row.balance),0);
  } finally { await db.close(); }
});

test('service role can use the complete v2 path while authenticated cannot', async () => {
  const db = await createDb();
  try {
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select public.get_xiaotao_pricing_cap_v2()'), /permission denied/i);
    await db.exec('reset role; set role service_role');
    const { rows: [quote] }=await db.query('select public.get_xiaotao_pricing_cap_v2() as value');
    await db.query(reserve,[user,'role-path',model,80,JSON.stringify(quote.value.config),version]);
    const { rows: [done] }=await db.query(settle,[user,'role-path',model]);
    assert.equal(Number(done.result.settled_credits),60);
  } finally { await db.close(); }
});
