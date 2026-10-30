import test from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { startLocalControlPlane } from '../../control-local/src/server.mjs';
import { generateWorkerSecret } from '../../packages/shared/src/tokens.mjs';
import { call, uuid } from '../helpers.mjs';

test('public compute enrollment is pending, bounded and cannot overwrite administrator choices', async () => {
  const ctx=await startLocalControlPlane({port:0});
  try {
    const owner=(await call(ctx.url,'POST','/dev/login',{body:{email:'approval-owner@test.local',plan:'trial'}})).body;
    const id=uuid(),secret=generateWorkerSecret();
    const body={profile:'compute-only',worker_id:id,worker_name:'automatic-device-name',worker_secret:secret,
      owner_id:owner.user.id,enabled:true,owner_enabled:true,sharing_enabled:true,
      hardware:{vram_mb:32768,enabled:true,owner_enabled:true,sharing_enabled:true}};
    const first=await call(ctx.url,'POST','/api/worker/register',{body});
    assert.equal(first.status,200,JSON.stringify(first.body));
    assert.equal(first.body.worker.owner_id,null);
    assert.equal(first.body.worker.pending_approval,true);
    assert.deepEqual(first.body.worker.policy,{pending_approval:true,enabled:false,owner_enabled:false,sharing_enabled:false,sharing_scope:'selected',allowed_user_ids:[]});
    const workerToken=first.body.workerToken;
    await call(ctx.url,'POST','/api/worker/models',{token:workerToken,body:{models:[{model_id:'qwen-image-2511',status:'ready'}]}});
    const heartbeat=await call(ctx.url,'POST','/api/worker/heartbeat',{token:workerToken,body:{status:'idle'}});
    assert.equal(heartbeat.body.worker.pending_approval,true);
    assert.equal((await call(ctx.url,'POST','/api/worker/claim',{token:workerToken})).body.task,null);
    assert.equal((await call(ctx.url,'GET','/api/web/nodes',{token:owner.session.token})).body.nodes.length,0);
    assert.equal((await call(ctx.url,'GET','/api/web/capabilities')).body.available_workers,0);
    const task={task_type:'qwen_t2i',target_worker_id:id,parameters:{prompt:'approval test',width:512,height:512,count:1}};
    assert.equal((await call(ctx.url,'POST','/api/web/tasks',{token:owner.session.token,body:task})).status,403);
    const retry=await call(ctx.url,'POST','/api/worker/register',{body});
    assert.equal(retry.status,200,JSON.stringify(retry.body));
    assert.equal(retry.body.worker.policy.enabled,false);
    assert.equal((await call(ctx.url,'POST','/api/worker/register',{body:{...body,worker_secret:generateWorkerSecret()}})).status,409);
    assert.equal((await call(ctx.url,'POST','/api/worker/register',{body:{...body,profile:'legacy',worker_id:uuid()}})).status,401);
    // Only a privileged backend update approves, assigns ownership and names the machine.
    await ctx.db.query("update public.gpu_workers set owner_id=$2,enabled=true,owner_enabled=true,worker_name='后台命名',name_managed=true where id=$1",[id,owner.user.id]);
    await ctx.db.exec(await readFile(new URL('../../supabase/migrations/20261030030000_compute_auto_enrollment.sql',import.meta.url),'utf8'));
    const approved=await call(ctx.url,'POST','/api/worker/register',{body:{...body,worker_name:'client tries to rename'}});
    assert.equal(approved.body.worker.pending_approval,false);
    assert.equal(approved.body.worker.worker_name,'后台命名');
    assert.equal(approved.body.worker.policy.enabled,true);
    const created=await call(ctx.url,'POST','/api/web/tasks',{token:owner.session.token,body:task});
    assert.equal(created.status,200,JSON.stringify(created.body));
    const claimed=await call(ctx.url,'POST','/api/worker/claim',{token:workerToken});
    assert.equal(claimed.body.task.id,created.body.task.id);
    // Concurrent approvals cannot be undone by retrying the pending RPC directly.
    const row=await ctx.store.getWorkerById(id);
    const same=await ctx.store.enrollPendingWorker({workerId:id,workerName:'bad rename',secretHash:row.worker_secret_hash,hardware:{},peerHash:'a'.repeat(64)});
    assert.equal(same.worker_name,'后台命名');
    assert.equal(same.owner_id,owner.user.id);
    assert.equal(same.enabled,true);
    // First enrollment already consumed one unit. Header/body spoofing cannot change peer identity.
    for(let i=0;i<8;i++) {
      const res=await call(ctx.url,'POST','/api/worker/register',{headers:{'x-forwarded-for':'fake-'+i},body:{...body,worker_id:uuid()}});
      assert.equal(res.status,200,JSON.stringify(res.body));
    }
    const concurrent=await Promise.all([1,2].map(i=>call(ctx.url,'POST','/api/worker/register',{
      headers:{'x-forwarded-for':'different-'+i},body:{...body,worker_id:uuid()}})));
    assert.deepEqual(concurrent.map(x=>x.status).sort(),[200,429],'database enforces the per-peer quota atomically');
    // Global pending quota also bounds growth from many distinct peer IPs.
    await ctx.db.exec("insert into public.gpu_workers(id,worker_name,owner_id,worker_secret_hash,status,enabled,owner_enabled,sharing_enabled) select gen_random_uuid(),'quota-'||n,null,repeat('c',64),'idle',false,false,false from generate_series(1,991) n");
    const full=await ctx.plane.handle({method:'POST',path:'/api/worker/register',clientAddress:'new-trusted-peer',body:{...body,worker_id:uuid()}});
    assert.equal(full.status,503,JSON.stringify(full.body));
  } finally { await new Promise(resolve=>ctx.server.close(resolve)); await ctx.db.close(); }
});


