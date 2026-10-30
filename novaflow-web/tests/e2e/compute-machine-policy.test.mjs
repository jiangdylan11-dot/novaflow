import { approveComputeWorker } from '../helpers.mjs';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { startLocalControlPlane } from '../../control-local/src/server.mjs';
import { generateWorkerSecret } from '../../packages/shared/src/tokens.mjs';
import { call, uuid } from '../helpers.mjs';

test('machine policy controls private use, selected sharing, scheduling and revocation', async () => {
  const ctx = await startLocalControlPlane({port:0});
  try {
    const login = async (email,plan) => (await call(ctx.url,'POST','/dev/login',{body:{email,plan,balance:5000}})).body;
    const owner = await login('private-owner@test.local','trial');
    const friend = await login('selected-friend@test.local','pro');
    const stranger = await login('stranger@test.local','pro');
    const id=uuid(), secret=generateWorkerSecret();
    const reg=await call(ctx.url,'POST','/api/worker/register',{token:owner.session.token,body:{
      worker_id:id,worker_name:'private-machine',worker_secret:secret,profile:'compute-only',hardware:{vram_mb:32768}
    }});
    assert.equal(reg.status,200,JSON.stringify(reg.body));
    assert.equal(reg.body.worker.policy.owner_enabled,false);
    await approveComputeWorker(ctx.db,id,{sharing:false});
    assert.equal(reg.body.worker.policy.sharing_enabled,false);
    const workerToken=reg.body.workerToken;
    await call(ctx.url,'POST','/api/worker/models',{token:workerToken,body:{models:[{model_id:'qwen-image-2511',status:'ready'}]}});
    await call(ctx.url,'POST','/api/worker/heartbeat',{token:workerToken,body:{status:'idle'}});
    const nodes=async token => (await call(ctx.url,'GET','/api/web/nodes',{token})).body.nodes;
    assert.equal((await nodes(owner.session.token))[0].is_owner,true);
    assert.equal((await nodes(stranger.session.token)).length,0);
    assert.equal((await call(ctx.url,'GET','/api/web/capabilities')).body.available_workers,0);
    assert.equal((await call(ctx.url,'GET','/api/web/capabilities?worker='+id,{token:owner.session.token})).body.available_workers,1);
    const body={task_type:'qwen_t2i',target_worker_id:id,parameters:{prompt:'test',width:512,height:512,count:1}};
    const create=async token => await call(ctx.url,'POST','/api/web/tasks',{token,body});
    const own=await create(owner.session.token);
    assert.equal(own.status,200,JSON.stringify(own.body));
    assert.equal(own.body.capableWorkers,1);
    assert.equal((await create(stranger.session.token)).status,403);
    await call(ctx.url,'POST','/api/web/tasks/'+own.body.task.id+'/cancel',{token:owner.session.token});
    await ctx.db.query("update public.gpu_workers set sharing_enabled=true,sharing_scope='selected',allowed_user_ids=$2::uuid[] where id=$1",[id,[friend.user.id]]);
    assert.equal((await nodes(friend.session.token)).length,1);
    assert.equal((await nodes(stranger.session.token)).length,0);
    const shared=await create(friend.session.token);
    assert.equal(shared.status,200,JSON.stringify(shared.body));
    assert.equal(shared.body.capableWorkers,1);
    await ctx.db.query('update public.gpu_workers set enabled=false where id=$1',[id]);
    const hb=await call(ctx.url,'POST','/api/worker/heartbeat',{token:workerToken,body:{status:'idle',hardware:{enabled:true}}});
    assert.equal(hb.body.worker.policy.enabled,false,'heartbeat cannot undo administrator policy');
    assert.equal((await call(ctx.url,'POST','/api/worker/claim',{token:workerToken})).body.task,null);
    assert.equal((await nodes(owner.session.token)).length,0);
    await ctx.db.query('update public.gpu_workers set enabled=true,sharing_enabled=false where id=$1',[id]);
    assert.equal((await call(ctx.url,'POST','/api/worker/claim',{token:workerToken})).body.task,null,'revoked sharing blocks already queued foreign work');
    const own2=await call(ctx.url,'POST','/api/web/tasks',{token:owner.session.token,body:{...body,target_worker_id:null}});
    assert.equal(own2.status,200,'ordinary accounts can auto-select their own authorized machine');
    const claim=await call(ctx.url,'POST','/api/worker/claim',{token:workerToken});
    assert.equal(claim.body.task.id,own2.body.task.id,'private task still works while sharing is off');
    await call(ctx.url,'POST','/api/worker/tasks/'+own2.body.task.id+'/fail',{token:workerToken,body:{task_id:own2.body.task.id,error_message:'test cleanup'}});
    await ctx.db.query('update public.gpu_workers set owner_enabled=false,sharing_enabled=true where id=$1',[id]);
    assert.equal((await create(owner.session.token)).status,403,'owner permission is independent from sharing');
    assert.equal((await create(friend.session.token)).status,200);
    const again=await call(ctx.url,'POST','/api/worker/register',{body:{worker_id:id,worker_name:'private-machine',worker_secret:secret,profile:'compute-only'}});
    assert.equal(again.body.worker.policy.owner_enabled,false);
    assert.equal(again.body.worker.policy.sharing_enabled,true,'re-registration preserves administrator choice');
    await ctx.db.query("update public.gpu_workers set owner_id=$2,enabled=true,status='maintenance' where id=$1",[id,stranger.user.id]);
    await ctx.db.exec(await readFile(new URL('../../supabase/migrations/20261030020000_compute_machine_policy.sql',import.meta.url),'utf8'));
    assert.equal((await ctx.store.getWorkerById(id)).enabled,true,'reapplying migration preserves administrator policy');
    await call(ctx.url,'POST','/api/worker/register',{token:owner.session.token,body:{worker_id:id,worker_name:'private-machine',worker_secret:secret,profile:'compute-only'}});
    assert.equal((await ctx.store.getWorkerById(id)).owner_id,stranger.user.id,'re-registering cannot undo administrator owner assignment');
  } finally { await new Promise(resolve=>ctx.server.close(resolve)); await ctx.db.close(); }
});
