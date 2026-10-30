import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createDatabase,seedUser} from '../../control-local/src/db.mjs';

test('compute history survives task, node and account deletion and remains read-only to the service role', async()=>{
  const db=await createDatabase();
  try {
    const user=await seedUser(db,{email:'history-fixture@test.local',displayName:'历史用户'});
    const node=(await db.query(`insert into public.gpu_workers(owner_id,worker_name,worker_secret_hash,status,enabled,owner_enabled,sharing_enabled) values($1,'历史机器',repeat('a',64),'idle',true,true,false) returning id`,[user.id])).rows[0];
    const task=(await db.query(`insert into public.web_ai_tasks(user_id,task_type,model_id,status,input_manifest) values($1,'image','fixture-model','queued','{"prompt":"must-not-be-archived"}') returning id`,[user.id])).rows[0];
    await db.query(`update public.web_ai_tasks set assigned_worker_id=$1,assigned_at=now(),started_at=now()-interval '10 seconds',status='processing',attempt_count=1 where id=$2`,[node.id,task.id]);
    await db.query(`update public.gpu_workers set worker_name='后来改名' where id=$1`,[node.id]);
    // Supabase grants ordinary task writes via its default privileges; PGlite has none.
    await db.exec('grant select,update on public.web_ai_tasks to service_role');
    await db.exec('set role service_role');
    await db.query(`update public.web_ai_tasks set status='completed',completed_at=now(),charged_credit_cost=12 where id=$1`,[task.id]);
    await db.exec('reset role');
    await db.query(`delete from public.gpu_workers where id=$1`,[node.id]);
    assert.equal((await db.query('select assigned_worker_id from public.web_ai_tasks where id=$1',[task.id])).rows[0].assigned_worker_id,null);
    let history=(await db.query('select * from public.web_compute_usage where id=$1',[task.id])).rows[0];
    assert.equal(history.worker_name,'历史机器'); assert.equal(history.assigned_worker_id,node.id); assert.equal(Number(history.charged_credit_cost),12);
    assert.equal(JSON.stringify(history).includes('must-not-be-archived'),false);
    await db.query('delete from public.web_ai_tasks where id=$1',[task.id]);
    await db.query('delete from public.users where id=$1',[user.id]);
    history=(await db.query('select * from public.web_compute_usage where id=$1',[task.id])).rows[0];
    assert.equal(history.user_account,'历史用户'); assert.equal(history.status,'completed');
    const summary=(await db.query('select * from public.admin_compute_usage_summary()')).rows;
    assert.equal(summary.length,1); assert.equal(Number(summary[0].total_tasks),1); assert.equal(summary[0].workers[0].name,'历史机器');
    await assert.rejects(db.exec('delete from public.web_compute_usage'),/must be retained/);
    await assert.rejects(db.exec('truncate public.web_compute_usage'),/must be retained/);
    await db.exec('set role service_role');
    assert.equal((await db.query('select count(*) from public.web_compute_usage')).rows[0].count,1);
    await assert.rejects(db.exec("update public.web_compute_usage set worker_name='tampered'"),/permission denied/);
    await assert.rejects(db.exec('delete from public.web_compute_usage'),/permission denied/);
    await db.exec('reset role');
  } finally {await db.close();}
});

test('migration backfills existing tasks and recovers deleted node identifiers from events, without copying payloads',async()=>{
  const db=await createDatabase();
  try {
    const user=await seedUser(db,{email:'legacy-history@test.local'});
    await db.exec('alter table public.web_ai_tasks disable trigger web_capture_compute_usage');
    const task=(await db.query(`insert into public.web_ai_tasks(user_id,task_type,status,error_code,error_message) values($1,'video','failed','fixture-failure','环境未就绪') returning id`,[user.id])).rows[0];
    const node='11111111-1111-4111-8111-111111111111';
    await db.query(`insert into public.web_task_events(task_id,to_status,worker_id) values($1,'assigned',$2)`,[task.id,node]);
    await db.exec(await readFile(new URL('../../supabase/migrations/20261030040000_compute_usage_history.sql',import.meta.url),'utf8'));
    const record=(await db.query('select * from public.web_compute_usage where id=$1',[task.id])).rows[0];
    assert.equal(record.assigned_worker_id,node);assert.equal(record.error_message,'环境未就绪');
    assert.equal(Number((await db.query('select * from public.admin_compute_usage_summary()')).rows[0].failed_tasks),1);
    await db.query(`update public.web_ai_tasks set status='queued',assigned_worker_id=null where id=$1`,[task.id]);
    assert.equal((await db.query('select assigned_worker_id from public.web_compute_usage where id=$1',[task.id])).rows[0].assigned_worker_id,node);
  } finally {await db.close();}
});
