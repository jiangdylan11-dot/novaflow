import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// The sweep migration runs on real PostgreSQL (PGlite). The live billing functions it calls are not in this
// repository, so they are stood in by recorders that change state the way the live ones do; the test checks
// which operations the sweep picks and which closing call each one gets. Synthetic data only.
const migration=await readFile(new URL('../../supabase/migrations/20261107120000_xiaotao_sweep_open_recorded_v3.sql',import.meta.url),'utf8');
const rollback=await readFile(new URL('../../supabase/migrations/rollback_20261107120000_xiaotao_sweep_open_recorded_v3.sql',import.meta.url),'utf8');
const USER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const schema=`
create role anon; create role authenticated; create role service_role;
create table public.xiaotao_operation_v3_operations(operation_id uuid primary key,user_id uuid,session_id text,model text,policy_version text,intent_hash text,status text,outcome text,receipt jsonb);
create table public.xiaotao_operation_v3_stages(operation_id uuid,phase_id text,sequence_no int,phase_kind text,usage_key text,request_hash text,status text);
create table public.credit_ledger(usage_key text primary key,status text,estimated_credits numeric,created_at timestamptz,updated_at timestamptz,art_dispatched_at timestamptz);
create table public.calls(name text,operation_id uuid,outcome text);
create function public.reject_xiaotao_operation_stage_v3(p_operation_id uuid,p_user_id uuid,p_session_id text,p_model text,p_policy_version text,p_intent_hash text,p_phase_id text,p_request_hash text,p_evidence jsonb) returns jsonb language plpgsql as $$
begin insert into public.calls values('reject',p_operation_id,null);
 update public.xiaotao_operation_v3_stages set status='rejected' where operation_id=p_operation_id and phase_id=p_phase_id and status='dispatched';
 return jsonb_build_object('status','rejected'); end $$;
create function public.finalize_xiaotao_operation_v3_refund(p_operation_id uuid,p_user_id uuid,p_session_id text,p_model text,p_policy_version text,p_intent_hash text) returns jsonb language plpgsql as $$
begin insert into public.calls values('refund',p_operation_id,'cancel');
 update public.xiaotao_operation_v3_operations set status='settled',outcome='cancel' where operation_id=p_operation_id;
 return jsonb_build_object('status','settled','charged',0); end $$;
create function public.finalize_xiaotao_operation_v3(p_operation_id uuid,p_user_id uuid,p_session_id text,p_model text,p_policy_version text,p_intent_hash text,p_outcome text) returns jsonb language plpgsql as $$
begin insert into public.calls values('finalize',p_operation_id,p_outcome);
 update public.xiaotao_operation_v3_operations set status='settled',outcome=p_outcome where operation_id=p_operation_id;
 update public.xiaotao_operation_v3_stages set status='settled' where operation_id=p_operation_id and status='recorded';
 return jsonb_build_object('status','settled','charged',0.240914); end $$;`;
async function database(){const db=new PGlite();await db.exec(schema);await db.exec(migration);return db;}
let n=0;
async function operation(db,{user=USER,stages,ageMinutes}){
  const id=`00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`,at=`now()-interval '${ageMinutes} minutes'`;
  await db.query(`insert into public.xiaotao_operation_v3_operations values($1,$2,'s','m','v','h','open',null,null)`,[id,user]);
  for(const [i,status] of stages.entries()){
    const key=id+':'+i;
    await db.query(`insert into public.xiaotao_operation_v3_stages values($1,$2,$3,'planner',$4,'rh',$5)`,[id,'foart_'+(i+1),i+1,key,status]);
    await db.exec(`insert into public.credit_ledger values('${key}','reserved',1.406797,${at},${at},${at})`);
  }
  return id;
}
const sweep=async(db,user=USER)=>(await db.query(`select public.sweep_xiaotao_stale_dispatched_v3($1,120) r`,[user])).rows[0].r;
const calls=async db=>(await db.query('select name,operation_id::text id,outcome from public.calls')).rows;