test('sessions, legacy profiles and user-minted codes cannot approve new machines', async () => {
  const ctx=await startLocalControlPlane({port:0});
  try {
    const login=(await call(ctx.url,'POST','/dev/login',{body:{email:'no-self-approval@test.local',plan:'trial'}})).body;
    const token=login.session.token;
    const register=async (extra={},session=token)=>await call(ctx.url,'POST','/api/worker/register',{
      token:session,body:{worker_id:uuid(),worker_name:'cannot-self-approve-'+uuid(),worker_secret:generateWorkerSecret(),
        hardware:{vram_mb:32768},enabled:true,owner_enabled:true,sharing_enabled:true,...extra}
    });
    const legacy=await register({profile:'legacy'});
    const omitted=await register();
    const code=await call(ctx.url,'POST','/api/web/workers/codes',{token,body:{label:'self-minted'}});
    assert.equal(code.status,200,JSON.stringify(code.body));
    const coded=await register({profile:'legacy',registration_code:code.body.registration_code},null);
    for(const row of [legacy,omitted,coded]) {
      assert.equal(row.status,200,JSON.stringify(row.body));
      assert.equal(row.body.worker.owner_id,login.user.id);
      assert.equal(row.body.worker.policy.enabled,false);
      assert.equal(row.body.worker.policy.owner_enabled,false);
      assert.equal(row.body.worker.policy.sharing_enabled,false);
      await call(ctx.url,'POST','/api/worker/models',{token:row.body.workerToken,body:{models:[{model_id:'qwen-image-2511',status:'ready'}]}});
      await call(ctx.url,'POST','/api/worker/heartbeat',{token:row.body.workerToken,body:{status:'idle',enabled:true}});
      assert.equal((await call(ctx.url,'POST','/api/worker/claim',{token:row.body.workerToken})).body.task,null);
      const denied=await call(ctx.url,'POST','/api/web/tasks',{token,body:{task_type:'qwen_t2i',target_worker_id:row.body.worker.id,parameters:{prompt:'x',width:512,height:512,count:1}}});
      assert.equal(denied.status,403,JSON.stringify(denied.body));
    }
    assert.equal((await call(ctx.url,'GET','/api/web/nodes',{token})).body.nodes.length,0);
    assert.equal((await call(ctx.url,'GET','/api/web/capabilities',{token})).body.available_workers,0);
    // Legacy/authenticated requests consume the same network quota as anonymous enrollment.
    for(let i=0;i<7;i++) assert.equal((await register({profile:'legacy'})).status,200);
    assert.equal((await register({profile:'compute-only'})).status,429);
  } finally { await new Promise(resolve=>ctx.server.close(resolve)); await ctx.db.close(); }
});