test('an operation left open with recorded usage (like 6a469892) is closed as a browser cancel after 30 minutes',async()=>{
  const db=await database(),stuck=await operation(db,{stages:['recorded'],ageMinutes:31});
  const result=await sweep(db);
  assert.deepEqual(await calls(db),[{name:'finalize',id:stuck,outcome:'cancel'}]);
  assert.equal(result.closed.length,1);assert.equal(result.closed[0].operation_id,stuck);assert.equal(result.skipped,0);
  assert.equal((await db.query('select status from public.xiaotao_operation_v3_operations where operation_id=$1',[stuck])).rows[0].status,'settled');
});
test('a recent open operation waiting on a tool step is left alone',async()=>{
  const db=await database();await operation(db,{stages:['recorded'],ageMinutes:20});
  const result=await sweep(db);assert.deepEqual(await calls(db),[]);assert.equal(result.closed.length,0);
});
test('a stale dispatched phase keeps the existing refund path and is not charged as a cancel',async()=>{
  const db=await database(),stale=await operation(db,{stages:['dispatched'],ageMinutes:40});
  const result=await sweep(db);
  assert.deepEqual((await calls(db)).map(c=>c.name),['reject','refund']);assert.equal(result.refunded[0].operation_id,stale);assert.equal(result.closed.length,0);
});
test('a recorded phase with another still dispatched is not closed by the new loop',async()=>{
  const db=await database();await operation(db,{stages:['recorded','dispatched'],ageMinutes:1});
  await sweep(db);assert.deepEqual(await calls(db),[]);
});
test('only the calling user\'s operations are swept',async()=>{
  const db=await database();await operation(db,{user:OTHER,stages:['recorded'],ageMinutes:90});
  await sweep(db);assert.deepEqual(await calls(db),[]);
});
test('a failing close is skipped without stopping the sweep',async()=>{
  const db=await database();const a=await operation(db,{stages:['recorded'],ageMinutes:45}),b=await operation(db,{stages:['recorded'],ageMinutes:50});
  await db.exec(`create or replace function public.finalize_xiaotao_operation_v3(p_operation_id uuid,p_user_id uuid,p_session_id text,p_model text,p_policy_version text,p_intent_hash text,p_outcome text) returns jsonb language plpgsql as $$
   begin if p_operation_id='${a}' then raise exception 'boom'; end if; insert into public.calls values('finalize',p_operation_id,p_outcome);
   update public.xiaotao_operation_v3_operations set status='settled' where operation_id=p_operation_id; return jsonb_build_object('status','settled','charged',0.1); end $$;`);
  const result=await sweep(db);assert.equal(result.skipped,1);assert.deepEqual(result.closed.map(c=>c.operation_id),[b]);
});
test('the migration and its rollback apply twice and keep the service-role-only grant',async()=>{
  const db=await database();await db.exec(migration);
  const grant=async()=>(await db.query(`select has_function_privilege('anon','public.sweep_xiaotao_stale_dispatched_v3(uuid,integer)','execute') anon,
    has_function_privilege('service_role','public.sweep_xiaotao_stale_dispatched_v3(uuid,integer)','execute') svc`)).rows[0];
  assert.deepEqual(await grant(),{anon:false,svc:true});
  await db.exec(rollback);await db.exec(rollback);assert.deepEqual(await grant(),{anon:false,svc:true});
  await operation(db,{stages:['recorded'],ageMinutes:60});const result=await sweep(db);
  assert.equal(result.closed,undefined,'the rollback is the live sweep, without the new loop');
});
test('the migration changes no pinned billing function',()=>{
  for(const name of ['finalize_xiaotao_operation_v3(','finalize_xiaotao_operation_v3_core','reserve_xiaotao_operation_stage_v3','get_xiaotao_operation_status_v3','xiaotao_v3_gate_before_ledger_insert','settle_xiaotao_credits_v2'])
    assert.doesNotMatch(migration,new RegExp('FUNCTION public\\.'+name.replace(/[()]/g,'\\$&'),'i'),name);
});
